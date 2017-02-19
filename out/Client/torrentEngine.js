"use strict";
const net_1 = require("net");
const webrtc_socket_1 = require("webrtc-socket");
const events_1 = require("events");
const url_1 = require("url");
const fs = require("fs");
const peer_tracker_1 = require("peer-tracker");
const binary_bitfield_1 = require("../modules/binary-bitfield");
const _ = require("lodash");
const extend = require("extend");
const debug = require("debug")("torrent-engine"), mkdirp = require("mkdirp"), TPH = require("torrent-piece-handler").default, Wire = require("bittorrent-wire").default;
const PeerData = {
    bitfield: "00",
    index: 0,
    piece: 0
};
const MAX_PEERS = 55;
class TorrentHandler extends events_1.EventEmitter {
    constructor(torrent) {
        super();
        this._debug = (...args) => {
            args[0] = "[" + this._debugId + "] " + args[0];
            debug.apply(null, args);
        };
        if (!(this instanceof TorrentHandler))
            return new TorrentHandler(torrent);
        const self = this;
        self._debugId = ~~((Math.random() * 100000) + 1);
        self.peerID = "-EM0012-ABCDEFGHIJKL";
        self.finished = torrent.finished;
        self.torrent = torrent;
        self.port = null;
        self.trackers = {};
        self.trackerData = {};
        self.peers = {};
        self.peerCount = 0;
        self.wires = {};
        self.connectQueue = [];
        self.haveStack = [];
        self.bitfieldDL = torrent.bitfieldDL || "00";
        self.bitfield = (!torrent.pieces) ? null : new binary_bitfield_1.default(torrent.pieces.length, torrent.bitfieldDL);
        self.tph = (!torrent.pieces) ? null : new TPH(torrent.files, torrent.length, torrent.pieceLength, torrent.pieces.length, torrent.lastPieceLength);
        process.on("uncaughtException", function (err) {
            self._debug(err);
        });
        self.incomingPeers = net_1.createServer((socket) => {
            self.createIncomingPeer(socket);
        }).listen(0, () => {
            self.port = self.incomingPeers.address().port;
            self._debug("Listening on port:", self.port);
        });
        self.incomingWrtcPeers = webrtc_socket_1.wrtcCreateServer((socket) => {
            self.createIncomingPeer(socket);
        });
        self.incomingWrtcPeers.listen(9001);
        self.torrent["announce"].forEach((tracker) => {
            let pt = url_1.parse(tracker);
            if (pt.protocol === "udp:") {
                self.trackers[tracker] = peer_tracker_1.Client.udp("scrape", pt.hostname, pt.port, self.port, self.torrent.infoHash, self.torrent.left, self.torrent.uploaded, self.torrent.downloaded);
            }
            else if (pt.protocol === "wss:") {
                self.trackers[tracker] = peer_tracker_1.Client.ws("scrape", pt.hostname, 443, self.port, self.torrent.infoHash, self.torrent.left, self.torrent.uploaded, self.torrent.downloaded);
            }
            else if (pt.protocol === "ws:") {
                self.trackers[tracker] = peer_tracker_1.Client.ws("scrape", pt.hostname, 80, self.port, self.torrent.infoHash, self.torrent.left, self.torrent.uploaded, self.torrent.downloaded);
            }
            self.trackers[tracker].on("announce", (interval, leechers, seeders, peers) => {
                peers = peers.map((peer) => { return peer + ":" + ((self.trackers[tracker].TYPE === "udp") ? "tcp" : "ws"); });
                self.connectQueue = self.connectQueue.concat(peers);
                self.connectQueue = _.uniq(self.connectQueue);
                if (!self.finished)
                    self.newConnectionRequests();
            });
            self.trackers[tracker].on("error", () => {
                self.trackerData[tracker + ":failure"] = true;
            });
            self.trackers[tracker].on("scrape", (seeders, completed, leechers, timeTillNextScrape) => {
                self.trackerData[tracker + ":seeders"] = seeders;
                self.trackerData[tracker + ":completed"] = completed;
                self.trackerData[tracker + ":leechers"] = leechers;
                self.trackerData[tracker + ":nextReq"] = timeTillNextScrape;
            });
        });
    }
    newConnectionRequests() {
        const self = this;
        while (self.peerCount < MAX_PEERS && (self.connectQueue.length)) {
            let peer = self.connectQueue.shift().split(":");
            self.createPeer(Number(peer[1]), peer[0], peer[2]);
        }
    }
    createIncomingPeer(socket) {
        const self = this;
        let host = (socket.remoteAddress) ? socket.remoteAddress : socket.host, port = (socket.remotePort) ? socket.remotePort : socket.port, family = (socket.remoteFamily) ? socket.remoteFamily : socket.family, wire = self.wires[host] = new Wire(self.torrent.infoHash, self.peerID);
        self.peers[host + port] = { port, family, wire, socket, bitfield: "00", position: 0, piece: (-1), mode: 2, activeCount: 0 };
        socket.pipe(wire).pipe(socket);
        wire.on("handshake", (infoHash, peerID) => {
            if (self.torrent.infoHash !== infoHash.toString("hex"))
                return;
            wire.sendHandshake();
            wire.sendBitfield(self.bitfieldDL);
        });
        wire.on("request", () => {
            if (!wire.reqBusy) {
                wire.reqBusy = true;
                while (wire.inRequests.length) {
                    let request = wire.inRequests.shift();
                    self.tph.prepareUpload(request.index, request.begin, request.length, (piece) => {
                        process.nextTick(() => {
                            wire.sendPiece(piece);
                        });
                    });
                }
                wire.reqBusy = false;
            }
        });
        wire.on("have", (pieceIndex) => {
        });
        self.peers[host + port].socket.on("close", () => {
            self._debug("the socket decided to leave");
            self.peers[host + port] = null;
            delete self.peers[host + port];
        });
    }
    createPeer(port, host, type) {
        const self = this;
        self._debug("Create new peer");
        self.peerCount++;
        self.peers[host + port] = { port, family: "ipv4", wire: new Wire(self.torrent.infoHash, self.peerID), socket: null, bitfield: "00", position: 0, piece: (-1), mode: 0, activeCount: 0 };
        if (type === "tcp")
            self.peers[host + port].socket = net_1.connect(port, host);
        else if (type === "ws")
            self.peers[host + port].socket = webrtc_socket_1.wrtcConnect(port, host);
        self.peers[host + port].socket.once("connect", () => {
            self.peers[host + port]["socket"].pipe(self.peers[host + port].wire).pipe(self.peers[host + port]["socket"]);
            self.peers[host + port].wire.sendHandshake();
        });
        self.peers[host + port].socket.on("error", (err) => {
            self.peers[host + port].wire.closeConnection();
            self.peers[host + port].socket.destroy();
            delete self.peers[host + port];
            self.newConnectionRequests();
        });
        self.peers[host + port].socket.on("close", () => {
            if (self.peers[host + port].socket)
                self.peers[host + port].socket.destroy();
            delete self.peers[host + port];
            self.peerCount--;
            self.newConnectionRequests();
        });
        self.peers[host + port]["wire"].on("metadata", (torrent) => {
            self._debug("Incoming metadata");
            extend(self.torrent, torrent);
            self.bitfield = new binary_bitfield_1.default(self.torrent.pieces.length, self.torrent.bitfieldDL);
            self.manageFiles();
            self.tph = new TPH(self.torrent.files, self.torrent.length, self.torrent.pieceLength, self.torrent.pieces.length, self.torrent.lastPieceLength);
            self._debug("Download phase");
            self.downloadPhase();
        });
        self.peers[host + port]["wire"].on("pex_added", (peers) => {
            self.connectQueue = self.connectQueue.concat(peers);
            self.connectQueue = _.uniq(self.connectQueue);
            if (!self.finished)
                self.newConnectionRequests();
        });
        self.peers[host + port]["wire"].on("bitfield", (payload) => {
            self._debug("peer's bitfield");
            self.peers[host + port].bitfield = payload;
            if (self.peers[host + port]["wire"].isChoked)
                self.peers[host + port]["wire"].sendInterested();
            if (self.torrent.pieces) {
                self.peers[host + port].mode = 1;
                self.fetchNewPiece(self.peers[host + port]);
            }
            else {
                self.peers[host + port].mode = 3;
                self.peers[host + port]["wire"].metaDataRequest();
            }
        });
        self.peers[host + port]["wire"].on("have", (payload) => {
            if (!self.bitfield)
                return;
            self.peers[host + port].bitfield = self.bitfield.onHave(payload, self.peers[host + port].bitfield);
            let busy = self.peers[host + port]["wire"].isBusy();
            if (!busy && !self.finished && self.torrent.pieces.length) {
                self.peers[host + port]["wire"].setBusy();
                self.fetchNewPiece(self.peers[host + port]);
            }
        });
        self.peers[host + port]["wire"].on("finished_piece", (index, block, hash) => {
            self._debug("finished piece");
            self._debug("peerCount: ", self.peerCount);
            let speed = 0;
            for (let p in self.peers) {
                speed += self.peers[p]["wire"].downloadSpeed();
            }
            let blockHash = hash.digest("hex");
            let percent = 0;
            if (blockHash === self.torrent.pieces[index]) {
                self.torrent.downloaded += block.length;
                self.torrent.left -= block.length;
                self.tph.saveBlock(self.peers[host + port].position, block);
                percent = self.bitfield.setDownloaded(self.peers[host + port].piece);
            }
            else {
                self._debug("failed hash");
                self.bitfield.set(self.peers[host + port].piece, false);
            }
            self._debug("index downloaded: ", index);
            self._debug("percent:          ", percent);
            if (percent === 1) {
                self.finished = true;
                self.finish();
                self.cleanupSeeders();
            }
            else {
                process.nextTick(() => {
                    self.fetchNewPiece(self.peers[host + port]);
                });
            }
        });
    }
    fetchNewPiece(peer) {
        const self = this;
        self.bitfield.findNewPieces(peer.bitfield, (result, downloading, which) => {
            if (which !== (-1)) {
                peer.piece = which;
                peer.position = self.tph.pieceIndex(which);
                self.tph.prepareRequest(which, (buf, count) => {
                    this._debug(`send ${count} piece request(s)`);
                    peer["wire"].sendRequest(buf, count);
                });
            }
            else {
                peer["wire"].unsetBusy();
            }
        });
    }
    downloadPhase() {
        const self = this;
        for (let host in self.peers) {
            if (self.peers[host].mode === 3) {
                self.peers[host]["wire"].removeMeta();
            }
            self.peers[host].mode = 1;
            self.fetchNewPiece(self.peers[host]);
        }
    }
    finish() {
        const self = this;
        self._debug("DONE");
    }
    cleanupSeeders() {
        const self = this;
        for (let host in self.peers) {
            if (self.bitfield.isSeeder(self.peers[host].bitfield)) {
                self.peers[host].wire.closeConnection();
                self.peers[host].socket.destroy();
                delete self.peers[host];
            }
        }
    }
    cleanupAll() {
        const self = this;
        for (let host in self.peers) {
            self.peers[host].socket.destroy();
            delete self.peers[host];
        }
    }
    manageFiles() {
        this.torrent["files"] = this.torrent["files"].map((file) => {
            let downloadDirectory = "Downloads";
            let folders = __dirname + "/" + downloadDirectory + "/" + file.path;
            let f = folders.split("/");
            let fileName = f.splice(-1);
            folders = f.join("/");
            mkdirp(folders, function (err) {
                if (err)
                    console.error(err);
                else
                    fs.writeFileSync(folders + "/" + fileName, new Buffer(file.length));
            });
            file.path = folders + "/" + fileName;
            return file;
        });
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = TorrentHandler;
//# sourceMappingURL=torrentEngine.js.map
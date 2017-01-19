"use strict";
const net_1 = require("net");
const events_1 = require("events");
const trackerClient_1 = require("./trackerClient");
const Hose_1 = require("./Hose");
const parse_p2p_tracker_1 = require("../modules/parse-p2p-tracker");
const torrent_piece_handler_1 = require("../modules/torrent-piece-handler");
const binary_bitfield_1 = require("../modules/binary-bitfield");
const _ = require("lodash");
const debug = require("debug");
debug('torrentEngine');
const PeerData = {
    bitfield: '00',
    index: 0,
    piece: 0
};
const MAX_PEERS = 50;
class torrentHandler extends events_1.EventEmitter {
    constructor(torrent) {
        super();
        this._debug = function (...args) {
            args = [].slice.call(arguments);
            args[0] = '[' + this._debugId + '] ' + args[0];
            debug.apply(null, args);
        };
        if (!(this instanceof torrentHandler))
            return new torrentHandler(torrent);
        const self = this;
        self._debugId = ~~((Math.random() * 100000) + 1);
        self.peerID = 'empire';
        self.finished = false;
        self.torrent = torrent;
        self.pieces = torrent.pieces;
        self.infoHash = torrent.infoHash;
        self.uploaded = torrent.uploaded;
        self.downloaded = torrent.downloaded;
        self.left = torrent.left;
        self.port = ~~((Math.random() * (65535 - 1)) + 1);
        self.trackers = {};
        self.trackerData = {};
        self.peers = {};
        self.hoses = {};
        self.connectQueue = [];
        self.haveStack = [];
        self.bitfieldDL = torrent.bitfieldDL || '00';
        self.bitfield = new binary_bitfield_1.default(torrent.pieces.length, torrent.bitfieldDL);
        self.tph = new torrent_piece_handler_1.default(torrent.files, torrent.length, torrent.pieceLength, torrent.pieces.length, torrent.lastPieceLength);
        self.torrent['announce'].forEach((tracker) => {
            let pt = parse_p2p_tracker_1.default(tracker);
            if (pt.type === 'udp') {
                self.trackers[tracker] = new trackerClient_1.udpTracker(pt.host, pt.port, self.port, self.infoHash);
            }
            else {
                self.trackers[tracker] = new trackerClient_1.wssTracker();
            }
            self.trackers[tracker].on('announce', (interval, leechers, seeders, peers) => {
                self.connectQueue = self.connectQueue.concat(peers);
                self.connectQueue = _.uniq(self.connectQueue);
                self.newConnectionRequests();
            });
            self.trackers[tracker].on('error', () => {
                self.trackerData[tracker + ':failure'] = true;
            });
            self.trackers[tracker].on('scrape', (seeders, completed, leechers, timeTillNextScrape) => {
                self.trackerData[tracker + ':seeders'] = seeders;
                self.trackerData[tracker + ':completed'] = completed;
                self.trackerData[tracker + ':leechers'] = leechers;
                self.trackerData[tracker + ':nextReq'] = timeTillNextScrape;
            });
        });
        self.incomingPeers = net_1.createServer((socket) => {
            self._debug('new connection');
            let host = socket.remoteAddress, port = socket.remotePort, family = socket.remoteFamily, hose = self.hoses[host] = new Hose_1.default(self.infoHash, self.peerID, self.bitfieldDL);
            self.peers[host] = { port, family, hose, socket, bitfield: '00', position: 0, piece: 0 };
            socket.pipe(hose).pipe(socket);
            self.peers[host].socket.on('close', () => {
                self._debug('the socket decided to leave');
            });
        }).listen(self.port);
    }
    newConnectionRequests() {
        const self = this;
        while ((self.peers.length || 0) < MAX_PEERS && (self.connectQueue.length)) {
            let peer = self.connectQueue.shift().split(':');
            self.createPeer(peer[1], peer[0]);
        }
    }
    createPeer(port, host) {
        const self = this;
        let peer = self.peers[host] = { port, family: 'ipv4', hose: new Hose_1.default(self.infoHash, self.peerID), socket: null, bitfield: '00', position: 0, piece: 0 };
        peer.socket = net_1.connect(port, host);
        peer.socket.once('connect', () => {
            peer['socket'].pipe(peer.hose).pipe(peer['socket']);
            peer.hose.sendHandshake();
        });
        peer['hose'].on('bitfield', (payload) => {
            peer.bitfield = payload;
            self.fetchNewPiece(peer);
        });
        self.peers[host]['hose'].on('have', (payload) => {
            self.peers[host].bitfield = self.bitfield.onHave(payload, self.peers[host].bitfield);
            let busy = self.peers[host]['hose'].isBusy();
            if (!busy && !self.finished) {
                self.peers[host]['hose'].setBusy();
                self.fetchNewPiece(self.peers[host]);
            }
        });
        self.peers[host]['hose'].on('finished_piece', (index, begin, block, hash) => {
            this._debug('finished piece');
            let blockHash = hash.digest('hex');
            let percent = 0;
            if (blockHash === self.pieces[index]) {
                self.tph.saveBlock(self.peers[host].position, block);
                percent = self.bitfield.setDownloaded(self.peers[host].piece);
            }
            console.log('perect: ', percent);
            if (percent === 1) {
                self.finished = true;
                self.cleanupSeeders();
            }
            else {
                process.nextTick(() => {
                    self.fetchNewPiece(self.peers[host]);
                });
            }
        });
    }
    fetchNewPiece(peer) {
        const self = this;
        self.bitfield.findNewPieces(peer.bitfield, (result, downloading, which) => {
            if (which !== (-1)) {
                if (peer['hose'].isChoked)
                    peer['hose'].sendInterested();
                peer.piece = which;
                peer.position = self.tph.pieceIndex(which);
                self.tph.prepareRequest(which, (buf, count) => {
                    this._debug('send piece request %n', count);
                    peer['hose'].sendRequest(buf, count);
                });
            }
            else {
                peer['hose'].unsetBusy();
            }
        });
    }
    cleanupSeeders() {
        const self = this;
        for (let host in self.peers) {
            if (self.bitfield.isSeeder(self.peers[host].bitfield)) {
                self.peers[host].socket.destroy();
                self.peers[host].hose.close();
                delete self.peers[host];
            }
        }
    }
    cleanupAll() {
        const self = this;
        for (let host in self.peers) {
            self.peers[host].socket.close();
            self.peers[host].hose.close();
            delete self.peers[host];
        }
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = torrentHandler;
//# sourceMappingURL=torrentEngine.js.map
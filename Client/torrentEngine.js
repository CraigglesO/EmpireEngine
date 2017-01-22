"use strict";
const net_1 = require("net");
const events_1 = require("events");
const fs = require("fs");
const trackerClient_1 = require("./trackerClient");
const Hose_1 = require("./Hose");
const parse_p2p_tracker_1 = require("../modules/parse-p2p-tracker");
const torrent_piece_handler_1 = require("../modules/torrent-piece-handler");
const binary_bitfield_1 = require("../modules/binary-bitfield");
const _ = require("lodash");
const extend = require("extend");
const debug = require("debug");
debug('torrentEngine');
const mkdirp = require('mkdirp');
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
        console.log('torrent: ', torrent);
        self._debugId = ~~((Math.random() * 100000) + 1);
        self.peerID = '-EM0012-ABCDEFGHIJKL';
        self.finished = false;
        self.torrent = torrent;
        self.port = ~~((Math.random() * (65535 - 1)) + 1);
        self.trackers = {};
        self.trackerData = {};
        self.peers = {};
        self.hoses = {};
        self.connectQueue = [];
        self.haveStack = [];
        self.bitfieldDL = torrent.bitfieldDL || '00';
        self.bitfield = (!torrent.pieces) ? null : new binary_bitfield_1.default(torrent.pieces.length, torrent.bitfieldDL);
        self.tph = (!torrent.pieces) ? null : new torrent_piece_handler_1.default(torrent.files, torrent.length, torrent.pieceLength, torrent.pieces.length, torrent.lastPieceLength);
        process.on('uncaughtException', function (err) {
            console.log(err);
        });
        self.torrent['announce'].forEach((tracker) => {
            let pt = parse_p2p_tracker_1.default(tracker);
            if (pt.type === 'udp') {
                self.trackers[tracker] = new trackerClient_1.udpTracker(pt.host, pt.port, self.port, self.torrent.infoHash);
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
            let host = socket.remoteAddress, port = socket.remotePort, family = socket.remoteFamily, hose = self.hoses[host] = new Hose_1.default(self.torrent.infoHash, self.peerID);
            self.peers[host + port] = { port, family, hose, socket, bitfield: '00', position: 0, piece: 0, mode: 0 };
            socket.pipe(hose).pipe(socket);
            self.peers[host].socket.on('close', () => {
                self._debug('the socket decided to leave');
                self.peers[host] = null;
                delete self.peers[host];
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
        console.log('create host: ', host, port);
        self.peers[host + port] = { port, family: 'ipv4', hose: new Hose_1.default(self.torrent.infoHash, self.peerID), socket: null, bitfield: '00', position: 0, piece: 0, mode: 0 };
        self.peers[host + port].socket = net_1.connect(port, host);
        self.peers[host + port].socket.once('connect', () => {
            self.peers[host + port]['socket'].pipe(self.peers[host + port].hose).pipe(self.peers[host + port]['socket']);
            self.peers[host + port].hose.sendHandshake();
        });
        self.peers[host + port].socket.on('error', (err) => {
            self.peers[host + port].hose.close();
            self.peers[host + port].socket.destroy();
            self.peers[host + port] = null;
            delete self.peers[host + port];
        });
        self.peers[host + port].socket.on('close', () => {
            self.peers[host + port] = null;
            delete self.peers[host + port];
        });
        self.peers[host + port]['hose'].on('metadata', (torrent) => {
            console.log('GOT METADATA');
            extend(self.torrent, torrent);
            self.bitfield = new binary_bitfield_1.default(self.torrent.pieces.length, self.torrent.bitfieldDL);
            self.manageFiles();
            self.tph = new torrent_piece_handler_1.default(self.torrent.files, self.torrent.length, self.torrent.pieceLength, self.torrent.pieces.length, self.torrent.lastPieceLength);
            self.peers[host + port]['hose'].removeMeta();
            self.downloadPhase();
        });
        self.peers[host + port]['hose'].on('bitfield', (payload) => {
            self.peers[host + port].bitfield = payload;
            if (self.peers[host + port]['hose'].isChoked)
                self.peers[host + port]['hose'].sendInterested();
            if (self.torrent.pieces) {
                self.peers[host + port].mode = 1;
                self.fetchNewPiece(self.peers[host + port]);
            }
            else {
                self.peers[host + port].mode = 3;
                self.peers[host + port]['hose'].metaDataRequest();
            }
        });
        self.peers[host + port]['hose'].on('have', (payload) => {
            self.peers[host + port].bitfield = self.bitfield.onHave(payload, self.peers[host + port].bitfield);
            let busy = self.peers[host + port]['hose'].isBusy();
            if (!busy && !self.finished && self.torrent.pieces.length) {
                self.peers[host + port]['hose'].setBusy();
                self.fetchNewPiece(self.peers[host + port]);
            }
        });
        self.peers[host + port]['hose'].on('finished_piece', (index, begin, block, hash) => {
            self._debug('finished piece');
            console.log('finished');
            let blockHash = hash.digest('hex');
            let percent = 0;
            if (blockHash === self.torrent.pieces[index]) {
                self.torrent.downloaded += block.length;
                self.torrent.left -= block.length;
                console.log('save the block:');
                self.tph.saveBlock(self.peers[host + port].position, block);
                percent = self.bitfield.setDownloaded(self.peers[host + port].piece);
            }
            console.log('index downloaded: ', index);
            console.log('percent:          ', percent);
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
        console.log('1');
        self.bitfield.findNewPieces(peer.bitfield, (result, downloading, which) => {
            if (which !== (-1)) {
                console.log('2');
                peer.piece = which;
                peer.position = self.tph.pieceIndex(which);
                console.log('3');
                self.tph.prepareRequest(which, (buf, count) => {
                    console.log('4');
                    console.log(buf);
                    this._debug('send piece request %n', count);
                    peer['hose'].sendRequest(buf, count);
                });
            }
            else {
                peer['hose'].unsetBusy();
            }
        });
    }
    downloadPhase() {
        const self = this;
        for (let host in self.peers) {
            console.log('HERERERE');
            if (self.peers[host].mode === 3) {
                console.log('HEHEHRHEHRHEHRHEHR');
                self.peers[host].mode = 1;
                self.fetchNewPiece(self.peers[host]);
            }
        }
    }
    finish() {
        const self = this;
        console.log('DONE!');
        for (let tracker in self.trackers) {
            if (!self.trackers[tracker + ':failure'])
                self.trackers[tracker].completed(self.torrent.left, self.torrent.uploaded, self.torrent.downloaded);
        }
    }
    cleanupSeeders() {
        const self = this;
        for (let host in self.peers) {
            if (self.bitfield.isSeeder(self.peers[host].bitfield)) {
                self.peers[host].hose.close();
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
        this.torrent['files'] = this.torrent['files'].map((file) => {
            let downloadDirectory = 'Downloads';
            let folders = __dirname + '/' + downloadDirectory + '/' + file.path;
            let f = folders.split('/');
            let fileName = f.splice(-1);
            folders = f.join('/');
            mkdirp(folders, function (err) {
                if (err)
                    console.error(err);
                else
                    fs.writeFileSync(folders + '/' + fileName, new Buffer(file.length));
            });
            file.path = folders + '/' + fileName;
            return file;
        });
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = torrentHandler;
//# sourceMappingURL=torrentEngine.js.map
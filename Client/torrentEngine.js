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
        self.finished = false;
        self.torrent = torrent;
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
        self.bitfield = new binary_bitfield_1.default(torrent.pieces.length, torrent.bitfieldDL);
        self.tph = new torrent_piece_handler_1.default(torrent.files, torrent.length, torrent.pieceLength, torrent.pieces.length, torrent.lastPieceLength);
        self.torrent['announce'].forEach((tracker) => {
            let pt = parse_p2p_tracker_1.default(tracker);
            if (pt.type === 'upd') {
                self.trackers[tracker] = new trackerClient_1.udpTracker(pt.host, pt.port, self.port, self.infoHash);
            }
            else {
                self.trackers[tracker] = new trackerClient_1.wssTracker();
            }
            self.trackers[tracker].on('announce', (interval, leechers, seeders, peers) => {
                let p = peers.split(',');
                self.connectQueue = self.connectQueue.concat(p);
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
            let host = socket.remoteAddress, port = socket.remotePort, family = socket.remoteFamily, hose = self.hoses[host] = new Hose_1.default(self.bitfield);
            self.peers[host] = { port, family, hose, socket, bitfield: '00', index: 0 };
            socket.pipe(hose).pipe(socket);
            self.peers[host].socket.on('close', () => {
                self._debug('the socket decided to leave');
            });
        }).listen(self.port);
    }
    newConnectionRequests() {
        const self = this;
        while (self.peers.length < MAX_PEERS && (self.connectQueue.length)) {
            let peer = self.connectQueue.shift().split(':');
            self.createPeer(peer[1], peer[0]);
        }
    }
    createPeer(port, host) {
        const self = this;
        let peer = self.peers[host] = { port, family: 'ipv4', hose: null, socket: null, bitfield: '00', index: 0, piece: 0 };
        peer.socket = net_1.connect(port, host);
        peer.socket.once('connect', () => {
            let hose = self.peers[host].hose = new Hose_1.default();
            peer['socket'].pipe(hose).pipe(peer['socket']);
        });
        peer['hose'].on('bitfield', (payload) => {
            peer.bitfield = payload;
            self.bitfield.findNewPieces(payload, (result, downloading, which) => {
                if (which !== (-1)) {
                    peer.piece = which;
                    peer.index = self.tph.pieceIndex(which);
                    self.tph.prepareRequest(which, (buf, count) => {
                        this._debug('send piece request %n', count);
                        peer['hose'].sendRequest(buf, count);
                    });
                }
                else {
                    peer['hose'].sendNotInterested();
                }
            });
        });
        peer['hose'].on('finished_piece', (block, hash) => {
            this._debug('finished piece');
            self.tph.saveBlock(peer.index, block);
            let finished = self.bitfield.setDownloaded(peer.piece);
            if (finished === 1) {
                self.finished = true;
                self.cleanupSeeders();
            }
            else {
                process.nextTick(() => {
                    self.bitfield.findNewPieces(peer.bitfield, (result, downloading, which) => {
                        if (which !== (-1)) {
                            peer.piece = which;
                            peer.index = self.tph.pieceIndex(which);
                            self.tph.prepareRequest(which, (buf, count) => {
                                this._debug('send piece request %n', count);
                                peer['hose'].sendRequest(buf, count);
                            });
                        }
                        else {
                        }
                    });
                });
            }
        });
    }
    cleanupSeeders() {
        const self = this;
        for (let host in self.peers) {
            if (self.bitfield.isSeeder(self.peers[host].bitfield)) {
                self.peers[host].socket.close();
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
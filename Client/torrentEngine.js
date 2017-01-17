"use strict";
const net_1 = require("net");
const events_1 = require("events");
const trackerClient_1 = require("./trackerClient");
const Hose_1 = require("./Hose");
const parse_p2p_tracker_1 = require("../modules/parse-p2p-tracker");
const _ = require("lodash");
const debug = require("debug");
debug('torrentEngine');
const Bitfield = require("bitfield");
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
        self.bitfield = this.setBitField(torrent.pieces.length);
        self.torrent['announce'].forEach((tracker) => {
            let pt = parse_p2p_tracker_1.default(tracker);
            if (pt.type === 'upd') {
                self.trackers[tracker] = new trackerClient_1.udpTracker(pt.host, pt.port, self.port, self.infoHash);
            }
            else {
                self.trackers[tracker] = new trackerClient_1.wssTracker();
            }
            self.trackers[tracker].on('peers', (interval, leechers, seeders, peers) => {
                let p = peers.split(',');
                self.connectQueue = self.connectQueue.concat(p);
                self.connectQueue = _.uniq(self.connectQueue);
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
            self.peers[host] = [port, family, hose, socket];
            socket.pipe(hose).pipe(socket);
            self.peers[host].socket.on('close', () => {
                self._debug('the socket decided to leave');
            });
        }).listen(self.port);
    }
    setBitField(pLength) {
        if (pLength)
            new Bitfield(pLength);
        else
            new Bitfield(0);
    }
    peerReview() {
    }
    createPeer(port, host) {
        const self = this;
        let peer = self.peers[host] = [port, 'ipv4', null, null];
        peer[3] = net_1.connect(port, host);
        peer[3].once('connect', () => {
            let hose = self.peers[host][2] = new Hose_1.default();
            peer[3].pipe(hose).pipe(peer[3]);
        });
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = torrentHandler;
//# sourceMappingURL=torrentEngine.js.map
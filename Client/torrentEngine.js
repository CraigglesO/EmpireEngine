"use strict";
const net_1 = require("net");
const events_1 = require("events");
const trackerClient_1 = require("./trackerClient");
const Hose_1 = require("./Hose");
const parse_p2p_tracker_1 = require("../modules/parse-p2p-tracker");
const _ = require("lodash");
const debug = require('debug')('torrentEngine');
class torrentHandler extends events_1.EventEmitter {
    constructor(torrent) {
        super();
        const self = this;
        self.torrent = torrent;
        self.infoHash = torrent.infoHash;
        self.port = ~~((Math.random() * (65535 - 1)) + 1);
        self.trackers = {};
        self.trackerData = {};
        self.connectQueue = [];
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
            const hose = new Hose_1.default();
            console.log('new connection');
            socket.pipe(hose).pipe(socket);
            socket.on('close', () => {
                console.log('the socket decided to leave');
            });
        }).listen(self.port || 1337);
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = torrentHandler;
//# sourceMappingURL=torrentEngine.js.map
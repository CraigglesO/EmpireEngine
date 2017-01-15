"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var net_1 = require("net");
var events_1 = require("events");
var trackerClient_1 = require("./trackerClient");
var Hose_1 = require("./Hose");
var parse_p2p_tracker_1 = require("../modules/parse-p2p-tracker");
var torrentHandler = (function (_super) {
    __extends(torrentHandler, _super);
    function torrentHandler(torrent) {
        var _this = _super.call(this) || this;
        var self = _this;
        self.torrent = torrent;
        self.port = ~~((Math.random() * (65535 - 1)) + 1);
        self.trackers = {};
        self.connectQueue = [];
        self.torrent['announce'].forEach(function (tracker) {
            var pt = parse_p2p_tracker_1.default(tracker);
            if (pt.type === 'upd') {
                self.trackers[tracker] = new trackerClient_1.udpTracker();
            }
            else {
                self.trackers[tracker] = new trackerClient_1.wssTracker();
            }
            self.trackers[tracker].on('peers', function (peers) {
                var p = peers.split(',');
                self.connectQueue = self.connectQueue.concat(p);
            });
            self.trackers[tracker].on('killSwitch', function () {
                self.trackers[tracker].kill;
            });
            self.trackers[tracker].on('scrape', function (seeders, completed, leechers) {
                self.trackers[tracker + ':seeders'] = seeders;
                self.trackers[tracker + ':completed'] = completed;
                self.trackers[tracker + ':leechers'] = leechers;
            });
        });
        self.incomingPeers = net_1.createServer(function (socket) {
            var hose = new Hose_1.default();
            console.log('new connection');
            socket.pipe(hose).pipe(socket);
            socket.on('close', function () {
                console.log('the socket decided to leave');
            });
        }).listen(self.port || 1337);
        return _this;
    }
    return torrentHandler;
}(events_1.EventEmitter));
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = torrentHandler;

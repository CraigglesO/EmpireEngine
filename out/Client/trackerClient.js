"use strict";
const events_1 = require("events");
const dgram = require("dgram");
const debug = require("debug");
debug("trackerClient");
const writeUInt64BE = require("writeUInt64BE"), ACTION_CONNECT = 0, ACTION_ANNOUNCE = 1, ACTION_SCRAPE = 2, ACTION_ERROR = 3;
let connectionIdHigh = 0x417, connectionIdLow = 0x27101980;
class UdpTracker extends events_1.EventEmitter {
    constructor(trackerHost, port, myPort, infoHash) {
        super();
        if (!(this instanceof UdpTracker))
            return new UdpTracker(trackerHost, port, myPort, infoHash);
        const self = this;
        self.HOST = trackerHost;
        self.HASH = infoHash;
        self.PORT = port;
        self.MY_PORT = myPort;
        self.TRANSACTION_ID = null;
        self.EVENT = 0;
        self.SCRAPE = true;
        self.DOWNLOADED = 0;
        self.LEFT = 1;
        self.UPLOADED = 0;
        self.KEY = 0;
        self.IP_ADDRESS = 0;
        self.TIMEOUTS = [];
        self.TIMEOUTS_DATE = 0;
        self.TIMEOUT_N = 1;
        self.server = dgram.createSocket("udp4");
        self.server.on("listening", function () {
            self.scrape();
        });
        self.server.on("message", function (msg, rinfo) { self.message(msg, rinfo); });
        self.server.bind(self.MY_PORT);
    }
    sendPacket(buf) {
        const self = this;
        self.server.send(buf, 0, buf.length, self.PORT, self.HOST, (err) => {
            if (err) {
                self.emit("error", err);
            }
        });
    }
    startConnection() {
        const self = this;
        self.TRANSACTION_ID = ~~((Math.random() * 100000) + 1);
        self.TIMEOUTS.push(setTimeout(() => {
            self.TRANSACTION_ID = null;
            self.SCRAPE = true;
            self.scrape();
        }, self.updateTimer() * 60 * 1000));
        self.TIMEOUTS_DATE = Date.now();
        let buf = new Buffer(16);
        buf.fill(0);
        buf.writeUInt32BE(connectionIdHigh, 0);
        buf.writeUInt32BE(connectionIdLow, 4);
        buf.writeUInt32BE(ACTION_CONNECT, 8);
        buf.writeUInt32BE(self.TRANSACTION_ID, 12);
        self.sendPacket(buf);
    }
    scrape() {
        const self = this;
        if (!self.TRANSACTION_ID) {
            self.startConnection();
        }
        else {
            let buf = new Buffer(36);
            buf.fill(0);
            buf.writeUInt32BE(connectionIdHigh, 0);
            buf.writeUInt32BE(connectionIdLow, 4);
            buf.writeUInt32BE(ACTION_SCRAPE, 8);
            buf.writeUInt32BE(self.TRANSACTION_ID, 12);
            buf.write(self.HASH, 16, 20, "hex");
            self.sendPacket(buf);
        }
    }
    announce() {
        const self = this;
        if (!self.TRANSACTION_ID) {
            self.startConnection();
        }
        else {
            let buf = new Buffer(98);
            buf.fill(0);
            buf.writeUInt32BE(connectionIdHigh, 0);
            buf.writeUInt32BE(connectionIdLow, 4);
            buf.writeUInt32BE(ACTION_ANNOUNCE, 8);
            buf.writeUInt32BE(self.TRANSACTION_ID, 12);
            buf.write(self.HASH, 16, 20, "hex");
            buf.write("-EM0012-ABCDEFGHIJKL", 36, 20);
            writeUInt64BE(buf, self.DOWNLOADED, 56);
            writeUInt64BE(buf, self.LEFT, 64);
            writeUInt64BE(buf, self.UPLOADED, 72);
            buf.writeUInt32BE(self.EVENT, 80);
            buf.writeUInt32BE(self.IP_ADDRESS, 84);
            buf.writeUInt32BE(self.KEY, 88);
            buf.writeInt32BE((-1), 92);
            buf.writeUInt16BE(self.MY_PORT, 96);
            self.sendPacket(buf);
            self.TRANSACTION_ID = null;
        }
    }
    message(msg, rinfo) {
        const self = this;
        let buf = new Buffer(msg);
        let action = buf.readUInt32BE(0);
        self.TRANSACTION_ID = buf.readUInt32BE(4);
        if (action === ACTION_CONNECT) {
            connectionIdHigh = buf.readUInt32BE(8);
            connectionIdLow = buf.readUInt32BE(12);
            if (self.SCRAPE) {
                self.SCRAPE = false;
                self.scrape();
            }
            else {
                self.announce();
            }
        }
        else if (action === ACTION_SCRAPE) {
            let seeders = buf.readUInt32BE(8), completed = buf.readUInt32BE(12), leechers = buf.readUInt32BE(16);
            self.emit("scrape", seeders, completed, leechers, self.timeTillNextScrape());
            self.announce();
        }
        else if (action === ACTION_ANNOUNCE) {
            let interval = buf.readUInt32BE(8), leechers = buf.readUInt32BE(12), seeders = buf.readUInt32BE(16), bufLength = buf.length, addresses = [];
            for (let i = 20; i < bufLength; i += 6) {
                let address = `${buf.readUInt8(i)}.${buf.readUInt8(i + 1)}.${buf.readUInt8(i + 2)}.${buf.readUInt8(i + 3)}:${buf.readUInt16BE(i + 4)}`;
                addresses.push(address);
            }
            self.emit("announce", interval, leechers, seeders, addresses);
            self.EVENT = 0;
        }
        else if (action === ACTION_ERROR) {
            let errorResponce = buf.slice(8).toString();
            self.emit("error", errorResponce);
        }
    }
    update(left, uploaded, downloaded, port) {
        this.LEFT = left;
        this.UPLOADED = uploaded;
        this.DOWNLOADED = downloaded;
        if (port)
            this.PORT = port;
        this.EVENT = 0;
        this.announce();
    }
    completed(left, uploaded, downloaded, port) {
        this.LEFT = left;
        this.UPLOADED = uploaded;
        this.DOWNLOADED = downloaded;
        if (port)
            this.PORT = port;
        this.EVENT = 1;
        this.announce();
    }
    start(left, uploaded, downloaded, port) {
        this.LEFT = left;
        this.UPLOADED = uploaded;
        this.DOWNLOADED = downloaded;
        if (port)
            this.PORT = port;
        this.EVENT = 2;
        console.log("start (tracker)");
        this.announce();
    }
    stop(left, uploaded, downloaded, port) {
        this.LEFT = left;
        this.UPLOADED = uploaded;
        this.DOWNLOADED = downloaded;
        if (port)
            this.PORT = port;
        this.EVENT = 3;
        this.announce();
    }
    timeTillNextScrape() {
        const self = this;
        return Math.ceil((self.TIMEOUTS_DATE + self.TIMEOUTS[0]._idleTimeout - Date.now()) / 1000);
    }
    updateTimer() {
        const self = this;
        for (let i = 0; i < self.TIMEOUTS.length; i++) {
            clearTimeout(self.TIMEOUTS[i]);
        }
        self.TIMEOUTS.shift();
        if (self.TIMEOUT_N === 1) {
            self.TIMEOUT_N = 5;
            return 5;
        }
        else if (self.TIMEOUT_N <= 5) {
            self.TIMEOUT_N = 10;
            return 10;
        }
        else if (self.TIMEOUT_N <= 15) {
            self.TIMEOUT_N = 20;
            return 20;
        }
        else {
            self.TIMEOUT_N = 30;
            return 30;
        }
    }
}
exports.UdpTracker = UdpTracker;
class WssTracker extends events_1.EventEmitter {
    constructor() {
        super();
        if (!(this instanceof WssTracker))
            return new WssTracker();
        const self = this;
    }
}
exports.WssTracker = WssTracker;
//# sourceMappingURL=trackerClient.js.map
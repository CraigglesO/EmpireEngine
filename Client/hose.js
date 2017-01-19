'use strict';
const stream_1 = require("stream");
const buffer_1 = require("buffer");
const crypto_1 = require("crypto");
const debug = require("debug");
debug('hose');
const speedometer = require('speedometer');
const BITFIELD_MAX_SIZE = 100000;
const KEEP_ALIVE_TIMEOUT = 55000;
const PROTOCOL = buffer_1.Buffer.from('\u0013BitTorrent protocol'), RESERVED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), KEEP_ALIVE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x00]), CHOKE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00]), UNCHOKE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x01]), INTERESTED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02]), UNINTERESTED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x03]), HAVE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x04]), BITFIELD = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x05]), REQUEST = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x06]), PIECE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x09, 0x07]), CANCEL = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x08]);
class Hose extends stream_1.Duplex {
    constructor(bitfield) {
        super();
        this._debug = function (...args) {
            args = [].slice.call(arguments);
            args[0] = '[' + this._debugId + '] ' + args[0];
            debug.apply(null, args);
        };
        if (!(this instanceof Hose))
            return new Hose(bitfield);
        const self = this;
        self._debugId = ~~((Math.random() * 100000) + 1);
        self.destroyed = false;
        self.sentHandshake = false;
        self.uploadSpeed = speedometer();
        self.downloadSpeed = speedometer();
        self.bufferSize = 0;
        self.streamStore = [];
        self.parseSize = 0;
        self.actionStore = null;
        self.inRequests = [];
        self.blocks = [];
        self.blockCount = 0;
        self.pieceHash = null;
        self.infoHash = '';
        self.peerID = '';
        self.choked = true;
        self.interested = false;
        self.bitfield = bitfield;
        self.haveSuppression = false;
        self.prepHandshake();
    }
    prepHandshake() {
        this._nextAction(1, (payload) => {
            let pstrlen = payload.readUInt8(0);
            this._nextAction(pstrlen + 48, (payload) => {
                console.log('payload');
                let pstr = payload.slice(0, pstrlen), reserved = payload.slice(pstrlen, 8);
                pstr = pstr.toString();
                payload = payload.slice(pstrlen + 8);
                let infoHash = payload.slice(0, 20), peerID = payload.slice(20, 40);
                this.infoHash = infoHash.toString('hex');
                this.peerID = peerID.toString('hex');
                if (pstr !== 'BitTorrent protocol')
                    return;
                this._debug('Protocol type: ', pstr);
                this._debug('infoHash:      ', this.infoHash);
                this._debug('peerId:        ', this.peerID);
                this.emit('handshake', infoHash, peerID);
                if (!this.sentHandshake)
                    this.sendHandshake();
                this.messageLength();
            });
        });
    }
    messageLength() {
        this._nextAction(4, (payload) => {
            let length = payload.readUInt32BE(0);
            if (length > 0)
                this._nextAction(length, this.handleCode);
            else
                this.messageLength();
        });
    }
    _read() { }
    _write(payload, encoding, next) {
        this._debug('new Data! %o');
        this.bufferSize += payload.length;
        this.streamStore.push(payload);
        console.log('bufferSize!: ', this.bufferSize);
        while (this.bufferSize >= this.parseSize) {
            let buf = (this.streamStore.length > 1)
                ? buffer_1.Buffer.concat(this.streamStore)
                : this.streamStore[0];
            this.bufferSize -= this.parseSize;
            this.streamStore = (this.bufferSize)
                ? [buf.slice(this.parseSize)]
                : [];
            this.actionStore(buf.slice(0, this.parseSize));
        }
        next(null);
    }
    _push(payload) {
        return this.push(payload);
    }
    createHandshake(infoHash, peerID) {
        this.infoHash = infoHash;
        this.peerID = peerID;
        this.sendHandshake();
    }
    sendHandshake() {
        this.sentHandshake = true;
        let infoHashBuffer = buffer_1.Buffer.from(this.infoHash, 'hex'), peerIDbuffer = buffer_1.Buffer.from(this.peerID, 'hex');
        console.log('giving handshake back..');
        this._push(buffer_1.Buffer.concat([PROTOCOL, RESERVED, infoHashBuffer, peerIDbuffer]));
    }
    sendNotInterested() {
        this._push(UNINTERESTED);
    }
    sendHave() {
    }
    sendBitfield(bitfield) {
        this._push(buffer_1.Buffer.concat([BITFIELD, bitfield]));
    }
    sendRequest(buf, count) {
        const self = this;
        self.blockCount = count;
        self.pieceHash = crypto_1.createHash('sha1');
        this._push(buf);
    }
    sendPiece() {
    }
    sendCancel() {
    }
    _nextAction(length, action) {
        this.parseSize = length;
        this.actionStore = action;
    }
    _onHave(pieceIndex) {
        this.bitfield.set(pieceIndex, true);
        if (!this.haveSuppression)
            this.emit('have', pieceIndex);
    }
    _onBitfield(payload) {
        this.emit('bitfield', payload);
    }
    _onRequest(index, begin, length) {
        const self = this;
        while (!self.inRequests.length) {
            process.nextTick(() => {
            });
        }
    }
    _onPiece(index, begin, block) {
        const self = this;
        process.nextTick(() => {
            self.blockCount--;
            self.pieceHash.update(block);
            self.blocks.push(block);
            if (!self.blockCount)
                self.emit('finished_piece', buffer_1.Buffer.concat(self.blocks), self.pieceHash.digest('hex'));
        });
    }
    _onCancel(index, begin, length) {
    }
    handleCode(payload) {
        const self = this;
        self.messageLength();
        console.log('debug message code and extra: ', payload);
        switch (payload[0]) {
            case 0:
                self._debug('got choke');
                self.choked = true;
                self._push(CHOKE);
                break;
            case 1:
                self._debug('got unchoke');
                if (!self.choked) {
                }
                else {
                    self.choked = false;
                    self._push(UNCHOKE);
                }
                break;
            case 2:
                self._debug('peer is interested');
                self.emit('interested');
                self.choked = false;
                self._push(buffer_1.Buffer.concat([INTERESTED, UNCHOKE]));
                break;
            case 3:
                self._debug('got uninterested');
                self.closeConnection();
                break;
            case 4:
                self._debug('got have');
                self._onHave(payload.readUInt32BE(1));
                break;
            case 5:
                self._debug('Recieved bitfield');
                self._onBitfield(payload.slice(1));
                break;
            case 6:
                if (self.choked)
                    return;
                self._debug('Recieved request');
                self._onRequest(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.readUInt32BE(9));
                break;
            case 7:
                self._debug('Recieved piece');
                self._onPiece(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.slice(9));
                break;
            case 8:
                self._debug('Recieved cancel');
                self._onCancel(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.readUInt32BE(9));
                break;
            default:
                this._debug('error, wrong message');
        }
    }
    closeConnection() {
        this.isActive = false;
        this.emit('close');
    }
    setHaveSuppression() {
        this.haveSuppression = true;
    }
    close() {
        this.isActive = false;
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Hose;
//# sourceMappingURL=Hose.js.map
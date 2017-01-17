'use strict';
const stream_1 = require("stream");
const buffer_1 = require("buffer");
const debug = require("debug");
debug('hose');
const speedometer = require('speedometer');
const Bitfield = require("bitfield");
const BITFIELD_MAX_SIZE = 100000;
const KEEP_ALIVE_TIMEOUT = 55000;
const PROTOCOL = buffer_1.Buffer.from('\u0013BitTorrent protocol'), RESERVED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), KEEP_ALIVE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x00]), CHOKE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00]), UNCHOKE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x01]), INTERESTED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02]), UNINTERESTED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x03]), HAVE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x04]), BITFIELD = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x05]), REQUEST = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x06]), PIECE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x07]), CANCEL = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x08]);
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
        this._debugId = ~~((Math.random() * 100000) + 1);
        this.destroyed = false;
        this.sentHandshake = false;
        this.uploadSpeed = speedometer();
        this.downloadSpeed = speedometer();
        this.bufferSize = 0;
        this.streamStore = [];
        this.parseSize = 0;
        this.actionStore = null;
        this.infoHash = '';
        this.peerID = '';
        this.choked = true;
        this.interested = false;
        this.bitfield = bitfield;
        this.haveSuppression = false;
        this.on('complete', this.destroy);
        this.prepHandshake();
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
                console.log('Protocol type: ', pstr);
                console.log('infoHash:      ', this.infoHash);
                console.log('peerId:        ', this.peerID);
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
    sendInterested() {
        this._debug('send interested');
        this._push(INTERESTED);
    }
    sendUnInterested() {
        this._push(UNINTERESTED);
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
        this.bitfield = new Bitfield(payload);
        this.emit('bitfield', this.bitfield);
    }
    _onRequest(index, begin, length) {
    }
    _onPiece(index, begin, block) {
    }
    _onCancel(index, begin, length) {
    }
    handleCode(payload) {
        this.messageLength();
        console.log('debug message code and extra: ', payload);
        switch (payload[0]) {
            case 0:
                this._debug('got choke');
                this.choked = true;
                this._push(CHOKE);
                break;
            case 1:
                this._debug('got unchoke');
                this.choked = false;
                this._push(UNCHOKE);
                break;
            case 2:
                this._debug('peer is interested');
                this.emit('interested');
                this.choked = false;
                this._push(UNCHOKE);
                break;
            case 3:
                this._debug('got uninterested');
                this.closeConnection();
                break;
            case 4:
                this._debug('got have');
                this._onHave(payload.readUInt32BE(1));
                break;
            case 5:
                this._debug('Recieved bitfield');
                this._onBitfield(payload.slice(1));
                break;
            case 6:
                this._debug('Recieved request');
                this._onRequest(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.readUInt32BE(9));
                break;
            case 7:
                this._debug('Recieved piece');
                this._onPiece(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.slice(9));
                break;
            case 8:
                this._debug('Recieved cancel');
                this._onCancel(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.readUInt32BE(9));
                break;
            default:
                console.log('error, wrong message');
        }
    }
    closeConnection() {
        this.isActive = false;
        this.emit('close');
    }
    setHaveSuppression() {
        this.haveSuppression = true;
    }
    destroy() {
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Hose;
//# sourceMappingURL=Hose.js.map
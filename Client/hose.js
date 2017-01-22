'use strict';
const stream_1 = require("stream");
const buffer_1 = require("buffer");
const crypto_1 = require("crypto");
const ut_extensions_1 = require("../modules/ut-extensions");
const debug = require("debug");
debug('hose');
const speedometer = require('speedometer');
const bencode = require('bencode');
const BITFIELD_MAX_SIZE = 100000;
const KEEP_ALIVE_TIMEOUT = 55000;
const PROTOCOL = buffer_1.Buffer.from('\u0013BitTorrent protocol'), RESERVED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00]), KEEP_ALIVE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x00]), CHOKE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00]), UNCHOKE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x01]), INTERESTED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02]), UNINTERESTED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x03]), HAVE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x04]), BITFIELD = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x05]), REQUEST = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x06]), PIECE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x09, 0x07]), CANCEL = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x08]), EXTENDED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x14]), UT_PEX = 1, UT_METADATA = 2;
class Hose extends stream_1.Duplex {
    constructor(infoHash, peerID) {
        super();
        this._debug = function (...args) {
            args = [].slice.call(arguments);
            args[0] = '[' + this._debugId + '] ' + args[0];
            debug.apply(null, args);
        };
        if (!(this instanceof Hose))
            return new Hose(infoHash, peerID);
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
        self.infoHash = infoHash;
        self.peerID = peerID;
        self.choked = true;
        self.interested = false;
        self.busy = false;
        self.ext = {};
        self.prepHandshake();
    }
    prepHandshake() {
        this._nextAction(1, (payload) => {
            let pstrlen = payload.readUInt8(0);
            this._nextAction(pstrlen + 48, (payload) => {
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
        console.log('payload!: ', payload);
        return this.push(payload);
    }
    sendKeepActive() {
        this._push(KEEP_ALIVE);
    }
    sendHandshake() {
        this.sentHandshake = true;
        let infoHashBuffer = buffer_1.Buffer.from(this.infoHash, 'hex'), peerIDbuffer = buffer_1.Buffer.from('2d4c54313030302d764874743153546a4d583043', 'hex');
        this._push(buffer_1.Buffer.concat([PROTOCOL, RESERVED, infoHashBuffer, peerIDbuffer]));
    }
    sendNotInterested() {
        this._push(UNINTERESTED);
    }
    sendInterested() {
        this._push(buffer_1.Buffer.concat([INTERESTED, UNCHOKE]));
    }
    sendHave() {
    }
    sendBitfield(bitfield) {
        let bf = BITFIELD;
        bf.writeUInt32BE(bitfield.length + 1, 0);
        this._push(buffer_1.Buffer.concat([bf, bitfield]));
    }
    sendRequest(buf, count) {
        const self = this;
        self.blockCount = count;
        self.busy = true;
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
        console.log('PIECE: ');
        process.nextTick(() => {
            self.blockCount--;
            self.pieceHash.update(block);
            self.blocks.push(block);
            if (!self.blockCount) {
                self.emit('finished_piece', index, begin, buffer_1.Buffer.concat(self.blocks), self.pieceHash);
                self.blocks = [];
            }
        });
    }
    _onCancel(index, begin, length) {
    }
    _onExtension(extensionID, payload) {
        const self = this;
        if (extensionID === 0) {
            let obj = bencode.decode(payload);
            console.log(obj);
            let m = obj.m;
            if (m['ut_metadata']) {
                self.ext[UT_METADATA] = new ut_extensions_1.utMetadata(obj.metadata_size, self.infoHash);
                self.ext['ut_metadata'] = m['ut_metadata'];
                self.ext[UT_METADATA].on('next', (piece) => {
                    let request = { "msg_type": 0, "piece": piece }, prepRequest = EXTENDED, requestEn = bencode.encode(request), code = new buffer_1.Buffer(1);
                    prepRequest.writeUInt32BE(requestEn.length + 2, 0);
                    code.writeUInt8(self.ext['ut_metadata'], 0);
                    let requestBuf = buffer_1.Buffer.concat([prepRequest, code, requestEn]);
                    this._push(requestBuf);
                });
                self.ext[UT_METADATA].on('metadata', (torrent) => {
                    self.emit('metadata', torrent);
                });
            }
            if (m['ut_pex']) {
                self.ext[UT_PEX] = new ut_extensions_1.utPex();
                self.ext['ut_pex'] = m['ut_pex'];
            }
        }
        else {
            console.log('extensionID', extensionID);
            self.ext[extensionID]._message(payload);
        }
    }
    metaDataRequest() {
        console.log('sending a metaData Request');
        const self = this;
        if (self.ext['ut_metadata']) {
            let handshake = { 'm': { 'ut_metadata': UT_METADATA } }, prepHandshake = EXTENDED, handshakeEn = bencode.encode(handshake);
            prepHandshake.writeUInt32BE(handshakeEn.length + 2, 0);
            let handshakeBuf = buffer_1.Buffer.concat([prepHandshake, buffer_1.Buffer.from([0x00]), handshakeEn]);
            console.log(handshakeBuf);
            this._push(handshakeBuf);
            let request = { "msg_type": 0, "piece": 0 }, prepRequest = EXTENDED, requestEn = bencode.encode(request), code = new buffer_1.Buffer(1);
            prepRequest.writeUInt32BE(requestEn.length + 2, 0);
            code.writeUInt8(self.ext['ut_metadata'], 0);
            let requestBuf = buffer_1.Buffer.concat([prepRequest, code, requestEn]);
            console.log(requestBuf);
            this._push(requestBuf);
        }
    }
    handleCode(payload) {
        const self = this;
        self.messageLength();
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
            case 20:
                self._debug('Extension Protocol');
                self._onExtension(payload.readUInt8(1), payload.slice(2));
            default:
                this._debug('error, wrong message');
        }
    }
    isChoked() {
        return this.choked;
    }
    isBusy() {
        return this.busy;
    }
    setBusy() {
        this.busy = true;
    }
    unsetBusy() {
        this.busy = false;
    }
    closeConnection() {
        this.isActive = false;
        this.emit('close');
    }
    removeMeta() {
        this.ext[UT_METADATA] = null;
        delete this.ext[UT_METADATA];
    }
    close() {
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Hose;
//# sourceMappingURL=Hose.js.map
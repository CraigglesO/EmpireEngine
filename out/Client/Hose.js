"use strict";
const stream_1 = require("stream");
const buffer_1 = require("buffer");
const crypto_1 = require("crypto");
const ut_extensions_1 = require("../modules/ut-extensions");
const debug = require("debug");
debug("hose");
const speedometer = require("speedometer");
const bencode = require("bencode");
const BITFIELD_MAX_SIZE = 100000;
const KEEP_ALIVE_TIMEOUT = 55000;
const DL_SIZE = 16384;
const PROTOCOL = buffer_1.Buffer.from("BitTorrent protocol"), RESERVED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00]), KEEP_ALIVE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x00]), CHOKE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00]), UNCHOKE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x01]), INTERESTED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02]), UNINTERESTED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x03]), HAVE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x04]), BITFIELD = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x05]), REQUEST = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x06]), PIECE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x09, 0x07]), CANCEL = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x08]), EXTENDED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x14]), EXT_PROTOCOL = { "m": { "ut_metadata": 2 } }, UT_PEX = 1, UT_METADATA = 2;
class Hose extends stream_1.Duplex {
    constructor(infoHash, peerID) {
        super();
        this._debug = function (...args) {
            args = [].slice.call(arguments);
            args[0] = "[" + this._debugId + "] " + args[0];
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
        self.reqBusy = false;
        self.meta = true;
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
                this.infoHash = infoHash.toString("hex");
                this.peerID = peerID.toString("hex");
                if (pstr !== "BitTorrent protocol")
                    return;
                if (!this.sentHandshake)
                    this.emit("handshake", infoHash, peerID);
                this.nextAction();
            });
        });
    }
    nextAction() {
        this._nextAction(4, (payload) => {
            let length = payload.readUInt32BE(0);
            if (length > 0)
                this._nextAction(length, this.handleCode);
            else
                this.nextAction();
        });
    }
    _read() { }
    _write(payload, encoding, next) {
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
        return this.push(payload);
    }
    sendKeepActive() {
        this._push(KEEP_ALIVE);
    }
    sendHandshake() {
        this.sentHandshake = true;
        let infoHashBuffer = buffer_1.Buffer.from(this.infoHash, "hex"), peerIDbuffer = buffer_1.Buffer.from("2d4c54313030302d764874743153546a4d583043", "hex");
        this._push(buffer_1.Buffer.concat([PROTOCOL, RESERVED, infoHashBuffer, peerIDbuffer]));
    }
    sendNotInterested() {
        this._push(UNINTERESTED);
    }
    sendInterested() {
        this._push(buffer_1.Buffer.concat([INTERESTED, UNCHOKE]));
        this.choked = false;
    }
    sendHave(index) {
    }
    sendBitfield(bitfield) {
        let bitfieldBuf = buffer_1.Buffer.from(bitfield, "hex");
        let bf = BITFIELD;
        bf.writeUInt32BE(bitfieldBuf.length + 1, 0);
        this._push(buffer_1.Buffer.concat([bf, bitfieldBuf]));
    }
    sendRequest(payload, count) {
        const self = this;
        self.blockCount = count;
        self.busy = true;
        self.pieceHash = crypto_1.createHash("sha1");
        this._push(payload);
    }
    sendPiece(piece) {
        this._push(piece);
    }
    sendCancel() {
    }
    _nextAction(length, action) {
        this.parseSize = length;
        this.actionStore = action;
    }
    _onHave(pieceIndex) {
        this.emit("have", pieceIndex);
    }
    _onBitfield(payload) {
        this.emit("bitfield", payload);
    }
    _onRequest(index, begin, length) {
        this.inRequests.push({ index, begin, length });
        this.emit("request");
    }
    _onPiece(index, begin, block) {
        const self = this;
        process.nextTick(() => {
            self.blockCount--;
            self.blocks[begin / DL_SIZE] = block;
            if (!self.blockCount) {
                let resultBuf = buffer_1.Buffer.concat(self.blocks);
                self.pieceHash.update(resultBuf);
                self.emit("finished_piece", index, resultBuf, self.pieceHash);
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
            let m = obj.m;
            if (m["ut_metadata"]) {
                self.ext[UT_METADATA] = new ut_extensions_1.UTmetadata(obj.metadata_size, self.infoHash);
                self.ext["ut_metadata"] = m["ut_metadata"];
                self.ext[UT_METADATA].on("next", (piece) => {
                    let request = { "msg_type": 0, "piece": piece }, prepRequest = EXTENDED, requestEn = bencode.encode(request), code = new buffer_1.Buffer(1);
                    prepRequest.writeUInt32BE(requestEn.length + 2, 0);
                    code.writeUInt8(self.ext["ut_metadata"], 0);
                    let requestBuf = buffer_1.Buffer.concat([prepRequest, code, requestEn]);
                    this._push(requestBuf);
                });
                self.ext[UT_METADATA].on("metadata", (torrent) => {
                    self.emit("metadata", torrent);
                });
            }
            if (m["ut_pex"]) {
                self.ext[UT_PEX] = new ut_extensions_1.UTpex();
                self.ext["ut_pex"] = m["ut_pex"];
            }
        }
        else {
            if (self.meta)
                self.ext[extensionID]._message(payload);
        }
    }
    metaDataRequest() {
        const self = this;
        if (self.ext["ut_metadata"]) {
            self.metaDataHandshake();
            let request = { "msg_type": 0, "piece": 0 }, prepRequest = EXTENDED, requestEn = bencode.encode(request), code = new buffer_1.Buffer(1);
            prepRequest.writeUInt32BE(requestEn.length + 2, 0);
            code.writeUInt8(self.ext["ut_metadata"], 0);
            let requestBuf = buffer_1.Buffer.concat([prepRequest, code, requestEn]);
            console.log("metadata request");
            this._push(requestBuf);
        }
    }
    metaDataHandshake() {
        let handshake = EXT_PROTOCOL, prepHandshake = EXTENDED, handshakeEn = bencode.encode(handshake);
        prepHandshake.writeUInt32BE(handshakeEn.length + 2, 0);
        let handshakeBuf = buffer_1.Buffer.concat([prepHandshake, buffer_1.Buffer.from([0x00]), handshakeEn]);
        this._push(handshakeBuf);
    }
    handleCode(payload) {
        const self = this;
        self.nextAction();
        switch (payload[0]) {
            case 0:
                self._debug("got choke");
                self.choked = true;
                self._push(CHOKE);
                break;
            case 1:
                self._debug("got unchoke");
                if (!self.choked) {
                }
                else {
                    self.choked = false;
                    self._push(UNCHOKE);
                }
                break;
            case 2:
                self._debug("peer is interested");
                self.emit("interested");
                self.choked = false;
                self._push(buffer_1.Buffer.concat([INTERESTED, UNCHOKE]));
                break;
            case 3:
                self._debug("peer is uninterested");
                self.closeConnection();
                break;
            case 4:
                self._debug("peer sent have");
                self._onHave(payload.readUInt32BE(1));
                break;
            case 5:
                self._debug("Recieved bitfield");
                self._onBitfield(payload.slice(1));
                break;
            case 6:
                if (self.choked)
                    return;
                self._debug("Recieved request");
                self._onRequest(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.readUInt32BE(9));
                break;
            case 7:
                self._debug("Recieved piece");
                self._onPiece(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.slice(9));
                break;
            case 8:
                self._debug("Recieved cancel");
                self._onCancel(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.readUInt32BE(9));
                break;
            case 20:
                self._debug("Extension Protocol");
                self._onExtension(payload.readUInt8(1), payload.slice(2));
            default:
                this._debug("error, wrong message");
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
        this.emit("close");
    }
    removeMeta() {
        this.meta = false;
        this.ext[UT_METADATA] = null;
        delete this.ext[UT_METADATA];
    }
    close() {
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Hose;
//# sourceMappingURL=Hose.js.map
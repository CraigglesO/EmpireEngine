'use strict';
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var stream_1 = require("stream");
var buffer_1 = require("buffer");
var speedometer = require('speedometer');
var bencode = require('bencode');
var PROTOCOL = buffer_1.Buffer.from('\u0013BitTorrent protocol'), RESERVED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), KEEP_ALIVE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x00]), CHOKE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00]), UNCHOKE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x01]), INTERESTED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02]), UNINTERESTED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x03]), HAVE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x04]), BITFIELD = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x05]), REQUEST = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x06]), PIECE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x07]), CANCEL = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x08]), PORT = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x03, 0x09, 0x00, 0x00]);
var myID = buffer_1.Buffer.from('317c8d25beefbb30d32592e2afd3fbb7a0396987', 'hex');
var Hose = (function (_super) {
    __extends(Hose, _super);
    function Hose(opts) {
        var _this = _super.call(this) || this;
        if (!opts)
            opts = {};
        if (!(_this instanceof Hose))
            return new Hose(opts);
        _this.destroyed = false;
        _this.sentHandshake = false;
        _this.uploadSpeed = speedometer();
        _this.downloadSpeed = speedometer();
        _this.bufferSize = 0;
        _this.streamStore = [];
        _this.parseSize = 0;
        _this.actionStore = null;
        _this.infoHash = '';
        _this.peerID = '';
        _this.choke = true;
        _this.choked = true;
        _this.interest = false;
        _this.interested = false;
        _this.on('complete', _this.destroy);
        _this.prepHandshake();
        return _this;
    }
    Hose.prototype._read = function () {
    };
    Hose.prototype._nextAction = function (length, action) {
        this.parseSize = length;
        this.actionStore = action;
    };
    Hose.prototype._push = function (payload) {
        return this.push(payload);
    };
    Hose.prototype._write = function (payload, encoding, next) {
        console.log('new data!');
        this.bufferSize += payload.length;
        this.streamStore.push(payload);
        console.log('bufferSize!: ', this.bufferSize);
        while (this.bufferSize >= this.parseSize) {
            var buf = (this.streamStore.length > 1)
                ? buffer_1.Buffer.concat(this.streamStore)
                : this.streamStore[0];
            this.bufferSize -= this.parseSize;
            this.streamStore = (this.bufferSize)
                ? [buf.slice(this.parseSize)]
                : [];
            this.actionStore(buf.slice(0, this.parseSize));
        }
        next(null);
    };
    Hose.prototype.prepHandshake = function () {
        var _this = this;
        this._nextAction(1, function (payload) {
            var pstrlen = payload.readUInt8(0);
            _this._nextAction(pstrlen + 48, function (payload) {
                console.log('payload');
                var pstr = payload.slice(0, pstrlen), reserved = payload.slice(pstrlen, 8);
                pstr = pstr.toString();
                payload = payload.slice(pstrlen + 8);
                var infoHash = payload.slice(0, 20), peerID = payload.slice(20, 40);
                _this.infoHash = infoHash.toString('hex');
                _this.peerID = peerID.toString('hex');
                if (pstr !== 'BitTorrent protocol')
                    return;
                console.log('Protocol type: ', pstr);
                console.log('infoHash:      ', _this.infoHash);
                console.log('peerId:        ', _this.peerID);
                _this.emit('handshake', infoHash, peerID);
                if (!_this.sentHandshake)
                    _this.sendHandshake();
                console.log('sexy5');
                _this._push(HAVE);
                var newNew = buffer_1.Buffer.from('0000000a05fffffffffffffffff8', 'hex');
                _this._push(newNew);
                _this.messageLength();
            });
        });
    };
    Hose.prototype.createHandshake = function (infoHash, peerID) {
        this.infoHash = infoHash;
        this.peerID = peerID;
        this.sendHandshake();
    };
    Hose.prototype.sendHandshake = function () {
        this.sentHandshake = true;
        var infoHashBuffer = buffer_1.Buffer.from(this.infoHash, 'hex'), peerIDbuffer = buffer_1.Buffer.from(this.peerID, 'hex');
        console.log('giving handshake back..');
        this._push(buffer_1.Buffer.concat([PROTOCOL, RESERVED, infoHashBuffer, peerIDbuffer]));
    };
    Hose.prototype.sendChoke = function () {
        console.log('interested...');
        this._push(buffer_1.Buffer.concat([CHOKE]));
    };
    Hose.prototype.messageLength = function () {
        var _this = this;
        this._nextAction(4, function (payload) {
            console.log('debug message length payload: ', payload);
            var length = payload.readUInt32BE(0);
            console.log('length: ', length);
            if (length > 0)
                _this._nextAction(length, _this.getCode);
            else
                _this.messageLength();
        });
    };
    Hose.prototype.getCode = function (payload) {
        this.messageLength();
        console.log('debug message code and extra: ', payload);
        switch (payload[0]) {
            case 0:
                break;
            case 1:
                break;
            case 2:
                break;
            case 3:
                break;
            case 4:
                break;
            case 5:
                break;
            case 6:
                break;
            case 7:
                break;
            case 8:
                break;
            default:
                console.log('error, wrong message');
        }
    };
    Hose.prototype.destroy = function () {
    };
    return Hose;
}(stream_1.Duplex));
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Hose;

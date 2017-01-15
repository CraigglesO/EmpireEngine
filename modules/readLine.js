"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var stream_1 = require("stream");
var readLine = (function (_super) {
    __extends(readLine, _super);
    function readLine() {
        var _this = _super.call(this) || this;
        _this.store = [];
        _this.newLine = false;
        process.stdin.pipe(_this);
        return _this;
    }
    readLine.prototype._write = function (chunk, encoding, next) {
        this.emit('add', chunk.toString());
        next();
    };
    return readLine;
}(stream_1.Writable));
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = readLine;

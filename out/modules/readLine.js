"use strict";
const stream_1 = require("stream");
class ReadLine extends stream_1.Writable {
    constructor() {
        super();
        this.store = [];
        this.newLine = false;
        process.stdin.pipe(this);
    }
    _write(chunk, encoding, next) {
        this.emit("add", chunk.toString());
        next();
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ReadLine;
//# sourceMappingURL=readLine.js.map
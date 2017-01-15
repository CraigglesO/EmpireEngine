'use strict';
var Decode = (function () {
    function Decode(data, start, end, encoding) {
        if (data == null || data.length === 0) {
            return null;
        }
        if (typeof start !== 'number' && encoding == null) {
            encoding = start;
            start = undefined;
        }
        if (typeof end !== 'number' && encoding == null) {
            encoding = end;
            end = undefined;
        }
        this.position = 0;
        this.encoding = encoding || null;
        this.data = !(Buffer.isBuffer(data))
            ? new Buffer(data)
            : data.slice(start, end);
        this.bytes = this.data.length;
        return this.next();
    }
    Decode.prototype.next = function () {
        switch (this['data'][this['position']]) {
            case 0x64:
                return this.dictionary();
            case 0x6C:
                return this.list();
            case 0x69:
                return this.integer();
            default:
                return this.buffer();
        }
    };
    Decode.prototype.find = function (chr) {
        var i = this.position;
        var c = this.data.length;
        var d = this.data;
        while (i < c) {
            if (d[i] === chr)
                return i;
            i++;
        }
        throw new Error('Invalid data: Missing delimiter "' +
            String.fromCharCode(chr) + '" [0x' +
            chr.toString(16) + ']');
    };
    Decode.prototype.dictionary = function () {
        this.position++;
        var dict = {};
        while (this.data[this.position] !== 0x65) {
            dict[this.buffer()] = this.next();
        }
        this.position++;
        return dict;
    };
    Decode.prototype.list = function () {
        this.position++;
        var lst = [];
        while (this.data[this.position] !== 0x65) {
            lst.push(this.next());
        }
        this.position++;
        return lst;
    };
    Decode.prototype.integer = function () {
        var end = this.find(0x65);
        var number = getIntFromBuffer(this.data, this.position + 1, end);
        this.position += end + 1 - this.position;
        return number;
    };
    Decode.prototype.buffer = function () {
        var sep = this.find(0x3A);
        var length = getIntFromBuffer(this.data, this.position, sep);
        var end = ++sep + length;
        this.position = end;
        return this.encoding
            ? this.data.toString(this.encoding, sep, end)
            : this.data.slice(sep, end);
    };
    return Decode;
}());
exports.Decode = Decode;
var Encode = (function () {
    function Encode(data, buffer, offset) {
        this.buffE = new Buffer('e');
        this.buffD = new Buffer('d');
        this.buffL = new Buffer('l');
        this.bytes = -1;
        this._floatConversionDetected = false;
        var buffers = [];
        var result = null;
        this._encode(buffers, data);
        result = Buffer.concat(buffers);
        this.bytes = result.length;
        if (Buffer.isBuffer(buffer)) {
            result.copy(buffer, offset);
            return buffer;
        }
        return result;
    }
    Encode.prototype._encode = function (buffers, data) {
        if (Buffer.isBuffer(data)) {
            buffers.push(new Buffer(data.length + ':'));
            buffers.push(data);
            return;
        }
        if (data == null) {
            return;
        }
        switch (typeof data) {
            case 'string':
                this.buffer(buffers, data);
                break;
            case 'number':
                this.number(buffers, data);
                break;
            case 'object':
                data.constructor === Array
                    ? this.list(buffers, data)
                    : this.dict(buffers, data);
                break;
            case 'boolean':
                this.number(buffers, data ? 1 : 0);
                break;
        }
    };
    Encode.prototype.buffer = function (buffers, data) {
        buffers.push(new Buffer(Buffer.byteLength(data) + ':' + data));
    };
    Encode.prototype.number = function (buffers, data) {
        var maxLo = 0x80000000;
        var hi = (data / maxLo) << 0;
        var lo = (data % maxLo) << 0;
        var val = hi * maxLo + lo;
        buffers.push(new Buffer('i' + val + 'e'));
        if (val !== data && !this._floatConversionDetected) {
            this._floatConversionDetected = true;
            console.warn('WARNING: Possible data corruption detected with value "' + data + '":', 'Bencoding only defines support for integers, value was converted to "' + val + '"');
            console.trace();
        }
    };
    Encode.prototype.dict = function (buffers, data) {
        buffers.push(this.buffD);
        var j = 0;
        var k;
        var keys = Object.keys(data).sort();
        var kl = keys.length;
        for (; j < kl; j++) {
            k = keys[j];
            if (data[k] == null)
                continue;
            this.buffer(buffers, k);
            this._encode(buffers, data[k]);
        }
        buffers.push(this.buffE);
    };
    Encode.prototype.list = function (buffers, data) {
        var i = 0;
        var c = data.length;
        buffers.push(this.buffL);
        for (; i < c; i++) {
            if (data[i] == null)
                continue;
            this._encode(buffers, data[i]);
        }
        buffers.push(this.buffE);
    };
    return Encode;
}());
exports.Encode = Encode;
function getIntFromBuffer(buffer, start, end) {
    var sum = 0;
    var sign = 1;
    for (var i = start; i < end; i++) {
        var num = buffer[i];
        if (num < 58 && num >= 48) {
            sum = sum * 10 + (num - 48);
            continue;
        }
        if (i === start && num === 43) {
            continue;
        }
        if (i === start && num === 45) {
            sign = -1;
            continue;
        }
        if (num === 46) {
            break;
        }
        throw new Error('not a number: buffer[' + i + '] = ' + num);
    }
    return sum * sign;
}

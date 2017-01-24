import { Buffer } from "buffer";
import { openSync, writeSync, readSync, writeFileSync } from "fs";

interface Files {
  path:   string;
  name:   string;
  length: number;
  offset: number;
}

const DL_SIZE = 16384; // This is the default allowable download size per request
const REQUEST = Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x06]);

class TPH {
  files:         Array<Files>;
  length:        number;
  pieceSize:     number;
  pieceCount:    number;
  lastPieceSize: number;
  parts:         number;
  lastParts:     number;
  leftover:      number;
  constructor(files: Array<Files>, length: number, pieceSize: number, pieceCount: number, lastPieceSize: number) {
    const self = this;
    self.files         = files;
    self.length        = length;
    self.pieceSize     = pieceSize;
    self.pieceCount    = --pieceCount;
    self.lastPieceSize = lastPieceSize;
    self.parts         = pieceSize / DL_SIZE;
    self.lastParts     = Math.floor(lastPieceSize / DL_SIZE);
    self.leftover      = lastPieceSize % DL_SIZE;
  }

  prepareRequest(pieceNumber: number, cb: Function) {
    const self = this;
    let result = [];
    let count  = 0;
    // If not last piece:
    if (pieceNumber !== self.pieceCount) {
      let part = 0;
      count = self.parts;
      for (let i = 0; i < self.parts; i++) {
        let buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00]);
        buf.writeUInt32BE(pieceNumber, 0); // set the piece position
        result.push(REQUEST);
        result.push(buf);
        buf.writeUInt32BE(part, 4);        // set the offset inside the piece
        part += DL_SIZE;
      }
    } else {
      let part = 0;
      count = self.lastParts;
      for (let i = 0; i < self.lastParts; i++) {
        let buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00]);
        buf.writeUInt32BE(pieceNumber, 0); // set the piece position
        result.push(REQUEST);
        result.push(buf);
        buf.writeUInt32BE(part, 4);        // set the offset inside the piece
        part += DL_SIZE;
      }
      if (self.leftover) {
        let buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00]);
        buf.writeUInt32BE(pieceNumber, 0);   // (value,offest)
        buf.writeUInt32BE(part, 4);          // set the offset inside the piece
        buf.writeUInt32BE(self.leftover, 8); // The size is smaller
        result.push(REQUEST);
        result.push(buf);
        count++;
      }
    }
    let resultBuf = Buffer.concat(result);
    cb(resultBuf, count);
  }

  prepareUpload(index: number, begin: number, length: number, cb: Function) {
    // index: which hash piece (e.g. 0,1,2,3,4,...)
    // begin: which part of the piece (e.g. 0,1,2,3,4,...)
    // length: piece request size: (e.g. 16,384)
    const self = this;
    // Check that the input is within the range
    if ( (begin * DL_SIZE) + length > self.length || index > self.pieceCount) {
      cb(null);
    }

    let pre = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    pre.writeUInt32BE(length + 9, 0);
    pre.writeUInt32BE(index, 5);
    pre.writeUInt32BE(begin, 9);

    // Index is the starting piece. Multiply by piece size and add begin which is multiplied by the DL_SIZE limit
    let start = (index * self.pieceSize) + (begin * DL_SIZE);
    // Prepare piece to send back
    let piece = new Buffer(length);
    piece.fill(0);
    let pieceOffset = 0;
    // Discover which file(s) we are uploading from
    self.files.forEach((file) => {
      // check if the piece we want exists inside this file
      if ( start >= file.offset && start < (file.offset + file.length) ) {
        let f = openSync(file.path, "r");
        let fileStart = start - file.offset;
        // check that the request 100% exists in this file
        if ( (start + length) < (file.offset + file.length) ) {
          readSync(f, piece, pieceOffset, length, fileStart);
        } else {
          // grab just what we need from the file
          let newLength = (file.offset + file.length) - start;
          readSync(f, piece, pieceOffset, newLength, fileStart);
          // Update where we start and length
          start       += newLength;
          length      -= newLength;
          pieceOffset += newLength;
        }
      }
    });

    // piece:   <len=0009+X><id=7><index><begin><block>
    let resultBuf = Buffer.concat([pre, piece]);
    cb(resultBuf);
  }

  pieceIndex(num: number): number {
    return num * this.pieceSize;
  }

  // Find the proper file(s) and write:
  saveBlock(index: number, buf: Buffer): Boolean {
    const self = this;

    if (buf.length > DL_SIZE) {
      return false;
    }

    // First get which file this index is in:
    self.files.forEach((file) => {
      // If the buffer fits within the file:
      if ( (file.offset <= index) && (index < (file.offset + file.length)) ) {
        // check for index offset relative to file:
        let offset = index - file.offset;
        // If the entire buffer does not fit within the file:
        let bufW = null;
        if ( (index + buf.length) > (file.offset + file.length) ) {
          let newBufferLength = buf.length - ( (offset + buf.length) - (file.offset + file.length) );
          // Create new buffer and update index
          bufW = buf.slice(0, newBufferLength );
          buf = buf.slice(newBufferLength);
          index += newBufferLength;
        }
        let f = openSync(file.path, "r+");
        try {
          if (!bufW) {
            writeSync(f, buf, 0, buf.length, offset);
          } else {
            writeSync(f, bufW, 0, bufW.length, offset);
          }
        } catch (e) {
          writeFileSync("./debug.txt", "problem writing...");
          return false;
        }
      }
    });
    return true;
  }
}

export default TPH;

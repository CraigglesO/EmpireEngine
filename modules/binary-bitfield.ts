import { Buffer } from 'buffer';

const parseHex = {
  '0': '0000',
  '1': '0001',
  '2': '0010',
  '3': '0011',
  '4': '0100',
  '5': '0101',
  '6': '0110',
  '7': '0111',
  '8': '1000',
  '9': '1001',
  'a': '1010',
  'A': '1010',
  'b': '1011',
  'B': '1011',
  'c': '1100',
  'C': '1100',
  'd': '1101',
  'D': '1101',
  'e': '1110',
  'E': '1110',
  'f': '1111',
  'F': '1111'
}

const parseBinary = {
  '0000': '0',
  '0001': '1',
  '0010': '2',
  '0011': '3',
  '0100': '4',
  '0101': '5',
  '0110': '6',
  '0111': '7',
  '1000': '8',
  '1001': '9',
  '1010': 'a',
  '1011': 'b',
  '1100': 'c',
  '1101': 'd',
  '1110': 'e',
  '1111': 'f',
}

class binaryBitfield {

  pieces:        number
  bitfield:      string
  downloaded:    string
  percent:       number
  constructor (pieces: number | string | Buffer, downloaded?: string | Buffer) {
    if (!(this instanceof binaryBitfield))
      return new binaryBitfield(pieces);

    if (Buffer.isBuffer(pieces)) {
      pieces = pieces.toString('hex');
      pieces = this.hex2binary(pieces);
    }

    if (downloaded && Buffer.isBuffer(downloaded)) {
      downloaded = downloaded.toString('hex');
      downloaded = this.hex2binary(downloaded);
    }

    this.pieces     = (typeof pieces === 'number') ? pieces : this.countPieces(pieces);
    this.bitfield   = this.setPieces(this.pieces);
    this.downloaded = (downloaded)
      ? this.d2binary(downloaded)
      : this.setZeros(this.pieces);
    this.percent    = 0;
    this.getPercentage();
  }

  setPieces(pieces: number): string {
    let result = '';
    for (let i = 0; i < pieces; i++)
      result += '1';
    while (result.length < 8) {
      result += '0';
    }
    let addZero = (result.length % 8) ? (8 - (result.length % 8)) : 0;
    while (addZero) {
      result += '0';
      addZero--;
    }
    return result;
  }

  d2binary(downloaded): string {
    if (Buffer.isBuffer(downloaded))
      downloaded = downloaded.toString('hex');
    downloaded = this.hex2binary(downloaded);
    while (downloaded.length < this.pieces)
      downloaded += '00000000';
    return downloaded;
  }

  setZeros(pieces: number): string {
    let result = '';
    for (let i = 0; i < pieces; i++)
      result += '0';
    while (result.length < 8) {
      result += '0';
    }
    let addZero = (result.length % 8) ? (8 - (result.length % 8)) : 0;
    while (addZero) {
      result += '0';
      addZero--;
    }
    return result;
  }

  getPercentage(): number {
    let p = this.downloaded.slice(0, this.pieces);
    let oneCount = 0;
    for (let i = 0; i < p.length; i++){
      if (p[i] === '1')
        oneCount++;
    }
    this.percent = Math.round((oneCount / p.length) * 100) / 100;
    return this.percent;
  }

  countPieces(hex: string): number {
    let binary = this.hex2binary(hex);
    let pCount = 0;
    for (let i = 0; i < binary.length; i++)
      if (binary[i] === '1')
        pCount++;
    return pCount;
  }

  hex2binary(hex: string): string {
    let binary = '';
    for (let i = 0; i < hex.length; i++)
      binary += parseHex[hex[i]];
    return binary;
  }

  binary2hex(binary: string): string {
    let hex = '';
    for (let i = 0; i < binary.length; i += 4) {
      hex += parseBinary[binary.slice(i,i+4)];
    }
    return hex;
  }

  getBitfield(): string {
    return this.bitfield;
  }

  isSeeder(bits: string | Buffer): Boolean {
    if (Buffer.isBuffer(bits))
      bits = bits.toString('hex');
    bits = this.hex2binary(bits);
    return (this.bitfield === bits);
  }

  findNewPieces(bits: string | Buffer, cb: Function) {
    const self = this;
    let result    = '';
    let add2total = '';
    if (Buffer.isBuffer(bits))
      bits = bits.toString('hex');
    bits = self.hex2binary(bits);
    while (bits.length < self.bitfield.length) {
      bits += '00000000';
    }
    process.nextTick(() => {
      for (let i = 0; i < bits.length; i++) {
        if (self.downloaded[i] === '0' && bits[i] === '1')
          result += '1';
        else
          result += '0';
        if (bits[i] === '1') {
          let num = Number(self.downloaded[i]);
          num++;
          add2total += num;
        }
        else
          add2total += self.downloaded[i];
      }
      self.downloaded = add2total;
      cb(self.binary2hex(result), self.downloaded);
    });
  }

  set(piece: number, b?: Boolean) {
    if (b || arguments.length === 1)
      this.downloaded = this.downloaded.slice(0, piece) + '1' + this.downloaded.slice(piece + 1);
    else
      this.downloaded = this.downloaded.slice(0, piece) + '0' + this.downloaded.slice(piece + 1);
    this.getPercentage();
    return this.downloaded;
  }

  get(piece: number): Boolean {
    return !!(Number(this.downloaded[piece]));
  }
}

export default binaryBitfield

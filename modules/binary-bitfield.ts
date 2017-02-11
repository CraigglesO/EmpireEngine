import { Buffer } from "buffer";

const parseHex = {
  "0": "0000",
  "1": "0001",
  "2": "0010",
  "3": "0011",
  "4": "0100",
  "5": "0101",
  "6": "0110",
  "7": "0111",
  "8": "1000",
  "9": "1001",
  "a": "1010",
  "A": "1010",
  "b": "1011",
  "B": "1011",
  "c": "1100",
  "C": "1100",
  "d": "1101",
  "D": "1101",
  "e": "1110",
  "E": "1110",
  "f": "1111",
  "F": "1111"
};

const parseBinary = {
  "0000": "0",
  "0001": "1",
  "0010": "2",
  "0011": "3",
  "0100": "4",
  "0101": "5",
  "0110": "6",
  "0111": "7",
  "1000": "8",
  "1001": "9",
  "1010": "a",
  "1011": "b",
  "1100": "c",
  "1101": "d",
  "1110": "e",
  "1111": "f",
};

class BinaryBitfield {

  pieces:        number;
  bitfield:      string;
  downloaded:    string;
  downloading:   string;
  totalBitfield: string;
  percent:       number;
  constructor (pieces: any, downloaded?: any) {
    if (!(this instanceof BinaryBitfield))
      return new BinaryBitfield(pieces);

    if (Buffer.isBuffer(pieces)) {
      pieces = pieces.toString("hex");
      pieces = this.hex2binary(pieces);
    }

    if (downloaded && Buffer.isBuffer(downloaded)) {
      downloaded = downloaded.toString("hex");
      downloaded = this.hex2binary(downloaded);
    }

    this.pieces        = (typeof pieces === "number") ? pieces : this.countPieces(pieces);
    this.bitfield      = this.setPieces(this.pieces);
    this.downloading   = this.downloaded = (downloaded)
      ? this.d2binary(downloaded)
      : this.setZeros(this.pieces);
    this.totalBitfield = this.downloading;
    this.percent       = 0;
    this.getPercentage();
  }

  setPieces(pieces: number): string {
    let result = "";
    for (let i = 0; i < pieces; i++)
      result += "1";
    while (result.length < 8) {
      result += "0";
    }
    let addZero = (result.length % 8) ? (8 - (result.length % 8)) : 0;
    while (addZero) {
      result += "0";
      addZero--;
    }
    return result;
  }

  d2binary(downloading): string {
    if (Buffer.isBuffer(downloading))
      downloading = downloading.toString("hex");
    downloading = this.hex2binary(downloading);
    while (downloading.length < this.pieces)
      downloading += "00000000";
    return downloading;
  }

  setZeros(pieces: number): string {
    let result = "";
    for (let i = 0; i < pieces; i++)
      result += "0";
    while (result.length < 8) {
      result += "0";
    }
    let addZero = (result.length % 8) ? (8 - (result.length % 8)) : 0;
    while (addZero) {
      result += "0";
      addZero--;
    }
    return result;
  }

  getPercentage(): number {
    let p = this.downloaded.slice(0, this.pieces);
    let oneCount = 0;
    for (let i = 0; i < p.length; i++) {
      if (p[i] === "1")
        oneCount++;
    }
    this.percent = Math.round((oneCount / p.length) * 100) / 100;
    if (this.percent === 1 && oneCount !== p.length) {
      this.percent = 0.99;
    }
    return this.percent;
  }

  countPieces(hex: string): number {
    let binary = this.hex2binary(hex);
    let pCount = 0;
    for (let i = 0; i < binary.length; i++)
      if (binary[i] === "1")
        pCount++;
    return pCount;
  }

  hex2binary(hex: string): string {
    let binary = "";
    for (let i = 0; i < hex.length; i++)
      binary += parseHex[hex[i]];
    return binary;
  }

  binary2hex(binary: string): string {
    let hex = "";
    for (let i = 0; i < binary.length; i += 4) {
      hex += parseBinary[binary.slice(i, i + 4)];
    }
    return hex;
  }

  getBitfield(): string {
    return this.bitfield;
  }

  isSeeder(bits: any): Boolean {
    if (Buffer.isBuffer(bits))
      bits = bits.toString("hex");
    bits = this.hex2binary(bits);
    return (this.bitfield === bits);
  }

  findNewPieces(bits: any, type: Boolean | Function, cb?: Function) {
    if (typeof type === "function") {
      cb = type;
      type = false;
    }
    const self    = this;
    let result    = "";
    let add2total = "";
    let rarest    = (-1);
    let lowNum    = Infinity;
    let earliest  = (-1);
    let battle    = (-1);
    let firstSet  = false;
    if (Buffer.isBuffer(bits))
      bits = bits.toString("hex");
    bits = self.hex2binary(bits);
    while (bits.length < self.bitfield.length) {
      bits += "00000000";
    }
    process.nextTick(() => {
      for (let i = 0; i < bits.length; i++) {
        // Check if user has a new piece that client does not have
        if (self.downloading[i] === "0" && bits[i] === "1") {
          result += "1";
          if (!firstSet) {
            firstSet = true;
            earliest = i;
          }
        } else {
          result += "0";
        }

        // In the wild, some peers are incredibly slow to upload. Peers are entitled to race them:
        if (battle === (-1) && self.downloaded[i] === "0" && self.downloading[i] === "1" && bits[i] === "1") {
          battle = i;
        }

        // Update total bitfield:
        if (bits[i] === "1") {
          let num = Number(self.totalBitfield[i]);
          num++;
          if (num < lowNum && i < self.pieces && self.downloading[i] === "0") {
            lowNum = num;
            rarest = i;
          }
          add2total += num;
        }
        else
          add2total += self.totalBitfield[i];
      }
      let which = (-1);
      if (!type && earliest !== (-1)) {
        self.set(earliest);
        which = earliest;
      } else if (type && rarest !== (-1)) {
        self.set(rarest);
        which = rarest;
      } else if (battle !== (-1)) {
        which = battle;
      }
      self.totalBitfield = add2total;
      cb(result, self.downloading, which);
    });
  }

  onHave(piece: number, bitfield: any): string {
    const self = this;
    if (Buffer.isBuffer(bitfield))
      bitfield = bitfield.toString("hex");
    // Set the number into the bitfield and return;
    let bf = self.hex2binary(bitfield);
    bf = bf.slice(0, piece) + "1" + bf.slice(piece + 1);
    let hex = self.binary2hex(bf);

    // Return a string with the new bitfield size
    return hex;
  }

  set(piece: number, b?: Boolean) {
    if (b || arguments.length === 1)
      this.downloading = this.downloading.slice(0, piece) + "1" + this.downloading.slice(piece + 1);
    else
      this.downloading = this.downloading.slice(0, piece) + "0" + this.downloading.slice(piece + 1);
    this.getPercentage();
    return this.downloading;
  }

  get(piece: number): Boolean {
    return !!(Number(this.downloading[piece]));
  }

  setDownloaded(piece: number, b?: Boolean) {
    if (b || arguments.length === 1)
      this.downloaded = this.downloaded.slice(0, piece) + "1" + this.downloaded.slice(piece + 1);
    else
      this.downloaded = this.downloaded.slice(0, piece) + "0" + this.downloaded.slice(piece + 1);
    this.getPercentage();
    return this.percent;
  }

  getDownloaded(piece: number): Boolean {
    return !!(Number(this.downloaded[piece]));
  }
}

export default BinaryBitfield;

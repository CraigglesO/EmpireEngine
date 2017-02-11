"use strict";

// https://tracker.openwebtorrent.com/stats

import { Duplex } from "stream";
import { Buffer } from "buffer";
import { Hash, createHash } from "crypto";
import { UTmetadata, UTpex } from "../modules/ut-extensions";
import * as debug from "debug";
debug("hose");

import { Encode, Decode } from "../modules/bencoder";

const speedometer = require("speedometer");
const bencode     = require("bencode");

const BITFIELD_MAX_SIZE  = 100000; // Size of field for preporations
const KEEP_ALIVE_TIMEOUT = 55000;  // 55 seconds
const DL_SIZE = 16384;

const PROTOCOL     = Buffer.from("BitTorrent protocol"),
      RESERVED     = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00]),
      KEEP_ALIVE   = Buffer.from([0x00, 0x00, 0x00, 0x00]),
      CHOKE        = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00]),
      UNCHOKE      = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x01]),
      INTERESTED   = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02]),
      UNINTERESTED = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x03]),
      HAVE         = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x04]),
      BITFIELD     = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x05]),
      REQUEST      = Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x06]), // Requests are 1 code and 3 32 bit integers
      PIECE        = Buffer.from([0x00, 0x00, 0x00, 0x09, 0x07]), // Pieces are 1 code and 2 16 bit integers and then the piece...
      CANCEL       = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x08]),
      EXTENDED     = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x14]),
      EXT_PROTOCOL = {"m": {"ut_pex": 1, "ut_metadata": 2} },
      UT_PEX       = 1,
      UT_METADATA  = 2;

interface Extension {
  "ut_pex":      number;
  "ut_metadata": number;
}

interface Request {
  index:  number;
  begin:  number;
  length: number;
}

class Hose extends Duplex {
  _debugId:        number;
  destroyed:       Boolean;
  sentHandshake:   Boolean;
  bufferSize:      number;
  streamStore:     Array<Buffer>;
  parseSize:       number;
  actionStore:     Function;
  uploadSpeed:     Function;
  downloadSpeed:   Function;
  inRequests:      Array<Request>;
  blocks:          Array<Buffer>;
  blockCount:      number;
  pieceHash:       Hash | null;
  infoHash:        string;
  peerID:          string;
  choked:          Boolean;
  interested:      Boolean;
  isActive:        Boolean;
  busy:            Boolean;
  reqBusy:         Boolean;
  meta:            Boolean;
  ext:             Extension | Object;

  constructor (infoHash: string, peerID: string) {
    super();
    if (!(this instanceof Hose))
      return new Hose(infoHash, peerID);

    const self = this;

    self._debugId       = ~~((Math.random() * 100000) + 1);

    self.destroyed       = false;
    self.sentHandshake   = false;
    self.uploadSpeed     = speedometer();
    self.downloadSpeed   = speedometer();
    self.bufferSize      = 0;
    self.streamStore     = [];
    self.parseSize       = 0;
    self.actionStore     = null;
    self.inRequests      = [];
    self.blocks          = [];
    self.blockCount      = 0;
    self.pieceHash       = null;

    self.infoHash        = infoHash;
    self.peerID          = peerID;
    self.choked          = true;
    self.interested      = false;
    self.busy            = false;
    self.reqBusy         = false;
    self.meta            = true;
    self.ext             = {};

    self.prepHandshake();
  }

  // HANDSHAKE:
  prepHandshake() {
    this._nextAction(1, (payload) => {
      let pstrlen = payload.readUInt8(0);
      this._nextAction(pstrlen + 48, (payload) => {
        // Prepare all information
        let pstr          = payload.slice(0, pstrlen),   // Protocol Identifier utf-8 encoding
            reserved      = payload.slice(pstrlen, 8);   // These 8 bytes are reserved for future use
            pstr          = pstr.toString();             // Convert the Protocol to a string
            payload       = payload.slice(pstrlen + 8);  // Remove the pre-string and reserved bytes from buffer
        let infoHash      = payload.slice(0, 20),
            peerID        = payload.slice(20, 40);
            this.infoHash = infoHash.toString("hex");    // Infohash is a hex string
            this.peerID   = peerID.toString("hex");      // PeerID is also a hex string

        if (pstr !== "BitTorrent protocol")
          return;

        // Send a handshake back if peer initiated the connection
        if (!this.sentHandshake)
          this.emit("handshake", infoHash, peerID);      // Let listeners know the peers requested infohash and ID

        // Last but not least let's add a new action to the queue
        this.nextAction();
      });
    });
  }

  nextAction() {
    // TODO: upate keep alive timer here.
    this._nextAction(4, (payload) => {
      let length = payload.readUInt32BE(0);          // Get the length of the payload.
      if (length > 0)
        this._nextAction(length, this.handleCode);      // Message length, next action is to parse the information provided
      else
        this.nextAction();
    });
  }

  // All built in functionality goes here:

  // Read streams will all be handled with this.push
  _read() {}
  // Handling incoming messages with message length (this.parseSize)
  // and cueing up commands to handle the message (this.actionStore)
  _write(payload: Buffer, encoding?: string, next?: Function) {
    this.downloadSpeed(payload.length);
    this.bufferSize += payload.length;             // Increase our buffer size count, we have more data
    this.streamStore.push(payload);                // Add the payload to our list of streams downloaded
    // Parse Size is always pre-recorded, because we know what to expect from peers
    while (this.bufferSize >= this.parseSize) {    // Wait until the package size fits the crime
      let buf = (this.streamStore.length > 1)      // Store our stream to a buffer to do the crime
        ? Buffer.concat(this.streamStore)
        : this.streamStore[0];
      this.bufferSize -= this.parseSize;           // Decrease the size of our store count, this number of data is processed
      this.streamStore = (this.bufferSize)         // If buffersize is zero, reset the buffer; otherwise just slice the part we are going to use
        ? [buf.slice(this.parseSize)]
        : [];
      this.actionStore(buf.slice(0, this.parseSize));  // Let us run the code we have!
    }
    // send a null to let stream know we are done and ready for the next input.
    next(null);
  }

  // ALL OUTGOING GOES HERE:

  _push(payload: Buffer) {
    // TODO: upate keep alive timer here.
    return this.push(payload);
  }
  // keep-alive: <len=0000>
  sendKeepActive() {
    this._push(KEEP_ALIVE);
  }
  // handshake: <pstrlen><pstr><reserved><info_hash><peer_id>
  sendHandshake() {
    // TODO: check if infohash and peerID are already buffers
    this.sentHandshake = true;
    // convert infoHash and peerID to buffer
    let infoHashBuffer = Buffer.from(this.infoHash, "hex"),
        peerIDbuffer   = Buffer.from("2d4c54313030302d764874743153546a4d583043", "hex");
        // peerIDbuffer   = Buffer.from(this.peerID, 'hex');
    this._push(Buffer.concat([PROTOCOL, RESERVED, infoHashBuffer, peerIDbuffer]));
  }
  // not interested: <len=0001><id=3>
  sendNotInterested() {
    this._push(UNINTERESTED);
  }
  // interested: <len=0001><id=2>
  sendInterested() {
    this._push(Buffer.concat([INTERESTED, UNCHOKE]));
    this.choked = false;
  }
  // have: <len=0005><id=4><piece index>
  sendHave(index: number) {
    // TODO: Superseeding
  }
  // bitfield: <len=0001+X><id=5><bitfield>
  sendBitfield(bitfield: string) {
    // update bitfield length param to bitfield size:
    let bitfieldBuf = Buffer.from(bitfield, "hex");
    let bf = BITFIELD;
    bf.writeUInt32BE(bitfieldBuf.length + 1, 0);
    this._push( Buffer.concat([bf, bitfieldBuf]) );
  }
  // request: <len=0013><id=6><index><begin><length>
  sendRequest(payload: Buffer, count: number) {
    const self      = this;
    // Track how many incoming we are going to get:
    self.blockCount = count;
    self.busy       = true;
    // Create a new hash to ensure authenticity
    self.pieceHash  = createHash("sha1");
    this._push(payload);
  }
  // piece: <len=0009+X><id=7><index><begin><block>
  sendPiece(piece: Buffer) {
    this._push(piece);
  }
  // cancel: <len=0013><id=8><index><begin><length>
  sendCancel() {

  }

  // ALL INCOMING GOES HERE:

  _nextAction(length: number, action: Function) {
    this.parseSize   = length;
    this.actionStore = action;
  }
  // have: <len=0005><id=4><piece index>
  _onHave(pieceIndex) {
    this.emit("have", pieceIndex);
  }
  // bitfield: <len=0001+X><id=5><bitfield>
  _onBitfield(payload) {
    // Here we have recieved a bitfield (first message)
    this.emit("bitfield", payload);
  }
  // request: <len=0013><id=6><index><begin><length>
  _onRequest(index, begin, length) {
    // Add the request to the stack:
    this.inRequests.push({index, begin, length});
    this.emit("request");
  }
  // piece: <len=0009+X><id=7><index><begin><block>
  _onPiece(index: number, begin: number, block: Buffer) {
    const self = this;
    process.nextTick(() => {
      self.blockCount--;
      // Commit piece to total. We wait to concat the buffers due to speed concerns
      self.blocks[begin / DL_SIZE] = block;
      // If we have all the blocks we need to make a piece send it up to torrentEngine:
      if (!self.blockCount) {
        let resultBuf = Buffer.concat(self.blocks);
        // Update hash:
        self.pieceHash.update(resultBuf);
        // Emit up:
        self.emit("finished_piece", index, resultBuf, self.pieceHash);
        self.blocks = [];
      }
    });
  }
  // cancel: <len=0013><id=8><index><begin><length>
  _onCancel(index, begin, length) {

  }

  // EXTENSIONS GO HERE

  // extension: <len=0002+x><id=20><extID><payload>
  _onExtension(extensionID: number, payload: Buffer) {
    const self = this;
    if (extensionID === 0) {
      // Handle the extension handshake:
      let obj = bencode.decode(payload);
      let m = obj.m;
      if (m["ut_metadata"]) {
        // Handle the ut_metadata protocol here:
        self.ext[UT_METADATA]   = new UTmetadata(obj.metadata_size, self.infoHash);
        self.ext["ut_metadata"] = m["ut_metadata"];

        // Prep emitter responces:
        self.ext[UT_METADATA].on("next", (piece) => {
          // Ask the peer for the next piece
          let request       = { "msg_type": 0, "piece": piece },
              prepRequest   = EXTENDED,
              requestEn     = bencode.encode(request),
              code          = new Buffer(1);
          prepRequest.writeUInt32BE(requestEn.length + 2, 0);
          code.writeUInt8(self.ext["ut_metadata"], 0);
          let requestBuf = Buffer.concat([prepRequest, code, requestEn]);
          this._push(requestBuf);
        });
        self.ext[UT_METADATA].on("metadata", (torrent) => {
          // send up:
          self.emit("metadata", torrent);
        });
      }
      if (m["ut_pex"]) {
        // Handle the PEX protocol here
        self.ext[UT_PEX]   = new UTpex();
        self.ext["ut_pex"] = m["ut_pex"];

        // Prep emitter responces:
        self.ext[UT_PEX].on("pex_added", (peers) => {
          self.emit("pex_added", peers);
        });
        self.ext[UT_PEX].on("pex_added6", (peers) => {
          self.emit("pex_added6", peers);
        });

        self.ext[UT_PEX].on("pex_dropped", (peers) => {
          self.emit("pex_dropped", peers);
        });
        self.ext[UT_PEX].on("pex_dropped6", (peers) => {
          self.emit("pex_dropped6", peers);
        });
      }
    } else {
      // Handle the payload with the proper extension
      if (self.meta || extensionID === self.ext["ut_pex"])
        self.ext[extensionID]._message(payload);
    }
  }

  metaDataRequest() {
    const self = this;
    if (self.ext["ut_metadata"]) {
      self.metaDataHandshake();
      // Prep and send a meta_data request:
      let request       = { "msg_type": 0, "piece": 0 },
          prepRequest   = EXTENDED,
          requestEn     = bencode.encode(request),
          code          = new Buffer(1);
      prepRequest.writeUInt32BE(requestEn.length + 2, 0);
      code.writeUInt8(self.ext["ut_metadata"], 0);
      let requestBuf = Buffer.concat([prepRequest, code, requestEn]);
      console.log("metadata request");
      this._push(requestBuf);
    }
  }

  metaDataHandshake() {
    // Prep and send a meta_data handshake:
    let handshake     = EXT_PROTOCOL,
        prepHandshake = EXTENDED,
        handshakeEn   = bencode.encode(handshake);
    prepHandshake.writeUInt32BE(handshakeEn.length + 2, 0);
    let handshakeBuf  = Buffer.concat([prepHandshake, Buffer.from([0x00]), handshakeEn]);
    this._push(handshakeBuf);
  }

  // HANDLE INCOMING MESSAGES HERE:

  handleCode(payload: Buffer) {
    const self = this;
    self.nextAction();     // Prep for the next nextAction
    switch (payload[0]) {
      case 0:
        // Choke
        self._debug("got choke");
        self.choked = true;
        self._push(CHOKE);
        break;
      case 1:
        // Unchoke
        self._debug("got unchoke");
        if (!self.choked) {

        } else {
          self.choked = false;
          self._push(UNCHOKE);
        }
        break;
      case 2:
        // Interested
        self._debug("peer is interested");
        self.emit("interested");
        self.choked = false;
        self._push(Buffer.concat([INTERESTED, UNCHOKE]));
        break;
      case 3:
        // Not Interested
        self._debug("peer is uninterested");
        self.closeConnection();
        break;
      case 4:
        // Have
        self._debug("peer sent have");
        self._onHave(payload.readUInt32BE(1));
        break;
      case 5:
        // Bitfield
        self._debug("Recieved bitfield");
        self._onBitfield(payload.slice(1)); // remove the ID from buffer
        break;
      case 6:
        // Request
        if (self.choked) return;
        self._debug("Recieved request");
        self._onRequest(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.readUInt32BE(9));
        break;
      case 7:
        // Piece
        self._debug("Recieved piece");
        self._onPiece(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.slice(9));
        break;
      case 8:
        // Cancel
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

  // Commands to & from torrentEngine

  isChoked(): Boolean {
    return this.choked;
  }

  isBusy(): Boolean {
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
    this.ext[ UT_METADATA ] = null;
    delete this.ext[ UT_METADATA ];
  }

  close() {
    // TODO: remove timeouts

  }

  _debug = function (...args: any[]) {
    args = [].slice.call(arguments);
    args[0] = "[" + this._debugId + "] " + args[0];
    debug.apply(null, args);
  };

}

export default Hose;

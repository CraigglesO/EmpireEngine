'use strict';

//https://tracker.openwebtorrent.com/stats

import { Duplex } from 'stream';
import { Buffer } from 'buffer';
import { Hash, createHash } from 'crypto';
import * as debug from 'debug';
debug('hose');

import { Encode, Decode } from '../modules/bencoder';

const speedometer = require('speedometer');

const BITFIELD_MAX_SIZE  = 100000; // Size of field for preporations
const KEEP_ALIVE_TIMEOUT = 55000;  // 55 seconds

const PROTOCOL     = Buffer.from('\u0013BitTorrent protocol'),
      RESERVED     = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
      KEEP_ALIVE   = Buffer.from([0x00, 0x00, 0x00, 0x00]),
      CHOKE        = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00]),
      UNCHOKE      = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x01]),
      INTERESTED   = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02]),
      UNINTERESTED = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x03]),
      HAVE         = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x04]),
      BITFIELD     = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x05]),
      REQUEST      = Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x06]), // Requests are 2 code and 3 32 bit integers
      PIECE        = Buffer.from([0x00, 0x00, 0x00, 0x09, 0x07]), // Pieces are 1 code and 2 16 bit integers and then the piece...
      CANCEL       = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x08]);

class Hose extends Duplex {
  _debugId:        number
  destroyed:       Boolean
  sentHandshake:   Boolean
  bufferSize:      number
  streamStore:     Array<Buffer>
  parseSize:       number
  actionStore:     Function
  uploadSpeed:     Function
  downloadSpeed:   Function
  inRequests:      Array<Buffer>
  blocks:          Array<Buffer>
  blockCount:      number
  pieceHash:       Hash | null
  infoHash:        string
  peerID:          string
  choked:          Boolean
  interested:      Boolean
  isActive:        Boolean
  bitfield:        any
  haveSuppression: Boolean

  constructor (bitfield?: any) {
    super();
    if (!(this instanceof Hose))
      return new Hose(bitfield);

    const self = this;

    self._debugId       = ~~((Math.random()*100000)+1);

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

    self.infoHash        = '';
    self.peerID          = '';
    self.choked          = true;
    self.interested      = false;
    self.bitfield        = bitfield;
    self.haveSuppression = false;

    self.prepHandshake();
  }

  //HANDSHAKE:
  prepHandshake() {
    this._nextAction(1, (payload) => {
      let pstrlen = payload.readUInt8(0);
      this._nextAction(pstrlen + 48, (payload) => {
        // Prepare all information
        console.log('payload');
        let pstr          = payload.slice(0, pstrlen),   // Protocol Identifier utf-8 encoding
            reserved      = payload.slice(pstrlen, 8);   // These 8 bytes are reserved for future use
            pstr          = pstr.toString();             // Convert the Protocol to a string
            payload       = payload.slice(pstrlen + 8);  // Remove the pre-string and reserved bytes from buffer
        let infoHash      = payload.slice(0, 20),
            peerID        = payload.slice(20, 40);
            this.infoHash = infoHash.toString('hex');    // Infohash is a hex string
            this.peerID   = peerID.toString('hex');      // PeerID is also a hex string

        if (pstr !== 'BitTorrent protocol')
          return;

        this._debug('Protocol type: ', pstr);
        this._debug('infoHash:      ', this.infoHash);
        this._debug('peerId:        ', this.peerID);

        this.emit('handshake', infoHash, peerID);        // Let listeners know the peers requested infohash and ID

        // Send a handshake back if peer initiated the connection
        if (!this.sentHandshake)
          this.sendHandshake();

        // Last but not least let's add a new action to the queue
        this.messageLength();
      });
    });
  }

  messageLength() {
    // TODO: upate keep alive timer here.
    this._nextAction(4, (payload) => {
      let length = payload.readUInt32BE(0);          // Get the length of the payload.
      if (length > 0)
        this._nextAction(length, this.handleCode);      // Message length, next action is to parse the information provided
      else
        this.messageLength();
    });
  }

  // All built in functionality goes here:

  // Read streams will all be handled with this.push
  _read() {}
  // Handling incoming messages with message length (this.parseSize)
  // and cueing up commands to handle the message (this.actionStore)
  _write(payload: Buffer, encoding?: string, next?: Function) {
    this._debug('new Data! %o');
    this.bufferSize += payload.length;             // Increase our buffer size count, we have more data
    this.streamStore.push(payload);                // Add the payload to our list of streams downloaded
    console.log('bufferSize!: ', this.bufferSize);
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

  createHandshake(infoHash: string, peerID: string) {
    this.infoHash = infoHash;
    this.peerID = peerID;
    this.sendHandshake();
  }

  sendHandshake() {
    //TODO: check if infohash and peerID are already buffers
    this.sentHandshake = true;
    //convert infoHash and peerID to buffer
    let infoHashBuffer = Buffer.from(this.infoHash, 'hex'),
        peerIDbuffer   = Buffer.from(this.peerID, 'hex');
    console.log('giving handshake back..');
    this._push(Buffer.concat([PROTOCOL, RESERVED, infoHashBuffer, peerIDbuffer]));
  }

  sendNotInterested() {
    this._push(UNINTERESTED);
  }

  sendHave() {

  }

  sendBitfield(bitfield) {
    this._push(Buffer.concat([BITFIELD,bitfield]));
  }

  sendRequest(buf, count) {
    const self      = this;
    // Track how many incoming we are going to get:
    self.blockCount = count;
    // Create a new hash to ensure authenticity
    self.pieceHash  = createHash('sha1');
    this._push(buf);
  }

  sendPiece() {

  }

  sendCancel() {

  }

  // ALL INCOMING GOES HERE:

  _nextAction(length: number, action: Function) {
    this.parseSize   = length;
    this.actionStore = action;
  }

  _onHave(pieceIndex) {
    this.bitfield.set(pieceIndex, true);
    if (!this.haveSuppression)
      this.emit('have', pieceIndex);
  }

  _onBitfield(payload) {
    // Here we have recieved a bitfield (first message)
    this.emit('bitfield', payload);
  }

  _onRequest(index, begin, length) {
    const self = this;
    // Iterate through requests...
    while (!self.inRequests.length) {
      process.nextTick(() => {

      });
    }
  }

  _onPiece(index, begin, block) {
    const self = this;
    process.nextTick(() => {
      self.blockCount--;
      // Update hash:
      self.pieceHash.update(block);
      // Commit piece to total. We wait to concat the buffers due to speed concerns
      self.blocks.push(block);

      // If we have all the blocks we need to make a piece send it up to torrentEngine:
      if (!self.blockCount)
        self.emit('finished_piece', Buffer.concat(self.blocks), self.pieceHash.digest('hex'));
    });
  }

  _onCancel(index, begin, length) {

  }

  handleCode(payload: Buffer) {
    const self = this;
    self.messageLength()                             // Prep for the next messageLength
    console.log('debug message code and extra: ', payload);
    switch (payload[0]) {
      case 0:
        // Choke
        self._debug('got choke');
        self.choked = true;
        self._push(CHOKE);
        break;
      case 1:
        // Unchoke
        self._debug('got unchoke');
        if (!self.choked) {

        } else {
          self.choked = false;
          self._push(UNCHOKE);
        }
        break;
      case 2:
        // Interested
        self._debug('peer is interested');
        self.emit('interested');
        self.choked = false;
        self._push(Buffer.concat([INTERESTED, UNCHOKE]));
        break;
      case 3:
        // Not INTERESTED
        self._debug('got uninterested');
        self.closeConnection();
        break;
      case 4:
        // Have
        self._debug('got have');
        self._onHave(payload.readUInt32BE(1));
        break;
      case 5:
        // Bitfield
        self._debug('Recieved bitfield');
        self._onBitfield(payload.slice(1)); //remove the ID from buffer
        break;
      case 6:
        // Request
        if (self.choked) return;
        self._debug('Recieved request');
        self._onRequest(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.readUInt32BE(9));
        break;
      case 7:
        // Piece
        self._debug('Recieved piece');
        self._onPiece(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.slice(9));
        break;
      case 8:
        // Cancel
        self._debug('Recieved cancel');
        self._onCancel(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.readUInt32BE(9));
        break;
      default:
        this._debug('error, wrong message');
    }
  }

  // Commands from torrentEngine

  closeConnection() {
    this.isActive = false;
    this.emit('close');
  }

  setHaveSuppression() {
    this.haveSuppression = true;
  }

  close() {
    this.isActive = false;
    // TODO: Clean up future intervals...
  }

  _debug = function (...args : any[]) {
    args = [].slice.call(arguments)
    args[0] = '[' + this._debugId + '] ' + args[0]
    debug.apply(null, args)
  }

}

export default Hose;

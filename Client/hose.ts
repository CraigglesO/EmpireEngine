'use strict';

//https://tracker.openwebtorrent.com/stats

import { Duplex } from 'stream';
import { Buffer } from 'buffer';
const speedometer = require('speedometer');
const bencode     = require('bencode');
//import { encode, decode } from 'bencode';

const PROTOCOL     = Buffer.from('\u0013BitTorrent protocol'),
      RESERVED     = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
      KEEP_ALIVE   = Buffer.from([0x00, 0x00, 0x00, 0x00]),
      CHOKE        = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00]),
      UNCHOKE      = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x01]),
      INTERESTED   = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02]),
      UNINTERESTED = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x03]),
      HAVE         = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x04]),
      BITFIELD     = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x05]),
      REQUEST      = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x06]),
      PIECE        = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x07]),
      CANCEL       = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x08]),
      PORT         = Buffer.from([0x00, 0x00, 0x00, 0x03, 0x09, 0x00, 0x00]);

const myID = Buffer.from('317c8d25beefbb30d32592e2afd3fbb7a0396987', 'hex');

class Hose extends Duplex {
  destroyed:     Boolean;
  sentHandshake: Boolean;
  bufferSize:    number;
  streamStore:   Array<Buffer>;
  parseSize:     number;
  actionStore:   Function;
  uploadSpeed:   Function;
  downloadSpeed: Function;
  infoHash:      string;
  peerID:        string;
  choked:        Boolean;
  interested:    Boolean;
  isActive:      Boolean;

  constructor (opts?: Object) {
    super();
    if (!opts) opts = {};
    if (!(this instanceof Hose))
      return new Hose(opts);

    this.destroyed      = false;
    this.sentHandshake  = false;
    this.uploadSpeed    = speedometer();
    this.downloadSpeed  = speedometer();
    this.bufferSize     = 0;
    this.streamStore    = [];
    this.parseSize      = 0;
    this.actionStore    = null;

    this.infoHash       = '';
    this.peerID         = '';
    this.choked         = true;
    this.interested     = false;

    this.on('complete', this.destroy);

    this.prepHandshake();
  }

  _read() {

  }

  _nextAction(length: number, action: Function) {
    this.parseSize   = length;
    this.actionStore = action;
  }

  _push(payload: Buffer) {
    return this.push(payload);
  }

  _write(payload: Buffer, encoding?: string, next?: Function) {
    console.log('new data!');
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
        : []
      this.actionStore(buf.slice(0, this.parseSize));  // Let us run the code we have!
    }

    next(null);
  }

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

        console.log('Protocol type: ', pstr);
        console.log('infoHash:      ', this.infoHash);
        console.log('peerId:        ', this.peerID);

        this.emit('handshake', infoHash, peerID);        // Let listeners know the peers requested infohash and ID

        if (!this.sentHandshake)
          this.sendHandshake();

        // Last but not least let's add a new action to the queue
        this.messageLength();
      });
    });
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

  sendChoke() {
    console.log('Send Choke');
    this._push(Buffer.from(CHOKE, 'hex'));
  }

  sendUnChoke() {
    console.log('Send Unchoke');
    this._push(Buffer.from(UNCHOKE, 'hex'));
  }

  sendInterested() {
    console.log('send Interested');
    this._push(Buffer.from(INTERESTED, 'hex'));
  }

  sendUnInterested() {
    this._push(Buffer.from(UNINTERESTED, 'hex'));
  }

  messageLength() {
    // TODO: have a keep alive timer updated here.
    this._nextAction(4, (payload) => {
      console.log('debug message length payload: ', payload);
      let length = payload.readUInt32BE(0);          // Get the length of the payload.
      console.log('length: ', length);
      if (length > 0)
        this._nextAction(length, this.getCode);      // Message length, next action is to parse the information provided
      else
        this.messageLength();
    });
  }

  getCode(payload: Buffer) {
    this.messageLength()                             // Prep for the next messageLength
    console.log('debug message code and extra: ', payload);
    switch (payload[0]) {
      case 0:
        // Choke
        this.choked = true;
        sendChoke();
        break;
      case 1:
        // Unchoke
        this.choked = false;
        sendUnchoke();
        break;
      case 2:
        // Interested
        sendInterested();
        break;
      case 3:
        // Not INTERESTED
        closeConnection();
        break;
      case 4:
        // Have
        break;
      case 5:
        // Bitfield
        // Here we have recieved a bitfield (first message), so 1) send to torrentEngine to decide which piece to download
        // 2) 
        break;
      case 6:
        // Request
        break;
      case 7:
        // Piece
        break;
      case 8:
        // Cancel
        break;
      default:
        console.log('error, wrong message');
    }
  }

  closeConnection() {
    this.isActive = false;
  }

  destroy() {

  }

}

export default Hose;

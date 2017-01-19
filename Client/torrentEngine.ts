import { createServer, connect, Socket } from 'net';
import { EventEmitter }                  from 'events';
import * as inherits                     from 'inherits';
import { Hash }                          from 'crypto';
import { udpTracker, wssTracker }        from './trackerClient';
import Hose                              from './Hose';
import parseTracker                      from '../modules/parse-p2p-tracker';
import TPH                               from '../modules/torrent-piece-handler';
import binaryBitfield                    from '../modules/binary-bitfield';
import * as _                            from 'lodash';
import * as debug                        from 'debug';
debug('torrentEngine');

interface PeerData {
  bitfield:  string    // Pieces this peer has
  index:     number    // Index of current piece project
  piece:     number
}

interface Files {
  path:   string
  name:   string
  length: number
  offset: number
}

const PeerData = {
  bitfield: '00',
  index:    0,
  piece:    0
}

const MAX_PEERS = 50;

class torrentHandler extends EventEmitter {
  peerID:        string
  _debugId:      number
  finished:      Boolean
  torrent:       Object
  pieces:        Array<string>
  infoHash:      string
  uploaded:      number
  downloaded:    number
  left:          number
  port:          number
  trackers:      Object
  trackerData:   Object
  connectQueue:  Array<string>
  haveStack:     Array<number>
  bitfieldDL:    string
  bitfield:      binaryBitfield
  tph:           TPH
  peers:         any
  hoses:         any
  incomingPeers: any
  constructor(torrent: any) {
    super();
    if (!(this instanceof torrentHandler))
      return new torrentHandler(torrent);
    const self = this;

    self._debugId      = ~~((Math.random()*100000)+1);
    self.peerID        = 'empire';

    self.finished      = false;
    self.torrent       = torrent;
    self.pieces        = torrent.pieces;
    self.infoHash      = torrent.infoHash;
    self.uploaded      = torrent.uploaded;
    self.downloaded    = torrent.downloaded;
    self.left          = torrent.left;
    self.port          = ~~( ( Math.random() * (65535-1) ) + 1); // Random port for speeeed.
    self.trackers      = {};
    self.trackerData   = {};
    self.peers         = {};
    self.hoses         = {};
    self.connectQueue  = [];
    self.haveStack     = [];
    self.bitfieldDL    = torrent.bitfieldDL || '00';
    self.bitfield      = new binaryBitfield(torrent.pieces.length, torrent.bitfieldDL);
    self.tph           = new TPH(torrent.files, torrent.length, torrent.pieceLength, torrent.pieces.length, torrent.lastPieceLength);

    // Trackers (WSS/UDP)
    self.torrent['announce'].forEach((tracker: string) => {
      let pt = parseTracker(tracker);
      if (pt.type === 'udp') {
        self.trackers[tracker] = new udpTracker(pt.host, pt.port, self.port, self.infoHash);
      } else {
        self.trackers[tracker] = new wssTracker();
      }

      self.trackers[tracker].on('announce', (interval, leechers, seeders, peers) => {
        self.connectQueue = self.connectQueue.concat(peers);
        self.connectQueue = _.uniq(self.connectQueue);  // MAYBE not do this, because reconnecting to an old peer might prove useful.
        //TODO: Create a queue action and emit an update above
        self.newConnectionRequests();
      });

      self.trackers[tracker].on('error', () => {
        self.trackerData[tracker+':failure'] = true;
      });

      self.trackers[tracker].on('scrape', (seeders, completed, leechers, timeTillNextScrape) => {
        self.trackerData[tracker+':seeders'] = seeders;
        self.trackerData[tracker+':completed'] = completed;
        self.trackerData[tracker+':leechers'] = leechers;
        self.trackerData[tracker+':nextReq'] = timeTillNextScrape;
      });

    });

    // P2P relations (TCP)
    self.incomingPeers = createServer((socket) => {
      self._debug('new connection');
      let host   = socket.remoteAddress,
          port   = socket.remotePort,
          family = socket.remoteFamily,
          hose   = self.hoses[host] = new Hose(self.infoHash, self.peerID, self.bitfieldDL);

      self.peers[host] = {port, family, hose, socket, bitfield: '00', position: 0, piece: 0};
      socket.pipe(hose).pipe(socket);

      self.peers[host].socket.on('close', () => {
        self._debug('the socket decided to leave');
      });

    }).listen(self.port);

    // Eventually add WS support

  }

  newConnectionRequests() {
    const self = this;
    // Determine how much room we have to add peers and connect.
    while ((self.peers.length || 0) < MAX_PEERS && (self.connectQueue.length)) {
      let peer = self.connectQueue.shift().split(':');
      self.createPeer(peer[1], peer[0]);
    }
  }

  createPeer(port, host) {
    const self = this;
    // Hopefully it works as is.
    let peer = self.peers[host] = {port, family: 'ipv4', hose: new Hose(self.infoHash, self.peerID), socket: null, bitfield: '00', position: 0, piece: 0 }; // [port, IPV-family, hose, socket, Bitfield]
    peer.socket = connect(port, host);

    peer.socket.once('connect', () => {
      peer['socket'].pipe(peer.hose).pipe(peer['socket']);
      peer.hose.sendHandshake();
    });

    peer['hose'].on('bitfield', (payload) => {
      // Add the bitfield to the host
      peer.bitfield = payload;
      // Fetch some data! :D
      self.fetchNewPiece(peer);
    });

    self.peers[host]['hose'].on('have', (payload) => {
      // UPDATE bitfield here
      self.peers[host].bitfield = self.bitfield.onHave(payload, self.peers[host].bitfield);
      // IF we are already sending a request and recieving a piece... hold your horses
      let busy = self.peers[host]['hose'].isBusy();
      if (!busy && !self.finished) {
        self.peers[host]['hose'].setBusy();
        self.fetchNewPiece(self.peers[host]);
      }
    });

    self.peers[host]['hose'].on('finished_piece', (index: number, begin: number, block: Buffer, hash: Hash) => {
      this._debug('finished piece');
      // Check the hash
      let blockHash = hash.digest('hex');
      let percent = 0;
      if (blockHash === self.pieces[index]) {
        // Place the buffer in its proper home
        self.tph.saveBlock(self.peers[host].position, block);
        // Check the percent of downloaded
        percent = self.bitfield.setDownloaded(self.peers[host].piece);
      }
      console.log('perect: ', percent);
      if (percent === 1) {
        self.finished = true;
        self.cleanupSeeders();
      } else {
        // Start a new request sequence
        process.nextTick(() => {
          self.fetchNewPiece(self.peers[host]);
        });
      }

    });
  }

  fetchNewPiece(peer) {
    const self = this;
    self.bitfield.findNewPieces(peer.bitfield, (result, downloading, which) => {
      if (which !== (-1)) {
        if (peer['hose'].isChoked)
          peer['hose'].sendInterested();
        // Set the peers piece number and index of piece
        peer.piece = which;
        peer.position = self.tph.pieceIndex(which);
        // Prepare a request for the pieces
        self.tph.prepareRequest(which, (buf, count) => {
          // Send to wire.
          this._debug('send piece request %n', count);
          peer['hose'].sendRequest(buf, count);
        });
      } else {
        // A have might be sent instead...
        peer['hose'].unsetBusy();
      }
    });
  }

  cleanupSeeders() {
    const self = this;
    for (let host in self.peers) {
      if ( self.bitfield.isSeeder(self.peers[host].bitfield) ) {
        self.peers[host].socket.destroy();
        self.peers[host].hose.close();
        delete self.peers[host];
      }
    }
  }

  cleanupAll() {
    const self = this;
    for (let host in self.peers) {
      self.peers[host].socket.close();
      self.peers[host].hose.close();
      delete self.peers[host];
    }
  }

  _debug = function (...args: any[]) {
    args = [].slice.call(arguments)
    args[0] = '[' + this._debugId + '] ' + args[0]
    debug.apply(null, args)
  }

}

export default torrentHandler;

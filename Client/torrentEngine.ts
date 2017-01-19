import { createServer, connect, Socket } from 'net';
import { EventEmitter }                  from 'events';
import * as inherits                     from 'inherits';
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
  _debugId:      number
  finished:      Boolean
  torrent:       Object
  infoHash:      string
  uploaded:      number
  downloaded:    number
  left:          number
  port:          number
  trackers:      Object
  trackerData:   Object
  connectQueue:  Array<string>
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

    self._debugId     = ~~((Math.random()*100000)+1);

    self.finished      = false;
    self.torrent       = torrent;
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
    self.bitfield      = new binaryBitfield(torrent.pieces.length, torrent.bitfieldDL);
    self.tph           = new TPH(torrent.files, torrent.length, torrent.pieceLength, torrent.pieces.length, torrent.lastPieceLength);

    // Trackers (WSS/UDP)
    self.torrent['announce'].forEach((tracker: string) => {
      let pt = parseTracker(tracker);

      if (pt.type === 'upd') {
        self.trackers[tracker] = new udpTracker(pt.host, pt.port, self.port, self.infoHash);
      } else {
        self.trackers[tracker] = new wssTracker();
      }

      self.trackers[tracker].on('announce', (interval, leechers, seeders, peers) => {
        let p = peers.split(',');
        self.connectQueue = self.connectQueue.concat(p);
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
          hose   = self.hoses[host] = new Hose(self.bitfield);

      self.peers[host] = {port, family, hose, socket, bitfield: '00', index: 0};
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
    while (self.peers.length < MAX_PEERS && (self.connectQueue.length)) {
      let peer = self.connectQueue.shift().split(':');
      self.createPeer(peer[1], peer[0]);
    }
  }

  createPeer(port, host) {
    const self = this;

    let peer = self.peers[host] = {port, family: 'ipv4', hose: null, socket: null, bitfield: '00', index: 0, piece: 0 }; // [port, IPV-family, hose, socket, Bitfield]
    peer.socket = connect(port, host);

    peer.socket.once('connect', () => {
      let hose = self.peers[host].hose = new Hose();
      peer['socket'].pipe(hose).pipe(peer['socket']);
    });

    peer['hose'].on('bitfield', (payload) => {
      // Find which pieces the user has that we do not:
      peer.bitfield = payload;
      self.bitfield.findNewPieces(payload, (result, downloading, which) => {
        if (which !== (-1)) {
          // Set the peers piece number and index of piece
          peer.piece = which;
          peer.index = self.tph.pieceIndex(which);
          // Prepare a request for the pieces
          self.tph.prepareRequest(which, (buf, count) => {
            // Send to wire.
            this._debug('send piece request %n', count);
            peer['hose'].sendRequest(buf, count);
          });
        } else {
          peer['hose'].sendNotInterested();
          // TODO: Close the connection.
        }
      });
    });

    peer['hose'].on('finished_piece', (block: Buffer, hash: string) => {
      this._debug('finished piece');
      // TODO: Check the hash
      // Place the buffer in its proper home
      self.tph.saveBlock(peer.index, block);

      let finished = self.bitfield.setDownloaded(peer.piece);

      if (finished === 1) {
        self.finished = true;
        self.cleanupSeeders();
      } else {
        // Start a new request sequence
        process.nextTick(() => {
          self.bitfield.findNewPieces(peer.bitfield, (result: string, downloading: string, which: number) => {
            if (which !== (-1)) {
              // Set the peers piece number and index of piece
              peer.piece = which;
              peer.index = self.tph.pieceIndex(which);
              // Prepare a request for the pieces
              self.tph.prepareRequest(which, (buf: Buffer, count: number) => {
                // Send to wire.
                this._debug('send piece request %n', count);
                peer['hose'].sendRequest(buf, count);
              });
            } else {
              // TODO: Send a 00 00 00 00 to keep peer active.
            }
          });
        });
      }

    });
  }

  cleanupSeeders() {
    const self = this;
    for (let host in self.peers) {
      if ( self.bitfield.isSeeder(self.peers[host].bitfield) ) {
        self.peers[host].socket.close();
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

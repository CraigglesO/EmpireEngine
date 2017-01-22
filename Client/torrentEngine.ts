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
import * as extend                       from 'extend';
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

interface Torrent {
  info: {
    name:           string
    'piece length': number
    pieces:         Array<string>
  },
  name:            string
  created:         string
  createdBy:       string
  urlList:         Array<string>
  files:           Array<File>
  length:          number
  pieceLength:     number
  lastPieceLength: number
  pieces:          Array<string>
  uploaded:        number
  downloaded:      number
  bitfieldDL:      string
  left:            number
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
  torrent:       Torrent
  pieces:        Array<string>
  infoHash:      string
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
    self.peerID        = '-EM0012-ABCDEFGHIJKL';

    self.finished      = false;
    self.torrent       = torrent;
    self.pieces        = torrent.pieces;
    self.infoHash      = torrent.infoHash;
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

    // Health Insurrance:
    process.on('uncaughtException', function (err) {
      console.log(err);
    });

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
        self.connectQueue = _.uniq(self.connectQueue);
        //TODO: Create a queue action and emit an update above
        self.newConnectionRequests();
      });

      self.trackers[tracker].on('error', () => {
        self.trackerData[tracker+':failure'] = true;
      });

      self.trackers[tracker].on('scrape', (seeders, completed, leechers, timeTillNextScrape) => {
        self.trackerData[tracker+':seeders']   = seeders;
        self.trackerData[tracker+':completed'] = completed;
        self.trackerData[tracker+':leechers']  = leechers;
        self.trackerData[tracker+':nextReq']   = timeTillNextScrape;
      });

    });

    // P2P relations (TCP)
    self.incomingPeers = createServer((socket) => {
      self._debug('new connection');
      let host   = socket.remoteAddress,
          port   = socket.remotePort,
          family = socket.remoteFamily,
          hose   = self.hoses[host] = new Hose(self.infoHash, self.peerID);
      // Create the peer (MODES: 0 - handshake; 1 - downloading; 2 - uploading; 3 - metadata)
      self.peers[host+port] = { port, family, hose, socket, bitfield: '00', position: 0, piece: 0, mode: 0 };
      socket.pipe(hose).pipe(socket);

      self.peers[host].socket.on('close', () => {
        self._debug('the socket decided to leave');
        // Destroy the hose and delete the Object
        self.peers[host] = null;
        delete self.peers[host];
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
    console.log('create host: ', host, port);
    // Create the peer (MODES: 0 - handshake; 1 - downloading; 2 - uploading; 3 - metadata)
    self.peers[host+port] = { port, family: 'ipv4', hose: new Hose(self.infoHash, self.peerID), socket: null, bitfield: '00', position: 0, piece: 0, mode: 0 }; // [port, IPV-family, hose, socket, Bitfield]
    self.peers[host+port].socket = connect(port, host);
    self.peers[host+port].socket.once('connect', () => {
      self.peers[host+port]['socket'].pipe(self.peers[host+port].hose).pipe(self.peers[host+port]['socket']);
      self.peers[host+port].hose.sendHandshake();
    });

    self.peers[host+port].socket.on('error', (err) => {
      // Destroy the hose and delete the Object
      self.peers[host+port].hose.close();
      self.peers[host+port].socket.destroy();
      self.peers[host+port] = null;
      delete self.peers[host+port];
    });

    self.peers[host+port].socket.on('close', () => {
      // Destroy the hose and delete the Object
      self.peers[host+port] = null;
      delete self.peers[host+port];
    })

    self.peers[host+port]['hose'].on('metadata', (torrent) => {
      // Add the data to our torrent
      extend(self.torrent, torrent);
      // Kill the metadata instance
      self.peers[host+port]['hose'].removeMeta();
      // Convert all peers who are currently in meta_data mode to download mode
      self.convertPeer(1); // (from, to)
    });

    self.peers[host+port]['hose'].on('bitfield', (payload) => {
      // Add the bitfield to the host+port
      self.peers[host+port].bitfield = payload;
      // Check that we have a connection:
      if (self.peers[host+port]['hose'].isChoked)
        self.peers[host+port]['hose'].sendInterested();
      // Get metadata and/or pex data
      self.peers[host+port]['hose'].pexRequest();
      // Fetch some data if torrent. Otherwise ut_metadata (magnet)
      if (self.pieces.length) {
        self.peers[host+port].mode = 1;
        self.fetchNewPiece(self.peers[host+port]); // Get some blocks!
      } else {
        self.peers[host+port].mode = 3;
        self.peers[host+port]['hose'].metaDataRequest(); // Get metadata and/or pex data
      }
    });

    self.peers[host+port]['hose'].on('have', (payload) => {
      // UPDATE bitfield here
      self.peers[host+port].bitfield = self.bitfield.onHave(payload, self.peers[host+port].bitfield);
      // IF we are already sending a request and recieving a piece... hold your horses
      let busy = self.peers[host+port]['hose'].isBusy();
      if (!busy && !self.finished && self.pieces.length) {
        self.peers[host+port]['hose'].setBusy();
        self.fetchNewPiece(self.peers[host+port]);
      }
    });

    self.peers[host+port]['hose'].on('finished_piece', (index: number, begin: number, block: Buffer, hash: Hash) => {
      self._debug('finished piece');
      // Check the hash
      let blockHash = hash.digest('hex');
      let percent = 0;
      if (blockHash === self.pieces[index]) {
        // Update downloaded:
        self.torrent.downloaded += block.length;
        self.torrent.left       -= block.length;
        // Place the buffer in its proper home
        self.tph.saveBlock(self.peers[host+port].position, block);
        // Check the percent of downloaded
        percent = self.bitfield.setDownloaded(self.peers[host+port].piece);
      }
      console.log('index downloaded: ', index);
      console.log('percent:          ', percent);
      if (percent === 1) {
        self.finished = true;
        self.finish();
        self.cleanupSeeders();
      } else {
        // Start a new request sequence
        process.nextTick(() => {
          self.fetchNewPiece(self.peers[host+port]);
        });
      }
    });

  }

  fetchNewPiece(peer) {
    const self = this;
    self.bitfield.findNewPieces(peer.bitfield, (result, downloading, which) => {
      if (which !== (-1)) {
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
  // MODES: 0 - handshake; 1 - downloading; 2 - uploading; 3 - metadata
  convertPeer (newPhase: number) {
    const self = this;
    for (let host in self.peers) {
      // Convert metadata peers to downloaders:
      switch (self.peers[host].mode) {
        case 0:
          break;
        case 1:
          break;
        case 2:
          break;
        case 3:
          // TODO: Kill all outgoing metadata requests... (perhaps through ignoring new metadata incoming and killing the metadata instance)
          break;
        default:
          self._debug('not the proper current phase code');
      }
      self.peers[host].mode = newPhase;
      switch (newPhase) {
        case 1:
          self.fetchNewPiece(self.peers[host]);
          break;
        case 2:
          break;
        case 3:
          break;
        default:
          self._debug('not the proper new phase code');
      }
    }
  }

  finish() {
    const self = this;
    console.log('DONE!');
    for (let tracker in self.trackers) {
      if (!self.trackers[tracker+':failure'])
        self.trackers[tracker].completed(self.torrent.left, self.torrent.uploaded, self.torrent.downloaded);
    }
  }

  cleanupSeeders() {
    const self = this;
    for (let host in self.peers) {
      if ( self.bitfield.isSeeder(self.peers[host].bitfield) ) {
        self.peers[host].hose.close();
        self.peers[host].socket.destroy();
        delete self.peers[host];
      }
    }
  }

  cleanupAll() {
    const self = this;
    for (let host in self.peers) {
      self.peers[host].socket.destroy();
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

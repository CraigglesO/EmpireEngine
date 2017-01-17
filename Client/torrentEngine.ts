import { createServer, connect, Socket } from 'net';
import { EventEmitter } from 'events';
import * as inherits from 'inherits';
import { udpTracker, wssTracker } from './trackerClient';
import Hose from './Hose';
import parseTracker from '../modules/parse-p2p-tracker';
import * as _ from 'lodash';
import * as debug from 'debug';
debug('torrentEngine');

const Bitfield = require("bitfield");

class torrentHandler extends EventEmitter {
  _debugId:       number
  torrent:       Object
  infoHash:      string
  uploaded:      number
  downloaded:    number
  left:          number
  port:          number
  trackers:      Object
  trackerData:   Object
  connectQueue:  Array<string>
  bitfield:      Object | void
  peers:         any
  hoses:         any
  incomingPeers: any
  constructor(torrent: any) {
    super();
    if (!(this instanceof torrentHandler))
      return new torrentHandler(torrent);
    const self = this;

    self._debugId     = ~~((Math.random()*100000)+1);

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
    self.bitfield      = this.setBitField(torrent.pieces.length);

    // Trackers (WSS/UDP)
    self.torrent['announce'].forEach((tracker: string) => {
      let pt = parseTracker(tracker);

      if (pt.type === 'upd') {
        self.trackers[tracker] = new udpTracker(pt.host, pt.port, self.port, self.infoHash);
      } else {
        self.trackers[tracker] = new wssTracker();
      }

      self.trackers[tracker].on('peers', (interval, leechers, seeders, peers) => {
        let p = peers.split(',');
        self.connectQueue = self.connectQueue.concat(p);
        self.connectQueue = _.uniq(self.connectQueue);
        //TODO: Create a queue action and emit an update above
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

      self.peers[host] = [port, family, hose, socket];
      socket.pipe(hose).pipe(socket);

      self.peers[host].socket.on('close', () => {
        self._debug('the socket decided to leave');
      });

    }).listen(self.port);

    // Eventually add WS support

  }

  setBitField(pLength?: number) {
    if (pLength)
      new Bitfield(pLength);
    else
      new Bitfield(0, );
  }

  peerReview() {

  }

  createPeer(port, host) {
    const self = this;
    // Needed to create peer:
    // 1)
    let peer = self.peers[host] = [port, 'ipv4', null, null];
    peer[3] = connect(port, host);

    peer[3].once('connect', () => {
      let hose = self.peers[host][2] = new Hose();
      peer[3].pipe(hose).pipe(peer[3]);
    });
  }

  _debug = function (...args: any[]) {
    args = [].slice.call(arguments)
    args[0] = '[' + this._debugId + '] ' + args[0]
    debug.apply(null, args)
  }

}

export default torrentHandler;

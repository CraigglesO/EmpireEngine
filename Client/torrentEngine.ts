import { createServer, connect, Socket } from 'net';
import { EventEmitter } from 'events';
import * as inherits from 'inherits';
import { udpTracker, wssTracker } from './trackerClient';
import Hose from './Hose';
import parseTracker from '../modules/parse-p2p-tracker';
import * as _ from 'lodash';

const debug = require('debug')('torrentEngine');

class torrentHandler extends EventEmitter {
  torrent:       Object
  infoHash:      string
  port:          number
  hash:          string
  connectQueue:  Array<string>
  incomingPeers: any
  trackers:      Object
  trackerData:   Object
  constructor(torrent: any) {
    super();
    const self = this;

    self.torrent      = torrent;
    self.infoHash     = torrent.infoHash;
    self.port         = ~~( ( Math.random() * (65535-1) ) + 1); // Random port for speeeed.
    self.trackers     = {};
    self.trackerData  = {};
    self.connectQueue = [];

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
      const hose = new Hose();
      console.log('new connection');
      socket.pipe(hose).pipe(socket);

      socket.on('close', () => {
        console.log('the socket decided to leave');
      });

    }).listen(self.port || 1337);

    // Eventually add WS support

  }

}

export default torrentHandler;

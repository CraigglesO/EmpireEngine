import { createServer, connect, Socket } from 'net';
import { EventEmitter } from 'events';
import * as inherits from 'inherits';
import { udpTracker, wssTracker } from './trackerClient';
import Hose from './Hose';
import parseTracker from '../modules/parse-p2p-tracker';

class torrentHandler extends EventEmitter {
  torrent:       Object;
  port:          number;
  connectQueue:  Array<string>;
  incomingPeers: any;
  trackers:      Object;
  constructor(torrent: Object) {
    super();
    const self = this;

    self.torrent = torrent;
    self.port = ~~( ( Math.random() * (65535-1) ) + 1); // Random port for speeeed.
    self.trackers = {};
    self.connectQueue = [];

    // Trackers (WSS/UDP)
    self.torrent['announce'].forEach((tracker) => {
      let pt = parseTracker(tracker);

      if (pt.type === 'upd') {
        self.trackers[tracker] = new udpTracker();
      } else {
        self.trackers[tracker] = new wssTracker();
      }

      self.trackers[tracker].on('peers', (peers) => {
        let p = peers.split(',');
        self.connectQueue = self.connectQueue.concat(p);
        //TODO: Create a queue action
      });

      self.trackers[tracker].on('killSwitch', () => {
        self.trackers[tracker].kill;
      });

      self.trackers[tracker].on('scrape', (seeders, completed, leechers) => {
        self.trackers[tracker+':seeders'] = seeders;
        self.trackers[tracker+':completed'] = completed;
        self.trackers[tracker+':leechers'] = leechers;
      });

    });

    // P2P relations (TCP)
    self.incomingPeers = createServer((socket) => {
      const hose = new Hose();
      console.log('new connection');
      socket.pipe(hose).pipe(socket);

      socket.on('close', () => {
        console.log('the socket decided to leave');
      })

    }).listen(self.port || 1337);

    // Eventually add PEX support nad DHT support

  }

}

export default torrentHandler;

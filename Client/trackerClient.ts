'use strict';

import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import * as debug from 'debug';
debug('trackerClient');


const writeUInt64BE    = require('writeUInt64BE'),
      ACTION_CONNECT   = 0,
      ACTION_ANNOUNCE  = 1,
      ACTION_SCRAPE    = 2,
      ACTION_ERROR     = 3,
      connectionIdHigh = 0x417,
      connectionIdLow  = 0x27101980;

class udpTracker extends EventEmitter {
  HOST:           string
  HASH:           string
  PORT:           number
  MY_PORT:        number
  TRANSACTION_ID: number
  EVENT:          number
  SCRAPE:         Boolean
  DOWNLOADED:     number
  LEFT:           number
  UPLOADED:       number
  KEY:            number
  IP_ADDRESS:     number
  TIMEOUTS:       Array<any>
  TIMEOUTS_DATE:  number
  TIMEOUT_N:      number
  server:         any
  constructor(trackerHost: string, port: number, myPort: number, infoHash: string) {
    super();
    if (!(this instanceof udpTracker))
      return new udpTracker(trackerHost, port, myPort, infoHash);
    const self = this;

    self.HOST = trackerHost;
    self.HASH = infoHash;
    self.PORT = port;
    self.MY_PORT = myPort;
    self.TRANSACTION_ID = null; // This will be our method of keeping track of new connections...
    self.EVENT = 0;

    console.log('Host: ', self.HOST);
    console.log('self.HASH: ', self.HASH);
    console.log('self.MY_PORT: ', self.MY_PORT);
    console.log('self.EVENT: ', self.EVENT);

    //avoid scraping unless it's a timed update
    self.SCRAPE = true;

    self.DOWNLOADED = 0;
    self.LEFT = 1;
    self.UPLOADED = 0;
    self.KEY = 0;
    self.IP_ADDRESS = 0; // default unless behind a proxy

    //timeSystem
    self.TIMEOUTS = [];
    self.TIMEOUTS_DATE = 0;
    self.TIMEOUT_N = 1;

    //setup server
    self.server = dgram.createSocket('udp4');
    self.server.on('listening', function () {
      self.scrape();
    });
    self.server.on('message', function (msg, rinfo) { self.message(msg, rinfo) });
    self.server.bind(self.MY_PORT);
  }

  sendPacket(buf: Buffer) {
    const self = this;
    self.server.send(buf, 0, buf.length, self.PORT, self.HOST, (err) => {
        if (err) { self.emit('error', err); }
    });
  }

  startConnection() {
    const self = this;

    //Prepare for the next connection:
    self.TRANSACTION_ID = ~~((Math.random()*100000)+1);

    self.TIMEOUTS.push( setTimeout(() => {
        self.TRANSACTION_ID = null;
        self.SCRAPE = true;
        self.scrape();
      }, self.updateTimer() * 60 * 1000) );
    self.TIMEOUTS_DATE = Date.now();

    //Prep a packet for delivery:
    let buf = new Buffer(16);
    buf.fill(0);

    buf.writeUInt32BE(connectionIdHigh, 0);      // 0    64-bit integer  connection_id   0x41727101980
    buf.writeUInt32BE(connectionIdLow, 4);       // 0    64-bit integer  connection_id   0x41727101980
    buf.writeUInt32BE(ACTION_CONNECT, 8);        // 8    32-bit integer  action          0 // connect
    buf.writeUInt32BE(self.TRANSACTION_ID, 12);  // 12   32-bit integer  transaction_id

    //Send packet
    self.sendPacket(buf);
  }

  scrape() {
    const self = this;

    if (!self.TRANSACTION_ID) {
        self.startConnection();
    } else {

      let buf = new Buffer(36);
      buf.fill(0);

      buf.writeUInt32BE(connectionIdHigh, 0);      // 0             64-bit integer  connection_id   0x41727101980
      buf.writeUInt32BE(connectionIdLow, 4);       // 0             64-bit integer  connection_id   0x41727101980
      buf.writeUInt32BE(ACTION_SCRAPE, 8);         // 8             32-bit integer  action          2 // scrape
      buf.writeUInt32BE(self.TRANSACTION_ID, 12);  // 12            32-bit integer  transaction_id
      buf.write(self.HASH, 16, 20, 'hex');         // 16 + 20 * n   20-byte string  info_hash

      //Send Packet
      self.sendPacket(buf);
    }

  }

  announce() {
    // EVENT: 0: none; 1: completed; 2: started; 3: stopped
    const self = this;

    if (!self.TRANSACTION_ID) {
        self.startConnection();
    } else {
      //Prepare announce packet for delivery
      let buf = new Buffer(98);
      buf.fill(0);

      buf.writeUInt32BE(connectionIdHigh, 0);     //   0    64-bit integer  connection_id
      buf.writeUInt32BE(connectionIdLow, 4);      //   0    64-bit integer  connection_id
      buf.writeUInt32BE(ACTION_ANNOUNCE, 8);      //   8    32-bit integer  action          1 // announce
      buf.writeUInt32BE(self.TRANSACTION_ID, 12); //   12   32-bit integer  transaction_id
      buf.write(self.HASH, 16, 20, 'hex');        //   16   20-byte string  info_hash
      buf.write('-EM0012-ABCDEFGHIJKL', 36, 20);  //   36   20-byte string  peer_id
      writeUInt64BE(buf, self.DOWNLOADED, 56);    //   56   64-bit integer  downloaded
      writeUInt64BE(buf, self.LEFT, 64);          //   64   64-bit integer  left
      writeUInt64BE(buf, self.UPLOADED, 72);      //   72   64-bit integer  uploaded
      buf.writeUInt32BE(self.EVENT, 80);          //   80   32-bit integer  event           0 // 0: none; 1: completed; 2: started; 3: stopped
      buf.writeUInt32BE(self.IP_ADDRESS, 84);     //   84   32-bit integer  IP address      0 // default
      buf.writeUInt32BE(self.KEY, 88);            //   88   32-bit integer  key
      buf.writeInt32BE((-1), 92);                 //   92   32-bit integer  num_want        -1 // default
      buf.writeUInt16BE(self.MY_PORT, 96);        //   96   16-bit integer  port

      // Send Packet
      self.sendPacket(buf);

      self.TRANSACTION_ID = null;
    }
  }

  message(msg: string, rinfo: Object) {
    const self = this;
    let buf = new Buffer(msg);

    let action = buf.readUInt32BE(0);            // 0   32-bit integer  action   0 // connect 1 // announce 2 // scrape 3 // error
    self.TRANSACTION_ID = buf.readUInt32BE(4);   // 4   32-bit integer  transaction_id
    if (action === ACTION_CONNECT) {

      // Server will establish a new connection_id to talk on.
      // This connection_id dies after 5-10 seconds.
      let connectionIdHigh = buf.readUInt32BE(8),     // 0   64-bit integer  connection_id
          connectionIdLow  = buf.readUInt32BE(12);    // 0   64-bit integer  connection_id

      // avoid scraping unless it's a timed checkup
      if (self.SCRAPE) {
        self.SCRAPE = false;
        self.scrape();
      } else {
        self.announce();
      }

    } else if (action === ACTION_SCRAPE) {

      let seeders   = buf.readUInt32BE(8),   //  8    32-bit integer  interval
          completed = buf.readUInt32BE(12),  //  12   32-bit integer  completed
          leechers  = buf.readUInt32BE(16);  //  16   32-bit integer  leechers
      self.emit('scrape', seeders, completed, leechers, self.timeTillNextScrape());
      self.announce();

    } else if (action === ACTION_ANNOUNCE) {

      let interval  = buf.readUInt32BE(8),   //  8           32-bit integer  interval
          leechers  = buf.readUInt32BE(12),  //  12          32-bit integer  leechers
          seeders   = buf.readUInt32BE(16),  //  16          32-bit integer  seeders
          bufLength = buf.length,            //  20 + 6 * n  32-bit integer  IP address
          addresses = [];                    //  24 + 6 * n  16-bit integer  TCP port

      for (let i = 20; i < bufLength; i += 6) {
        let address = `${buf.readUInt8(i)}.${buf.readUInt8(i+1)}.${buf.readUInt8(i+2)}.${buf.readUInt8(i+3)}:${buf.readUInt16BE(i+4)}`;
        addresses.push(address);
      }

      self.emit('announce', interval, leechers, seeders, addresses);
      // Reset for default timed updates
      self.EVENT = 0;

    } else if (action === ACTION_ERROR) {
      let errorResponce = buf.slice(8).toString();
      self.emit('error', errorResponce);
    }
  }

  update(left: number, uploaded: number, downloaded: number, port?: number) {
    this.LEFT       = left;
    this.UPLOADED   = uploaded;
    this.DOWNLOADED = downloaded;
    if (port)
      this.PORT     = port;
    this.EVENT      = 0;
    this.announce();
  }

  completed(left: number, uploaded: number, downloaded: number, port?: number) {
    this.LEFT       = left;
    this.UPLOADED   = uploaded;
    this.DOWNLOADED = downloaded;
    if (port)
      this.PORT     = port;
    this.EVENT      = 1;
    this.announce();
  }

  start(left: number, uploaded: number, downloaded: number, port?: number) {
    this.LEFT       = left;
    this.UPLOADED   = uploaded;
    this.DOWNLOADED = downloaded;
    if (port)
      this.PORT     = port;
    this.EVENT      = 2;
    console.log('start (tracker)')
    this.announce();
  }

  stop(left: number, uploaded: number, downloaded: number, port?: number) {
    this.LEFT       = left;
    this.UPLOADED   = uploaded;
    this.DOWNLOADED = downloaded;
    if (port)
      this.PORT     = port;
    this.EVENT      = 3;
    this.announce();
  }

  timeTillNextScrape() {
    const self = this;
    return Math.ceil((self.TIMEOUTS_DATE + self.TIMEOUTS[0]._idleTimeout - Date.now()) / 1000);
  }

  updateTimer() {
    const self = this;
    //First delete all old timers:
    for (let i = 0; i < self.TIMEOUTS.length; i++) {
        clearTimeout(self.TIMEOUTS[i]);
    }
    self.TIMEOUTS.shift();
    //Prep a new timer:
    if (self.TIMEOUT_N === 1) {
      self.TIMEOUT_N = 5;
      return 5;
    } else if (self.TIMEOUT_N <= 5) {
      self.TIMEOUT_N = 10;
      return 10;
    } else if (self.TIMEOUT_N <= 15) {
      self.TIMEOUT_N = 20;
      return 20;
    } else {
      self.TIMEOUT_N = 30;
      return 30;
    }
  }
}

class wssTracker extends EventEmitter {
  constructor() {
    super();
    if (!(this instanceof wssTracker))
      return new wssTracker();
    const self = this;
  }
}

export { udpTracker, wssTracker };

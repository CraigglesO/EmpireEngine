import { createServer, connect, Socket } from "net";
import { wrtcCreateServer, wrtcConnect } from "webrtc-socket";
import { EventEmitter }                  from "events";
import * as inherits                     from "inherits";
import { Hash }                          from "crypto";
import { parse }                         from "url";
import * as fs                           from "fs";
import { Client }                        from "peer-tracker";
import binaryBitfield                    from "../modules/binary-bitfield";
import * as _                            from "lodash";
import * as extend                       from "extend";

const debug  = require("debug")("torrent-engine"),
      mkdirp = require("mkdirp"),
      TPH    = require("torrent-piece-handler").default,
      Wire   = require("bittorrent-wire").default;


interface PeerData {
  bitfield:  string;    // Pieces this peer has
  index:     number;    // Index of current piece project
  piece:     number;
}

interface File {
  path:   string;
  name:   string;
  length: number;
  offset: number;
}

interface Torrent {
  info: {
    name:           string
    "piece length": number
    pieces:         Array<string>
  };
  name:            string;
  infoHash:        string;
  created:         string;
  createdBy:       string;
  urlList:         Array<string>;
  files:           Array<File>;
  length:          number;
  pieceLength:     number;
  lastPieceLength: number;
  pieces:          Array<string>;
  uploaded:        number;
  downloaded:      number;
  bitfieldDL:      string;
  finished:        Boolean;
  left:            number;
}

interface Request {
  index:  number;
  begin:  number;
  length: number;
}

const PeerData = {
  bitfield: "00",
  index:    0,
  piece:    0
};

const MAX_PEERS = 55;

class TorrentHandler extends EventEmitter {
  peerID:            string;
  _debugId:          number;
  finished:          Boolean;
  torrent:           Torrent;
  pieces:            Array<string>;
  port:              number;
  trackers:          Object;
  trackerData:       Object;
  connectQueue:      Array<string>;
  haveStack:         Array<number>;
  bitfieldDL:        string;
  bitfield:          binaryBitfield;
  tph:               any;
  peers:             any;
  peerCount:         number;
  wires:             any;
  incomingPeers:     any;
  incomingWrtcPeers: any;
  inRequests:        Array<Request>;

  constructor(torrent: any) {
    super();
    if (!(this instanceof TorrentHandler))
      return new TorrentHandler(torrent);
    const self = this;

    self._debugId      = ~~((Math.random() * 100000) + 1);
    self.peerID        = "-EM0012-ABCDEFGHIJKL";

    self.finished      = torrent.finished;
    self.torrent       = torrent;
    self.port          = null;
    // self.port          = ~~( ( Math.random() * (65535-1000) ) + 1000 ); // Random port for speeeed.
    self.trackers      = {};
    self.trackerData   = {};
    self.peers         = {};
    self.peerCount     = 0;
    self.wires         = {};
    self.connectQueue  = [];
    self.haveStack     = [];
    self.bitfieldDL    = torrent.bitfieldDL || "00";
    self.bitfield      = (!torrent.pieces) ? null : new binaryBitfield(torrent.pieces.length, torrent.bitfieldDL);
    self.tph           = (!torrent.pieces) ? null : new TPH(torrent.files, torrent.length, torrent.pieceLength, torrent.pieces.length, torrent.lastPieceLength);

    // Health Insurrance:
    process.on("uncaughtException", function (err) {
      self._debug(err);
    });

    // Incoming (TCP)
    self.incomingPeers = createServer((socket) => {
      self.createIncomingPeer(socket);
    }).listen(0, () => {
      self.port = self.incomingPeers.address().port;
      self._debug("Listening on port:", self.port);
    });

    // Eventually add WS support
    self.incomingWrtcPeers = wrtcCreateServer((socket) => {
      self.createIncomingPeer(socket);
    });
    self.incomingWrtcPeers.listen(9001);

    // Trackers (WSS/UDP)
    self.torrent["announce"].forEach((tracker: string) => {
      let pt = parse(tracker);
      if (pt.protocol === "udp:") {
        self.trackers[tracker] = Client.udp("scrape", pt.hostname, pt.port, self.port, self.torrent.infoHash, self.torrent.left, self.torrent.uploaded, self.torrent.downloaded);
      } else if (pt.protocol === "wss:") {
        self.trackers[tracker] = Client.ws("scrape", pt.hostname, 443, self.port, self.torrent.infoHash, self.torrent.left, self.torrent.uploaded, self.torrent.downloaded);
      } else if (pt.protocol === "ws:") {
        self.trackers[tracker] = Client.ws("scrape", pt.hostname, 80, self.port, self.torrent.infoHash, self.torrent.left, self.torrent.uploaded, self.torrent.downloaded);
      }

      self.trackers[tracker].on("announce", (interval, leechers, seeders, peers) => {
        peers = peers.map((peer) => { return peer + ":" + ( (self.trackers[tracker].TYPE === "udp") ? "tcp" : "ws" ); });
        self.connectQueue = self.connectQueue.concat(peers);
        self.connectQueue = _.uniq(self.connectQueue);
        if (!self.finished)
          self.newConnectionRequests();
      });

      self.trackers[tracker].on("error", () => {
        self.trackerData[tracker + ":failure"] = true;
      });

      self.trackers[tracker].on("scrape", (seeders, completed, leechers, timeTillNextScrape) => {
        self.trackerData[tracker + ":seeders"]   = seeders;
        self.trackerData[tracker + ":completed"] = completed;
        self.trackerData[tracker + ":leechers"]  = leechers;
        self.trackerData[tracker + ":nextReq"]   = timeTillNextScrape;
      });

    });

  }

  newConnectionRequests() {
    const self = this;
    // Determine how much room we have to add peers and connect.
    while (self.peerCount < MAX_PEERS && (self.connectQueue.length)) {
      let peer = self.connectQueue.shift().split(":");
      self.createPeer(Number(peer[1]), peer[0], peer[2]);
    }
  }

  createIncomingPeer(socket) {
    const self = this;
    let host   = (socket.remoteAddress) ? socket.remoteAddress : socket.host,
        port   = (socket.remotePort)    ? socket.remotePort    : socket.port,
        family = (socket.remoteFamily)  ? socket.remoteFamily  : socket.family,
        wire   = self.wires[host] = new Wire(self.torrent.infoHash, self.peerID);
    // Create the peer (MODES: 0 - handshake; 1 - downloading; 2 - uploading; 3 - metadata)
    self.peers[host + port] = { port, family, wire, socket, bitfield: "00", position: 0, piece: (-1), mode: 2, activeCount: 0 };
    socket.pipe(wire).pipe(socket);
    // TODO: SET BITFIELDDL DURING DOWNLOAD
    wire.on("handshake", (infoHash: Buffer, peerID: string) => {
      if (self.torrent.infoHash !== infoHash.toString("hex"))
        return;
      // Send handshake, metadata handshake, and bitfield.
      wire.sendHandshake();
      wire.sendBitfield(self.bitfieldDL);
    });

    wire.on("request", () => {
      if (!wire.reqBusy) {
        wire.reqBusy = true;

        // Iterate through requests...
        while (wire.inRequests.length) {
          let request = wire.inRequests.shift();
          self.tph.prepareUpload(request.index, request.begin, request.length, (piece: Buffer) => {
            process.nextTick(() => {
              wire.sendPiece(piece);
            });
          });
        }
        wire.reqBusy = false;
      }
    });

    wire.on("have", (pieceIndex: number) => {
      // TODO: If new piece and not a seeder, switch to download phase and grab

    });

    self.peers[host + port].socket.on("close", () => {
      self._debug("the socket decided to leave");
      // Destroy the wire and delete the Object
      self.peers[host + port] = null;
      delete self.peers[host + port];
    });
  }

  createPeer(port: number, host: string, type: string) {
    const self = this;
    self._debug("Create new peer");
    self.peerCount++;
    // Create the peer (MODES: 0 - handshake; 1 - downloading; 2 - uploading; 3 - metadata)
    self.peers[host + port] = { port, family: "ipv4", wire: new Wire(self.torrent.infoHash, self.peerID), socket: null, bitfield: "00", position: 0, piece: (-1), mode: 0, activeCount: 0 };
    if (type === "tcp")
      self.peers[host + port].socket = connect(port, host);
    else if (type === "ws")
      self.peers[host + port].socket = wrtcConnect(port, host);
    self.peers[host + port].socket.once("connect", () => {
      self.peers[host + port]["socket"].pipe(self.peers[host + port].wire).pipe(self.peers[host + port]["socket"]);
      self.peers[host + port].wire.sendHandshake();
    });

    self.peers[host + port].socket.on("error", (err) => {
      // TODO: if the peer was uploading but didn't finish, let's unset that bit
      // Destroy the wire and delete the Object
      self.peers[host + port].wire.closeConnection();
      self.peers[host + port].socket.destroy();
      delete self.peers[host + port];
      self.newConnectionRequests();
    });

    self.peers[host + port].socket.on("close", () => {
      // TODO: if the peer was uploading but didn't finish, let's unset that bit
      // Destroy the wire and delete the Object
      if (self.peers[host + port].socket)
        self.peers[host + port].socket.destroy();
      delete self.peers[host + port];
      self.peerCount--;
      self.newConnectionRequests();
    });

    self.peers[host + port]["wire"].on("metadata", (torrent) => {
      self._debug("Incoming metadata");
      // Add the data to our torrent
      extend(self.torrent, torrent);
      // Prepare bitfield, files, and block handler
      self.bitfield = new binaryBitfield(self.torrent.pieces.length, self.torrent.bitfieldDL);
      self.manageFiles();
      self.tph      = new TPH(self.torrent.files, self.torrent.length, self.torrent.pieceLength, self.torrent.pieces.length, self.torrent.lastPieceLength);
      // Convert all peers who are currently in meta_data mode to download mode
      self._debug("Download phase");
      self.downloadPhase(); // (from mode: 3, to: 1)
    });

    self.peers[host + port]["wire"].on("pex_added", (peers) => {
      self.connectQueue = self.connectQueue.concat(peers);
      self.connectQueue = _.uniq(self.connectQueue);
      if (!self.finished)
        self.newConnectionRequests();
    });

    self.peers[host + port]["wire"].on("bitfield", (payload) => {
      self._debug("peer's bitfield");
      // Add the bitfield to the host+port
      self.peers[host + port].bitfield = payload;
      // Check that we have a connection:
      if (self.peers[host + port]["wire"].isChoked)
        self.peers[host + port]["wire"].sendInterested();
      // Fetch some data if torrent. Otherwise ut_metadata (magnet)
      if (self.torrent.pieces) {
        self.peers[host + port].mode = 1;
        self.fetchNewPiece(self.peers[host + port]); // Get some blocks!
      } else {
        self.peers[host + port].mode = 3;
        self.peers[host + port]["wire"].metaDataRequest(); // Get metadata
      }
    });

    self.peers[host + port]["wire"].on("have", (payload) => {
      if (!self.bitfield)
        return;
      // UPDATE bitfield here
      self.peers[host + port].bitfield = self.bitfield.onHave(payload, self.peers[host + port].bitfield);
      // IF we are already sending a request and recieving a piece... hold your horses
      let busy = self.peers[host + port]["wire"].isBusy();
      // Additionally, if we don't get have torrent data or we have already finished the projet, ignore.
      if (!busy && !self.finished && self.torrent.pieces.length) {
        self.peers[host + port]["wire"].setBusy();
        self.fetchNewPiece(self.peers[host + port]);
      }
    });

    self.peers[host + port]["wire"].on("finished_piece", (index: number, block: Buffer, hash: Hash) => {
      self._debug("finished piece");
      self._debug("peerCount: ", self.peerCount);
      let speed = 0;
      for (let p in self.peers) {
        speed += self.peers[p]["wire"].downloadSpeed();
      }
      // Check the hash
      let blockHash = hash.digest("hex");
      let percent = 0;
      if (blockHash === self.torrent.pieces[index]) {
        // Update downloaded:
        self.torrent.downloaded += block.length;
        self.torrent.left       -= block.length;
        // Place the buffer in its proper home
        self.tph.saveBlock(self.peers[host + port].position, block);
        // Check the percent of downloaded
        percent = self.bitfield.setDownloaded(self.peers[host + port].piece);
        // Emit up.
        // self.emit('finished_piece', percent, );
      } else {
        self._debug("failed hash");
        // Remove piece and try again
        self.bitfield.set(self.peers[host + port].piece, false);
      }
      self._debug("index downloaded: ", index);
      self._debug("percent:          ", percent);
      if (percent === 1) {
        self.finished = true;
        self.finish();
        self.cleanupSeeders();
      } else {
        // Start a new request sequence
        process.nextTick(() => {
          self.fetchNewPiece(self.peers[host + port]);
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
          this._debug(`send ${count} piece request(s)`);
          peer["wire"].sendRequest(buf, count);
        });
      } else {
        // A have might be sent instead...
        peer["wire"].unsetBusy();
      }
    });
  }

  // MODES: 0 - handshake; 1 - downloading; 2 - uploading; 3 - metadata
  downloadPhase() {
    const self = this;
    for (let host in self.peers) {
      // Convert metadata peers to downloaders:
      if (self.peers[host].mode === 3) {
        // Kill the metadata instance
        self.peers[host]["wire"].removeMeta();
      }
      // Change the mode
      self.peers[host].mode = 1;
      // Fetch new pieces
      self.fetchNewPiece(self.peers[host]);
    }
  }

  finish() {
    const self = this;
    self._debug("DONE");
    // for (let tracker in self.trackers) {
    //   if (!self.trackers[tracker + ":failure"])
    //     self.trackers[tracker].completed(self.torrent.left, self.torrent.uploaded, self.torrent.downloaded);
    // }
  }

  cleanupSeeders() {
    const self = this;
    for (let host in self.peers) {
      if ( self.bitfield.isSeeder(self.peers[host].bitfield) ) {
        self.peers[host].wire.closeConnection();
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

  manageFiles() {
    this.torrent["files"] = this.torrent["files"].map((file) => {
      // TODO: Setup the proper location to download
      let downloadDirectory = "Downloads";
      let folders = __dirname + "/" + downloadDirectory + "/" + file.path;
      let f = folders.split("/");
      let fileName = f.splice(-1);
      folders = f.join("/");
      mkdirp(folders, function (err) {
        if (err) console.error(err);
        else fs.writeFileSync(folders + "/" + fileName, new Buffer(file.length));
      });
      file.path = folders + "/" + fileName;
      return file;
    });
  }

  _debug = (...args: any[]) => {
    args[0] = "[" + this._debugId + "] " + args[0];
    debug.apply(null, args);
  }

}

export default TorrentHandler;

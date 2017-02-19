import { Writable } from "stream";
import * as fs from "fs";

import torrentEngine from "./Client/torrentEngine";
const { decodeTorrentFile, decodeTorrent, encodeTorrent } = require("torrent-parser");
const { parseMagnet, encodeMagnet } = require("parse-magnet-uri");

const debug         = require("debug")("empire"),
      readJsonSync = require("read-json-sync"),
      writeJsonFile = require("write-json-file"),
      mkdirp = require("mkdirp");

class Empire extends Writable {
  _debugId:          number;
  config:            Object;
  downloadDirectory: string;
  maxPeers:          number;
  downloadPriority:  string;
  torrents:          Object;
  constructor() {
    super();
    const self = this;

    self._debugId      = ~~((Math.random() * 100000) + 1);

    self.config            = readJsonSync("config.json");
    self.downloadDirectory = self.config["downloadDirectory"];
    self.maxPeers          = self.config["maxPeers"];
    self.downloadPriority  = self.config["bte"];

    self.torrents          = {};

    // Ready user input for torrent files
    process.stdin.pipe(self);

    // Begin P2P with torrent files saved;
    self.handleTorrents();

    self._debug("Instantiate Empire");

    // Health Insurrance:
    process.on("uncaughtException", function (err) {
    });
  }

  _write(chunk: Buffer, encoding: string, next: Function) {
    this.importTorrentFile(chunk.toString());
    next();
  }

  importTorrentFile(file: string) {
    const self = this;
    self._debug("Import torrent file");
    // File = file.slice(0,file.length - 2);
    file = file.trim();
    // If Magnet file, parse it:
    let torrent = null;
    if (file.indexOf("magnet") > -1) {
      torrent = parseMagnet(file);
    } else {
      // Create the proper JSON:
      torrent = decodeTorrentFile(file);
    }
    // Sanity check
    if (!torrent["infoHash"]) {
      console.log("Error, bad file");
      return;
    }
    // if file already exists, exist
    if (self.config["hashes"].indexOf(torrent["infoHash"]) > -1) {
      self.emit("error", "File already Exists");
      return;
    }
    torrent["uploaded"]        = 0;
    torrent["downloaded"]      = 0;
    torrent["bitfieldDL"]      = "00";
    torrent["finished"]        = false;
    torrent["left"]            = torrent["length"] || (-1);
    // Create the folders and files:
    if (torrent["files"]) {
      torrent["files"] = torrent["files"].map((file) => {
        // TODO: Setup the proper location to download
        let folders = __dirname + "/" + self.downloadDirectory + "/" + file.path;
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
    // Update to our config
    self.config["torrents"].push(torrent);
    self.config["hashes"].push(torrent["infoHash"]);
    writeJsonFile("./config.json", self.config);
    // Emit up and begin P2P:
    self.emit("addedTorrent", torrent);
    self.handleTorrents();
  }

  createTorrent() {

  }

  handleTorrents() {
    const self = this;
    self.config["torrents"].forEach((torrent) => {
      if (!self.torrents[torrent.infoHash])
        self.torrents[torrent.infoHash] = new torrentEngine(torrent);

        // this.torrents[torrent.infoHash].on('killSwitch', () => { });
    });
  }

  _debug = (...args: any[]) => {
    args[0] = "[" + this._debugId + "] " + args[0];
    debug.apply(null, args);
  }

}


export default Empire;

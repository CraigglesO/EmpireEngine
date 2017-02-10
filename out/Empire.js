"use strict";
const stream_1 = require("stream");
const fs = require("fs");
const debug = require("debug");
debug("Empire");
const parseTorrent_1 = require("./modules/parseTorrent");
const parse_magnet_uri_1 = require("./modules/parse-magnet-uri");
const torrentEngine_1 = require("./Client/torrentEngine");
const readJsonSync = require("read-json-sync");
const writeJsonFile = require("write-json-file");
const mkdirp = require("mkdirp");
class Empire extends stream_1.Writable {
    constructor() {
        super();
        const self = this;
        self.config = readJsonSync("config.json");
        self.downloadDirectory = self.config["downloadDirectory"];
        self.maxPeers = self.config["maxPeers"];
        self.downloadPriority = self.config["bte"];
        self.torrents = {};
        process.stdin.pipe(self);
        self.handleTorrents();
    }
    _write(chunk, encoding, next) {
        this.importTorrentFile(chunk.toString());
        next();
    }
    importTorrentFile(file) {
        const self = this;
        file = file.trim();
        let torrent = null;
        if (file.indexOf("magnet") > -1) {
            torrent = parse_magnet_uri_1.parseMagnet(file);
        }
        else {
            torrent = parseTorrent_1.decodeTorrentFile(file);
        }
        if (!torrent["infoHash"]) {
            console.log("Error, bad file");
            return;
        }
        if (self.config["hashes"].indexOf(torrent["infoHash"]) > -1) {
            self.emit("error", "File already Exists");
            return;
        }
        torrent["uploaded"] = 0;
        torrent["downloaded"] = 0;
        torrent["bitfieldDL"] = "00";
        torrent["finished"] = false;
        torrent["left"] = torrent["length"] || (-1);
        if (torrent["files"]) {
            torrent["files"] = torrent["files"].map((file) => {
                let folders = __dirname + "/" + self.downloadDirectory + "/" + file.path;
                let f = folders.split("/");
                let fileName = f.splice(-1);
                folders = f.join("/");
                mkdirp(folders, function (err) {
                    if (err)
                        console.error(err);
                    else
                        fs.writeFileSync(folders + "/" + fileName, new Buffer(file.length));
                });
                file.path = folders + "/" + fileName;
                return file;
            });
        }
        self.config["torrents"].push(torrent);
        self.config["hashes"].push(torrent["infoHash"]);
        writeJsonFile("./config.json", self.config);
        self.emit("addedTorrent", torrent);
        self.handleTorrents();
    }
    createTorrent() {
    }
    handleTorrents() {
        const self = this;
        self.config["torrents"].forEach((torrent) => {
            if (!self.torrents[torrent.infoHash])
                self.torrents[torrent.infoHash] = new torrentEngine_1.default(torrent);
        });
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Empire;
//# sourceMappingURL=Empire.js.map
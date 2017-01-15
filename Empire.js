"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var stream_1 = require("stream");
var fs = require("fs");
var parseTorrent_1 = require("./parseTorrent/parseTorrent");
var torrentEngine_1 = require("./Client/torrentEngine");
var readJsonSync = require('read-json-sync');
var writeJsonFile = require('write-json-file');
var mkdirp = require('mkdirp');
var Empire = (function (_super) {
    __extends(Empire, _super);
    function Empire() {
        var _this = _super.call(this) || this;
        var self = _this;
        self.config = readJsonSync('config.json');
        self.downloadDirectory = self.config['downloadDirectory'];
        self.maxPeers = self.config['maxPeers'];
        self.downloadPriority = self.config['bte'];
        self.torrents = {};
        process.stdin.pipe(self);
        self.handleTorrents();
        return _this;
    }
    Empire.prototype._write = function (chunk, encoding, next) {
        this.importTorrentFile(chunk.toString());
        next();
    };
    Empire.prototype.importTorrentFile = function (file) {
        var self = this;
        file = file.slice(0, file.length - 2);
        var torrent = parseTorrent_1.decodeTorrentFile(file);
        if (self.config['hashes'].indexOf(torrent['infoHash']) > -1) {
            self.emit('error', 'File already Exists');
            return;
        }
        torrent['finished pieces'] = [];
        torrent['uploaded'] = 0;
        torrent['downloaded'] = 0;
        torrent['left'] = 0;
        var files = torrent['files'];
        files.forEach(function (folders) {
            folders = './' + self.downloadDirectory + '/' + folders.path;
            folders = folders.split('/');
            var fileName = folders.splice(-1);
            folders = folders.join('/');
            mkdirp(folders, function (err) {
                if (err)
                    console.error(err);
                else
                    fs.writeFileSync(folders + '/' + fileName, '');
            });
        });
        self.config['torrents'].push(torrent);
        self.config['hashes'].push(torrent['infoHash']);
        writeJsonFile('./config.json', self.config);
        self.emit('addedTorrent', torrent);
    };
    Empire.prototype.createTorrent = function () {
    };
    Empire.prototype.handleTorrents = function () {
        var self = this;
        self.config['torrents'].forEach(function (torrent) {
            if (!self.torrents[torrent.infoHash])
                self.torrents[torrent.infoHash] = new torrentEngine_1.default(torrent);
        });
    };
    return Empire;
}(stream_1.Writable));
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Empire;

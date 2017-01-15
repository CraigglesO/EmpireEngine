import { Writable } from 'stream';
import * as fs from 'fs';

import { decodeTorrentFile, decodeTorrent, encodeTorrent } from './parseTorrent/parseTorrent';
import torrentEngine from './Client/torrentEngine';

const readJsonSync = require('read-json-sync');
const writeJsonFile = require('write-json-file');
const mkdirp = require('mkdirp');

class Empire extends Writable {
  config:            Object;
  downloadDirectory: string;
  maxPeers:          number;
  downloadPriority:  string;
  torrents:          Object;
  constructor() {
    super();
    const self = this;

    self.config            = readJsonSync('config.json');
    self.downloadDirectory = self.config['downloadDirectory'];
    self.maxPeers          = self.config['maxPeers'];
    self.downloadPriority  = self.config['bte'];

    self.torrents          = {};

    // Ready user input for torrent files
    process.stdin.pipe(self);

    // Begin P2P with torrent files saved;
    self.handleTorrents();
  }

  _write(chunk: Buffer, encoding: string, next: Function) {
    this.importTorrentFile(chunk.toString());
    next();
  }

  importTorrentFile(file: string) {
    const self = this;
    file = file.slice(0,file.length - 2);
    // Create the proper JSON:
    let torrent = decodeTorrentFile(file);
    // if file already exists, exist
    if (self.config['hashes'].indexOf(torrent['infoHash']) > -1) {
      self.emit('error', 'File already Exists');
      return;
    }
    torrent['finished pieces'] = [];
    torrent['uploaded'] = 0;
    torrent['downloaded'] = 0;
    torrent['left'] = 0;
    // Create the folders and files:
    let files = torrent['files'];
    files.forEach((folders) => {
      folders = './' + self.downloadDirectory + '/' + folders.path;
      folders = folders.split('/');
      let fileName = folders.splice(-1);
      folders = folders.join('/');
      mkdirp(folders, function (err) {
        if (err) console.error(err)
        else fs.writeFileSync(folders + '/' + fileName,'');
      });
    });
    // Update to our config
    self.config['torrents'].push(torrent);
    self.config['hashes'].push(torrent['infoHash']);
    writeJsonFile('./config.json', self.config);
    // Emit up and begin P2P:
    self.emit('addedTorrent', torrent);
  }

  createTorrent() {

  }

  handleTorrents() {
    const self = this;
    self.config['torrents'].forEach((torrent) => {
      if (!self.torrents[torrent.infoHash])
        self.torrents[torrent.infoHash] = new torrentEngine(torrent);

      // this.torrents[torrent.infoHash].on('killSwitch', () => { });
    });
  }
}


export default Empire;

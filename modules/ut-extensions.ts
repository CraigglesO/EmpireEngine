import { EventEmitter } from 'events';
import { Hash, createHash } from 'crypto';

const bencode     = require('bencode'),
      PACKET_SIZE = 16384,
      UT_PEX      = 1,
      UT_METADATA = 2;


interface File {
  path:   string,
  name:   string,
  length: number,
  offset: number
}

interface Torrent {
  info: {
    name:           string
    'piece length': number
    pieces:         Array<string>
  },
  name:            string
  files:           Array<File>
  length:          number
  pieceLength:     number
  lastPieceLength: number
  pieces:          Array<string>
}

// BEP_0009
class utMetadata extends EventEmitter {
  metaDataSize:  number
  infoHash:      string
  pieceHash:     Hash
  piece_count:   number
  next_piece:    number
  pieces:        Array<Buffer>

  constructor (metaDataSize: number, infoHash: string) {
    super();
    if (!(this instanceof utMetadata))
      return new utMetadata(metaDataSize, infoHash);
    const self = this;

    self.metaDataSize  = metaDataSize;
    self.infoHash      = infoHash;
    self.pieceHash     = createHash('sha1');
    self.piece_count   = (self.metaDataSize) ? Math.ceil(metaDataSize / PACKET_SIZE) : 1;
    console.log(metaDataSize);
    self.next_piece    = 0;
    self.pieces        = Array.apply(null, Array(self.piece_count));

  }

  _message (payload: Buffer) {
    const self       = this;
    let str          = payload.toString(),
        trailerIndex = str.indexOf('ee') + 2,
        dict         = bencode.decode( str ),
        trailer      = payload.slice(trailerIndex);

    console.log('message: ', dict);
    console.log('piece_count', self.piece_count);
    switch (dict.msg_type) {
      case 0:
        // REQUEST {'msg_type': 0, 'piece': 0}
        break
      case 1:
        self.pieces[dict.piece] = trailer;
        // update the hash
        self.pieceHash.update(trailer);
        console.log('piece count: ', self.piece_count);
        console.log('next piece: ', self.next_piece);
        // Check that we have all the pieces
        if ( ++self.next_piece === self.piece_count ) {
          // Check that the hash matches the infoHash we started with
          if ( self.pieceHash.digest('hex') === self.infoHash ) {
            // Parse the metadata and send it off.
            let torrent = parseMetaData( Buffer.concat(self.pieces) );
            self.emit('metadata', torrent);
          } else {
            // Bad torrent data; try again
            self.next_piece = 0;
            console.log('bad torrent data');
            self.emit('next', self.next_piece);
          }
        } else {
          // Otherwise tell the engine we need more data
          console.log('more data..');
          self.emit('next', self.next_piece);
        }
        break
      case 2:
        // REJECT {'msg_type': 2, 'piece': 0}
        break
      default:

    }
  }
}

// BEP_0011
class utPex extends EventEmitter {
  constructor () {
    super();
    if (!(this instanceof utPex))
      return new utPex();
  }

  _message (payload: Buffer) { return; }

  start () {

  }

  stop () {

  }

  addPeer () {

  }

  removePeer () {

  }
}

// BEP_0040
function CanonicalPeerPriority () {

}

function parseMetaData (data): Torrent {

  let t = bencode.decode(data);

  let torrent = {
    info: {
      'name': t.name,
      'piece length': t['piece length'],
      'pieces': t.pieces
    },
    'name': t.name.toString(),
    'files': [],
    'length': null,
    'pieceLength': t['piece length'],
    'lastPieceLength': null,
    'pieces': []
  }

  //Files:
  let length = 0;
  if (t.files) {
    torrent.files = t.files;
    let o         = 0;
    torrent.files = torrent.files.map((file) => {
      length     += file.length;
      file.path   = file.path.toString();
      file.offset = o;
      o          += file.length;
      return file;
    });
    torrent.length = length;
  } else {
    torrent.files = [{
      length: t.length,
      path:   torrent.name,
      name:   torrent.name,
      offset: 0
    }];
    torrent.length = t.length;
  }
  torrent.lastPieceLength = torrent.length % torrent.pieceLength;

  // Pieces:
  let piece = t.pieces.toString('hex');
  for (let i = 0; i < piece.length; i += 40) {
    let p = piece.substring(i, i+40);
    torrent.pieces.push(p);
  }

  return torrent;
}

export { utMetadata, utPex }

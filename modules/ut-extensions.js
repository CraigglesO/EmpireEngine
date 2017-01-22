"use strict";
const events_1 = require("events");
const crypto_1 = require("crypto");
const bencode = require('bencode'), PACKET_SIZE = 16384, UT_PEX = 1, UT_METADATA = 2;
class utMetadata extends events_1.EventEmitter {
    constructor(metaDataSize, infoHash) {
        super();
        if (!(this instanceof utMetadata))
            return new utMetadata(metaDataSize, infoHash);
        const self = this;
        self.metaDataSize = metaDataSize;
        self.infoHash = infoHash;
        self.pieceHash = crypto_1.createHash('sha1');
        self.piece_count = Math.ceil(metaDataSize / PACKET_SIZE);
        self.next_piece = 0;
        self.pieces = Array.apply(null, Array(self.piece_count));
    }
    _message(payload) {
        const self = this;
        let str = payload.toString(), trailerIndex = str.indexOf('ee') + 2, dict = bencode.decode(str), trailer = payload.slice(trailerIndex);
        switch (dict.msg_type) {
            case 0:
                break;
            case 1:
                if (dict.total_size > PACKET_SIZE) {
                    self.next_piece = 0;
                    self.emit('next', self.next_piece);
                }
                else {
                    self.pieces[dict.piece] = trailer;
                    self.pieceHash.update(trailer);
                    if (++self.next_piece === self.piece_count) {
                        if (self.pieceHash.digest('hex') === self.infoHash) {
                            let torrent = parseMetaData(Buffer.concat(self.pieces));
                            self.emit('metadata', torrent);
                        }
                        else {
                            self.next_piece = 0;
                            self.emit('next', self.next_piece);
                        }
                    }
                    else {
                        self.emit('next', self.next_piece);
                    }
                }
                break;
            case 2:
                break;
            default:
        }
    }
}
exports.utMetadata = utMetadata;
class utPex extends events_1.EventEmitter {
    constructor() {
        super();
        if (!(this instanceof utPex))
            return new utPex();
    }
    _message(payload) { return; }
    start() {
    }
    stop() {
    }
    addPeer() {
    }
    removePeer() {
    }
}
exports.utPex = utPex;
function CanonicalPeerPriority() {
}
function parseMetaData(data) {
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
    };
    let length = 0;
    if (t.files) {
        torrent.files = t.files;
        let o = 0;
        torrent.files = torrent.files.map((file) => {
            length += file.length;
            file.path = file.path.toString();
            file.offset = o;
            o += file.length;
            return file;
        });
        torrent.length = length;
    }
    else {
        torrent.files = [{
                length: t.length,
                path: torrent.name,
                name: torrent.name,
                offset: 0
            }];
        torrent.length = t.length;
    }
    torrent.lastPieceLength = torrent.length % torrent.pieceLength;
    let piece = t.pieces.toString('hex');
    for (let i = 0; i < piece.length; i += 40) {
        let p = piece.substring(i, i + 40);
        torrent.pieces.push(p);
    }
    return torrent;
}
//# sourceMappingURL=ut-extensions.js.map
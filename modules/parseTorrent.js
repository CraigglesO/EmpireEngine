"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const buffer_1 = require("buffer");
const _ = require("lodash");
const bencoder_1 = require("../modules/bencoder");
const decodeTorrentFile = function (torrentFile) {
    let torrentData = fs.readFileSync(torrentFile);
    return _parseTorrent(torrentData);
};
exports.decodeTorrentFile = decodeTorrentFile;
const decodeTorrent = function (torrent) {
    return _parseTorrent(torrent);
};
exports.decodeTorrent = decodeTorrent;
function _parseTorrent(torrentId) {
    if (torrentId && torrentId.infoHash) {
        if (typeof torrentId.announce === 'string') {
            return torrent(torrentId);
        }
        else {
            throw new Error('Invalid torrent identifier');
        }
    }
    else {
        return new Error('Invalid torrent identifier');
    }
}
function torrent(torrent) {
    if (buffer_1.Buffer.isBuffer(torrent))
        torrent = new bencoder_1.Decode(torrent);
    let result = {};
    result['info'] = torrent.info;
    result['infoBuffer'] = new bencoder_1.Encode(torrent['info']);
    result['infoHash'] = sha1sync(result['infoBuffer']);
    result['infoHashBuffer'] = new buffer_1.Buffer(result['infoHash'], 'hex');
    result['name'] = (torrent.info['name.utf-8'] || torrent.info.name).toString();
    if (torrent.info.private !== undefined)
        result['private'] = !!torrent.info.private;
    if (torrent['creation date'])
        result['created'] = new Date(torrent['creation date'] * 1000);
    if (torrent['created by'])
        result['createdBy'] = torrent['created by'].toString();
    if (buffer_1.Buffer.isBuffer(torrent.comment))
        result['comment'] = torrent.comment.toString();
    result['announce'] = [];
    if (torrent['announce-list'] && torrent['announce-list'].length) {
        torrent['announce-list'].forEach(function (urls) {
            urls.forEach(function (url) {
                result['announce'].push(url.toString());
            });
        });
    }
    else if (torrent.announce) {
        result['announce'].push(torrent.announce.toString());
    }
    if (buffer_1.Buffer.isBuffer(torrent['url-list'])) {
        torrent['url-list'] = torrent['url-list'].length > 0
            ? [torrent['url-list']]
            : [];
    }
    result['urlList'] = (torrent['url-list'] || []).map(function (url) {
        return url.toString();
    });
    result['announce'] = _.uniq(result['announce']);
    result['urlList'] = _.uniq(result['urlList']);
    let files = torrent.info.files || [torrent.info];
    result['files'] = files.map((file, i) => {
        let parts = [].concat(result['name'], file['path.utf-8'] || file.path || []).map(function (p) {
            return p.toString();
        });
        return {
            path: path.join.apply(null, [path.sep].concat(parts)).slice(1),
            name: parts[parts.length - 1],
            length: file.length,
            offset: files.slice(0, i).reduce(sumLength, 0)
        };
    });
    result['length'] = files.reduce(sumLength, 0);
    let lastFile = result['files'][result['files'].length - 1];
    result['pieceLength'] = torrent.info['piece length'];
    result['lastPieceLength'] = ((lastFile.offset + lastFile.length) % result['pieceLength']) || result['pieceLength'];
    torrent.info.pieces = check(torrent.info.pieces);
    result['pieces'] = splitPieces(torrent.info.pieces);
    return result;
}
const encodeTorrentFile = function (location, data) {
    let result = encodeTorrent(data);
    return fs.writeFileSync(location, result);
};
const encodeTorrent = function (parsed) {
    let torrent = {};
    torrent['info'] = parsed['info'];
    torrent['announce-list'] = (parsed['announce'] || []).map(function (url) {
        if (!torrent['announce'])
            torrent['announce'] = url;
        url = new buffer_1.Buffer(url, 'utf8');
        return [url];
    });
    torrent['url-list'] = parsed['urlList'] || [];
    if (parsed['created']) {
        torrent['creation date'] = (parsed['created'].getTime() / 1000) | 0;
    }
    if (parsed['createdBy']) {
        torrent['created by'] = parsed['createdBy'];
    }
    if (parsed['comment']) {
        torrent['comment'] = parsed['comment'];
    }
    return new bencoder_1.Encode(torrent);
};
exports.encodeTorrent = encodeTorrent;
function sumLength(sum, file) {
    return sum + file.length;
}
function splitPieces(buf) {
    var pieces = [];
    for (var i = 0; i < buf.length; i += 20) {
        pieces.push(buf.slice(i, i + 20).toString('hex'));
    }
    return pieces;
}
function sha1sync(buf) {
    return crypto.createHash('sha1')
        .update(buf)
        .digest('hex');
}
function check(input) {
    if (!buffer_1.Buffer.isBuffer(input))
        return new buffer_1.Buffer(input);
    else
        return input;
}
//# sourceMappingURL=parseTorrent.js.map
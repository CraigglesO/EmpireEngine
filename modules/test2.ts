// import parseTracker from './parse-p2p-tracker';
//
// let x = [ 'https://ashrise.com:443/phoenix/announce',
//   'udp://open.demonii.com:1337/announce',
//   'udp://tracker.ccc.de:80/announce',
//   'udp://tracker.openbittorrent.com:80/announce',
//   'udp://tracker.publicbt.com:80/announce',
//   'wss://tracker.btorrent.xyz',
//   'wss://tracker.fastcast.nz',
//   'wss://tracker.openwebtorrent.com' ];
//
// x.forEach((y) => {
//   console.log(parseTracker(y));
// })
import { Buffer } from 'buffer';

let x = Buffer.from('-em0022-123456789012');
console.log(x);

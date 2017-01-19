"use strict";
const parse_p2p_tracker_1 = require("./parse-p2p-tracker");
let x = ['https://ashrise.com:443/phoenix/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://tracker.ccc.de:80/announce',
    'udp://tracker.openbittorrent.com:80/announce',
    'udp://tracker.publicbt.com:80/announce',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.fastcast.nz',
    'wss://tracker.openwebtorrent.com'];
x.forEach((y) => {
    console.log(parse_p2p_tracker_1.default(y));
});
//# sourceMappingURL=test2.js.map
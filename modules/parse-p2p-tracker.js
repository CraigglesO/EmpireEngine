"use strict";
function parseTracker(trackerLink) {
    let result = {
        type: '',
        host: '',
        port: 0
    };
    let announce = false;
    result.type = trackerLink.split(':')[0];
    result.host = trackerLink.split(':')[1];
    result.host = result.host.slice(2);
    let p = trackerLink.split(':')[2];
    if (p !== undefined)
        result.port = Number(p.split('\/')[0]);
    else
        result.port = 80;
    return result;
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = parseTracker;
//# sourceMappingURL=parse-p2p-tracker.js.map
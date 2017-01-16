"use strict";
function parseTracker(trackerLink) {
    var result = {
        type: '',
        host: '',
        port: 0
    };
    result.type = trackerLink.slice(0, 3);
    result.host = trackerLink.slice(6);
    result.port = Number(result.host.slice((-4)));
    result.host = result.host.split(':')[0];
    return result;
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = parseTracker;

"use strict";
function parseTracker(trackerLink) {
    var result = {
        type: '',
        path: '',
        port: 0
    };
    result.type = trackerLink.slice(0, 3);
    result.path = trackerLink.slice(6);
    result.port = Number(result.path.slice((-4)));
    result.path = result.path.split(':')[0];
    return result;
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = parseTracker;

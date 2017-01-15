"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var events_1 = require("events");
var udpTracker = (function (_super) {
    __extends(udpTracker, _super);
    function udpTracker() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    return udpTracker;
}(events_1.EventEmitter));
exports.udpTracker = udpTracker;
var wssTracker = (function (_super) {
    __extends(wssTracker, _super);
    function wssTracker() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    return wssTracker;
}(events_1.EventEmitter));
exports.wssTracker = wssTracker;

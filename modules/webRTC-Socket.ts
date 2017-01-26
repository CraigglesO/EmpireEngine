import * as wrtc from "wrtc";
import * as WebSocket from "ws";
import { Buffer } from "buffer";
import { Duplex } from "stream";

interface Settings {
  reliable: {
    ordered:        Boolean;
    maxRetransmits: number;
  };
}

interface Candidate {
  candidate:     string;
  sdp:           string;
  sdpMid:        string;
  sdpMLineIndex: number;
}

const MAX_REQUEST_LENGHT = 1024;

function wrtcConnect(host: string, port: number): WrtcSocket {
  return new WrtcSocket(host, port);
}

function wrtcCreateServer(func: Function): WrtcServer {
  return new WrtcServer(func);
}

class WrtcServer {
  wss:     WebSocket.Server | null;
  func:    Function;

  constructor(func: Function) {
    const self   = this;
    self.wss     = null | WebSocket.Server;
    self.func    = func;
  }

  initiate(port: number) {
    const self = this;
    // Create the server
    self.wss = new WebSocket.Server({ port });
    // Create the connection:
    self.wss.on("connection", (ws: WebSocket | WrtcIncomingSocket) => {
      // Create a socket:
      ws = new WrtcIncomingSocket(ws);
      // Run the users function on it
      ws.on("connect", () => {
        self.func(ws);
      });
    });
  }

  close() {
    this.wss.close();
  }

  broadcast(payload) {
    this.wss.clients.forEach( (client) => {
      if (client.ready === true) {
        client.send(payload);
      }
    });
  }

  listen(port: number, cb?: Function) {
    this.initiate(port);
    if (cb)
      cb();
  }
}

class WrtcIncomingSocket extends Duplex {
  ready:               Boolean;
  ws:                  WebSocket;
  remoteAddress:       string;
  remoteFamily:        string;
  remotePort:          number;
  pc:                  wrtc.RTCPeerConnection;
  offer:               null | wrtc.RTCSessionDescription;
  answer:              null;
  remoteReceived:      Boolean;
  dataChannelSettings: Settings;
  pendingDataChannels: Object;
  dataChannels:        Object;
  pendingCandidates:   Array<Candidate>;

  constructor(ws) {
    super();
    const self = this;

    self.ready               = false;
    self.ws                  = ws;
    self.remoteAddress       = null;
    self.remoteFamily        = "webrtc";
    self.remotePort          = null;
    self.pc                  = new wrtc.RTCPeerConnection({ iceServers: [{url: "stun:stun.l.google.com:19302"}] }, { "optional": [{DtlsSrtpKeyAgreement: false}] } );
    self.offer               = null;
    self.answer              = null;
    self.remoteReceived      = false;
    self.dataChannelSettings = { "reliable": { ordered: true, maxRetransmits: 0 } };

    self.pendingDataChannels = {};
    self.dataChannels        = {};
    self.pendingCandidates   = [];

    ws.on("message", (payload) => {
      let data = JSON.parse(payload);
      if ("offer" === data.type) {
        self.offer = new wrtc.RTCSessionDescription(data);

        self.pc.onsignalingstatechange = (event) => { // -> Works in browser only
          if (event.target)
            self.emit("stateChange", event.target.signalingState);
        };
        self.pc.oniceconnectionstatechange = (event) => { // -> Works in browser only
          if (event.target)
            self.emit("iceConnectionStateChange", event.target.iceConnectionState);
        };
        self.pc.onicegatheringstatechange = (event) => { // -> Works in browser only
          if (event.target)
            self.emit("iceGatheringStateChange", event.target.iceGatheringState);
        };

        self.pc.onicecandidate = (candidate) => {
          ws.send(JSON.stringify(
            {"type": "ice",
             "sdp": {"candidate": candidate.candidate, "sdpMid": candidate.sdpMid, "sdpMLineIndex": candidate.sdpMLineIndex}
            })
          );
        };

        self.handleDataChannels();

      } else if ("ice" === data.type) {
        if (self.remoteReceived && data.sdp.candidate) {
          self.parseCandidate(data.sdp.candidate);
          self.pc.addIceCandidate(new wrtc.RTCIceCandidate(data.sdp.candidate));
        } else
          self.pendingCandidates.push(data);
      }
    });

  }

  parseCandidate(candidate: string) {
    this.remoteAddress = candidate.split(" ")[4];
    this.remotePort    = Number(candidate.split(" ")[5]);
  }

  close() {
    this.pc.close();
    this.ws.close();
  }

  send(payload: any) {
    if (Buffer.isBuffer(payload))
      payload = new Uint8Array(payload);
    this.dataChannels["reliable"].send(payload);
  }

  _read() {

  }

  _write(payload: Buffer, encoding: string, next: Function) {

    next(null);
  }

  complete() {
    this.ready = true;
    this.emit("connect");
  }

  handleError(err) {
    throw err;
  }

  createAnswer() {
    const self = this;
    self.remoteReceived = true;
    self.pendingCandidates.forEach((candidate) => {
      if (candidate.sdp) {
        self.pc.addIceCandidate(new wrtc.RTCIceCandidate(candidate.sdp));
      }
    });
    self.pc.createAnswer(
      self.setLocalDesc.bind(self),
      self.handleError.bind(self)
    );
  };

  setLocalDesc(desc) {
    const self = this;
    self.answer = desc;
    self.pc.setLocalDescription(
      desc,
      self.sendAnswer.bind(self),
      self.handleError.bind(self)
    );
  };

  sendAnswer() {
    const self = this;
    self.ws.send(JSON.stringify(self.answer));
  }

  handleDataChannels() {
    const self = this;
    let labels = Object.keys(self.dataChannelSettings);
    self.pc.ondatachannel = (event) => {
      let channel = event.channel;
      let label = channel.label;

      self.pendingDataChannels[label] = channel;
      channel.binaryType = "arraybuffer";
      channel.onopen = () => {
        self.dataChannels[label] = channel;
        delete self.pendingDataChannels[label];
        if (Object.keys(self.dataChannels).length === labels.length) {
          self.complete();
        }
      };

      channel.onmessage = (event) => {
        let data;
        if (event.data instanceof ArrayBuffer) data = new Buffer(event.data);
        else data = event.data;
        self.emit("data", data);
      };

      channel.onclose = (event) => {
        this.emit("close", event);
      };

      channel.onerror = self.handleError;
    };

    self.setRemoteDesc();
  }

  setRemoteDesc() {
    const self = this;
    self.pc.setRemoteDescription(
      self.offer,
      self.createAnswer.bind(self),
      self.handleError.bind(self)
    );
  }

}

class WrtcSocket extends Duplex {
  host:                  string;
  port:                  number;
  remoteAddress:         string;
  remoteFamily:          string;
  remotePort:            number;
  bridge:                string;
  RTCPeerConnection:     wrtc.RTCPeerConnection;
  RTCSessionDescription: wrtc.RTCSessionDescription;
  RTCIceCandidate:       wrtc.RTCIceCandidate;
  dataChannelSettings:   Settings;
  pendingDataChannels:   Object;
  dataChannels:          Object;
  pendingCandidates:     Array<Candidate>;
  ws:                    WebSocket;
  pc:                    any;

  constructor(host: string, port: number, ws?: WebSocket) {
    super();
    const self = this;

    self.host                  = host;
    self.port                  = port;
    self.remoteAddress         = null;
    self.remoteFamily          = "webrtc";
    self.remotePort            = null;
    self.bridge                = "ws://" + host + ":" + port.toString();
    self.RTCPeerConnection     = wrtc.RTCPeerConnection;
    self.RTCSessionDescription = wrtc.RTCSessionDescription;
    self.RTCIceCandidate       = wrtc.RTCIceCandidate;
    self.dataChannelSettings   = { "reliable": { ordered: true, maxRetransmits: 10 } }; /* 'reliable': {}, '@control': { outOfOrderAllowed: true, maxRetransmitNum: 0 } */
    self.pendingDataChannels   = {};
    self.dataChannels          = {};
    self.pendingCandidates     = [];

    self.ws                    = (ws) ? ws : new WebSocket(self.bridge);
    self.pc                    = new self.RTCPeerConnection({ iceServers: [{url: "stun:stun.l.google.com:19302"}] }, { "optional": [] } );

    self.pc.onsignalingstatechange = (event) => { // -> Works in browser only
      if (event.target)
        self.emit("stateChange", event.target.signalingState);
    };
    self.pc.oniceconnectionstatechange = (event) => { // -> Works in browser only
      if (event.target)
        self.emit("iceConnectionStateChange", event.target.iceConnectionState);
    };
    self.pc.onicegatheringstatechange = (event) => { // -> Works in browser only
      if (event.target)
        self.emit("iceGatheringStateChange", event.target.iceGatheringState);
    };

    self.pc.onicecandidate = (event) => {
      let candidate = event.candidate;
      if (!candidate) return;
      if (WebSocket.OPEN === self.ws.readyState) {
        self.ws.send(JSON.stringify({
          "type": "ice",
          "sdp": {"candidate": candidate.candidate, "sdpMid": candidate.sdpMid, "sdpMLineIndex": candidate.sdpMLineIndex}
          })
        );
      } else {
        self.parseCandidate(candidate.candidate);
        self.pendingCandidates.push(candidate);
      }
    };

    self.createDataChannels();

  }

  parseCandidate(candidate: string) {
    this.remoteAddress = candidate.split(" ")[4];
    this.remotePort    = Number(candidate.split(" ")[5]);
  }

  close() {
    this.pc.close();
    this.ws.close();
  }

  send(payload: any) {
    if (Buffer.isBuffer(payload))
      payload = new Uint8Array(payload);
    this.dataChannels["reliable"].send(payload);
  }

  _read() {

  }

  _write(payload: Buffer, encoding: string, next: Function) {
    this.send(payload);
    next(null);
  }

  handleError(err) {
    throw err;
  }

  ready() {
    this.emit("connect");
  }

  awaitingDataChannels() {
    this.emit("awaitingDataChannels");
  }

  createDataChannels() {
    const self = this;
    let labels = Object.keys(self.dataChannelSettings);
    labels.forEach( (label) => {

      let channelOptions = self.dataChannelSettings[label];
      let channel = self.pendingDataChannels[label] = self.pc.createDataChannel(label, channelOptions);
      channel.binaryType = "arraybuffer";

      channel.onopen = () => {
        self.dataChannels[label] = channel;
        delete self.pendingDataChannels[label];
        if (Object.keys(self.dataChannels).length === labels.length)
          self.ready();
      };

      channel.onmessage = (event) => {
        let data;
        if (event.data instanceof ArrayBuffer) data = new Buffer(event.data);
        else data = event.data;
        self.emit("data", data);
      };

      channel.onclose = (event) => {
        this.emit("close", event);
      };

      channel.onerror = self.handleError;
    });

    self.pc.createOffer( self.setLocalDesc.bind(self), self.handleError.bind(self) );
  }

  setLocalDesc (desc) {
    const self = this;
    self.pc.setLocalDescription( new self.RTCSessionDescription(desc), self.sendOffer.bind(self, desc), self.handleError);
  }

  sendOffer(offer) {
    const self = this;
    self.ws.onopen = () => {

      self.pendingCandidates.forEach((candidate) => {
        self.ws.send(JSON.stringify({
            "type": "ice",
            "sdp": {"candidate": candidate.candidate, "sdpMid": candidate.sdpMid, "sdpMLineIndex": candidate.sdpMLineIndex }
          })
        );
      });

      self.ws.send( JSON.stringify({"type": offer.type, "sdp": offer.sdp}) );
    };

    self.ws.onmessage = (event) => {
      let data = JSON.parse(event.data);
      if ("answer" === data.type) {
        self.setRemoteDesc(data);
      } else if ("ice" === data.type) {
        if (data.sdp.candidate) {
          let candidate = new self.RTCIceCandidate(data.sdp.candidate);
          self.pc.addIceCandidate(candidate, self.handleAddIceCandidateSuccess.bind(self), self.handleAddIceCandidateError.bind(self));
        }
      }
    };
  }

  setRemoteDesc (desc) {
    this.pc.setRemoteDescription(
      new this.RTCSessionDescription(desc),
      this.awaitingDataChannels.bind(this),
      this.handleError.bind(this)
    );
  }

  handleAddIceCandidateSuccess() {}

  handleAddIceCandidateError() {}

}

export { wrtcCreateServer, wrtcConnect, WrtcSocket }

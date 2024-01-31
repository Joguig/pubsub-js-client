
import EventsDispatcher from "./events";
import logging from "./log";
import util from "./util";
import PubsubSocket from "./PubsubSocket";
import MyMap from "./mymap";

var logger = logging._getLogger("WebsocketClient");

const SOCKET_CLOSED_RECONNECT_TIME = 1 * 1000; // 1 second
const RESPONSE_TIMEOUT = 30 * 1000; // 30 seconds
const ERR_RESPONSE_TIMEOUT = "response timeout";
const NONCE_LENGTH = 30;
const FIRST_LISTEN_TIMEOUT = 45 * 1000; // 45 seconds

const addrProduction = "wss://pubsub-edge.twitch.tv:443/v1";
const addrDarklaunch = "wss://pubsub-edge-darklaunch.twitch.tv:443/v1";
const addrDevelopment = "ws://localhost:6900/v1";

class WebsocketClient extends EventsDispatcher {

  constructor (opts) {
    // opts should include: environment
    super(opts);
    this._opts = opts;
    this._env = opts.env;

    switch (this._env) {
    case "production":
      this._addr = addrProduction;
      break;
    case "darklaunch":
      this._addr = addrDarklaunch;
      break;
    case "development":
      this._addr = addrDevelopment;
      break;
    default:
      this._addr = addrProduction;
    }

    // noop if WebSockets aren't supported
    if (!window.WebSocket) {
      return;
    }

    // Keep track of Listen/Unlisten requests that have queued up while Driver is disconnected
    this._queuedRequests = [];
    // Keep track of pending responses; map is from nonce -> {timeout to clear, isListen bool, un/listen opts}
    this._pendingResponses = new MyMap();
    // Keep track of nonces from outstanding listen replays
    this._pendingReplayResponses = new MyMap();
    // Keep track of messages we are listening to, and their callbacks
    this._listens = new EventsDispatcher();
    // Keep track of topic+auth token for each successful LISTEN callback
    this._replays = new MyMap();
    this._replaysSize = 0;

    // Track the 'time to first Listen'
    this._firstConnectTime = this._firstListenTime = 0;

    // Instantiate websocket connection
    this._connectCalled = this._reconnecting = false;
    this._primarySocket = new PubsubSocket({
      addr: this._addr
    });
    this._bindPrimary(this._primarySocket);
  }

  verify () {
    this._trigger("verified");
  }

  connect () {
    // noop if WebSockets aren't supported
    if (!window.WebSocket) {
      return;
    }

    if (this._connectCalled) {
      // Noop for every "connect()" call after the first
      if (this._primarySocket._isReady()) {
        this._trigger("connected");
      }
    } else {
      this._connectCalled = true;
      this._primarySocket.connect();
    }
  }

  _bindPrimary (socket) {
    // Socket opening
    socket.on('open', this._onPrimaryOpen, this);
    // Pubsub messages
    socket.on('response', this._onResponse, this);
    socket.on('message', this._onMessage, this);
    socket.on('reconnect', this._onReconnect, this);
    // Errors
    socket.on('connection_failure', this._onConnectionFailure, this);
  }

  _unbindPrimary (socket) {
    // Socket opening
    socket.off('open', this._onPrimaryOpen, this);
    // Pubsub messages
    socket.off('response', this._onResponse, this);
    socket.off('message', this._onMessage, this);
    socket.off('reconnect', this._onReconnect, this);
    // Errors
    socket.off('connection_failure', this._onConnectionFailure, this);
  }

  _onPrimaryOpen () {
    logger.debug("primary open: " + this._primarySocket._id);
    // Triggered when the PubsubDriver is ready to start receiving commands
    if (this._firstConnectTime === 0) {
      this._firstConnectTime = util.time.now();
    }

    this._connected = true;
    this._trigger("connected");

    this._flushQueuedRequests();
  }

  _onResponse (resp) {
    logger.debug("primary response: " + JSON.stringify(resp));
    if (this._pendingResponses.has(resp.nonce)) {
      var responseInfo = this._pendingResponses.get(resp.nonce);
      logger.debug("responseInfo: " + JSON.stringify(responseInfo));
      clearTimeout(responseInfo.timeout);
      this._pendingResponses.remove(resp.nonce);

      if (resp.error === "") {
        // Add/remove onMessage callback from the specified topic
        // Also add/remove the auth token used for that topic/callback pair
        if (responseInfo.message.type === "LISTEN") {
          // Track time to first listen
          if (this._firstListenTime === 0) {
            this._firstListenTime = util.time.now();
          }

          this._replays.set(resp.nonce, {
            nonce: resp.nonce,
            message: responseInfo.callbacks.message,
            topic: responseInfo.topic,
            auth: responseInfo.auth
          });

          if (responseInfo.callbacks.message) {
            this._listens.on(responseInfo.topic, responseInfo.callbacks.message, this);
          }
        } else if (responseInfo.message.type === "UNLISTEN") {
          this._replays.remove(resp.nonce);

          if (responseInfo.callbacks.message) {
            this._listens.off(responseInfo.topic, responseInfo.callbacks.message, this);
          }
        }
        // Call the specified onSuccess callback
        if (responseInfo.callbacks.success) {
          responseInfo.callbacks.success();
        }
      } else {
        // Call the specified onFailure callback
        if (responseInfo.callbacks.failure) {
          responseInfo.callbacks.failure(resp.error);
        }
      }
    }
  }

  _onResponseTimeout (nonce) {
    if (this._pendingResponses.has(nonce)) {
      var info = this._pendingResponses.get(nonce);
      this._pendingResponses.remove(nonce);

      if (info.callbacks.failure) {
        info.callbacks.failure(ERR_RESPONSE_TIMEOUT);
      }
    }
  }

  _onMessage (msg) {
    logger.debug("primary message: " + JSON.stringify(msg));
    this._listens._trigger(msg.data.topic, msg.data.message);
  }

  _onConnectionFailure () {
    logger.debug("connection failure");
    // Call disconnection callback
    this._trigger("disconnected");
    // try to reconnect, using the same backupSocket flow as intentional reconnects
    // will end up re-listening on all topics
    this._notifyWhenOpen = true;
    this._onReconnect();
  }

  // Smoothly reconnect, establishing a new socket before terminating the old one
  _onReconnect () {
    logger.debug("reconnecting...");
    this._reconnecting = true;
    this._backupSocket = new PubsubSocket({
      addr: this._addr
    });
    this._bindBackup(this._backupSocket);
    setTimeout(this._backupSocket.connect.bind(this._backupSocket), this._jitteredReconnectDelay());
  }

  _bindBackup (socket) {
    socket.on('open', this._onBackupOpen, this);
    socket.on('response', this._onBackupResponse, this);
  }

  _unbindBackup (socket) {
    socket.off('open', this._onBackupOpen, this);
    socket.off('response', this._onBackupResponse, this);
  }

  _onBackupOpen () {
    logger.debug("Backup socket opened");
    if (this._replays.size() > 0) {
      this._replayBackup();
    } else {
      this._swapSockets();
      if (this._notifyWhenOpen) {
        logger.debug("triggering connected");
        this._notifyWhenOpen = false;
        this._trigger('connected');
      }
    }
  }

  // Get the backup socket up to speed by re-listening on topics
  _replayBackup () {
    var replays = this._replays.values();
    for (var i = 0; i < replays.length; i++) {
      var msg = {
        type: "LISTEN",
        nonce: this._generateNonce(),
        data: {
          topics: [replays[i].topic],
          auth_token: replays[i].auth
        }
      };
      this._pendingReplayResponses.set(msg.nonce, true);
      this._backupSocket.send(msg);
    }
  }

  _onBackupResponse (resp) {
    if (this._pendingReplayResponses.has(resp.nonce) && resp.error === "") {
      this._pendingReplayResponses.remove(resp.nonce);
      if (this._pendingReplayResponses.size() === 0) {
        // Finished getting the backup socket up to speed
        this._swapSockets();
        if (this._notifyWhenOpen) {
          // Flag set when the reconnection is accidental, and we need to notify the client that the pubsub is ready again, rather than just silently switching
          logger.debug("triggering connected");
          this._notifyWhenOpen = false;
          this._trigger('connected');
        }
      }
    }
  }

  _swapSockets () {
    logger.debug("swapping primary " + this._primarySocket._id + " and backup " + this._backupSocket._id);
    this._unbindPrimary(this._primarySocket);
    this._unbindBackup(this._backupSocket);
    this._bindPrimary(this._backupSocket);
    this._primarySocket.close();
    this._primarySocket = this._backupSocket;
    this._reconnecting = false;
    this._flushQueuedRequests();
  }

  Listen (opts) {
    // noop if WebSockets aren't supported
    if (!window.WebSocket) {
      return;
    }

    // opts should include: topic, auth, success, failure, message
    logger.debug("listening on " + opts.topic);
    var nonce = this._generateNonce();
    var msg = {
      type: "LISTEN",
      nonce: nonce,
      data: {
        topics: [opts.topic],
        auth_token: opts.auth
      }
    };
    this._queuedSend(nonce, msg, opts);
  }

  Unlisten (opts) {
    // noop if WebSockets aren't supported
    if (!window.WebSocket) {
      return;
    }

    // opts should include: topic, success, failure, message
    logger.debug("unlistening on " + opts.topic + "(" + this._listens.count(opts.topic) + " listeners)");

    // If there are more than one callbacks waiting on this topic, we can just remove the specified one rather than sending an UNLISTEN
    if (this._listens.count(opts.topic) > 1) {
      this._listens.off(opts.topic, opts.message);

      // Delete from replays
      for (var key in this._replays.map()) {
        if (this._replays.get(key).message === opts.message) {
          this._replays.remove(key);
          break;
        }
      }

      if (opts.success) {
        opts.success();
      }
      logger.debug("now have " + this._listens.count(opts.topic) + " listeners");
      return;
    }

    var nonce = this._generateNonce();
    var msg = {
      type: "UNLISTEN",
      nonce: nonce,
      data: {
        topics: [opts.topic]
      }
    };
    this._queuedSend(nonce, msg, opts);
  }

  _queuedSend (nonce, msg, opts) {
    if (this._reconnecting || this._primarySocket._isReady() === false) {
      // queue the message
      logger.debug("queuing");
      this._queuedRequests.push({nonce: nonce, msg: msg, opts: opts});
    } else {
      // send
      logger.debug("sending immediately");
      this._send(nonce, msg, opts);
    }
  }

  _flushQueuedRequests () {
    logger.debug("flushing " + this._queuedRequests.length + " listen/unlistens");
    while (this._queuedRequests.length > 0) {
      var req = this._queuedRequests.shift();
      this._send(req.nonce, req.msg, req.opts);
    }
  }

  _send (nonce, msg, opts) {
    this._pendingResponses.set(nonce, {
      timeout: setTimeout(this._onResponseTimeout.bind(this), RESPONSE_TIMEOUT, nonce),
      topic: opts.topic,
      auth: opts.auth,
      message: msg,
      callbacks: {
        success: opts.success,
        failure: opts.failure,
        message: opts.message
      }
    });
    this._primarySocket.send(msg);
  }

  // Utility functions
  _generateNonce () {
    return util.generateString(NONCE_LENGTH);
  }

  _jitteredReconnectDelay () {
    return util.randomInt(2000);
  }

}

export default WebsocketClient;

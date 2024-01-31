import EventsDispatcher from "./events";
import logging from "./log";
import util from "./util";

var logger = logging._getLogger("PubsubSocket");

const MAX_CONNECTION_DELAY = 120;

const ERR_SOCKET_CLOSED = "socket_closed";
const ERR_PONG_TIMEOUT = "missed_pong";
const ERR_CONNECTION_FAILED = "max_connection_attempts";
const ERR_NOT_READY = "not_ready";
const ERR_FAILED_SEND = "failed_send";

const PONG_TIMEOUT = 30 * 1000; // 30 seconds
const PING_INTERVAL = 4 * 60 * 1000; // 4 minutes

/*
PubsubSocket is responsible for managing the WebSocket connction to Pubsub Edge, hiding the details of ping/pong, connection retries, and parsing received message types from the PubsubDriver.
It retries connecting with exponential backoff if it fails to connect.
When it opens, it triggers an "open" event.
If it closes unexpectedly, it triggers a "connection_failure" event.
It handles pings/pongs, and triggers a "pong_timeout" event if a pong isn't received.
If it is intentionally closed, it triggers a "closed" event when it closes.
If it receives a RESPONSE type message from the Pubsub, it triggers a "response" event.
If it receives a MESSAGE type message from the Pubsub, it triggers a "message" event.
If it receives a RECONNECT type message from the Pubsub, it triggers a "reconnect" event.
*/

class PubsubSocket extends EventsDispatcher {
  constructor (opts) {
    super(opts);
    this._opts = opts;
    this._addr = opts.addr;

    this._connectionAttempts = 0;
    this._sentPing = this._receivedPong = false;

    this._id = "[" + util.generateString(10) + "] ";

    window.addEventListener("beforeunload", this._beforeUnload.bind(this));
  }

  connect () {
    logger.debug(this._id + "connecting to " + this._addr);
    this._connecting = true;
    try {
      this._socket = new WebSocket(this._addr);
      this._socket.onmessage = this._onMessage.bind(this);
      this._socket.onerror = this._onError.bind(this);
      this._socket.onclose = this._onClose.bind(this);
      this._socket.onopen = this._onOpen.bind(this);
    } catch (e) {
      this._trigger("connection_failure");
    }
  }

  close () {
    logger.debug(this._id + "closing");
    this._closing = true;
    this._clearTimeouts();
    this._socket.close();
  }

  send (msg) {
    logger.debug(this._id + "sending " + JSON.stringify(msg));
    if (this._isReady()) {
      this._socket.send(JSON.stringify(msg));
    } else {
      this._trigger("error", ERR_NOT_READY);
    }
  }

  _isReady () {
    logger.debug(this._id + "_isReady called");
    if (this._socket) {
      return (this._socket.readyState === WebSocket.OPEN);
    } else {
      return false;
    }
  }

  _onMessage (event) {
    logger.debug(this._id + "received message: " + event.data);
    try {
      var msg = JSON.parse(event.data);
      switch (msg.type) {
      case "RESPONSE":
        this._trigger("response", msg);
        break;
      case "MESSAGE":
        this._trigger("message", msg);
        break;
      case "PONG":
        this._receivedPong = true;
        break;
      case "RECONNECT":
        this._trigger("reconnect");
        break;
      }
    } catch (e) {
      // bad json parse
      logger.debug("onMessage JSON Parse error: " + e);
    }
  }

  _onError (event) {
    // Irrelevant since the _onClose event is about to be triggered
    logger.debug(this._id + "error: " + JSON.stringify(event));
  }

  _onClose (event) {
    logger.debug(this._id + "onClose triggered with code " + event.code + "(closing = " + this._closing + ", connecting = " + this._connecting + ")");
    this._clearTimeouts();
    if (this._connecting) {
      // Failed during connection, retry with exponential backoff
      var connectionDelay = Math.pow(2, this._connectionAttempts);
      if (connectionDelay > MAX_CONNECTION_DELAY) {
        connectionDelay = MAX_CONNECTION_DELAY;
      }
      logger.debug(this._id + "reconnecting in " + connectionDelay + " seconds");
      this._connectionAttempts += 1;
      this._nextConnectionAttempt = setTimeout(this.connect.bind(this), 1000 * connectionDelay);
    } else if (this._closing) {
      // Intentionally closed itself (due to an error), don't send an 'unexpected_closed' error since the relevant error will have already been sent
      this._closed = true;
      this._trigger("connection_failure");
    } else if (this._windowUnloading) {
      // Closed because the browser window is being refreshed or redirected
      // Don't trigger anything, whole object is going to be destroyed by the browser anyhow
      return;
    } else {
      // Unintentionally closed, trigger an error so the Driver knows to re-fetch state
      logger.debug(this._id + "unexpected close");
      var line = "pubsub-js-client unexpected_close. code: " + event.code + ", reason: " + event.reason + ", wasClean: " + event.wasClean;
      this._closed = true;
      this._trigger("connection_failure");
    }
  }

  _onOpen (event) {
    logger.debug(this._id + " socket opened");
    this._connectionAttempts = 0;
    this._connecting = false;

    this._ping();
    this._pingInterval = window.setInterval(this._ping.bind(this), PING_INTERVAL);
    this._trigger("open");
  }

  _ping () {
    logger.debug(this._id + "sending PING");
    try {
      this._socket.send(JSON.stringify({type: "PING"}));
      this._sentPing = true;
      if (this._pongTimeout) {
        clearTimeout(this._pongTimeout);
      }
      this._pongTimeout = setTimeout(this._pongTimedOut.bind(this), PONG_TIMEOUT);
    } catch (e) {
      this.close();
    }
  }

  _pongTimedOut () {
    if (this._sentPing && !this._receivedPong) {
      logger.debug(this._id + "Pong timed out!");
      // Close the socket; this will initiate the reconnection flow automatically
      this.close();
    }
  }

  _clearTimeouts () {
    this._sentPing = this._receivedPong = false;
    clearTimeout(this._pongTimeout);
    clearInterval(this._pingInterval);
    clearTimeout(this._nextConnectionAttempt);
  }

  _beforeUnload () {
    this._windowUnloading = true;
  }

}

export default PubsubSocket;

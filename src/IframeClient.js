import EventsDispatcher from "./events";
import logging from "./log";
import util from "./util";
import MyMap from "./mymap";

const NONCE_LENGTH = 30;
const RESPONSE_TIMEOUT = 30 * 1000; // 30 seconds
const VERIFY_TIMEOUT = 1 * 1000; // 1 second
const TWITCH_PROTOCOL = "pubsub";

var logger = logging._getLogger("IframeClient");

class IframeClient extends EventsDispatcher {
  constructor (opts) {
    super(opts);
    this._parentUrl = opts.parentUrl;
    this._pendingResponses = new MyMap();
    this._listens = new EventsDispatcher();

    window.addEventListener("message", this.receiveMessage.bind(this), false);
  }

  connect () {
    window.parent.postMessage({
      twitch_protocol: TWITCH_PROTOCOL,
      type: "connect"
    }, this._parentUrl);
  }

  verify () {
    window.parent.postMessage({
      twitch_protocol: TWITCH_PROTOCOL,
      type: "verify"
    }, this._parentUrl);
    this._verifyTimeout = setTimeout(this._unverified.bind(this), VERIFY_TIMEOUT);
  }

  Listen (opts) {
    // opts should include: topic, auth, success, failure, message
    logger.debug("listening on " + opts.topic);
    var nonce = this._generateNonce();
    var msg = {
      twitch_protocol: TWITCH_PROTOCOL,
      type: "LISTEN",
      nonce: nonce,
      data: {
        topics: [opts.topic],
        auth_token: opts.auth
      }
    };
    this._send(nonce, msg, opts);
  }

  Unlisten (opts) {
    // opts should include: topic, success, failure, message
    logger.debug("unlistening on " + opts.topic + "(" + this._listens.count(opts.topic) + " listeners)");

    // If there are more than one callbacks waiting on this topic, we can just remove the specified one rather than sending an UNLISTEN
    if (this._listens.count(opts.topic) > 1) {

      if (opts.message) {
        this._listens.off(opts.topic, opts.message);
      }

      if (opts.success) {
        opts.success();
      }

      logger.debug("now have " + this._listens.count(opts.topic) + " listeners");
      return;
    }

    var nonce = this._generateNonce();
    var msg = {
      twitch_protocol: TWITCH_PROTOCOL,
      type: "UNLISTEN",
      nonce: nonce,
      data: {
        topics: [opts.topic]
      }
    };
    this._send(nonce, msg, opts);
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
    window.parent.postMessage(msg, this._parentUrl);
  }

  receiveMessage (event) {
    if (!event.data || event.data.twitch_protocol != TWITCH_PROTOCOL) {
      return;
    }
    logger.debug("Received message: " + JSON.stringify(event.data));
    switch (event.data.type) {
    case "connected":
      this._trigger("connected");
      break;
    case "disconnected":
      this._trigger("disconnected");
      break;
    case "success":
      this.handleResponse(true, event.data);
      break;
    case "failure":
      this.handleResponse(false, event.data);
      break;
    case "message":
      this.handleMessage(event.data.topic, event.data.message);
      break;
    case "verify":
      this._verified();
      break;
    }
  }

  handleResponse (successful, resp) {
    if (this._pendingResponses.has(resp.nonce)) {
      var responseInfo = this._pendingResponses.get(resp.nonce);
      logger.debug("ResponseInfo: " + JSON.stringify(responseInfo));
      clearTimeout(responseInfo.timeout);
      this._pendingResponses.remove(resp.nonce);

      if (successful) {


        if (responseInfo.callbacks.message) {
          if (responseInfo.message.type === "LISTEN") {
            this._listens.on(responseInfo.topic, responseInfo.callbacks.message, this);
          } else if (responseInfo.message.type === "UNLISTEN") {
            this._listens.off(responseInfo.topic, responseInfo.callbacks.message, this);
          }
        }

        if (responseInfo.callbacks.success) {
          responseInfo.callbacks.success();
        }
      } else {
        if (responseInfo.callbacks.failure) {
          responseInfo.callbacks.failure(resp.error);
        }
      }
    }
  }

  handleMessage (topic, msg) {
    logger.debug("received '" + msg + "' on topic " + topic);
    this._listens._trigger(topic, msg);
  }

  _onResponseTimeout (nonce) {
    logger.debug("response timed out: " + nonce);
  }

  _verified () {
    logger.debug("Verified");
    clearTimeout(this._verifyTimeout);
    this._trigger("verified");
  }

  _unverified () {
    window.removeEventListener("message", this.receiveMessage.bind(this), false);
    this._trigger("unverified");
  }

  // Utility functions
  _generateNonce () {
    return util.generateString(NONCE_LENGTH);
  }
}

export default IframeClient;

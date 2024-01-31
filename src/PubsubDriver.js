
import EventsDispatcher from "./events";
import logging from "./log";
import util from "./util";
import IframeClient from "./IframeClient";
import IframeHost from "./IframeHost";
import WebsocketClient from "./WebsocketClient";
import PubsubTest from "./PubsubTest";

var logger = logging._getLogger("PubsubDriver");

const SOCKET_CLOSED_RECONNECT_TIME = 1 * 1000; // 1 second
const RESPONSE_TIMEOUT = 30 * 1000; // 30 seconds
const ERR_RESPONSE_TIMEOUT = "response timeout";
const NONCE_LENGTH = 30;
const DEFER_TEST_TIME = 30 * 1000; // 30 seconds

const twitchUrlRegexp = /^https?:\/\/([\w-]+\.)*twitch\.(tv|tech)(:\d+)?\/.*$/;

var pctTester = 0.0;

class PubsubDriver extends EventsDispatcher {

  constructor (env) {
    // opts should include: environment
    super(env);

    this._env = util.urlParams.pubsub_environment || env;

    this._clientReady = false;
    this._hasDisconnected = false;
    this._queuedRequests = [];

    this._numDisconnects = 0;

    if (util.inIframe() && twitchUrlRegexp.test(document.referrer)) {
      // check parent location, if ok, create iframe with specified domain
      logger.debug("Driver is in an iframe");
      this._client = new IframeClient({
        parentUrl: document.referrer
      });
      this._clientType = "iframe-verified";
    } else {
      logger.debug("Driver is not in an iframe");
      this._client = new WebsocketClient({
        env: this._env
      });
      this._iframeHost = new IframeHost(this._client);
      this._clientType = "ws";
    }

    // Pubsub Tester
    if (util.urlParams.force_pubsub_tester === "true") {
      pctTester = 1.0;
    } else if (util.urlParams.force_pubsub_tester === "false") {
      pctTester = 0.0;
    }
    if (Math.random() < pctTester) {
      // Defer starting the test to avoid wasting resources during page load.
      window.setTimeout(this.runTest.bind(this), DEFER_TEST_TIME);
    }

    this._client.on("unverified", this._clientUnverified, this);
    this._client.on("verified", this._clientVerified, this);
    this._client.verify();
  }

  runTest () {
    this._tester = new PubsubTest({
      env: this._env,
      driver: this
    });
  }

  connect () {
    // return this._client.connect();
  }

  Listen (opts) {
    if (this._clientReady) {
      this._client.Listen(opts);
    } else {
      this._queuedRequests.push({type: "LISTEN", opts: opts});
    }
  }

  Unlisten (opts) {
    if (this._clientReady) {
      this._client.Unlisten(opts);
    } else {
      this._queuedRequests.push({type: "UNLISTEN", opts: opts});
    }
  }

  simulateReceivedMessage(topic, message) {
    const msg = {
      data: {message, topic},
      type: "MESSAGE-SIMULATED"
    };
    this._client._onMessage(msg);
  }

  _flushQueuedRequests () {
    logger.debug("Flushing " + this._queuedRequests.length + " queued requests");
    while (this._queuedRequests.length > 0) {
      var req = this._queuedRequests.shift();
      switch (req.type) {
      case "LISTEN":
        this._client.Listen(req.opts);
        break;
      case "UNLISTEN":
        this._client.Unlisten(req.opts);
        break;
      }
    }
  }

  _clientConnected () {
    logger.debug("Client connected");
    this._client.on("disconnected", this._clientDisconnected, this);
    this._trigger("connected");
    if (this._hasDisconnected) {
      this._trigger("reconnected");
    }
    this._clientReady = true;
    this._flushQueuedRequests();
  }

  _clientDisconnected () {
    logger.debug("Client disconnected");
    this._trigger("disconnected");
    this._clientReady = false;
    this._numDisconnects += 1;
    this._hasDisconnected = true;
  }

  _clientVerified () {
    logger.debug("Client verified (type = " + this._clientType + ")");
    this._client.on("connected", this._clientConnected, this);
    this._client.connect();
  }

  _clientUnverified () {
    // only triggered by iframe clients
    logger.debug("Unverified IframeClient");
    this._client.off("verified", this._clientVerified, this);
    this._client.off("unverified", this._clientUnverified, this);

    this._client = new WebsocketClient({
        env: this._env
      });
    this._clientType = "iframe-unverified";

    this._client.on("unverified", this._clientUnverified, this);
    this._client.on("verified", this._clientVerified, this);
    this._client.verify();
  }
}

window.__Twitch__pubsubInstances = window.__Twitch__pubsubInstances || {
  production: null,
  staging: null,
  darklaunch: null
};

function getInstance(env) {
  if (env !== "production" && env !== "staging" && env !== "darklaunch") {
    throw "Invalid Pubsub instance environment";
  }
  if (window.__Twitch__pubsubInstances[env] === null) {
    // create driver
    window.__Twitch__pubsubInstances[env] = new PubsubDriver(env);
  }
  return window.__Twitch__pubsubInstances[env];
}

export default {getInstance};

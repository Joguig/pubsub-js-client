import logging from "./log";

const TWITCH_PROTOCOL = "pubsub";
const ORPHAN_CHECK_INTERVAL = 10000;

var logger = logging._getLogger("IframeHost");

class IframeHost {
  constructor (driver) {
    this._driver = driver;
    this._sources = [];
    this._listeners = [];
    this._driver.on("connected", this.handleConnected, this);
    this._driver.on("disconnected", this.handleDisconnected, this);
    window.addEventListener("message", this.receiveMessage.bind(this), false);

    // Periodically check to see if we have any orphaned listeners
    this._orphanedListenerCheckTimer = setInterval(this._checkOrphanedListeners.bind(this), ORPHAN_CHECK_INTERVAL);
  }

  destroy () {
    clearInterval(this._orphanedListenerCheckTimer);
  }

  receiveMessage (event) {
    if (!event.data || event.data.twitch_protocol != TWITCH_PROTOCOL || !event.source) {
      return;
    }
    logger.debug("Received message: " + JSON.stringify(event.data));
    switch (event.data.type) {
    case "LISTEN":
      this.handleListen(event.source, event.data.nonce, event.data.data);
      break;
    case "UNLISTEN":
      this.handleUnlisten(event.source, event.data.nonce, event.data.data);
      break;
    case "connect":
      this._sources.push(event.source);
      this._driver.connect();
      break;
    case "verify":
      event.source.postMessage({
        twitch_protocol: TWITCH_PROTOCOL,
        type: "verify"
      }, "*");
      break;
    }
  }

  // Keeps track of which sources are listening to which topics
  // Returns an object containing the source, topic, and onMessage callback
  // If a listener already exists for the specified source and topic, returns null
  _pushListener (source, topic) {
    // If we've already got a listener for this source and topic we don't need to create another one
    for (var i = 0; i < this._listeners.length; i++) {
      if (this._listeners[i].source === source && this._listeners[i].topic === topic) {
        return null;
      }
    }

    var listener = {
      source: source,
      topic: topic,
      message: function (msg) {
        source.postMessage({twitch_protocol: TWITCH_PROTOCOL, type: "message", topic: topic, message: msg}, "*");
      }
    };

    this._listeners.push(listener);

    return listener;
  }

  // Untracks and returns the listener for the given source and topic
  // If no listener is found for the specified source and topic, returns null
  _popListener (source, topic) {
    for (var i = 0; i < this._listeners.length; i++) {
      if (this._listeners[i].source === source && this._listeners[i].topic === topic) {
        return this._listeners.splice(i, 1)[0];
      }
    }

    return null;
  }

  // Checks to see if any of the registered listeners have a source that has been deleted
  // Calls Unlisten on any listeners that are found
  _checkOrphanedListeners () {
    for (var i = 0; i < this._listeners.length; i++) {
      // source is a reference to the window that sent the postMessage
      if (this._listeners[i].source.closed) {
        this._cleanUpOrphanedListener(this._listeners.splice(i--, 1)[0]);
      }
    }
  }

  // Call Unlisten for the supplied listener with local logging as callback because the listener passed in has no source
  _cleanUpOrphanedListener (listener) {
    logger.debug("Cleaning up orphaned listener for topic: " + listener.topic);
    this._driver.Unlisten({
      topic: listener.topic,
      success: (function () {
        logger.debug("Success when cleaning up orphaned listener for topic: " + listener.topic);
      }),
      failure: (function (err) {
        logger.debug("Error when cleaning up orphaned listener for topic: " + listener.topic + " Error: " + err);
      }),
      message: listener.message
    });
  }

  handleListen (source, nonce, data) {
    var listener = this._pushListener(source, data.topics[0]);

    // We already have a listener for this source and topic so just send back the success message
    if (!listener) {
      source.postMessage({twitch_protocol: TWITCH_PROTOCOL, type: "success", nonce: nonce}, "*");
      return;
    }

    this._driver.Listen({
      topic: listener.topic,
      auth: data.auth_token,
      success: (function () {
        source.postMessage({twitch_protocol: TWITCH_PROTOCOL, type: "success", nonce: nonce}, "*");
      }),
      failure: (function (err) {
        source.postMessage({twitch_protocol: TWITCH_PROTOCOL, type: "failure", nonce: nonce, error: err}, "*");
      }),
      message: listener.message
    });
  }

  handleUnlisten (source, nonce, data) {
    var listener = this._popListener(source, data.topics[0]);

    if (!listener) {
      logger.debug("Failed to unlisten, could not find listener for topic " + data.topics[0]);
      return;
    }

    this._driver.Unlisten({
      topic: listener.topic,
      auth: data.auth_token,
      success: (function () {
        source.postMessage({twitch_protocol: TWITCH_PROTOCOL, type: "success", nonce: nonce}, "*");
      }),
      failure: (function (err) {
        source.postMessage({twitch_protocol: TWITCH_PROTOCOL, type: "failure", nonce: nonce, error: err}, "*");
      }),
      message: listener.message
    });
  }

  handleConnected () {
    for (var i = 0; i < this._sources.length; i++) {
      this._sources[i].postMessage({
        twitch_protocol: TWITCH_PROTOCOL,
        type: "connected"
      }, "*");
    }
  }

  handleDisconnected () {
    for (var i = 0; i < this._sources.length; i++) {
      this._sources[i].postMessage({
        twitch_protocol: TWITCH_PROTOCOL,
        type: "disconnected"
      }, "*");
    }
  }
}

export default IframeHost;

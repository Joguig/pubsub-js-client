/* globals $ */

import util from "./util";
import logging from "./log";

const pubsterAddrProduction = "https://pubster.twitch.tv/publish";
const pubsterAddrDarklaunch = "https://pubster-darklaunch.twitch.tv/publish";

const uniqueKey = "pubsubtest.unique.";
const sharedKey = "pubsubtest.shared." + util.randomInt(10); // 10 topics
const pctPublishShared = 0.0001;

const publishIntervalTime = 60 * 1000; // 60 seconds
const ajaxTimeout = 30 * 1000; // 30 seconds

const sampleRateSuccess = 0.1;
const sampleRateFailure = 1.0;

var logger = logging._getLogger("PubsubTest");

class PubsubTest {
  constructor (opts) {
    if (!window.$) {
      logger.debug("PubsubTest could not be enabled. JQuery is undefined.");
      return;
    }

    logger.debug("PubsubTest enabled");
    this._env = opts.env;
    this._driver = opts.driver;

    switch (this._env) {
    case "production":
      this._addr = pubsterAddrProduction;
      break;
    case "darklaunch":
      this._addr = pubsterAddrDarklaunch;
      break;
    default:
      this._env = "production";
      this._addr = pubsterAddrProduction;
    }

    this._statKeys = {
      uniqueSuccess: "test.unique.success",
      uniqueFailure: "test.unique.failure",
      sharedSuccess: "test.shared.success",
      sharedFailure: "test.shared.failure"
    };

    this._uniqueKey = uniqueKey + util.generateString(20);
    this._sharedKey = sharedKey;

    this._listeningUnique = this._listeningShared = false;
    this.sendListens();
  }

  sendListens () {
    this._driver.Listen({
      topic: this._uniqueKey,
      auth: "",
      success: this._gotUniqueOk.bind(this),
      failure: this._gotUniqueFail.bind(this),
      message: this._gotUniqueMessage.bind(this)
    });

    this._driver.Listen({
      topic: this._sharedKey,
      auth: "",
      success: this._gotSharedOk.bind(this),
      failure: this._gotSharedFail.bind(this),
      message: this._gotSharedMessage.bind(this)
    });
  }

  _gotUniqueOk () {
    this._listeningUnique = true;
    if (this._listeningShared) {
      this.startTesting();
    }
  }

  _gotUniqueFail (err) {
    // Ignore
  }

  _gotSharedOk () {
    this._listeningShared = true;
    if (this._listeningUnique) {
      this.startTesting();
    }
  }

  _gotSharedFail (err) {
    // Ignore
  }

  startTesting() {
    logger.debug("startTesting");
    this._driver.on("connected", this.resumeTesting, this);
    this._driver.on("disconnected", this.stopTesting, this);
    this.checkAndSend();
    this._publishInterval = window.setInterval(this.checkAndSend.bind(this), publishIntervalTime);
  }

  resumeTesting() {
    logger.debug("resumeTesting");
    this.checkAndSend();
    this._publishInterval = window.setInterval(this.checkAndSend.bind(this), publishIntervalTime);
  }

  stopTesting() {
    logger.debug("stopTesting");
    clearInterval(this._publishInterval);
    this._receivedUniqueMessage = this._sentUniqueMessage = false;
    this._receivedSharedMessage = this._sentSharedMessage = false;
  }

  checkAndSend() {
    logger.debug("checkAndSend: unique: sent = " + this._sentUniqueMessage + ", received = " + this._receivedUniqueMessage);
    if (!this._receivedUniqueMessage && this._sentUniqueMessage) {
      // log unique error
      logger.debug("unique failure");
    }
    if (!this._receivedSharedMessage && this._sentSharedMessage) {
      // log shared error
      logger.debug("shared failure");
    }

    this._receivedUniqueMessage = this._sentUniqueMessage = false;
    this._receivedSharedMessage = this._sentSharedMessage = false;

    this._expectedMessage = util.generateString(30);

    // publish unique message to testPub
    $.ajax({
      type: "POST",
      url: this._addr,
      contentType: "application/json",
      timeout: ajaxTimeout,
      data: JSON.stringify({
        topics: [this._uniqueKey],
        data: this._expectedMessage
      }),
      success: (function () {
        logger.debug("unique message sent");
        this._sentUniqueMessage = true;
      }).bind(this)
    });
    this._sentUniqueMessageTime = util.time.now();

    // potentially publish shared message
    if (Math.random() < pctPublishShared) {
      $.ajax({
        type: "POST",
        url: this._addr,
        contentType: "application/json",
        timeout: ajaxTimeout,
        data: JSON.stringify({
          topics: [this._sharedKey],
          data: this._expectedMessage
        }),
        success: (function () {
          logger.debug("shared message sent");
          this._sentSharedMessage = true;
        }).bind(this)
      });
      this._sentSharedMessageTime = util.time.now();
    }
  }

  _gotUniqueMessage (msg) {
    logger.debug("received unique message: " + msg);
    if (msg === this._expectedMessage) {
      var rtt = util.time.now() - this._sentUniqueMessageTime;
      this._receivedUniqueMessage = true;
    }
  }

  _gotSharedMessage (msg) {
    if (msg === this._expectedMessage) {
      var rtt = util.time.now() - this._sentSharedMessageTime;
      this._receivedSharedMessage = true;
    }
  }

}

export default PubsubTest;


var util = {};

util.randomInt = function (max) {
  return Math.floor(Math.random() * max);
};

util.time = {
  seconds: function (num) {
    return num * 1000;
  },

  now: function () {
    return new Date().getTime();
  }
};

util.urlParams = (function () {
  var urlParams = {};
  var params = window.location.search.substr(1);
  var keyValues = params.split("&");
  for (var i = 0; i < keyValues.length; ++i) {
    var keyValue = keyValues[i].split("=");
    try {
      urlParams[decodeURIComponent(keyValue[0])] = keyValue.length > 1 ? decodeURIComponent(keyValue[1]) : "";
    } catch (e) {
      // Sometimes decodeURIComponent throws errors if weird chars are in the URL
    }
  }
  return urlParams;
}());

util.generateString = function (len) {
  var text = "";
  var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (var i = 0; i < len; i++) {
    text += possible.charAt(util.randomInt(possible.length));
  }
  return text;
};

util.inIframe = function () {
  try {
    return window.self !== window.top;
  } catch (e) {
    // Sometimes browsers block an iframe's access to window.top
    return true;
  }
};

export default util;

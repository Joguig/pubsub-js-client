# pubsub-js-client

This is the library to integrate with our new PubSub service.

## Installation

Make sure you are running node version `8.17.0` as more modern versions do not work.

```bash
make build
```

This generates `dist/pubsub.js` which is in AMD.

## Browser parameters

* `pubsub_log_level` Set this to `debug` to see all messages in console logs
* `force_pubsub_tester` Set this to `false` to disable pubsub_tester messages

## Client API

##### Instantiation
```javascript
let driver = PubsubDriver.getInstance(environment); // environment can be "production" or "darklaunch"

// Driver automatically connects to Pubsub on instantiation

driver.on("connected", function () { ... });
// Triggered when the driver first connects
// Also triggered upon recovering from a disconnect
driver.on("reconnected", function() { ... });
// Triggered when the driver recovers from a disconnect
driver.on("disconnected", function () { ... });
// Triggered when the driver loses connection to the Pubsub
// Driver automatically attempts to reconnect and re-listen on topics
```
##### Methods
```javascript
driver.Listen({
  topic: "topic",
  auth: "auth_token",
  success: function (), // callback when Driver has successfully listened on the topic
  failure: function (err), // callback when there was an error listening - either a permissions error, or a timeout
  message: function (msg) // callback when a message is received on this topic
});

driver.Unlisten({
  topic: "topic",
  success: function (), // callback when the Driver has successfully unlistened on the topic
  failure: function (err), // callback when there was an error unlistening
  message: function (msg) // a reference to the callback used in the initial Listen(), to specify which callback to remove
})
```

##### Example
```javascript
let driver = PubsubDriver.getInstance("production");
driver.Listen({
  topic: "pubsubtest.123456",
  success: function () { console.log("successfully listened"); },
  failure: function (err) { console.log("error listening: " + err); },
  message: function (msg) { console.log("received message: " + msg); }
});
```
```bash
curl -v -X POST https://pubster.twitch.tv/publish -d '{"topics":["pubsubtest.123456"],"data":"arbitrary string"}'
```

##### Troubleshooting
Try `let driver = PubsubDriver.default.getInstance("production");` (add `.default.`)

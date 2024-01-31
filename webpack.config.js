var path = require('path');
module.exports = {
  entry: './src/PubsubDriver.js',
  output: {
    library: "pubsub",
    libraryTarget: "umd",
    path: "./dist/",
    filename: 'pubsub.js'
  },
  module: {
    loaders: [
      { test: /\.js$/,
        loader: 'babel-loader',
        query: {
          presets: ['es2015']
        }
      }
    ]
  }
};
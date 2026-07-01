const path = require('path');

module.exports = {
  entry: path.join(__dirname, 'src', 'index'),
  output: {
    path: path.join(__dirname, 'dist'),
    publicPath: '/dist/',
    filename: "AframeNft.js",
    chunkFilename: '[name].js'
  },
  module: {
    rules: [{
      test: /\.js?$/,
      include: path.resolve(__dirname, 'src'),
      exclude: /node_modules/,
      loader: 'babel-loader',
      options: {
        presets: [
          ["@babel/env", {
            "targets": {
              "browsers": "last 2 chrome versions"
            }
          }]
        ]
      }
    }]
  },
  resolve: {
    extensions: ['.json', '.js', '.jsx']
  },
  devtool: 'source-map',
  devServer: {
    // Serve the whole project so examples/ (HTML, config.json, DataNFT) load
    // alongside the bundle at /dist/.
    static: path.join(__dirname),
    host: 'localhost',
    port: 8080,
    open: ['/examples/basic.html'],
  }
};
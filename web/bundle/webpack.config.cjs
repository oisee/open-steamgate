const path = require("node:path");
const webpack = require("/home/alice/dev/open-steamgate-shlp/node_modules/webpack");

// The transpiled ABAP of oisee/vivid-vibes, for a page with no server: after
// open-steamgate's webpack.config.cjs, which is after larshp/hithub's (MIT).
module.exports = {
  mode: "development",
  target: "web",
  entry: path.resolve(__dirname, "web/entry.mjs"),
  output: {path: path.resolve(__dirname, "build"), filename: "vivid.js"},
  devtool: false,
  experiments: {topLevelAwait: true},
  performance: {hints: false},
  optimization: {minimize: false},
  resolve: {
    extensions: [".mjs", ".js"],
    modules: [path.resolve("/home/alice/dev/open-steamgate-shlp/node_modules"), "node_modules"],
    fallback: {
      assert: require.resolve("/home/alice/dev/open-steamgate-shlp/node_modules/assert/"),
      buffer: require.resolve("/home/alice/dev/open-steamgate-shlp/node_modules/buffer/"),
      crypto: require.resolve("/home/alice/dev/open-steamgate-shlp/node_modules/crypto-browserify"),
      events: require.resolve("/home/alice/dev/open-steamgate-shlp/node_modules/events/"),
      http: require.resolve("/home/alice/dev/open-steamgate-shlp/node_modules/stream-http"),
      https: require.resolve("/home/alice/dev/open-steamgate-shlp/node_modules/https-browserify"),
      os: require.resolve("/home/alice/dev/open-steamgate-shlp/node_modules/os-browserify/browser"),
      path: require.resolve("/home/alice/dev/open-steamgate-shlp/node_modules/path-browserify"),
      process: require.resolve("/home/alice/dev/open-steamgate-shlp/node_modules/process/browser"),
      stream: require.resolve("/home/alice/dev/open-steamgate-shlp/node_modules/stream-browserify"),
      string_decoder: require.resolve("/home/alice/dev/open-steamgate-shlp/node_modules/string_decoder/"),
      url: require.resolve("/home/alice/dev/open-steamgate-shlp/node_modules/url/"),
      util: require.resolve("/home/alice/dev/open-steamgate-shlp/node_modules/util/"),
      vm: require.resolve("/home/alice/dev/open-steamgate-shlp/node_modules/vm-browserify"),
      zlib: require.resolve("/home/alice/dev/open-steamgate-shlp/node_modules/browserify-zlib"),
      fs: false, net: false, tls: false, constants: false,
    },
  },
  module: {rules: [{test: /\.m?js$/, resolve: {fullySpecified: false}}]},
  plugins: [
    new webpack.NormalModuleReplacementPlugin(/^node:/, (r) => {
      r.request = r.request.replace(/^node:/, "");
    }),
    // the transpiler escapes a percent in a specifier; the file carries it raw
    new webpack.NormalModuleReplacementPlugin(/%25/, (r) => {
      r.request = path.resolve(__dirname, "output", r.request.replace(/^\.\//, "").replaceAll("%25", "%"));
    }),
    new webpack.ProvidePlugin({
      Buffer: ["buffer", "Buffer"],
      process: "process/browser",
    }),
    new webpack.optimize.LimitChunkCountPlugin({maxChunks: 1}),
  ],
};

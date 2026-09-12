const path = require("node:path");
const webpack = require("webpack");
const TerserPlugin = require("terser-webpack-plugin");

// Bundles the transpiled ABAP gateway into the service worker that serves the
// preview deployment (scripts/build-preview.mjs runs it). After
// larshp/hithub's webpack.config.cjs (MIT).
module.exports = {
  mode: "production",
  target: "webworker",
  entry: path.resolve(__dirname, "web/preview-worker.mjs"),
  output: {
    path: path.resolve(__dirname, "build"),
    filename: "sw.js",
    clean: true,
  },
  devtool: false,
  experiments: {topLevelAwait: true},
  performance: {hints: false},
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        extractComments: false,
        terserOptions: {
          // the runtime looks classes up by name
          keep_classnames: true,
          keep_fnames: true,
          mangle: {keep_classnames: true, keep_fnames: true},
        },
      }),
    ],
  },
  resolve: {
    extensions: [".mjs", ".js"],
    alias: {
      // the asm.js build needs no separate .wasm file to deploy and route
      "sql.js$": require.resolve("sql.js/dist/sql-asm.js"),
    },
    fallback: {
      assert: require.resolve("assert/"),
      buffer: require.resolve("buffer/"),
      constants: require.resolve("constants-browserify"),
      crypto: require.resolve("crypto-browserify"),
      events: require.resolve("events/"),
      http: require.resolve("stream-http"),
      https: require.resolve("https-browserify"),
      os: require.resolve("os-browserify/browser"),
      path: require.resolve("path-browserify"),
      process: require.resolve("process/browser"),
      stream: require.resolve("stream-browserify"),
      string_decoder: require.resolve("string_decoder/"),
      url: require.resolve("url/"),
      util: require.resolve("util/"),
      vm: require.resolve("vm-browserify"),
      zlib: require.resolve("browserify-zlib"),
      fs: false,
      net: false,
      tls: false,
    },
  },
  module: {
    rules: [{test: /\.m?js$/, resolve: {fullySpecified: false}}],
  },
  plugins: [
    new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
      resource.request = resource.request.replace(/^node:/, "");
    }),
    // The transpiler percent-escapes namespaces in imports (%23iwbep%23...),
    // the files on disk carry the # itself.
    new webpack.NormalModuleReplacementPlugin(/%23/, (resource) => {
      const filename = resource.request.replace(/^\.\//, "").replaceAll("%23", "#");
      resource.request = path.resolve(__dirname, "output", filename);
    }),
    // DuckDB is a native module the browser never takes; keep it out of the bundle
    new webpack.IgnorePlugin({resourceRegExp: /duckdb-client\.mjs$/}),
    new webpack.ProvidePlugin({
      Buffer: ["buffer", "Buffer"],
      process: "process/browser",
    }),
    new webpack.optimize.LimitChunkCountPlugin({maxChunks: 1}),
  ],
};

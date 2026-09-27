const path = require("node:path");
const preview = require("../../../webpack.config.cjs");

module.exports = {
  ...preview,
  entry: path.resolve(__dirname, "extension.mjs"),
  output: {
    path: path.resolve(__dirname, "../dist/web"),
    filename: "extension.js",
    clean: true,
    globalObject: "self",
    library: {type: "commonjs"},
  },
  externals: {vscode: "commonjs vscode"},
};

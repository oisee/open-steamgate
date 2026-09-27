import {createRequire} from "node:module";
import {resolve} from "node:path";
import {stat} from "node:fs/promises";

const root = resolve(import.meta.dirname, "..");
for (const file of ["output/init.mjs", "web/generated/seed.mjs", "web/generated/services.mjs"]) {
  await stat(resolve(root, file)).catch(() => {
    throw new Error(`${file} is missing; run npm run web:vscode to transpile and generate the gateway first`);
  });
}
const require = createRequire(import.meta.url);
const webpack = require("webpack");
const config = require(resolve(root, "editors/vscode/web/webpack.config.cjs"));
const result = await new Promise((resolveBuild, reject) => webpack(config, (error, stats) => {
  if (error) reject(error);
  else if (stats.hasErrors()) reject(new Error(stats.toString({colors: false, errorDetails: true})));
  else resolveBuild(stats);
}));
console.log(result.toString({colors: false, preset: "minimal"}));
const file = resolve(root, "editors/vscode/dist/web/extension.js");
const bytes = (await stat(file)).size;
console.log(`VS Code web bundle: ${bytes} bytes (${(bytes / 1048576).toFixed(2)} MiB)`);

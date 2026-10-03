"use strict";
// One bounded worker owns parsing, type resolution and disk reads. Never load
// abaplint on the extension host. The VSIX has an independent scanner runtime.
const {parentPort, workerData} = require("node:worker_threads");
const fs = require("node:fs/promises");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
(async () => {
  const {file, buffers, scanner} = workerData;
  const dir = path.dirname(file);
  const prefix = path.basename(file).split(".").slice(0, 2).join(".").toLowerCase();
  const sources = new Map();
  for (const name of (await fs.readdir(dir)).sort()) {
    if (name.toLowerCase().startsWith(prefix + ".") && /\.(abap|xml)$/i.test(name))
      sources.set(name, await fs.readFile(path.join(dir, name), "utf8"));
  }
  for (const buffer of buffers) {
    if (path.dirname(buffer.file) === dir && path.basename(buffer.file).toLowerCase().startsWith(prefix + "."))
      sources.set(path.basename(buffer.file), buffer.source);
  }
  const {kernelWarnings} = await import(pathToFileURL(scanner).href);
  parentPort.postMessage({warnings: kernelWarnings([...sources].map(([file, source]) => ({file, source}))) });
})().catch((error) => parentPort.postMessage({error: String(error.message ?? error)}));

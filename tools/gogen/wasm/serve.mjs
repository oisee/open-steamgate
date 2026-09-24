// Serves previews as plain static files, each under a mount of its own, so
// their service workers do not share a scope:
//   node tools/gogen/wasm/serve.mjs <port> /go=<dir> [/js=<dir> ...]
import express from "express";

const [port, ...mounts] = process.argv.slice(2);
const app = express();
app.disable("x-powered-by");
for (const m of mounts) {
  const [path, dir] = m.split("=");
  app.use(path, express.static(dir));
}
app.listen(Number(port), "127.0.0.1", () => console.log(`static previews on http://127.0.0.1:${port}/ (${mounts.join(", ")})`));

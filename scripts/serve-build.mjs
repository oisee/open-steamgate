// Serves build/ the way a static host would, for a local look at the preview
// and for test/e2e/preview.spec.mjs. STG_PREVIEW_PORT, default 3031.
//
// HTTPS beside it, because a service worker only registers in a secure
// context: https, or localhost. That is fine on this machine and fatal from
// another one — over plain http to an address that is not localhost, the
// worker never registers, nothing intercepts, and every request 404s against
// the static files. The symptom looks like a broken build rather than a
// refused registration, which is why this serves both and says so.
import express from "express";
import {createServer as createHttpsServer} from "node:https";
import {fileURLToPath} from "node:url";
import {networkInterfaces} from "node:os";
import {credentials as tlsCredentials, fingerprint as tlsFingerprint, TLS_DIR} from "../tools/osd-tls.mjs";

const app = express();
app.disable("x-powered-by");
const build = fileURLToPath(new URL("../build/preview", import.meta.url));
// This local server exposes the same build at / and at the GitHub Pages
// mount. Entering at / and then navigating into the mount otherwise creates
// two overlapping service-worker scopes; direct visitors should start with
// the canonical mounted scope.
app.get("/", (_request, response) => response.redirect(302, "/open-steamgate/main/index.html"));
// The second mount is not decoration: GitHub Pages serves this project below
// /open-steamgate/<deployment>/.  Testing only at / lets an accidental
// absolute fetch("/sap/...") pass locally and fail after publication.
app.use("/open-steamgate/main", express.static(build));
app.use(express.static(build));

const port = Number(process.env.STG_PREVIEW_PORT ?? 3031);
const tlsPort = Number(process.env.STG_PREVIEW_TLS_PORT ?? port + 1);

app.listen(port, () => console.log(`preview build on http://localhost:${port}/`));

// A preview may need a certificate for a LAN address that was assigned after
// the main OSD certificate was minted. Keep its key separate from the main
// service's key so starting a demo cannot rotate another running listener.
const previewCertRoot = process.env.STG_PREVIEW_CERT_ROOT ?? process.cwd();
const tls = process.env.STG_TLS === "0" ? undefined : tlsCredentials(previewCertRoot);
if (tls !== undefined) {
  // Public certificate only, never the private key. A second computer must
  // trust this certificate before its browser will register the worker.
  app.get("/osd-preview.crt", (_request, response) => response.type("application/x-x509-ca-cert").send(tls.cert));
}
if (tls === undefined) {
  console.log("No TLS: run `npm run osd:tls` to make a certificate. Without it");
  console.log("the preview works on this machine only, because a service worker");
  console.log("needs https anywhere else.");
} else {
  createHttpsServer(tls, app).listen(tlsPort, () => {
    console.log(`preview build on https://localhost:${tlsPort}/`);
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.internal === false && address.family === "IPv4") {
          console.log(`                  https://${address.address}:${tlsPort}/   (from another machine)`);
        }
      }
    }
    console.log(`the certificate is ${previewCertRoot}/${TLS_DIR}/osd.crt, sha256 ${tlsFingerprint(previewCertRoot)}`);
    console.log("another machine must trust it, or the worker will not register");
  });
}

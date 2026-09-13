// The certificate OSD serves HTTPS with.
//
// Eclipse refuses a plain-HTTP ABAP Cloud project outright, so TLS is not a
// nicety here: without it that client cannot reach OSD at all. A local system
// has no certificate authority behind it and wants none, so this makes a
// self-signed one, and the client is told to trust it once.
//
// The key never leaves .local/, which is not this repository's git. A
// certificate committed to a public repository is a certificate anybody can
// impersonate, and it costs one command to make another.
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync} from "node:fs";
import {networkInterfaces} from "node:os";
import {join} from "node:path";

export const TLS_DIR = ".local/tls";
export const KEY = "osd.key";
export const CERT = "osd.crt";

// Java, which is what Eclipse runs on, rejects a certificate that names its
// host only in the common name; the subject alternative name is the one it
// reads. So both spellings of this machine go in it.
const SUBJECT = "/CN=localhost/O=open-steamgate/OU=OSD";

// Every address this machine can be reached on, not only the loopback. The
// case that needs it: a client on the host operating system reaching a server
// inside a Linux subsystem, where the address it dials is this machine's own
// network address and a certificate naming only localhost is rejected.
function subjectAltName() {
  const names = ["DNS:localhost", "DNS:osd", "IP:127.0.0.1", "IP:::1"];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.internal === false && address.family === "IPv4") {
        names.push("IP:" + address.address);
      }
    }
  }
  return "subjectAltName=" + names.join(",");
}

export function paths(root = process.cwd()) {
  return {dir: join(root, TLS_DIR), key: join(root, TLS_DIR, KEY), cert: join(root, TLS_DIR, CERT)};
}

export function exists(root = process.cwd()) {
  const {key, cert} = paths(root);
  return existsSync(key) && existsSync(cert);
}

// the key and certificate as Node wants them, or undefined when there are none
export function credentials(root = process.cwd()) {
  if (exists(root) === false) {
    return undefined;
  }
  const {key, cert} = paths(root);
  return {key: readFileSync(key), cert: readFileSync(cert)};
}

export function generate(root = process.cwd(), options = {}) {
  const {dir, key, cert} = paths(root);
  if (exists(root) === true && options.force !== true) {
    return {key, cert, created: false};
  }
  mkdirSync(dir, {recursive: true});
  execFileSync("openssl", [
    "req", "-x509",
    "-newkey", "rsa:2048",
    "-keyout", key,
    "-out", cert,
    "-days", String(options.days ?? 3650),
    "-nodes",
    "-subj", SUBJECT,
    "-addext", subjectAltName(),
  ], {stdio: "pipe"});
  return {key, cert, created: true};
}

// the fingerprint a person compares against what a client shows them
// what the certificate says it is good for, which is the question a person
// asks when a client rejects it
export function hosts(root = process.cwd()) {
  const {cert} = paths(root);
  if (existsSync(cert) === false) {
    return [];
  }
  const text = execFileSync("openssl", ["x509", "-in", cert, "-noout", "-ext", "subjectAltName"], {encoding: "utf8"});
  return text.split("\n").slice(1).join(" ").split(",").map((p) => p.trim()).filter((p) => p !== "");
}

export function fingerprint(root = process.cwd()) {
  const {cert} = paths(root);
  if (existsSync(cert) === false) {
    return undefined;
  }
  return execFileSync("openssl", ["x509", "-in", cert, "-noout", "-fingerprint", "-sha256"], {encoding: "utf8"})
    .trim()
    .replace(/^.*=/, "");
}

if (process.argv[1]?.endsWith("osd-tls.mjs")) {
  const force = process.argv.includes("--force");
  const result = generate(process.cwd(), {force});
  console.log(`${result.created ? "written" : "already there"}: ${result.key}, ${result.cert}`);
  console.log(`sha256 ${fingerprint()}`);
  console.log(`good for ${hosts().join(", ")}`);
  console.log("self-signed: a client will ask once whether to trust it");
}

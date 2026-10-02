// The system listens on loopback unless OSD_BIND says otherwise
// (tools/osd-bind.mjs). The ADT facade takes any credentials and the RFC
// bridge runs in demo mode, which is only fine while nothing but this machine
// reaches them; a container sets OSD_BIND=0.0.0.0.
//
// The front is started for real (test/run.mjs, the path `npm start`, `osd up`
// and the VS Code launcher take). It needs no transpiled output to open its
// listener: the serving child fails to start without one and the front keeps
// answering, which is all a bind test asks of it.
import {expect} from "chai";
import {spawn} from "node:child_process";
import {connect, createServer as createNetServer} from "node:net";
import {createServer as createHttpServer, get as httpGet} from "node:http";
import {createServer as createHttpsServer, get as httpsGet} from "node:https";
import {mkdtempSync, rmSync} from "node:fs";
import {networkInterfaces, tmpdir} from "node:os";
import {join} from "node:path";
import {bindAddresses, bindHost, listenBound} from "../tools/osd-bind.mjs";
import {credentials, generate} from "../tools/osd-tls.mjs";
import {closeProtocols, listenProtocols} from "../tools/protocols/server.mjs";

// an IPv4 address of this host that is not loopback, or undefined
function outside() {
  for (const list of Object.values(networkInterfaces())) {
    for (const one of list ?? []) {
      if (one.family === "IPv4" && one.internal === false) return one.address;
    }
  }
  return undefined;
}

const hasV6Loopback = await new Promise((resolve) => {
  const probe = createNetServer().once("error", () => resolve(false));
  probe.listen(0, "::1", () => probe.close(() => resolve(true)));
});

function reachable(host, port) {
  return new Promise((resolve) => {
    const socket = connect({host, port, timeout: 2000});
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
  });
}

// an HTTP answer, any status: the host resolved and the listener took it
function answers(url, options = {}) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith("https:") ? httpsGet : httpGet;
    const request = get(url, {timeout: 5000, rejectUnauthorized: false, ...options}, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.once("error", reject);
    request.once("timeout", () => request.destroy(new Error(`timeout: ${url}`)));
  });
}

async function freePort() {
  const probe = createNetServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const {port} = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function front(env) {
  const port = await freePort();
  const childEnv = {...process.env, STG_PORT: String(port), STG_TLS: "0", STG_DB: "sqlite", STG_PROTOCOLS: "0", ...env};
  for (const key of Object.keys(childEnv)) {
    if (childEnv[key] === undefined) delete childEnv[key];
  }
  const child = spawn(process.execPath, ["test/run.mjs"], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk; });
  child.stderr.on("data", (chunk) => { log += chunk; });
  for (let i = 0; i < 200 && !/Listening on/.test(log); i++) {
    if (child.exitCode !== null) throw new Error(`front exited: ${log}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // the line is printed right after listen() is called: wait for the socket
  for (let i = 0; i < 50 && !await reachable("127.0.0.1", port); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return {port, child, log: () => log};
}

function stop(one) {
  if (one === undefined || one.child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    one.child.once("exit", resolve);
    one.child.kill("SIGTERM");
    setTimeout(() => one.child.kill("SIGKILL"), 5000).unref();
  });
}

describe("bind address (OSD_BIND)", function () {
  this.timeout(60000);

  it("is loopback unless set, and the literal address otherwise", () => {
    expect(bindHost({})).to.equal("127.0.0.1");
    expect(bindHost({OSD_BIND: "localhost"})).to.equal("127.0.0.1");
    expect(bindAddresses({})).to.deep.equal(["127.0.0.1", "::1"]);
    expect(bindAddresses({OSD_BIND: "127.0.0.1"})).to.deep.equal(["127.0.0.1"]);
    expect(bindHost({OSD_BIND: "0.0.0.0"})).to.equal("0.0.0.0");
    expect(bindAddresses({OSD_BIND: " :: "})).to.deep.equal(["::"]);
  });

  describe("the HTTP front (test/run.mjs)", () => {
    let one;
    afterEach(async () => { await stop(one); one = undefined; });

    it("binds 127.0.0.1 by default and is not reachable from another interface", async () => {
      one = await front({OSD_BIND: undefined});
      expect(await reachable("127.0.0.1", one.port)).to.equal(true);
      const address = outside();
      if (address !== undefined) {
        expect(await reachable(address, one.port), `reachable on ${address}`).to.equal(false);
      }
      expect(one.log()).to.match(/bound to 127\.0\.0\.1/);
    });

    it("answers a client that resolves localhost, to either loopback", async () => {
      one = await front({OSD_BIND: undefined});
      expect(await answers(`http://localhost:${one.port}/`)).to.be.a("number");
      expect(await answers(`http://localhost:${one.port}/`, {family: 4})).to.be.a("number");
      if (hasV6Loopback) {
        expect(await answers(`http://localhost:${one.port}/`, {family: 6})).to.be.a("number");
        expect(await reachable("::1", one.port)).to.equal(true);
      }
    });

    it("binds every interface with OSD_BIND=0.0.0.0", async function () {
      const address = outside();
      if (address === undefined) this.skip();
      one = await front({OSD_BIND: "0.0.0.0"});
      expect(await reachable(address, one.port)).to.equal(true);
      expect(await reachable("127.0.0.1", one.port)).to.equal(true);
      expect(one.log()).to.match(/bound to 0\.0\.0\.0/);
    });
  });

  describe("listenBound, as the HTTPS front uses it", () => {
    let root;
    let server;
    before(function () {
      root = mkdtempSync(join(tmpdir(), "osd-bind-"));
      try {
        generate(root);
      } catch {
        this.skip(); // no openssl
      }
    });
    after(() => rmSync(root, {recursive: true, force: true}));
    afterEach(async () => {
      if (server !== undefined) await new Promise((resolve) => server.close(resolve));
      server = undefined;
    });

    it("answers TLS on both loopbacks and on neither outside address", async () => {
      server = createHttpsServer(credentials(root), (req, res) => res.end("ok"));
      await new Promise((resolve) => listenBound(server, 0, {}, resolve));
      const {port, address} = server.address();
      expect(address).to.equal("127.0.0.1");
      expect(await answers(`https://127.0.0.1:${port}/`)).to.equal(200);
      if (hasV6Loopback) {
        // the twin is opened once the first listener is up
        for (let i = 0; i < 20 && !await reachable("::1", port); i++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(await answers(`https://[::1]:${port}/`)).to.equal(200);
      }
      const other = outside();
      if (other !== undefined) {
        expect(await reachable(other, port)).to.equal(false);
      }
    });

    it("binds one literal address when OSD_BIND names one", async () => {
      server = createHttpServer((req, res) => res.end("ok"));
      await new Promise((resolve) => listenBound(server, 0, {OSD_BIND: "127.0.0.1"}, resolve));
      const {port} = server.address();
      expect(server.address().address).to.equal("127.0.0.1");
      if (hasV6Loopback) {
        expect(await reachable("::1", port)).to.equal(false);
      }
    });
  });

  describe("the DIAG and RFC listeners (tools/protocols/server.mjs)", () => {
    it("bind loopback by default", async () => {
      const servers = await listenProtocols({INSTANCE: "11", STG_DIAG_PORT: "0", STG_RFC_PORT: "0", STG_PORT: "3030"});
      try {
        expect(servers.diag.address().address).to.equal("127.0.0.1");
        expect(servers.rfc.address().address).to.equal("127.0.0.1");
      } finally {
        await closeProtocols(servers);
      }
    });

    it("follow OSD_BIND, and STG_DIAG_HOST / STG_RFC_HOST still override it", async () => {
      const servers = await listenProtocols({INSTANCE: "11", STG_DIAG_PORT: "0", STG_RFC_PORT: "0", STG_PORT: "3030",
        OSD_BIND: "0.0.0.0", STG_RFC_HOST: "127.0.0.1"});
      try {
        expect(servers.diag.address().address).to.equal("0.0.0.0");
        expect(servers.rfc.address().address).to.equal("127.0.0.1");
      } finally {
        await closeProtocols(servers);
      }
    });
  });
});

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
import {bindAddresses, bindHost, listenBound, relisten} from "../tools/osd-bind.mjs";
import {forwardPorts} from "../tools/osd-tcp-forward.mjs";
import {existsSync, readFileSync, readdirSync, statSync} from "node:fs";
import {execFileSync} from "node:child_process";
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
      expect(one.log()).to.include("listening on localhost only; for the network set OSD_BIND=0.0.0.0");
    });

    it("answers a client that resolves localhost, to either loopback", async () => {
      one = await front({OSD_BIND: undefined});
      // /osd/serving is answered by the front itself, also while the
      // serving child is still booting
      expect(await answers(`http://localhost:${one.port}/osd/serving`, {timeout: 30000})).to.be.a("number");
      expect(await answers(`http://localhost:${one.port}/osd/serving`, {family: 4, timeout: 30000})).to.be.a("number");
      if (hasV6Loopback) {
        expect(await answers(`http://localhost:${one.port}/osd/serving`, {family: 6, timeout: 30000})).to.be.a("number");
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
      expect(one.log()).not.to.include("listening on localhost only");
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

  describe("the ::1 twin across close and listen", () => {
    const waitFor = async (check) => {
      for (let i = 0; i < 40; i++) {
        if (await check()) return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    };

    it("serves ::1 again after close and relisten", async function () {
      if (!hasV6Loopback) this.skip();
      const server = createHttpServer((req, res) => res.end("ok"));
      await new Promise((resolve) => listenBound(server, 0, {}, resolve));
      const {port} = server.address();
      expect(await waitFor(() => reachable("::1", port))).to.equal(true);
      await new Promise((resolve) => server.close(resolve));
      expect(await reachable("::1", port)).to.equal(false);
      await new Promise((resolve) => relisten(server, port, {}, resolve));
      try {
        expect(await waitFor(() => reachable("::1", port)), "::1 after relisten").to.equal(true);
        expect(await answers(`http://[::1]:${port}/`, {agent: false})).to.equal(200);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it("calls close back only after an active ::1 request has ended", async function () {
      if (!hasV6Loopback) this.skip();
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      let arrived;
      const inside = new Promise((resolve) => { arrived = resolve; });
      const server = createHttpServer(async (req, res) => {
        arrived();
        await held;
        res.end("late");
      });
      await new Promise((resolve) => listenBound(server, 0, {}, resolve));
      const {port} = server.address();
      expect(await waitFor(() => reachable("::1", port))).to.equal(true);
      const response = answers(`http://[::1]:${port}/`, {agent: false});
      await inside;
      let closed = false;
      const closing = new Promise((resolve) => server.close(() => { closed = true; resolve(); }));
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(closed, "close called back while a ::1 request was still running").to.equal(false);
      release();
      expect(await response).to.equal(200);
      await closing;
      expect(closed).to.equal(true);
    });
  });

  describe("forwarders and stands", () => {
    it("osd-tcp-forward listens on loopback unless --bind says otherwise", async () => {
      const port = await freePort();
      const {servers} = forwardPorts({host: "127.0.0.1", ports: [port]});
      try {
        await new Promise((resolve) => servers[0].listening ? resolve() : servers[0].once("listening", resolve));
        expect(servers[0].address().address).to.equal("127.0.0.1");
      } finally {
        await Promise.all(servers.map((one) => new Promise((resolve) => one.close(resolve))));
      }
    });

    const stand = async (command, args, env) => {
      const port = await freePort();
      const childEnv = {...process.env, ...env};
      for (const key of Object.keys(childEnv)) if (childEnv[key] === undefined) delete childEnv[key];
      const child = spawn(command, [...args(port)], {env: childEnv, stdio: "ignore"});
      for (let i = 0; i < 100 && !await reachable("127.0.0.1", port); i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return {port, child};
    };
    const standCases = [
      ["o4dserve-js.mjs (Node)", "tools/gogen/.out/o4dserve/demo.mjs",
        process.execPath, (port) => ["tools/gogen/o4dserve-js.mjs", "--listen", String(port), "--upstream", "http://127.0.0.1:9"]],
      ["o4dserve (Go)", "tools/gogen/.out/o4dserve/o4dserve",
        "tools/gogen/.out/o4dserve/o4dserve", (port) => ["-listen", `:${port}`, "-upstream", "http://127.0.0.1:9"]],
    ];
    for (const [name, built, command, args] of standCases) {
      it(`${name}: a bare port stays on loopback, OSD_BIND=0.0.0.0 opens it`, async function () {
        // the ZO4D stands proxy everything else to the loopback backend,
        // ADT included; they exist only after node tools/gogen/o4dserve.mjs
        if (!existsSync(built)) this.skip();
        const address = outside();
        let one = await stand(command, args, {OSD_BIND: undefined});
        try {
          expect(await reachable("127.0.0.1", one.port)).to.equal(true);
          if (hasV6Loopback) expect(await reachable("::1", one.port), "::1").to.equal(true);
          if (address !== undefined) expect(await reachable(address, one.port), `reachable on ${address}`).to.equal(false);
        } finally {
          await stop(one);
        }
        if (address === undefined) return;
        one = await stand(command, args, {OSD_BIND: "0.0.0.0"});
        try {
          expect(await reachable(address, one.port)).to.equal(true);
        } finally {
          await stop(one);
        }
      });
    }
  });

  // a listener added later must not bind every interface unasked: each call
  // takes a host, goes through tools/osd-bind.mjs / osdbind, or is listed
  // here with the reason it may
  describe("no listener binds every interface unasked", () => {
    const allowed = new Map([
      ["scripts/serve-build.mjs", "the LAN preview of static files, all interfaces on purpose, and it says so"],
      ["docker/image/free-instance.mjs", "a probe that binds and closes at once to find a free port"],
      ["tools/gogen/go/cmd/osgo/main.go", "pprof on osdbind.PprofAddr, which keeps a bare port on the bind host"],
      ["tools/gogen/go/cmd/osabap/sapgui.go", "-sapgui, default 127.0.0.1:3232"],
      ["tools/gogen/go/osdbind/bind.go", "the module every Go listener goes through"],
    ]);
    const tracked = execFileSync("git", ["ls-files", "-z", "tools", "scripts", "web", "bin", "docker", "editors", "test/start.mjs", "test/run.mjs"],
      {encoding: "utf8"}).split("\0").filter((f) => /\.(mjs|js|cjs|go)$/.test(f) && !/_test\.go$|\.test\.mjs$|node_modules|\/generated\//.test(f));

    // the argument text of each .listen( call, split at its top-level commas
    function listenCalls(text) {
      const out = [];
      for (const match of text.matchAll(/\.listen\(/g)) {
        let depth = 1;
        let i = match.index + match[0].length;
        const start = i;
        for (; i < text.length && depth > 0; i++) {
          if ("([{".includes(text[i])) depth++;
          else if (")]}".includes(text[i])) depth--;
        }
        const inner = text.slice(start, i - 1);
        const args = [];
        let level = 0;
        let from = 0;
        for (let j = 0; j < inner.length; j++) {
          if ("([{".includes(inner[j])) level++;
          else if (")]}".includes(inner[j])) level--;
          else if (inner[j] === "," && level === 0) { args.push(inner.slice(from, j).trim()); from = j + 1; }
        }
        args.push(inner.slice(from).trim());
        out.push({args: args.filter((a) => a !== ""), line: text.slice(0, match.index).split("\n").length});
      }
      return out;
    }

    it("Node: every .listen( names a host", () => {
      const offenders = [];
      for (const file of tracked.filter((f) => !f.endsWith(".go"))) {
        if (allowed.has(file)) continue;
        for (const {args, line} of listenCalls(readFileSync(file, "utf8"))) {
          const [first, second] = args;
          if (first === undefined || first.startsWith("{") || /sock|path|join\(/i.test(first)) continue; // options object or a unix socket
          const hostless = second === undefined || /=>|^function\b|^(resolve|r|ok|done|cb|callback)$/.test(second);
          if (hostless || args.some((a) => /^["'](0\.0\.0\.0|::)["']$/.test(a))) offenders.push(`${file}:${line} .listen(${args.join(", ")})`);
        }
      }
      expect(offenders).to.deep.equal([]);
    });

    it("Go: every listener goes through osdbind", () => {
      const offenders = [];
      for (const file of tracked.filter((f) => f.endsWith(".go"))) {
        if (allowed.has(file)) continue;
        readFileSync(file, "utf8").split("\n").forEach((text, i) => {
          if (/\b(ListenAndServe(TLS)?|net\.Listen)\(/.test(text) && !/^\s*\/\//.test(text)) offenders.push(`${file}:${i + 1} ${text.trim()}`);
        });
      }
      expect(offenders).to.deep.equal([]);
    });
  });

  describe("the DIAG and RFC listeners (tools/protocols/server.mjs)", () => {
    it("bind loopback by default", async () => {
      const servers = await listenProtocols({INSTANCE: "11", STG_DIAG_PORT: "0", STG_RFC_PORT: "0", STG_PORT: "3030"});
      try {
        expect(servers.diag.address().address).to.equal("127.0.0.1");
        expect(servers.rfc.address().address).to.equal("127.0.0.1");
        if (hasV6Loopback) {
          // docs/docker.md: every listener answers both loopbacks
          for (const server of [servers.diag, servers.rfc]) {
            const port = server.address().port;
            let up = false;
            for (let i = 0; i < 20 && !(up = await reachable("::1", port)); i++) {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            expect(up, `::1:${port}`).to.equal(true);
          }
        }
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

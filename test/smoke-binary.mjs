import {strict as assert} from "node:assert";
import {spawn} from "node:child_process";
import {createServer} from "node:http";
import {smokeBinary} from "../scripts/smoke-binary.mjs";

describe("standalone binary smoke process identity", function () {
  this.timeout(15000);
  before(function () { if (process.platform !== "linux") this.skip(); });

  it("rejects a foreign server even while our child is alive and ignores inherited STG_PORT", async () => {
    const server = createServer((req, res) => {
      res.end(req.url === "/osd/serving" ? JSON.stringify({ready: true, pid: process.pid}) : "discovery");
    });
    const inherited = process.env.STG_PORT;
    process.env.STG_PORT = "1";
    let child;
    let requests = 0;
    server.on("request", () => requests++);
    try {
      await assert.rejects(smokeBinary(process.execPath, {spawnChild(command, args, options) {
        assert.equal(command, "bwrap");
        assert.notEqual(options.env.STG_PORT, "1");
        // Steal the selected port after its final availability check.
        server.listen(Number(options.env.STG_PORT), "127.0.0.1");
        child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options);
        return child;
      }}), /foreign or dead process/);
      assert.ok(requests > 0, "the foreign HTTP 200 must actually reach the smoke");
      assert.ok(child.exitCode !== null || child.signalCode !== null, "the smoke must reap its child on failure");
    } finally {
      if (inherited === undefined) delete process.env.STG_PORT;
      else process.env.STG_PORT = inherited;
      await new Promise((done) => server.close(done));
    }
  });

  it("accepts HTTP 200 from its own live child", async () => {
    await smokeBinary(process.execPath, {spawnChild(command, args, options) {
      return spawn(process.execPath, ["-e", `
        require("node:http").createServer((req, res) => {
          res.end(req.url === "/osd/serving"
            ? JSON.stringify({ready: true, pid: process.pid}) : "discovery");
        }).listen(Number(process.env.STG_PORT), "127.0.0.1");
      `], options);
    }});
  });

  it("rejects readiness if the child dies while discovery is in flight", async () => {
    let child;
    const server = createServer((req, res) => {
      if (req.url === "/osd/serving") {
        res.end(JSON.stringify({ready: true, pid: child.pid}));
      } else {
        child.once("exit", () => res.end("discovery"));
        child.kill("SIGTERM");
      }
    });
    try {
      await assert.rejects(smokeBinary(process.execPath, {spawnChild(command, args, options) {
        server.listen(Number(options.env.STG_PORT), "127.0.0.1");
        child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options);
        return child;
      }}), /child exited before readiness was verified/);
    } finally {
      await new Promise((done) => server.close(done));
    }
  });
});

import assert from "node:assert/strict";
import {test} from "node:test";
import {createServer} from "node:http";
import {spawn} from "node:child_process";

for (const [ready, status, exitCode] of [[false, 503, 1], [false, 200, 1], [true, 200, 0]]) {
  test(`image healthcheck: ready=${ready}, HTTP ${status} exits ${exitCode}`, async () => {
    const paths = [];
    const server = createServer((req, res) => {
      paths.push(req.url);
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/osd/ready") {
        res.writeHead(status).end(JSON.stringify({ready}));
      } else if (req.url === "/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$top=1&$format=json") {
        res.end(JSON.stringify({d: {results: [{TravelID: "1"}]}}));
      } else {
        res.writeHead(404).end("{}");
      }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const exit = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["docker/image/healthcheck.mjs"], {
          env: {...process.env, STG_PORT: String(server.address().port), STG_PROTOCOLS: "0"}, stdio: "ignore"});
        child.on("error", reject);
        child.on("exit", resolve);
      });
      assert.equal(exit, exitCode);
      assert.deepEqual(paths, ["/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$top=1&$format=json", "/osd/ready"]);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
}

// Public protocol acceptance, run from a separate test-client container.
// No credentials or captured frames from another SAP system are used.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {get as httpGet} from "node:http";
import {get as httpsGet} from "node:https";
import {stripVTControlCharacters} from "node:util";
import {terminalSvg} from "./terminal-svg.mjs";

const host = process.env.PROBE_HOST ?? "osd";
const instance = process.env.INSTANCE ?? "11";
assert.match(instance, /^\d{2}$/);
const label = process.env.PROBE_LABEL ?? `instance-${instance}`;
assert.match(label, /^[a-zA-Z0-9_-]+$/);
const out = join(process.env.PROBE_REPORTS ?? "/reports", label);
mkdirSync(out, {recursive: true});
const report = {label, instance, image: process.env.OSD_TEST_IMAGE, checks: [], passed: false};
let servingGeneration;
const save = (name, data) => writeFileSync(join(out, name), data);
function get(url) {
  return new Promise((resolve, reject) => {
    const request = (url.startsWith("https:") ? httpsGet : httpGet)(url,
      {rejectUnauthorized: false}, response => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", chunk => { text += chunk; });
        response.on("error", reject);
        response.on("end", () => resolve({status: response.statusCode, text}));
      });
    request.setTimeout(15000, () => request.destroy(new Error(`Timeout: ${url}`)));
    request.on("error", reject);
  });
}
function run(program, args, name, env = {}) {
  try {
    const result = execFileSync(program, args, {encoding: "utf8", timeout: 25000,
      maxBuffer: 8 * 1024 * 1024, env: {...process.env, ...env}, stdio: ["ignore", "pipe", "pipe"]});
    save(name, result);
    return result;
  } catch (error) {
    save(name, error.stdout ?? "");
    save(`${name}.stderr`, error.stderr ?? error.message);
    throw new Error(`${program} failed; see ${name}.stderr`, {cause: error});
  }
}
try {
  for (const [scheme, port] of [["http", process.env.PROBE_HTTP_PORT ?? 3030], ["https", process.env.PROBE_HTTPS_PORT ?? 44300]]) {
    const paths = [
      ["adt-discovery", "/sap/bc/adt/core/discovery", text => {
        assert.ok(/<app:service\b/.test(text) && /href="\/sap\/bc\/adt\/packages"/.test(text), "ADT discovery must advertise the package collection");
      }],
      ["adt-build", "/sap/bc/adt/core/http/build", text => {
        const serving = JSON.parse(text).system?.serving;
        assert.ok(serving);
        if (servingGeneration !== undefined) assert.deepEqual(serving, servingGeneration);
        servingGeneration = serving;
      }],
      ["odata-metadata", "/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata", text => { assert.match(text, /<edmx:Edmx\b/); assert.match(text, /Name="TravelSet"/); }],
      ["odata-travels", "/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$top=1&$format=json", text => assert.ok(JSON.parse(text).d?.results?.length)],
    ];
    for (const [name, path, check] of paths) {
      const answer = await get(`${scheme}://${host}:${port}${path}`);
      save(`${scheme}-${name}.txt`, answer.text);
      assert.equal(answer.status, 200, `${scheme} ${name}`);
      check(answer.text);
      report.checks.push({check: `${scheme}-${name}`, status: answer.status, passed: true});
    }
  }
  const screen = run("sap-tui", ["--once", "--addr", `${host}:32${instance}`], "diag.ansi");
  const plain = stripVTControlCharacters(screen);
  save("diag.txt", plain);
  save("diag.svg", terminalSvg(screen));
  assert.match(plain, /Tape loading error, 0:1/i, "SAP-TUI must render the tape screen received over DIAG");
  report.checks.push({check: "sap-tui-tape-screen", port: Number(`32${instance}`), passed: true});
  const answer = run("rfc-probe", [host, `33${instance}`, "/sap/bc/adt/core/http/build"], "rfc-adt.json");
  const response = JSON.parse(answer).RESPONSE;
  assert.equal(response?.STATUS_LINE?.STATUS_CODE, "200", "ADT-over-RFC must return HTTP 200");
  const body = Buffer.from(response.MESSAGE_BODY, "base64").toString("utf8");
  save("rfc-adt-body.json", body);
  assert.deepEqual(JSON.parse(body).system?.serving, servingGeneration, "RFC must reach the same serving OSD generation as HTTP/HTTPS");
  report.checks.push({check: "SADT_REST_RFC_ENDPOINT", port: Number(`33${instance}`), passed: true});
  report.passed = true;
  console.log(`PASS ${label}: HTTP/HTTPS ADT + OData, SAP-TUI tape screen, ADT-over-RFC`);
} finally {
  save("report.json", JSON.stringify(report, null, 2) + "\n");
}

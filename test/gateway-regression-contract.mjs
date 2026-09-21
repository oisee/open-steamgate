import {expect} from "chai";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {
  evaluateCase,
  syntheticRunResult,
  validateCase,
} from "../tools/osd-regression-case.mjs";

const folder = "test/fixtures/gateway-regression";
const json = (name) => JSON.parse(readFileSync(`${folder}/${name}`, "utf8"));
const testCase = () => json("travel.case.json");

describe("GW0 Gateway regression contract", () => {
  it("validates and passes the positive synthetic fixture", () => {
    const c = testCase();
    expect(validateCase(c)).to.deep.equal([]);
    const result = syntheticRunResult(c, json("response-pass.json"), {
      runId: "test-pass",
      now: new Date("2026-09-21T15:00:00Z"),
    });
    expect(result.outcome).to.equal("passed");
    expect(result.findings).to.deep.equal([]);
    expect(result.provenance).to.include({evidence: "synthetic"});
    expect(result.target).to.include({requestedMode: "wire", actualMode: "replay"});
  });

  it("round-trips the portable case through canonical JSON data", () => {
    const encoded = JSON.stringify(testCase());
    const decoded = JSON.parse(encoded);
    expect(validateCase(decoded)).to.deep.equal([]);
    expect(evaluateCase(decoded, json("response-pass.json"))).to.deep.include({outcome: "passed"});
    expect(JSON.stringify(decoded)).to.equal(encoded);
  });

  it("goes red on the one intentional business mutation at its exact pointer", () => {
    const verdict = evaluateCase(testCase(), json("response-fail.json"));
    expect(verdict).to.deep.equal(json("expected-failure.json"));
  });

  it("does not globally erase an unmasked timestamp or UUID", () => {
    const c = testCase();
    c.expect.body.value.d.BusinessDate = "2026-09-21T00:00:00Z";
    c.expect.body.value.d.BusinessId = "11111111-1111-4111-" + "8111-111111111111";
    const response = json("response-pass.json");
    response.body.value.d.BusinessDate = "2026-09-22T00:00:00Z";
    response.body.value.d.BusinessId = "22222222-2222-4222-" + "8222-222222222222";
    expect(evaluateCase(c, response).findings.map((f) => f.path))
      .to.deep.equal(["/d/BusinessDate", "/d/BusinessId"]);
  });

  it("keeps arrays ordered and values typed while object member order is irrelevant", () => {
    const c = testCase();
    c.expect.body.value.d.Values = [1, "2"];
    const response = json("response-pass.json");
    response.body.value.d.Values = ["2", 1];
    const findings = evaluateCase(c, response).findings;
    expect(findings.map((f) => [f.kind, f.path])).to.deep.equal([
      ["type-mismatch", "/d/Values/0"],
      ["type-mismatch", "/d/Values/1"],
    ]);
  });

  it("fails closed on a stale mask or a mask without a reason", () => {
    const stale = testCase();
    stale.expect.body.masks = [{path: "/d/NoSuchField", reason: "deliberate stale fixture"}];
    expect(evaluateCase(stale, json("response-pass.json"))).to.deep.include({outcome: "error"});
    expect(evaluateCase(stale, json("response-pass.json")).findings[0]).to.include({
      kind: "invalid-mask",
      path: "/d/NoSuchField",
    });

    const unexplained = testCase();
    unexplained.expect.body.masks[0].reason = "";
    expect(validateCase(unexplained).map((e) => e.path))
      .to.include("/expect/body/masks/0/reason");

    const overlapping = testCase();
    overlapping.expect.body.masks.push({path: "/d/ObservedAt/value", reason: "overlap probe"});
    expect(validateCase(overlapping).map((e) => e.message))
      .to.include("overlapping mask paths are not allowed");
  });

  it("fails closed on unsupported assertions and invalid JSON without echoing payloads", () => {
    const unsupported = testCase();
    unsupported.expect.unsupportedAssertion = true;
    expect(evaluateCase(unsupported, json("response-pass.json"))).to.deep.include({outcome: "error"});

    const invalid = evaluateCase(testCase(), {
      status: 200,
      headers: {"content-type": "application/json"},
      body: "actual-secret is not JSON",
    });
    expect(invalid.outcome).to.equal("error");
    expect(JSON.stringify(invalid)).not.to.contain("actual-secret");
  });

  it("rejects malformed expected-header containers and names", () => {
    const array = testCase();
    array.expect.headers = [];
    expect(validateCase(array).map((entry) => entry.path)).to.include("/expect/headers");
    expect(evaluateCase(array, json("response-pass.json")).outcome).to.equal("error");

    const badName = testCase();
    badName.expect.headers["bad\nname"] = "x";
    expect(validateCase(badName).map((entry) => entry.path)).to.include("/expect/headers/bad\nname");
  });

  it("reports a null redaction rule as configuration error instead of throwing", () => {
    const c = testCase();
    c.redaction.body = [null];
    expect(() => validateCase(c)).not.to.throw();
    expect(validateCase(c).map((entry) => entry.path)).to.include.members([
      "/redaction/body/0/path",
      "/redaction/body/0/reason",
    ]);
    expect(() => syntheticRunResult(c, json("response-pass.json"))).not.to.throw();
  });

  it("rejects absolute paths and stored session secrets without echoing values", () => {
    const c = testCase();
    c.request.path = "https://internal.invalid/service";
    c.request.headers.Authorization = "Basic synthetic-secret";
    const errors = validateCase(c);
    expect(errors.map((e) => e.path)).to.include.members([
      "/request/path",
      "/request/headers/Authorization",
    ]);
    expect(JSON.stringify(errors)).not.to.contain("synthetic-secret");
  });

  it("requires a logical destination name rather than an inline URL", () => {
    const c = testCase();
    c.destination = "https://evil.example";
    expect(validateCase(c).map((entry) => entry.path)).to.include("/destination");
  });

  it("rejects origin escapes, secret query params, bodies, header injection and unknown fields", () => {
    const c = testCase();
    c.request.path = "/\\evil.example/x?access_token=query-secret";
    c.request.body = {format: "json", value: {password: "body-secret"}};
    c.request.headers["x-api-key"] = "header-secret";
    c.request.headers["x-bad\nname"] = "value\r\nInjected: yes";
    c.execution.unknownPolicy = true;
    c.expect.body.masks[0].unknownMatcher = true;
    const errors = validateCase(c);
    expect(errors.map((entry) => entry.path)).to.include.members([
      "/request/path",
      "/request/body",
      "/request/headers/x-api-key",
      "/execution/unknownPolicy",
      "/expect/body/masks/0/unknownMatcher",
    ]);
    expect(JSON.stringify(errors)).not.to.contain("query-secret");
    expect(JSON.stringify(errors)).not.to.contain("body-secret");
    expect(JSON.stringify(errors)).not.to.contain("header-secret");
  });

  it("rejects credential aliases by allowing no query and only fixed safe headers", () => {
    const c = testCase();
    c.request.path += "?SAMLResponse=query-secret&ticket=other-secret";
    c.request.headers["x-auth-token"] = "header-secret";
    c.expect.headers.Location = "/cb?access_token=expected-secret";
    const errors = validateCase(c);
    expect(errors.map((entry) => entry.path)).to.include.members([
      "/request/path",
      "/request/headers/x-auth-token",
      "/expect/headers/Location",
    ]);
    for (const secret of ["query-secret", "other-secret", "header-secret", "expected-secret"]) {
      expect(JSON.stringify(errors)).not.to.contain(secret);
    }
  });

  it("matches before redaction and persists neither secret headers nor secret findings", () => {
    const c = testCase();
    c.redaction = {
      body: [{path: "/d/OperatorSecret", reason: "synthetic secret used to prove persistence redaction"}],
    };
    const response = json("response-pass.json");
    response.headers["set-cookie"] = "SESSION=header-secret";
    response.headers["x-csrf-token"] = "csrf-secret";
    response.body.value.d.OperatorSecret = "actual-secret";
    const result = syntheticRunResult(c, response, {
      runId: "redaction",
      now: new Date("2026-09-21T15:00:00Z"),
    });
    expect(result.outcome, "the mismatch existed before persistence redaction").to.equal("failed");
    const saved = JSON.stringify(result);
    for (const secret of ["actual-secret", "header-secret", "csrf-secret"]) {
      expect(saved).not.to.contain(secret);
    }
    expect(result.response.headers["set-cookie"]).to.equal("[redacted]");
    expect(result.findings.find((f) => f.path === "/d/OperatorSecret"))
      .to.include({actual: "[redacted]"});
  });

  it("redacts secrets embedded in ancestor findings and captures only safe headers", () => {
    const c = testCase();
    c.redaction = {body: [{path: "/d/Private/token", reason: "synthetic secret"}]};
    const response = json("response-pass.json");
    response.headers.location = "/callback?token=location-secret";
    response.headers["x-api-key"] = "api-secret";
    response.body.value.d.Private = {token: "actual-token"};
    const result = syntheticRunResult(c, response, {
      runId: "ancestor-redaction",
      now: new Date("2026-09-21T15:00:00Z"),
    });
    const saved = JSON.stringify(result);
    for (const secret of ["location-secret", "api-secret", "actual-token"]) {
      expect(saved).not.to.contain(secret);
    }
    expect(result.response.headers).not.to.have.keys("location", "x-api-key");
  });

  it("quarantines the response when declared redaction is stale or malformed", () => {
    for (const body of [
      [{path: "/d/MissingSecret", reason: "stale on purpose"}],
      "not-an-array",
      [{reason: "missing path"}],
      [{path: "/d/~bad", reason: "invalid pointer"}],
    ]) {
      const c = testCase();
      c.redaction = {body};
      const response = json("response-pass.json");
      response.body.value.d.UncoveredSecret = "must-not-survive";
      const result = syntheticRunResult(c, response);
      expect(result.outcome).to.equal("error");
      expect(JSON.stringify(result)).not.to.contain("must-not-survive");
      expect(result.response.body.format).to.equal("unavailable");
    }
  });

  it("rejects untagged response bodies", () => {
    for (const body of [{d: {}}, '{"d":{}}']) {
      expect(evaluateCase(testCase(), {status: 200, headers: {}, body}).outcome).to.equal("error");
    }
  });

  it("classifies malformed response envelopes as errors, not business failures", () => {
    for (const response of [
      {...json("response-pass.json"), status: "200"},
      {...json("response-pass.json"), headers: []},
      {...json("response-pass.json"), headers: {"content-type": ["application/json"]}},
    ]) {
      expect(evaluateCase(testCase(), response).outcome).to.equal("error");
    }
  });

  it("the headless oracle exits 0 for green, 1 for red, 2 for error, and prints the red pointer", () => {
    const run = (response) => {
      try {
        return {code: 0, out: execFileSync(process.execPath, [
          "tools/osd-regression-fixture.mjs",
          `${folder}/travel.case.json`,
          `${folder}/${response}`,
        ], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]})};
      } catch (error) {
        return {code: error.status, out: String(error.stdout)};
      }
    };
    expect(run("response-pass.json").code).to.equal(0);
    const red = run("response-fail.json");
    expect(red.code).to.equal(1);
    expect(red.out).to.contain('"/d/Seats"');
    expect(red.out).to.contain('"scope": "body"');
    expect(run("response-error.json").code).to.equal(2);
  });
});

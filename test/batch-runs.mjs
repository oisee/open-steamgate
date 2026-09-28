import {expect} from "chai";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {BatchRuns, runPersistedBatch} from "../tools/osd-batch-runs.mjs";

const root = resolve(".");

describe("durable one-shot batch runs", function () {
  let dir;
  let env;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-batch-runs-"));
    env = {...process.env, OSD_OPERATIONS_DB: join(dir, "operations.sqlite")};
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  it("reopens a finished run and its output on a fresh SQLite connection", async () => {
    const first = new BatchRuns(root, env);
    const run = await runPersistedBatch(root,
      {program: "ZGG_EX_012", input: [{name: "P_DATE", value: "20251231"}]},
      first, async () => ({status: "COMPLETED", lines: ["20251231"]}));
    first.close();
    expect(run.state).to.equal("COMPLETED");
    expect(run.input).to.deep.equal([{name: "P_DATE"}]);
    expect(run.generation).to.match(/^[0-9a-f]{16}$/);
    const reopened = new BatchRuns(root, env);
    try {
      expect(reopened.get(run.id)).to.deep.equal(run);
      expect(reopened.output(run.id).lines).to.deep.equal(["20251231"]);
    } finally {
      reopened.close();
    }
  });

  it("keeps a failed result, redacts selection values on reads, and detects changed output", async () => {
    const store = new BatchRuns(root, env);
    try {
      const run = await runPersistedBatch(root,
        {program: "ZGG_EX_012", input: [{name: "P_DATE", value: "private-value"}]},
        store, async () => ({status: "INVALID_INPUT", detail: "bad date", lines: ["partial"]}));
      expect(run.state).to.equal("FAILED");
      expect(run.input).to.deep.equal([{name: "P_DATE"}]);
      expect(store.get(run.id, {revealInput: true}).input[0].value).to.equal("private-value");
      expect(store.output(run.id).lines).to.deep.equal(["partial"]);
      writeFileSync(join(dir, "batch-output", `${run.id}.json`), "tampered");
      expect(() => store.output(run.id)).to.throw(/digest check/);
    } finally {
      store.close();
    }
  });

  it("records a thrown report error without claiming it completed", async () => {
    const store = new BatchRuns(root, env);
    try {
      let id;
      try {
        await runPersistedBatch(root, {program: "ZGG_EX_012"}, store, async () => {
          throw new Error("report dumped");
        });
      } catch (error) {
        id = error.runId;
      }
      expect(id).to.be.a("string");
      expect(store.get(id).resultStatus).to.equal("DUMP");
      expect(store.get(id).state).to.equal("FAILED");
      expect(store.output(id)).to.equal(undefined);
    } finally {
      store.close();
    }
  });

  it("keeps an interrupted run visible for a later doctor", () => {
    const first = new BatchRuns(root, env);
    const started = first.start({program: "ZGG_EX_012"});
    first.close();
    const reopened = new BatchRuns(root, env);
    try {
      expect(reopened.get(started.id).state).to.equal("RUNNING");
      expect(reopened.get(started.id).endedAt).to.equal(null);
      expect(reopened.output(started.id)).to.equal(undefined);
    } finally {
      reopened.close();
    }
  });
});

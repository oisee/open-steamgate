import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {ADT_SCALARS, adtStoreSignature} from "../tools/gogen/storecmp-signature.mjs";
import {resolve} from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);

describe("OSGo store command parity", function() {
  this.timeout(120000);
  it("derives every declared row field and refuses omitted scalars or unknown tables", () => {
    const tables = adtStoreSignature(root);
    assert.ok(tables.ET_REVISION.includes("subject_full"));
    for (const scalar of ADT_SCALARS) {
      assert.throws(() => adtStoreSignature(root, ADT_SCALARS.filter((f) => f !== scalar)), /harness missing scalar/);
    }
    const scratch = mkdtempSync(resolve(tmpdir(), "storecmp-signature-"));
    try {
      mkdirSync(resolve(scratch, "src/adt"), {recursive: true});
      mkdirSync(resolve(scratch, "src/webgui"));
      writeFileSync(resolve(scratch, "src/adt/caller.abap"),
        "DATA lt_rows TYPE STANDARD TABLE OF zosd_revision_s WITH DEFAULT KEY.\nCALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE' TABLES et_revision = lt_rows.");
      const xml = readFileSync(resolve(root, "src/webgui/zosd_revision_s.tabl.xml"), "utf8")
        .replace("</DD03P_TABLE>", "<DD03P><FIELDNAME>FUTURE_TITLE</FIELDNAME></DD03P></DD03P_TABLE>");
      writeFileSync(resolve(scratch, "src/webgui/zosd_revision_s.tabl.xml"), xml);
      assert.ok(adtStoreSignature(scratch).ET_REVISION.includes("future_title"));
      writeFileSync(resolve(scratch, "src/adt/caller.abap"),
        "CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE' TABLES et_future = lt_rows.");
      assert.throws(() => adtStoreSignature(scratch), /harness missing table comparison/);
    } finally { rmSync(scratch, {recursive: true, force: true}); }
  });
  it("matches every read and write on the store fixture through execute and the RFC adapter", () => {
    const result = spawnSync(process.execPath, ["tools/gogen/storecmp.mjs", "--root", "tools/gogen/testdata-store/tree", "--tools", "."],
      {cwd: root, encoding: "utf8", env: {...process.env, GOCACHE: process.env.GOCACHE ?? "/tmp/osgo-gocache"}});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const mode of ["execute", "adapter"]) {
      for (const kind of ["reads", "writes"]) {
        const match = result.stdout.match(new RegExp(`${mode} ${kind}: (\\d+) of (\\d+) answers the same`));
        assert.ok(match, result.stdout);
        assert.equal(match[1], match[2], result.stdout);
        assert.ok(Number(match[1]) > 0);
      }
    }
    assert.match(result.stdout, /history: 2 revisions compared through execute and adapter/);
    assert.match(result.stdout, /compiler: \d+ CHECK and OUTLINE answers compared with real sidecar/);
    assert.match(result.stdout, /compiler adapter: \d+ CHECK and OUTLINE answers compared with complete RFC caller signature/);
    assert.match(result.stdout, /compiler absent: original CHECK and PARSE refusals/);
  });
});

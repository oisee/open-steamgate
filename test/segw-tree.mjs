import {expect} from "chai";
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DDIC_DIR, SPEC_FILE, YAML_FILE, derive, generated, iwprTables, readSpec} from "../tools/segw-tables.mjs";
import {DEFAULT_URL, exportIwpr, importIwpr, projectOf, pull, pullFile, push, pushFile, readData, writeData} from "../tools/segw-tree.mjs";
import {startServer} from "./start.mjs";

// The SEGW project tree as our tables: the spec derived from real SEGW
// projects, the tables and the service generated from it, and the IWPR
// round trip through those tables.
describe("tools/segw-tables + tools/segw-tree: the project tree as tables", () => {
  const spec = readSpec();

  it("the tables and the service under src/segw are what the spec says", () => {
    for (const [file, text] of Object.entries(generated(spec))) {
      expect(readFileSync(file, "utf8"), file).to.equal(text);
    }
    const tracked = readdirSync(DDIC_DIR).map((f) => join(DDIC_DIR, f));
    expect(tracked.filter((f) => !(f in generated(spec)))).to.deep.equal([]);
    expect(existsSync(SPEC_FILE) && existsSync(YAML_FILE)).to.equal(true);
  });

  it("the key of every table is a prefix of its fields with PROJECT and NODE_UUID, SYLANGU for texts", () => {
    for (const [tag, t] of Object.entries(spec)) {
      const fields = Object.keys(t.fields);
      expect(fields.slice(0, t.keys.length), tag).to.deep.equal(t.keys);
      expect(t.keys, tag).to.include("PROJECT");
      if (fields.includes("NODE_UUID")) {
        expect(t.keys, tag).to.include("NODE_UUID");
      }
      if (fields.includes("SYLANGU")) {
        expect(t.keys, tag).to.include("SYLANGU");
      }
    }
    expect(spec.SBD_MR.keys).to.deep.equal(["PROJECT", "NODE_UUID", "DS_ATT_PATH"]);
    expect(spec.SBD_MAP.keys).to.deep.equal(["PROJECT", "NODE_HASH", "NODE_UUID"]);
    expect(spec.SBO_PRT.keys).to.deep.equal(["SYLANGU", "PROJECT", "NODE_UUID"]);
  });

  it("entity names differ in their first 16 characters, SEGW's method name budget", () => {
    const names = Object.values(spec).map((t) => t.entity.slice(0, 16).toUpperCase());
    expect(new Set(names).size).to.equal(names.length);
  });

  // the fixture was written by hand: the same rows, but its table blocks
  // and the fields of SBO_PR are not in the order SEGW writes them
  it("round trip of the mapped fixture keeps every table, row and field", () => {
    const xml = readFileSync("test/fixtures/segw/zstg_mapped.iwpr.xml", "utf8");
    const tables = importIwpr(xml, spec);
    expect(projectOf(tables)).to.equal("ZSTG_MAPPED");
    const back = exportIwpr(tables, "ZSTG_MAPPED", spec);
    const rows = (text) => [...iwprTables(text)].map(([tag, list]) => [tag, list.map((r) => Object.entries(r).sort())]).sort();
    expect(rows(back)).to.deep.equal(rows(xml));
    // alphabetical table blocks, fields in DDIC order, so a second trip is identical
    expect(exportIwpr(importIwpr(back, spec), "ZSTG_MAPPED", spec)).to.equal(back);
  });

  it("rows keep their position and initial fields stay out", () => {
    const tables = importIwpr(readFileSync("test/fixtures/segw/zstg_mapped.iwpr.xml", "utf8"), spec);
    const mp = tables.get("SBD_MP");
    expect(mp.map((r) => r.stg_seq)).to.deep.equal(mp.map((_, i) => i + 1));
    expect(mp.every((r) => r.mandt === "123" && r.project === "ZSTG_MAPPED")).to.equal(true);
    const ds = tables.get("SBD_DS");
    expect(ds[0].rfc_dest).to.equal("NONE");
    expect(ds[1]).to.not.have.property("rfc_dest");
    expect(exportIwpr(tables, "ZSTG_MAPPED", spec)).to.not.contain("<RFC_DEST></RFC_DEST>");
  });

  it("a field SEGW never writes is refused", () => {
    const xml = readFileSync("test/fixtures/segw/zstg_mini.iwpr.xml", "utf8").replace("<NAME>Travel</NAME>", "<NAME>Travel</NAME>\n     <MADE_UP>x</MADE_UP>");
    expect(() => importIwpr(xml, spec)).to.throw("SBO_ET.MADE_UP: not in the spec");
  });

  it("importing a project replaces its rows and leaves other projects alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "segw-tree-"));
    try {
      const mapped = importIwpr(readFileSync("test/fixtures/segw/zstg_mapped.iwpr.xml", "utf8"), spec);
      const mini = importIwpr(readFileSync("test/fixtures/segw/zstg_mini.iwpr.xml", "utf8"), spec);
      writeData(dir, mapped, "ZSTG_MAPPED", spec);
      writeData(dir, mini, "ZSTG_MINI", spec);
      writeData(dir, mapped, "ZSTG_MAPPED", spec);
      const data = readData(dir, spec);
      expect(data.get("SBO_ET").filter((r) => r.project === "ZSTG_MAPPED")).to.have.length(mapped.get("SBO_ET").length);
      expect(data.get("SBO_ET").filter((r) => r.project === "ZSTG_MINI")).to.have.length(mini.get("SBO_ET").length);
      expect(exportIwpr(data, "ZSTG_MINI", spec)).to.equal(exportIwpr(mini, "ZSTG_MINI", spec));
      expect(exportIwpr(data, "NOBODY", spec)).to.not.contain("<_-IWBEP_-I_");
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it("data/ holds the mapped fixture, as the unit tests and the demo expect", () => {
    const mapped = importIwpr(readFileSync("test/fixtures/segw/zstg_mapped.iwpr.xml", "utf8"), spec);
    const data = readData("data", spec);
    for (const [tag, rows] of mapped) {
      expect(data.get(tag).filter((r) => r.project === "ZSTG_MAPPED"), tag).to.deep.equal(rows);
    }
  });

  // the strong claim, on the untracked corpus: every IWPR file a SEGW
  // system wrote comes back byte for byte (the byte order mark aside)
  const corpus = [".local/corpus", ".local/corpus-sap", ".local/lars"].filter((d) => existsSync(d));
  const files = [];
  const walk = (folder) => {
    for (const name of readdirSync(folder)) {
      const p = join(folder, name);
      if (name === "node_modules" || name === ".git") {
        continue;
      }
      if (statSync(p).isDirectory()) {
        walk(p);
      } else if (name.endsWith(".iwpr.xml")) {
        files.push(p);
      }
    }
  };
  corpus.forEach(walk);
  (files.length === 0 ? it.skip : it)(`the SEGW-written IWPR files of the corpus round trip byte for byte (${files.length} files)`, () => {
    for (const file of files) {
      const xml = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
      const tables = importIwpr(xml, spec);
      expect(exportIwpr(tables, projectOf(tables), spec), file).to.equal(xml);
    }
    // and the spec is what those files say
    expect(derive(corpus).spec).to.deep.equal(spec);
  });
});

// the same round trip through the gateway and the generic CRUD of
// ZSTG_SEGW_SRV: rows in the database, not in a JSON file
describe("tools/segw-tree push / pull through ZSTG_SEGW_SRV", function () {
  this.timeout(120000);
  const spec = readSpec();
  let server;

  before(() => {
    server = startServer(true);
  });

  after(() => {
    server.close();
  });

  it("pulls the seeded project as the file it was imported from", async () => {
    const xml = readFileSync("test/fixtures/segw/zstg_mapped.iwpr.xml", "utf8");
    expect(exportIwpr(await pull(DEFAULT_URL, "ZSTG_MAPPED", spec), "ZSTG_MAPPED", spec)).to.equal(xml);
  });

  it("pushes a file and pulls it back byte for byte, twice, without doubling rows", async () => {
    const xml = readFileSync("test/fixtures/segw/zstg_mini.iwpr.xml", "utf8");
    const tables = importIwpr(xml, spec);
    const first = await push(DEFAULT_URL, tables, "ZSTG_MINI", spec);
    expect(first.deleted).to.equal(0);
    expect(first.posted).to.equal([...tables.values()].reduce((n, r) => n + r.length, 0));
    expect(exportIwpr(await pull(DEFAULT_URL, "ZSTG_MINI", spec), "ZSTG_MINI", spec)).to.equal(xml);
    const second = await push(DEFAULT_URL, tables, "ZSTG_MINI", spec);
    expect(second.deleted).to.equal(first.posted);
    expect(exportIwpr(await pull(DEFAULT_URL, "ZSTG_MINI", spec), "ZSTG_MINI", spec)).to.equal(xml);
    // the other project is untouched
    expect(exportIwpr(await pull(DEFAULT_URL, "ZSTG_MAPPED", spec), "ZSTG_MAPPED", spec)).to.equal(readFileSync("test/fixtures/segw/zstg_mapped.iwpr.xml", "utf8"));
  });

  // the file as one POST to ImportSet: zcl_stg_segw_import parses it in ABAP
  it("POST ImportSet takes the file and the pull gives it back byte for byte", async () => {
    for (const name of ["zstg_mini", "zstg_mapped"]) {
      const xml = readFileSync(`test/fixtures/segw/${name}.iwpr.xml`, "utf8");
      const tables = importIwpr(xml, spec);
      const rows = [...tables.values()].reduce((n, r) => n + r.length, 0);
      const result = await pushFile(DEFAULT_URL, xml);
      expect(result, name).to.deep.equal({project: projectOf(tables), posted: rows, tables: tables.size});
      expect(exportIwpr(await pull(DEFAULT_URL, result.project, spec), result.project, spec), name).to.equal(xml);
      // and the file the service writes itself (GET ExportSet, zcl_stg_segw_export)
      expect(await pullFile(DEFAULT_URL, result.project), name).to.equal(xml);
    }
  });

  it("GET ExportSet of a project nobody imported is 400", async () => {
    const res = await fetch(`${DEFAULT_URL}/sap/opu/odata/sap/ZSTG_SEGW_SRV/ExportSet('NOBODY')`);
    expect(res.status).to.equal(400);
    expect(await res.text()).to.contain("no project NOBODY");
  });

  it("POST ImportSet refuses a field SEGW never writes and leaves the tables alone", async () => {
    const xml = readFileSync("test/fixtures/segw/zstg_mini.iwpr.xml", "utf8");
    const res = await fetch(`${DEFAULT_URL}/sap/opu/odata/sap/ZSTG_SEGW_SRV/ImportSet`, {
      method: "POST", headers: {"content-type": "application/json"},
      body: JSON.stringify({Content: xml.replace("<NAME>Travel</NAME>", "<NAME>Travel</NAME>\n     <MADE_UP>x</MADE_UP>")}),
    });
    expect(res.status).to.equal(400);
    expect(await res.text()).to.contain("SBO_ET.MADE_UP: not a field of ZSTG_SBO_ET");
    expect(exportIwpr(await pull(DEFAULT_URL, "ZSTG_MINI", spec), "ZSTG_MINI", spec)).to.equal(xml);
  });
});

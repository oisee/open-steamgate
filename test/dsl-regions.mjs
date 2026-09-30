// Generated regions (tools/dsl-regions.mjs): every `" osd:gen` region in a
// tree is regenerated from its recipe's model and template and compared.
import {expect} from "chai";
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {checkRegions, formatResult, parseRegions, regionText} from "../tools/dsl-regions.mjs";

const DEMO = "src/lift/zcl_osd_lift_r1_demo.clas.abap";
const COPY_LINE = "        <ls_row>-text = <ls_lookup>-text.";
// marker lines of the demo as it is checked in: the first region's begin and
// end, the second region's begin
const lineOf = (text) => readFileSync(DEMO, "utf8").split("\n").indexOf(text) + 1;
const BEGIN1 = lineOf(`    " osd:gen r1-lookup-enrich from=before begin`);
const END1 = lineOf(`    " osd:gen r1-lookup-enrich end`);
const BEGIN2 = lineOf(`    " osd:gen r1-lookup-enrich from=before_mixed begin`);

describe("DSL generated regions", function () {
  this.timeout(120000);
  let dir, file, original;
  const cli = (...args) => spawnSync(process.execPath, ["tools/dsl-regions.mjs", ...args], {encoding: "utf8"});
  const copy = (source) => { writeFileSync(file, source); return file; };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dsl-regions-"));
    file = join(dir, "zcl_osd_lift_r1_demo.clas.abap");
    original = readFileSync(DEMO, "utf8");
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  it("finds the demo's two regions, each naming its recipe and its source method", () => {
    const {regions} = parseRegions(original, DEMO);
    expect(regions.map((r) => [r.recipe, r.params.from])).to.deep.equal(
      [["r1-lookup-enrich", "before"], ["r1-lookup-enrich", "before_mixed"]]);
    expect(regionText(regions[0])).to.match(/^DATA lt_lookup TYPE HASHED TABLE/);
  });

  it("check on the demo class: every region ok, exit 0", () => {
    const run = cli("check", "src/lift");
    expect(run.status, run.stdout + run.stderr).to.equal(0);
    expect(run.stdout).to.match(new RegExp(`^ok +${DEMO}:\\d+ r1-lookup-enrich from=before$`, "m"));
    expect(run.stdout).to.match(new RegExp(`^ok +${DEMO}:\\d+ r1-lookup-enrich from=before_mixed$`, "m"));
    expect(run.stdout).to.match(/^2 region\(s\): 2 ok, 0 drift, 0 refused, 0 error$/m);
  });

  it("an edited line of a region is DRIFT naming region and line, exit 1; write repairs only it", async () => {
    const lines = original.split("\n");
    const edited = lines.indexOf(COPY_LINE);
    expect(edited).to.be.greaterThan(0);
    lines[edited] = "        <ls_row>-text = 'HAND EDIT'.";
    copy(lines.join("\n"));
    const run = cli("check", dir);
    expect(run.status, run.stdout + run.stderr).to.equal(1);
    expect(run.stdout).to.include(`DRIFT   ${file}:${BEGIN1} r1-lookup-enrich from=before: line ${edited + 1} is "        <ls_row>-text = 'HAND EDIT'.", the recipe renders "${COPY_LINE}"`);
    expect(run.stdout).to.match(/^ok +.*from=before_mixed$/m);

    const written = await checkRegions([dir], {write: true});
    expect(written.map((r) => r.status)).to.deep.equal(["DRIFT", "ok"]);
    expect(written[0].written).to.deep.equal({from: 14, to: 14});
    expect(written[1].written, "an ok region is not rewritten").to.equal(undefined);
    expect(readFileSync(file, "utf8")).to.equal(original);
    const again = await checkRegions([dir]);
    expect(again.map((r) => r.status)).to.deep.equal(["ok", "ok"]);
  });

  it("write puts back a region that lost a line and leaves the rest of the file byte-identical", async () => {
    // the rest of the file carries its own oddities (a trailing blank, a
    // comment) which write must keep as they are
    const source = original.replace("ENDCLASS.\n\nCLASS", "ENDCLASS.   \n* kept as is\nCLASS");
    expect(source).to.not.equal(original);
    copy(source.replace(`${COPY_LINE}\n`, ""));
    const [first] = await checkRegions([dir], {write: true});
    expect(first.status).to.equal("DRIFT");
    expect(first.written).to.deep.equal({from: 13, to: 14});
    expect(readFileSync(file, "utf8")).to.equal(source);
  });

  it("mixed line endings: every region is still read, and write keeps each line's own ending", async () => {
    // the first line break CRLF, the rest LF: a parser that picks one ending
    // for the file finds no region at all and calls the file clean
    const mixed = original.replace("\n", "\r\n");
    copy(mixed);
    const results = await checkRegions([dir]);
    expect(results.map((r) => [r.status, r.params.from])).to.deep.equal([["ok", "before"], ["ok", "before_mixed"]]);
    // and a CRLF region inside the LF file is repaired with CRLF
    const crlfRegion = mixed.replace(/(from=before begin)\n([\s\S]*?)(    " osd:gen r1-lookup-enrich end)\n/,
      (all, begin, body, end) => `${begin}\r\n${body.replace(/\n/g, "\r\n")}${end}\r\n`);
    expect(crlfRegion).to.not.equal(mixed);
    copy(crlfRegion.replace(COPY_LINE, "        <ls_row>-text = 'HAND EDIT'."));
    const written = await checkRegions([dir], {write: true});
    expect(written.map((r) => r.status)).to.deep.equal(["DRIFT", "ok"]);
    expect(readFileSync(file, "utf8")).to.equal(crlfRegion);
  });

  it("write changes no byte outside the drifted region, not even one that is not UTF-8", async () => {
    const [head, tail] = original.split("CLASS zcl_osd_lift_r1_demo IMPLEMENTATION.");
    const bytes = Buffer.concat([Buffer.from(head), Buffer.from("* not UTF-8: "), Buffer.from([0xff, 0xc3]),
      Buffer.from("\nCLASS zcl_osd_lift_r1_demo IMPLEMENTATION." + tail)]);
    writeFileSync(file, Buffer.from(bytes.toString("latin1").replace(COPY_LINE, "        <ls_row>-text = 'HAND EDIT'."), "latin1"));
    const written = await checkRegions([dir], {write: true});
    expect(written.map((r) => r.status)).to.deep.equal(["DRIFT", "ok"]);
    expect(readFileSync(file).equals(bytes)).to.equal(true);
  });

  it("a marker behind code on the same line is an error, not a line nobody reads", () => {
    const source = original.replace(`    " osd:gen r1-lookup-enrich from=before_mixed begin`,
      `    CLEAR sy-subrc. " osd:gen r1-lookup-enrich from=before_mixed begin`);
    expect(() => parseRegions(source, file)).to.throw(`${file}:${BEGIN2}: an osd:gen marker must stand on a line of its own`);
  });

  it("a BEFORE that R1 refuses is REFUSED with the recipe's reason", async () => {
    copy(original.replace("WHERE kind = <ls_row>-kind AND code = <ls_row>-code.",
      "WHERE kind = <ls_row>-kind AND text = <ls_row>-text."));
    const results = await checkRegions([dir]);
    expect(results.map((r) => r.status)).to.deep.equal(["REFUSED", "ok"]);
    expect(results[0].message).to.equal("full key: WHERE names kind, text; the primary key of zosd_lift_txt is kind, code");
    expect(formatResult(results[0])).to.match(new RegExp(`^REFUSED .*:${BEGIN1} r1-lookup-enrich from=before: full key: WHERE names kind, text`));
  });

  it("a from= method the class does not have is an error at the begin marker", async () => {
    copy(original.replace("from=before_mixed begin", "from=nothing_here begin"));
    const results = await checkRegions([dir]);
    expect(results[1]).to.include({status: "ERROR", line: BEGIN2});
    expect(results[1].message).to.equal(`${file}:${BEGIN2}: from=nothing_here: no method nothing_here in class zcl_osd_lift_r1_demo`);
  });

  for (const [what, change, line, message] of [
    ["an end without a begin", (s) => s.replace(`    " osd:gen r1-lookup-enrich from=before begin\n`, ""), END1 - 1,
      "unbalanced marker: end of r1-lookup-enrich without a begin"],
    ["a begin without an end", (s) => s.replace(/(from=before_mixed begin[\s\S]*?)    " osd:gen r1-lookup-enrich end\n/, "$1"), BEGIN2,
      "unbalanced marker: r1-lookup-enrich begin has no end"],
    ["a region inside a region", (s) => s.replace(`    " osd:gen r1-lookup-enrich end\n  ENDMETHOD.\n\n  METHOD before_mixed.`, "  ENDMETHOD.\n\n  METHOD before_mixed."), BEGIN2 - 1,
      `nested region: begin inside the r1-lookup-enrich region begun at line ${BEGIN1}`],
    ["an unknown recipe", (s) => s.replace("osd:gen r1-lookup-enrich from=before_mixed begin", "osd:gen r9-nothing from=before_mixed begin"), BEGIN2,
      "unknown recipe r9-nothing (known: r1-lookup-enrich)"],
    ["a marker in the wrong form", (s) => s.replace("osd:gen r1-lookup-enrich from=before begin", "osd:gen r1-lookup-enrich from=before start"), BEGIN1,
      `malformed marker: expected '" osd:gen <recipe> [key=value]... begin|end', found '" osd:gen r1-lookup-enrich from=before start'`],
    ["a begin without from=", (s) => s.replace("osd:gen r1-lookup-enrich from=before begin", "osd:gen r1-lookup-enrich begin"), BEGIN1,
      "recipe r1-lookup-enrich needs from=<...> on its begin marker"],
  ]) {
    it(`${what} is an error with file and line`, () => {
      const source = change(original);
      expect(source).to.not.equal(original);
      expect(() => parseRegions(source, file)).to.throw(`${file}:${line}: ${message}`);
    });
  }

  it("the command line says ERROR with file and line and exits 2 on a malformed file", () => {
    copy(original.replace("osd:gen r1-lookup-enrich from=before_mixed begin", "osd:gen r9-nothing from=before_mixed begin"));
    const run = cli("check", dir);
    expect(run.status).to.equal(2);
    expect(run.stdout).to.include(`ERROR   ${file}:${BEGIN2}: unknown recipe r9-nothing`);
  });

  it("--trace maps each generated line to its template line and model path", () => {
    const run = cli("check", "src/lift", "--trace");
    expect(run.status, run.stdout + run.stderr).to.equal(0);
    const lines = original.split("\n");
    const copied = lines.indexOf(COPY_LINE) + 1;
    expect(run.stdout).to.include(`  ${copied} <- recipes/r1-lookup-enrich/template.tpl:15 /loop/row`);
  });
});

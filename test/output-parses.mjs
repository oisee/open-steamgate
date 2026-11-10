import {expect} from "chai";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {parse} from "acorn";

// **A green build is not a verdict on the artefact.** The transpiler wrote
// six modules of packs/rap-flight that Node could not parse: `UPDATE dbtab
// FROM wa` lowers to one JS property access per component of the row
// (`ls_row.get().<name>.get()`), and a component an append structure names
// `/dmo/...` or a draft table's admin include names `%...` makes that not
// JavaScript. The build was green -- it transpiles, it never loads what it
// wrote -- and the first thing that failed was the runtime's init, which
// imports every module, with an error that named no file (2026-11-08, found
// by a seed capture, fixed in tools/cds2ddic.mjs by updating such tables
// FROM TABLE). This suite is the sentence that catches the next one: every
// module the build wrote must parse.
const OUTPUT = join(process.cwd(), "output");

// The one module already broken on main, named here so that a second one is
// a failure and not a longer list: ZL3_FLEET2's `RETURN.` at the top level
// of the program is legal ABAP and the transpiler writes it as a top-level
// JS `return`, which ESM forbids -- and nothing imports the module, so
// nothing had noticed until this suite read it (ANORMALIES.md, 2026-11-08).
// An entry without a date and a reason is a way of making the check green;
// delete this one when that module is fixed.
const KNOWN_BROKEN = new Map([
  ["zl3_fleet2.prog.mjs", "RETURN at program top level, transpiler writes a top-level JS return (upstream: needs an issue)"],
]);

describe("every module the build wrote parses as JavaScript", function () {
  this.timeout(120000);
  this.retries(0);

  before(function () {
    if (!existsSync(OUTPUT)) this.skip();
  });

  it("parses each one, and names the module and the token when it does not", () => {
    const files = readdirSync(OUTPUT).filter((f) => f.endsWith(".mjs")).sort();
    expect(files.length, "there are modules to parse").to.be.greaterThan(0);
    const broken = [];
    const excused = [];
    for (const file of files) {
      // module mode, latest syntax: the runtime imports these as ESM, so
      // that is the grammar they are held to
      try {
        parse(readFileSync(join(OUTPUT, file), "utf8"), {ecmaVersion: "latest", sourceType: "module"});
      } catch (error) {
        if (KNOWN_BROKEN.has(file)) excused.push(file);
        else broken.push(`${file}: ${error.message}`);
      }
    }
    expect(broken, "the modules Node cannot load, by name").to.deep.equal([]);
    // an entry whose module is gone, or parses again, is a stale excuse
    expect(excused.sort(), "exactly the listed modules are broken").to.deep.equal([...KNOWN_BROKEN.keys()].sort());
  });
});

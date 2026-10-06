import {expect} from "chai";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {build} from "../tools/osd-build.mjs";
import {WarmCompiler} from "../tools/osd-warm.mjs";
import {UPDATE_LIMIT} from "../tools/osd-warm-update.mjs";
import {outputFiles} from "../tools/osd-transpile.mjs";

const source = (name, body = "rv = 1.") => `CLASS ${name} DEFINITION PUBLIC CREATE PUBLIC.
 PUBLIC SECTION. CLASS-METHODS get RETURNING VALUE(rv) TYPE i. ENDCLASS.
 CLASS ${name} IMPLEMENTATION. METHOD get. ${body} ENDMETHOD. ENDCLASS.`;

describe("kept registry after a cold publication", function () {
  this.timeout(30000);
  let root, compiler, logs;
  const file = name => join(root, "src", `${name}.clas.abap`);
  const cold = () => build({root, generators: false});
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-warm-update-"));
    mkdirSync(join(root, "src"));
    writeFileSync(file("zcl_a"), source("zcl_a"));
    writeFileSync(file("zcl_b"), source("zcl_b", "rv = zcl_a=>get( )."));
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: "src", output_folder: "output", libs: [], write_source_map: true,
      options: {ignoreSyntaxCheck: false, unknownTypes: "compileError"}}));
    symlinkSync(resolve("node_modules"), join(root, "node_modules"));
    await cold();
    logs = [];
    compiler = new WarmCompiler({root, log: text => logs.push(text)});
    await compiler.prime();
  });
  afterEach(() => { compiler?.drop(); rmSync(root, {recursive: true, force: true}); });

  it("adds files, reparses dependents, removes objects and keeps config and unrelated syntax", async () => {
    const reg = compiler.reg, config = reg.getConfig();
    writeFileSync(file("zcl_new"), source("zcl_new"));
    writeFileSync(join(root, "src", "zcl_new.clas.xml"), "<abapGit/>");
    writeFileSync(file("zcl_b"), source("zcl_b", "rv = zcl_new=>get( )."));
    const syntax = reg.getObject("CLAS", "ZCL_A").syntaxResult;
    const published = await cold();
    expect((await compiler.update()).hash).to.equal(published.hash);
    expect(compiler.reg).to.equal(reg);
    expect(reg.getConfig()).to.equal(config);
    expect(reg.getObject("CLAS", "ZCL_A").syntaxResult).to.equal(syntax);
    expect(compiler.closureOf("CLAS", "ZCL_NEW").map(o => o.name)).to.include("ZCL_B");
    expect(compiler.readersOf("CLAS", "ZCL_A")).to.deep.equal([]);
    writeFileSync(file("zcl_new"), source("zcl_new", "rv = 2."));
    const warm = await compiler.build();
    expect(warm.modules).to.include("zcl_b.clas.mjs");
    expect((await compiler.verify(warm.hash)).verdict).to.equal("same");
    writeFileSync(file("zcl_b"), source("zcl_b"));
    rmSync(file("zcl_new"));
    rmSync(join(root, "src", "zcl_new.clas.xml"));
    await cold();
    expect((await compiler.update()).files).to.equal(3);
    expect(reg.getObject("CLAS", "ZCL_NEW")).to.equal(undefined);
    expect(compiler.readersOf("CLAS", "ZCL_A")).to.deep.equal([]);
    expect(logs.filter(line => line.includes("warm: primed"))).to.have.length(1);
  });

  it("retains cold iteration order when a new class constructor precedes existing objects", async () => {
    const constructor = name => source(name).replace("PUBLIC SECTION.", "PUBLIC SECTION. CLASS-METHODS class_constructor.")
      .replace(`CLASS ${name} IMPLEMENTATION.`, `CLASS ${name} IMPLEMENTATION. METHOD class_constructor. ENDMETHOD.`);
    writeFileSync(file("zcl_a"), constructor("zcl_a"));
    await cold();
    compiler.drop();
    await compiler.prime();
    writeFileSync(file("zcl_0new"), constructor("zcl_0new"));
    await cold();
    const registry = compiler.reg;
    await compiler.update();
    expect(compiler.reg).to.equal(registry);
    writeFileSync(file("zcl_0new"), constructor("zcl_0new").replace("rv = 1.", "rv = 2."));
    const warm = await compiler.build();
    expect((await compiler.verify(warm.hash)).verdict).to.equal("same");
  });

  it("keeps same-name source and library object types grouped in cold script order", async () => {
    mkdirSync(join(root, "lib", "src"), {recursive: true});
    writeFileSync(join(root, "lib", "src", "zcl_a.prog.abap"), "REPORT zcl_a. WRITE 'library'.");
    const path = join(root, "abap_transpile.json"), config = JSON.parse(readFileSync(path, "utf8"));
    config.libs = [{folder: "/lib"}];
    writeFileSync(path, JSON.stringify(config));
    await cold();
    compiler.drop();
    await compiler.prime();
    writeFileSync(file("zcl_new"), source("zcl_new"));
    await cold();
    await compiler.update();
    writeFileSync(file("zcl_new"), source("zcl_new", "rv = 2."));
    const warm = await compiler.build();
    expect((await compiler.verify(warm.hash)).verdict).to.equal("same");
  });

  it("ignores non-object files when ordering library schemas and constructors", async () => {
    mkdirSync(join(root, "lib", "src"), {recursive: true});
    const constructor = name => source(name).replace("PUBLIC SECTION.", "PUBLIC SECTION. CLASS-METHODS class_constructor.")
      .replace(`CLASS ${name} IMPLEMENTATION.`, `CLASS ${name} IMPLEMENTATION. METHOD class_constructor. ENDMETHOD.`);
    for (const name of ["zcl_early", "zcl_noise"]) {
      writeFileSync(join(root, "lib", "src", `${name}.clas.abap`), constructor(name));
    }
    for (const name of ["zt_early", "zt_noise"]) {
      writeFileSync(join(root, "lib", "src", `${name}.tabl.xml`), `<abapGit><asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values>
<DD02V><TABNAME>${name.toUpperCase()}</TABNAME><TABCLASS>TRANSP</TABCLASS></DD02V>
<DD03P_TABLE><DD03P><FIELDNAME>ID</FIELDNAME><KEYFLAG>X</KEYFLAG><DATATYPE>INT4</DATATYPE><INTTYPE>I</INTTYPE><INTLEN>000004</INTLEN></DD03P></DD03P_TABLE>
</asx:values></asx:abap></abapGit>`);
    }
    // Like local/tmp/tadir.json in the ADT lifecycle: only two filename
    // components, so Registry.addFile ignores it before creating an object.
    writeFileSync(join(root, "src", "zcl_noise.json"), "{}");
    writeFileSync(join(root, "src", "zt_noise.json"), "{}");
    const path = join(root, "abap_transpile.json"), config = JSON.parse(readFileSync(path, "utf8"));
    config.libs = [{folder: "/lib"}];
    writeFileSync(path, JSON.stringify(config));
    await cold();
    compiler.drop();
    await compiler.prime();
    writeFileSync(file("zcl_a"), source("zcl_a", "rv = 2."));
    const warm = await compiler.build();
    expect((await compiler.verify(warm.hash)).verdict).to.equal("same");
    const scripts = ["init.mjs", "_init.mjs"].map(name => readFileSync(join(root, "output", name), "utf8"));
    // An independent oracle: bypass orderRegistry and use exactly the native
    // source-then-dependency admission that the cold transpiler originally used.
    const native = new compiler.core.Registry();
    for (const f of compiler.files.values()) native.addFile(new compiler.core.MemoryFile(f.filename, f.contents));
    for (const f of compiler.libs) native.addDependency(new compiler.core.MemoryFile(f.filename, f.contents));
    const keys = reg => [...reg.getObjects()].map(o => `${o.getType()} ${o.getName()}`);
    expect(keys(compiler.reg)).to.deep.equal(keys(native));
    const output = await new compiler.Transpiler(compiler.settings).run(native);
    const nativeFiles = outputFiles(output, compiler.own, join(root, "output"), [...compiler.files.values()]);
    for (const [i, name] of ["init.mjs", "_init.mjs"].entries()) {
      expect(nativeFiles.find(f => f.path === join(root, "output", name)).contents).to.equal(scripts[i]);
    }
    await build({root, generators: false, force: true, replace: true});
    for (const [i, name] of ["init.mjs", "_init.mjs"].entries()) expect(readFileSync(join(root, "output", name), "utf8")).to.equal(scripts[i]);
  });

  it("refuses a delta above the bounded threshold", async () => {
    for (let i = 0; i <= UPDATE_LIMIT; i++) writeFileSync(file(`zcl_more_${i}`), source(`zcl_more_${i}`));
    await cold();
    const error = await compiler.update().catch(e => e);
    expect(error.message).to.include(`exceeds ${UPDATE_LIMIT}`);
    expect(compiler.primed).to.equal(false);
    expect(logs.join("\n")).to.include("warm: re-prime: delta");
  });

  it("refuses INTERFACES generator input changes", async () => {
    writeFileSync(join(root, "src", "zif_new.intf.abap"), "INTERFACE zif_new PUBLIC. ENDINTERFACE.");
    writeFileSync(file("zcl_a"), source("zcl_a").replace("PUBLIC SECTION.", "PUBLIC SECTION. INTERFACES zif_new."));
    await cold();
    const error = await compiler.update().catch(e => e);
    expect(error.message).to.include("INTERFACES lines changed");
    expect(compiler.primed).to.equal(false);
  });

  it("checks delta outputs against the cold generation before keeping its premise", async () => {
    writeFileSync(file("zcl_new"), source("zcl_new"));
    const published = await cold();
    writeFileSync(join(root, "build", "by-input", published.hash, "output", "zcl_new.clas.mjs"), "// deliberately wrong output");
    const error = await compiler.update().catch(e => e);
    expect(error.message).to.include("incremental registry differs");
    expect(compiler.primed).to.equal(false);
  });
});

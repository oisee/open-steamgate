// The scissors: cutting an AMDP body out of an ABAP class, with the signature
// it needs in order to become a HANA procedure (backlog B.19).
//
// The design this serves: an AMDP body is already valid SQLScript, so HANA
// runs it natively and we never write an interpreter for a second language.
// What has to be right is therefore the cut and the type map, and that is
// what these check.
import {expect} from "chai";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {extract, procedure, hanaType, parameterType, localTypes} from "../tools/amdp-extract.mjs";

// The fixtures are kept as .abap.txt, not .abap: test/ is an input folder of
// the build, and a file that looks like a class gets transpiled -- an AMDP
// body is exactly what the transpiler refuses. The logical name is passed to
// extract() instead, which is all abaplint needs.
const fixture = (name) => readFileSync(fileURLToPath(new URL(`fixtures/amdp/${name}.txt`, import.meta.url)), "utf8");

describe("AMDP: cutting a body out of a class", () => {

  it("finds the method, its options and the body, and leaves the ABAP behind", () => {
    const r = extract(fixture("zcl_vsp_00_amdp_test.clas.abap"), "zcl_vsp_00_amdp_test.clas.abap");
    expect(r.className).to.equal("ZCL_VSP_00_AMDP_TEST");
    expect(r.methods).to.have.length(1);
    const m = r.methods[0];
    expect([m.name, m.forDb, m.language, m.readOnly]).to.deep.equal(["calculate_squares", "HDB", "SQLSCRIPT", true]);
    // the body is SQLScript and nothing but: no METHOD, no ENDMETHOD, no
    // ABAP around it. It is taken by source position, because abaplint
    // parses an AMDP body as a run of NativeSQL statements whose
    // concatenated tokens do not reproduce the source.
    expect(m.body).to.match(/^DECLARE lv_i INTEGER;/);
    expect(m.body).to.contain("WHILE lv_i <= :iv_count DO");
    expect(m.body.toUpperCase()).to.not.contain("ENDMETHOD");
    expect(m.body.toUpperCase()).to.not.contain("BY DATABASE");
  });

  it("gives each parameter its direction and its HANA type", () => {
    const r = extract(fixture("zcl_vsp_00_amdp_test.clas.abap"), "zcl_vsp_00_amdp_test.clas.abap");
    const p = r.methods[0].parameters;
    expect(p.map((x) => `${x.direction} ${x.name}`)).to.deep.equal(["IN iv_count", "OUT et_result"]);
    expect(parameterType(p[0].abapType, r.types)).to.equal("INTEGER");
    // a class-local table type becomes a HANA table type, column by column
    expect(parameterType(p[1].abapType, r.types)).to.equal("TABLE(id INTEGER, value NCLOB, square INTEGER)");
  });

  it("does not leak OPTIONAL backward across parameters on the same line", () => {
    const source = `CLASS zcl_optional_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
      PUBLIC SECTION.
        CLASS-METHODS f IMPORTING VALUE(iv_required) TYPE i VALUE(iv_optional) TYPE i OPTIONAL
          RETURNING VALUE(rv_value) TYPE i.
        CLASS-METHODS g IMPORTING VALUE(iv_comment) TYPE i. " not OPTIONAL
        CLASS-METHODS h IMPORTING VALUE(iv_named) TYPE /ns/optional.
        CLASS-METHODS f_iv_target IMPORTING VALUE(iv_other) TYPE i OPTIONAL VALUE(iv_target) TYPE i
          RETURNING VALUE(rv_other) TYPE i.
      ENDCLASS.
      CLASS zcl_optional_probe IMPLEMENTATION.
        METHOD f BY DATABASE FUNCTION FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
          rv_value = :iv_required + COALESCE(:iv_optional, 0);
        ENDMETHOD.
        METHOD g BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
          x = :iv_comment;
        ENDMETHOD.
        METHOD h BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
          x = :iv_named;
        ENDMETHOD.
        METHOD f_iv_target BY DATABASE FUNCTION FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
          rv_other = COALESCE(:iv_other, 0) + :iv_target;
        ENDMETHOD.
      ENDCLASS.`;
    const methods = extract(source, "zcl_optional_probe.clas.abap").methods;
    const method = methods.find((one) => one.name === "f");
    expect(method.parameters.map(({name, optional}) => ({name, optional}))).to.deep.equal([
      {name: "iv_required", optional: false},
      {name: "iv_optional", optional: true},
      {name: "rv_value", optional: false},
    ]);
    const secondary = methods.filter((one) => one.name !== "f").flatMap((one) => one.parameters);
    expect(secondary)
      .to.include.deep.members([
        {name: "iv_comment", direction: "IN", abapType: "i", optional: false},
        {name: "iv_named", direction: "IN", abapType: "/ns/optional", optional: false},
      ]);
    expect(methods.find((one) => one.name === "g").parameters)
      .to.deep.equal([{name: "iv_comment", direction: "IN", abapType: "i", optional: false}]);
    expect(methods.find((one) => one.name === "f_iv_target").parameters.map(({name, optional}) => ({name, optional})))
      .to.deep.equal([
        {name: "iv_other", optional: true},
        {name: "iv_target", optional: false},
        {name: "rv_other", optional: false},
      ]);
  });

  it("refuses INOUT in the scalar oracle helper instead of dropping its input value", async () => {
    const {call} = await import("../tools/amdp-run.mjs");
    let failure;
    try {
      await call({}, '"S"."P"', {parameters: [{name: "cv", direction: "INOUT", abapType: "i"}]}, {cv: 3}, new Map());
    } catch (error) { failure = error; }
    expect(failure).to.be.instanceOf(Error);
    expect(failure.message).to.match(/does not support INOUT/);
  });

  it("uses the resolved manifest TABLE type when the source type map is no longer present", async () => {
    const {call} = await import("../tools/amdp-run.mjs");
    const sql = [];
    const client = {exec(statement, callback) {
      sql.push(statement);
      if (/^CALL\b/.test(statement)) callback(undefined, {}, []);
      else callback(undefined);
    }};
    const method = {parameters: [
      {name: "it_amount", direction: "IN", abapType: "TT_AMOUNT", hanaType: "TABLE(amount INTEGER)"},
      {name: "et_total", direction: "OUT", abapType: "TT_TOTAL", hanaType: "TABLE(item_count INTEGER, total INTEGER)"},
    ]};
    await call(client, '"S"."P"', method, {it_amount: []}, undefined);
    expect(sql).to.include("CREATE LOCAL TEMPORARY COLUMN TABLE #AMDP_IN_IT_AMOUNT (amount INTEGER)");
    expect(sql.find((one) => /^CALL\b/.test(one))).to.equal('CALL "S"."P" (#AMDP_IN_IT_AMOUNT, ?)');
    expect(sql.join("\n")).to.not.contain("UNDEFINED");
  });

  it("builds a CREATE PROCEDURE that carries the body unchanged", () => {
    const r = extract(fixture("zcl_vsp_00_amdp_test.clas.abap"), "zcl_vsp_00_amdp_test.clas.abap");
    const sql = procedure(r.className, r.methods[0], "OSD", r.types);
    expect(sql).to.contain('CREATE PROCEDURE "OSD"."ZCL_VSP_00_AMDP_TEST=>CALCULATE_SQUARES"');
    expect(sql).to.contain("IN iv_count INTEGER");
    expect(sql).to.contain("OUT et_result TABLE(id INTEGER, value NCLOB, square INTEGER)");
    expect(sql).to.contain("READS SQL DATA");
    expect(sql).to.contain(r.methods[0].body);
  });

  it("does not relabel a table-function RETURNING signature as a procedure OUT", () => {
    const method = {name: "f", language: "SQLSCRIPT", readOnly: true, body: "RETURN SELECT 1 AS id FROM DUMMY;",
      parameters: [{name: "rt", direction: "RETURNING", abapType: "tt_result"}]};
    const types = new Map([
      ["TY_RESULT", {kind: "structure", components: [{name: "id", abapType: "i"}]}],
      ["TT_RESULT", {kind: "table", of: "TY_RESULT"}],
    ]);
    expect(() => procedure("ZCL_X", method, "OSD", types))
      .to.throw(/disposable procedure oracle supports scalar RETURNING only/);
  });

  it("takes the types from another object when the class does not declare them", () => {
    // the Z80 CPU keeps its types in an interface of its own, which is the
    // ordinary case rather than the exception
    const types = localTypes(fixture("zif_z80_00_amdp_types.intf.abap"));
    expect(parameterType("tt_mem", types)).to.equal("TABLE(addr INTEGER, val INTEGER)");
    expect(parameterType("tt_cpu_state", types)).to.contain("cycles BIGINT");
  });

  it("a CDS table function is checked against the method that implements it", async () => {
    const {parseTableFunction, cdsType, check} = await import("../tools/amdp-tablefunc.mjs");
    const abaplint = (await import("@abaplint/core"));
    const tf = parseTableFunction(`
      define table function ZTF_PROBE
        with parameters p_count : abap.int4
        returns { id : abap.int4; label : abap.char(40); square : abap.int4; }
        implemented by method zcl_x=>f;`, abaplint);
    expect([tf.name, tf.class, tf.method]).to.deep.equal(["ZTF_PROBE", "ZCL_X", "f"]);
    expect(tf.returns.map((r) => `${r.name} ${r.hanaType}`)).to.deep.equal(
      ["id INTEGER", "label NVARCHAR(40)", "square INTEGER"]);

    const method = {kind: "function", parameters: [
      {name: "p_count", direction: "IN", hanaType: "INTEGER"},
      {name: "rt", direction: "RETURNING", hanaType: "TABLE(id INTEGER, label NVARCHAR(40), square INTEGER)"}]};
    expect(check(tf, method), "the declarations agree").to.deep.equal([]);

    // the CDS is the authority, and a mismatch is named rather than tolerated:
    // the body fills columns by position, so a wrong width produces rows that
    // look plausible and are wrong
    const narrower = {...method, parameters: [method.parameters[0],
      {...method.parameters[1], hanaType: "TABLE(id INTEGER, label NVARCHAR(30), square INTEGER)"}]};
    expect(check(tf, narrower)[0]).to.contain("the CDS says abap.char(40)");
    const renamed = {...method, parameters: [method.parameters[0],
      {...method.parameters[1], hanaType: "TABLE(id INTEGER, caption NVARCHAR(40), square INTEGER)"}]};
    expect(check(tf, renamed)[0]).to.contain("'label' in the CDS and 'caption' in the method");
  });

  it("gives HANA's dates and times back in ABAP's spelling", async () => {
    const {abapDateTime} = await import("../tools/amdp-destination.mjs");
    // Measured against HANA Express on 2026-09-18: the driver hands DATE,
    // TIME, TIMESTAMP and SECONDDATE over as strings, not Date objects. ABAP
    // holds a date as CHAR(8) and a time as CHAR(6), so the separators go.
    expect(abapDateTime("2026-09-18")).to.equal("20260918");
    expect(abapDateTime("14:30:05")).to.equal("143005");
    expect(abapDateTime("2026-09-18T14:30:05.123")).to.equal("20260918143005");
    expect(abapDateTime("2026-09-18 14:30:05")).to.equal("20260918143005");
    // and everything else is left exactly alone, which is the part worth
    // testing: a converter that also touches what it should not is how a
    // value ends up quietly wrong
    expect(abapDateTime("20260918")).to.equal("20260918");
    expect(abapDateTime("square of 3")).to.equal("square of 3");
    expect(abapDateTime(42)).to.equal(42);
    expect(abapDateTime(null)).to.equal(null);
  });

  it("maps the ABAP types an AMDP signature can use, and says so when it cannot", () => {
    expect(hanaType("i")).to.equal("INTEGER");
    expect(hanaType("int8")).to.equal("BIGINT");
    expect(hanaType("string")).to.equal("NCLOB");
    expect(hanaType("d")).to.equal("NVARCHAR(8)");
    expect(hanaType("dats")).to.equal("NVARCHAR(8)");
    expect(hanaType("t")).to.equal("NVARCHAR(6)");
    expect(hanaType("tims")).to.equal("NVARCHAR(6)");
    expect(hanaType("c LENGTH 20")).to.equal("NVARCHAR(20)");
    expect(hanaType("p LENGTH 8 DECIMALS 2")).to.equal("DECIMAL(8, 2)");
    // an unknown type is undefined rather than guessed at, so the caller can
    // refuse instead of generating a procedure that will not compile
    expect(hanaType("zsome_unknown_type")).to.equal(undefined);
  });

});

describe("the database methods are cut out of the text, not out of abaplint's statements", () => {
  // abaplint 2.120.59 lexes a SQLScript body as ABAP: one `}` in it -- in a
  // SQLScript comment, too -- and ENDMETHOD is no longer a statement, so the
  // next method was swallowed into this one and lost
  const cls = (line, header2 = "  METHOD b BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT.") => `CLASS zcl_r DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.
    CLASS-METHODS a.
    CLASS-METHODS b.
ENDCLASS.
CLASS zcl_r IMPLEMENTATION.
  METHOD a BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT.
    declare x integer;
${line}
  ENDMETHOD.
${header2}
    declare y integer;
  ENDMETHOD.
ENDCLASS.
`;
  it("keeps both methods when a body has a } in it", () => {
    const r = extract(cls("    x = 1; -- closing ] ) }"), "zcl_r.clas.abap");
    expect(r.methods.map((m) => [m.name, m.body])).to.deep.equal([
      ["a", "declare x integer;\n    x = 1; -- closing ] ) }"],
      ["b", "declare y integer;"],
    ]);
  });
  it("ends a body at its last ENDMETHOD before the next method: a pragma, a statement before it on the line, one in a comment", () => {
    const pragma = extract(cls("    x = 1;").replace("  ENDMETHOD.\n  METHOD b", "  ENDMETHOD ##NEEDED.\n  METHOD b"), "zcl_r.clas.abap");
    expect(pragma.methods.map((m) => [m.name, m.body])).to.deep.equal([["a", "declare x integer;\n    x = 1;"], ["b", "declare y integer;"]]);
    const sameLine = extract(cls("    x = 1; ENDMETHOD.").replace("x = 1; ENDMETHOD.\n  ENDMETHOD.", "x = 1; ENDMETHOD."), "zcl_r.clas.abap");
    expect(sameLine.methods.map((m) => [m.name, m.body])).to.deep.equal([["a", "declare x integer;\n    x = 1;"], ["b", "declare y integer;"]]);
    const inComment = extract(cls("    x = 1; -- ENDMETHOD."), "zcl_r.clas.abap");
    expect(inComment.methods.map((m) => [m.name, m.body])).to.deep.equal([["a", "declare x integer;\n    x = 1; -- ENDMETHOD."], ["b", "declare y integer;"]]);
  });
  it("reads a header with a \" comment in it, a dot inside the comment", () => {
    const r = extract(cls("    x = 1;", `  METHOD b BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT " note. with a dot
    OPTIONS READ-ONLY USING zt_one.`), "zcl_r.clas.abap");
    expect(r.methods.map((m) => m.name)).to.deep.equal(["a", "b"]);
    expect([r.methods[1].readOnly, r.methods[1].usings]).to.deep.equal([true, ["zt_one"]]);
  });
  it("reads USING without the ABAP comment lines inside it, and no header from a comment", () => {
    const r = extract(cls("    x = 1;", `  METHOD b BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT USING zt_one
*                                zt_commented_out
                                 zt_two.`).replace("CLASS zcl_r IMPLEMENTATION.", `CLASS zcl_r IMPLEMENTATION.
*  METHOD c BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT.`), "zcl_r.clas.abap");
    expect(r.methods.map((m) => m.name)).to.deep.equal(["a", "b"]);
    expect(r.methods[1].usings).to.deep.equal(["zt_one", "zt_two"]);
  });
});

// abaplint parses `!x` and parses `VALUE(x)` and does not parse the two
// together: the statement comes back `Unknown` and the whole class loses its
// parameters (ANORMALY-2026-09-19-bang-value). SE24 writes exactly that
// combination, so a corpus class declared by the editor arrived signatureless
// and its bodies then looked as though they read undeclared table variables.
describe("a parameter written !VALUE(x) is still a parameter", () => {
  const withBody = (decl) => `CLASS c DEFINITION PUBLIC.
  PUBLIC SECTION.
    ${decl}
ENDCLASS.
CLASS c IMPLEMENTATION.
  METHOD m1 BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT.
    et_out = select * from :it_in;
  ENDMETHOD.
ENDCLASS.`;

  it("reads the same parameters however the declaration escapes them", async () => {
    const {extract} = await import("../tools/amdp-extract.mjs");
    const forms = [
      "CLASS-METHODS m1 IMPORTING VALUE(it_in) TYPE t EXPORTING VALUE(et_out) TYPE t.",
      "CLASS-METHODS m1 IMPORTING !VALUE(it_in) TYPE t EXPORTING !VALUE(et_out) TYPE t.",
      "CLASS-METHODS:\n      m1 IMPORTING !value(it_in) TYPE t EXPORTING !value(et_out) TYPE t,\n      m2 IMPORTING !value(iv_x) TYPE i.",
    ];
    for (const decl of forms) {
      const cls = extract(withBody(decl), "c.clas.abap");
      expect(cls.methods[0]?.parameters.map((p) => p.name), decl.slice(0, 40))
        .to.deep.equal(["it_in", "et_out"]);
    }
  });

  it("and the marker is removed for the parser only, nowhere else", async () => {
    const {withoutBangValue} = await import("../tools/amdp-extract.mjs");
    // `!name` on its own parses and is left alone; only the combination goes
    expect(withoutBangValue("IMPORTING !iv_x TYPE i")).to.equal("IMPORTING !iv_x TYPE i");
    expect(withoutBangValue("IMPORTING !VALUE(iv_x)")).to.equal("IMPORTING VALUE(iv_x)");
    // and never inside a string literal: rewriting there would change a
    // body rather than a declaration. The first version of this function did
    // exactly that, and this assertion is the one that caught it
    expect(withoutBangValue("SELECT '!VALUE(' FROM t")).to.equal("SELECT '!VALUE(' FROM t");
    expect(withoutBangValue("a = '!VALUE(x)'; METHODS m IMPORTING !VALUE(iv) TYPE i."))
      .to.equal("a = '!VALUE(x)'; METHODS m IMPORTING VALUE(iv) TYPE i.");
  });
});

// **The test that has to go red the day the workaround stops being needed.**
//
// `withoutBangValue` exists only because abaplint cannot parse `!VALUE(x)`.
// A workaround with no expiry is how a tree collects code nobody dares
// remove: the reason lives in a commit message, the commit message is read
// once, and five years later the normalisation looks load-bearing. So the
// upstream defect itself is asserted. When abaplint learns the form, this
// fails, and what it says to do is delete the workaround and this test with
// it.
describe("the abaplint gap the !VALUE workaround exists for", () => {
  it("is still there — and when this fails, remove withoutBangValue, not this test's expectation", async () => {
    const abaplint = await import("@abaplint/core");
    const source = `CLASS c DEFINITION PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS m1 IMPORTING !VALUE(iv_x) TYPE i.
ENDCLASS.
CLASS c IMPLEMENTATION.
ENDCLASS.`;
    const registry = new abaplint.Registry()
      .addFile(new abaplint.MemoryFile("c.clas.abap", source)).parse();
    const object = registry.getFirstObject();
    const kinds = object.getABAPFiles()[0].getStatements().map((s) => s.get().constructor.name);
    // A sentinel has to do two things or it goes stale unnoticed
    // (fable-osd): assert the **specific** way it breaks, and say in its own
    // message what to do when it goes red. It will go red in months, when
    // the context is gone.
    const todo = "abaplint now parses !VALUE(x). Do this, in order: delete withoutBangValue and its " +
      "call in tools/amdp-extract.mjs; delete this describe block; mark " +
      "ANOMALY-2026-09-19-bang-value fixed with the version; re-run " +
      "`node tools/sqlscript/coverage.mjs` and check the count did not fall.";
    expect(kinds, todo).to.contain("Unknown");
    // the specific breakage, not "something failed": not one method
    // mis-read, the whole class silently parameterless. Without this, an
    // unrelated change to how abaplint reports a refusal would leave the
    // test green while it checked nothing.
    expect(object.getClassDefinition?.()?.methods ?? [], todo).to.have.length(0);
  });

  it("while the two halves apart are parsed, which is what makes it a gap and not a policy", async () => {
    const abaplint = await import("@abaplint/core");
    for (const decl of ["CLASS-METHODS m1 IMPORTING !iv_x TYPE i.",
                        "CLASS-METHODS m1 IMPORTING VALUE(iv_x) TYPE i."]) {
      const source = `CLASS c DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    ${decl}\nENDCLASS.\nCLASS c IMPLEMENTATION.\nENDCLASS.`;
      const registry = new abaplint.Registry()
        .addFile(new abaplint.MemoryFile("c.clas.abap", source)).parse();
      const kinds = registry.getFirstObject().getABAPFiles()[0].getStatements()
        .map((s) => s.get().constructor.name);
      expect(kinds, decl).to.not.contain("Unknown");
    }
  });
});

// **An ABAP program cannot defend itself against a runtime throw.**
//
// `CALL FUNCTION ... DESTINATION 'AMDP'` is ABAP, and the ABAP around it
// guards itself with `CATCH cx_root`. A JavaScript Error thrown from the
// destination goes straight past that CATCH and out of the request, so a
// page that asks an honest question -- "does anything here speak SQLScript?"
// -- and is written to handle "no" gets a crash page instead of an answer.
// That is exactly how the AMDP tile answered 500 in the browser preview
// (osg-osd-i7, E.5, 2026-09-19), and it is the same family as
// ANOMALY-2026-09-14, the exception with no message.
describe("the AMDP destination fails where the calling ABAP can catch it", () => {
  it("binds its independent HANA session to the system schema", async () => {
    const {amdpSessionSchema} = await import("../tools/amdp-destination.mjs");
    expect(amdpSessionSchema("OSD_ZVDB_100")).to.deep.equal([
      `CREATE SCHEMA "OSD_ZVDB_100"`, `SET SCHEMA "OSD_ZVDB_100"`,
    ]);
  });

  it("raises an ABAP exception when the runtime has one", async () => {
    const {AmdpDestination} = await import("../tools/amdp-destination.mjs");
    const before = globalThis.abap;
    globalThis.abap = {Classes: {CX_SY_DYN_CALL_ILLEGAL_FUNC: class {
      async constructor_(input) { this.INPUT = input; return this; }
      async get_text() { return {get: () => "An exception was raised."}; }
    }}};
    try {
      let raised;
      try {
        await new AmdpDestination({}).call("ZNOT_THERE", {});
      } catch (error) {
        raised = error;
      }
      expect(raised, "it must fail").to.not.equal(undefined);
      expect(raised.constructor.name, "a JavaScript Error walks past CATCH cx_root")
        .to.equal("CX_SY_DYN_CALL_ILLEGAL_FUNC");
      expect(raised.AMDP_REASON, "and the reason a developer needs travels with it").to.contain("ZNOT_THERE");
      // the half that a property does not cover: the ABAP catching this does
      // `lv_error = lx_root->get_text( )`, which reads the class's TEXTID and
      // returns "An exception was raised." -- measured through the real
      // runtime. An exception with no message is a 500 that has learnt to
      // answer 200, which is ANOMALY-2026-09-14 over again.
      const said = await raised.get_text();
      expect(String(said?.get?.() ?? said), "get_text must say the reason, not the class's generic text")
        .to.contain("ZNOT_THERE");
    } finally {
      globalThis.abap = before;
    }
  });

  it("and a plain Error where there is no runtime at all, which is a tool calling it directly", async () => {
    const {AmdpDestination} = await import("../tools/amdp-destination.mjs");
    const before = globalThis.abap;
    globalThis.abap = undefined;
    try {
      let raised;
      try {
        await new AmdpDestination({}).call("ZNOT_THERE", {});
      } catch (error) {
        raised = error;
      }
      expect(raised.constructor.name).to.equal("Error");
      expect(raised.message).to.contain("no procedure known");
    } finally {
      globalThis.abap = before;
    }
  });
});

// The other abaplint gap this tree works around, and the older of the two:
// `tools/amdp-extract.mjs` takes an AMDP body **by source position**, between
// the end of the method statement and the start of its ENDMETHOD, rather than
// from the NativeSQL statements abaplint produces. The reason is asserted here
// for the same reason the !VALUE one is: a workaround with no expiry becomes
// load-bearing by forgetting.
//
// abaplint/abaplint#4307, opened 2026-09-19, with a fix offered the same day.
describe("the abaplint gap the position-based AMDP extraction exists for", () => {
  it("is still there — and when this fails, take the body from the statements, do not adjust this", async () => {
    const abaplint = await import("@abaplint/core");
    const source = `CLASS zcl_amdp_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.
    CLASS-METHODS squares.
ENDCLASS.

CLASS zcl_amdp_probe IMPLEMENTATION.
  METHOD squares BY DATABASE PROCEDURE FOR HDB
                 LANGUAGE SQLSCRIPT
                 OPTIONS READ-ONLY.
    SELECT :a AS x, :b AS y FROM dummy;
  ENDMETHOD.
ENDCLASS.`;
    const registry = new abaplint.Registry()
      .addFile(new abaplint.MemoryFile("zcl_amdp_probe.clas.abap", source)).parse();
    const native = registry.getFirstObject().getABAPFiles()[0].getStatements()
      .filter((s) => s.get().constructor.name === "NativeSQL")
      .map((s) => s.concatTokens());
    const todo = "abaplint now keeps a colon inside native SQL (#4307). Do this, in order: take the " +
      "body from the NativeSQL statements in tools/amdp-extract.mjs instead of by source position; " +
      "delete this describe block; mark the anomaly fixed with the version; re-run " +
      "`node tools/sqlscript/coverage.mjs` and check the count did not fall.";
    // the SPECIFIC breakage, twice over, so that an unrelated change to how
    // abaplint reports statements cannot leave this green while it checks
    // nothing: the body is cut in two, and the colons are gone from it
    expect(native, todo).to.have.length(2);
    expect(native.join(" "), todo).to.not.contain(":a");
  });
});

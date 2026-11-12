import {expect} from "chai";
import {ddicFields, ddicFieldsWithIncludes, domaXml, dtelXml, mandtFirstKey, tablXml} from "../tools/hana-ddic-map.mjs";

// The DD03L -> our *.tabl.xml shape mapping (tools/hana-ddic-map.mjs), as a
// pure function: fixture rows with made-up names, no database.
//
// The rows are shaped exactly as a HANA read hands them to query(): keys in
// lower case (the client folds them on the way out), LENG/DECIMALS/POSITION
// as the dictionary holds them. The names are invented for this test; a real
// system's table names must never appear here (the leak list exists for a
// reason).
describe("the DD03L to abapGit TABL mapping", () => {
  // one table carrying every type this slice maps, a key with MANDT first,
  // and one field typed only through its data element and one through that
  // element's domain, so the DD04L and DD01L hops are exercised too.
  const dd03l = [
    {position: "1", fieldname: "MANDT", keyflag: "X", rollname: "MANDT", datatype: "CLNT", leng: "3", decimals: "0", inttype: "C", notnull: "X"},
    {position: "2", fieldname: "ZOSD_H1_KEY", keyflag: "X", rollname: "", datatype: "CHAR", leng: "10", decimals: "0", inttype: "C", notnull: "X"},
    {position: "3", fieldname: "ZOSD_H1_CODE", keyflag: "", rollname: "", datatype: "NUMC", leng: "4", decimals: "0", inttype: "N", notnull: ""},
    {position: "4", fieldname: "ZOSD_H1_DATE", keyflag: "", rollname: "", datatype: "DATS", leng: "8", decimals: "0", inttype: "D", notnull: ""},
    {position: "5", fieldname: "ZOSD_H1_TIME", keyflag: "", rollname: "", datatype: "TIMS", leng: "6", decimals: "0", inttype: "T", notnull: ""},
    {position: "6", fieldname: "ZOSD_H1_AMT", keyflag: "", rollname: "", datatype: "DEC", leng: "15", decimals: "2", inttype: "P", notnull: ""},
    {position: "7", fieldname: "ZOSD_H1_COUNT", keyflag: "", rollname: "", datatype: "INT4", leng: "10", decimals: "0", inttype: "I", notnull: ""},
    {position: "8", fieldname: "ZOSD_H1_HASH", keyflag: "", rollname: "", datatype: "RAW", leng: "4", decimals: "0", inttype: "X", notnull: ""},
    {position: "9", fieldname: "ZOSD_H1_MEMO", keyflag: "", rollname: "", datatype: "STRG", leng: "0", decimals: "0", inttype: "g", notnull: ""},
    {position: "10", fieldname: "ZOSD_H1_ELEM", keyflag: "", rollname: "ZOSD_H1_DTEL_CHAR", datatype: "", leng: "", decimals: "", inttype: "", notnull: ""},
    {position: "11", fieldname: "ZOSD_H1_VIA_DOMA", keyflag: "", rollname: "ZOSD_H1_DTEL_DOMA", datatype: "", leng: "", decimals: "", inttype: "", notnull: ""},
  ];
  // DD04L and DD01L rows, shaped as the measured column lists read them:
  // DATATYPE, LENG, DECIMALS (and DD04L's DOMNAME). No INTTYPE anywhere --
  // that column lives on DD03L only, which is what the probe's first run
  // against a real system taught (test/hana-ddic-probe.mjs pins the lists)
  const elements = new Map([
    ["ZOSD_H1_DTEL_CHAR", {datatype: "CHAR", leng: "3", decimals: "0"}],
    // a data element usually has no type of its own: it names a domain, and
    // the domain carries the type (the same hop tools/adt-documents.mjs makes)
    ["ZOSD_H1_DTEL_DOMA", {datatype: "", leng: "", decimals: "", domname: "ZOSD_H1_DOMA_DEC"}],
  ]);
  const domains = new Map([
    ["ZOSD_H1_DOMA_DEC", {datatype: "DEC", leng: "9", decimals: "2"}],
  ]);

  it("maps every field, in POSITION order", () => {
    const fields = ddicFields(dd03l, {elements, domains});
    expect(fields.map((f) => f.fieldname)).to.deep.equal([
      "MANDT", "ZOSD_H1_KEY", "ZOSD_H1_CODE", "ZOSD_H1_DATE", "ZOSD_H1_TIME",
      "ZOSD_H1_AMT", "ZOSD_H1_COUNT", "ZOSD_H1_HASH", "ZOSD_H1_MEMO",
      "ZOSD_H1_ELEM", "ZOSD_H1_VIA_DOMA",
    ]);
  });

  it("keeps the key flags: MANDT first, one CHAR key beside it, the rest open", () => {
    const fields = ddicFields(dd03l, {elements, domains});
    expect(fields[0].key).to.equal(true);
    expect(fields[1].key).to.equal(true);
    expect(fields[1].notnull).to.equal(true);
    expect(fields[2].key, "a non-key field stays non-key").to.equal(false);
    expect(fields[2].notnull).to.equal(false);
  });

  it("maps the built-in types, INTLEN included", () => {
    const byName = new Map(ddicFields(dd03l, {elements, domains}).map((f) => [f.fieldname, f]));
    // CHAR/NUMC are two bytes a character in the dictionary's internal length
    expect(byName.get("ZOSD_H1_KEY")).to.include({datatype: "CHAR", leng: "000010", intlen: "000020", inttype: "C"});
    expect(byName.get("ZOSD_H1_CODE")).to.include({datatype: "NUMC", leng: "000004", intlen: "000008", inttype: "N"});
    // DATS 16 and TIMS 12, as every tabl.xml of this tree spells them
    expect(byName.get("ZOSD_H1_DATE")).to.include({datatype: "DATS", leng: "000008", intlen: "000016"});
    expect(byName.get("ZOSD_H1_TIME")).to.include({datatype: "TIMS", leng: "000006", intlen: "000012"});
    // packed: (digits + 1) / 2 rounded up, decimals kept
    expect(byName.get("ZOSD_H1_AMT")).to.include({datatype: "DEC", leng: "000015", intlen: "000008", decimals: "000002"});
    expect(byName.get("ZOSD_H1_COUNT")).to.include({datatype: "INT4", leng: "000010", intlen: "000004"});
    // raw: the length is the byte count
    expect(byName.get("ZOSD_H1_HASH")).to.include({datatype: "RAW", leng: "000004", intlen: "000004"});
    // a string has no length: zero, and an 8-byte reference
    expect(byName.get("ZOSD_H1_MEMO")).to.include({datatype: "STRG", leng: "000000", intlen: "000008", inttype: "g"});
    // where each half came from: these rows carry DD03L's own INTTYPE and
    // leave its INTLEN blank, so only the INTLEN was derived
    expect(byName.get("ZOSD_H1_CODE").inttypeFrom).to.equal("dd03l");
    expect(byName.get("ZOSD_H1_CODE").intlenFrom).to.equal("derived");
  });

  it("resolves a field typed only by its data element, and through the domain", () => {
    const byName = new Map(ddicFields(dd03l, {elements, domains}).map((f) => [f.fieldname, f]));
    expect(byName.get("ZOSD_H1_ELEM")).to.include({datatype: "CHAR", leng: "000003", intlen: "000006", rollname: "ZOSD_H1_DTEL_CHAR"});
    expect(byName.get("ZOSD_H1_VIA_DOMA")).to.include({datatype: "DEC", leng: "000009", intlen: "000005", decimals: "000002", rollname: "ZOSD_H1_DTEL_DOMA"});
  });

  it("prefers DD03L's own INTTYPE and INTLEN; derives only what it leaves blank", () => {
    const byName = new Map(ddicFields([
      // CHAR leng 10 would derive C and 000020; DD03L's own pair is what the
      // system says, and it wins
      {position: "1", fieldname: "ZOSD_H1_OWN", keyflag: "", rollname: "", datatype: "CHAR", leng: "10", decimals: "0", inttype: "N", intlen: "000008", notnull: ""},
      // the pair blank: derived from the DATATYPE and the type rules, and
      // said to be derived
      {position: "2", fieldname: "ZOSD_H1_BLANK", keyflag: "", rollname: "", datatype: "DEC", leng: "9", decimals: "2", inttype: "", intlen: "", notnull: ""},
    ]).map((f) => [f.fieldname, f]));
    expect(byName.get("ZOSD_H1_OWN")).to.include({inttype: "N", intlen: "000008", inttypeFrom: "dd03l", intlenFrom: "dd03l"});
    expect(byName.get("ZOSD_H1_BLANK")).to.include({inttype: "P", intlen: "000005", inttypeFrom: "derived", intlenFrom: "derived"});
  });

  it("refuses a field whose type resolves to nothing, by name", () => {
    const orphan = [{position: "1", fieldname: "ZOSD_H1_ORPHAN", keyflag: "", rollname: "ZOSD_H1_NO_DTEL", datatype: "", leng: "", decimals: "", inttype: "", notnull: ""}];
    let error;
    try { ddicFields(orphan, {elements, domains}); } catch (e) { error = e; }
    expect(error?.message).to.include("ZOSD_H1_ORPHAN");
    expect(error?.message).to.include("ZOSD_H1_NO_DTEL");
  });

  it("carries a CURR/QUAN field's reference as DD03L says it: REFTABLE, PRECFIELD, REFFIELD", () => {
    // a currency amount points at the CUKY field its currency is read from,
    // a quantity at the UNIT field; DD03L carries the reference as REFTABLE
    // plus REFFIELD, and PRECFIELD beside it as DD03L's own position marker.
    // Without them the emitted XML is a packed field with no reference: it
    // does not round-trip against what a system's own abapGit export writes,
    // and --diff cannot see reference drift on the most common SAP field
    // kinds (the critic round's SHOULD 3). The rows are keyed as query()
    // hands them over -- column names folded to lower case, so DD03L's
    // PRECFIELD arrives as `precfield`. Round 2's fixtures spelled the key
    // `preffield`, the same misspelling the map read, and passed without a
    // value ever moving.
    const rows = [
      {position: "1", fieldname: "MANDT", keyflag: "X", rollname: "MANDT", datatype: "CLNT", leng: "3", decimals: "0", inttype: "C", notnull: "X"},
      {position: "2", fieldname: "ZOSD_H1_AMT", keyflag: "", rollname: "", datatype: "CURR", leng: "13", decimals: "2", inttype: "P", intlen: "000007", notnull: "", reftable: "ZOSD_H1_REF", reffield: "ZOSD_H1_WAERS"},
      {position: "3", fieldname: "ZOSD_H1_WAERS", keyflag: "", rollname: "", datatype: "CUKY", leng: "5", decimals: "0", inttype: "C", notnull: ""},
      {position: "4", fieldname: "ZOSD_H1_QTY", keyflag: "", rollname: "", datatype: "QUAN", leng: "13", decimals: "3", inttype: "P", intlen: "000007", notnull: "", reftable: "ZOSD_H1_REF", precfield: "ZOSD_H1_AMT", reffield: "ZOSD_H1_UNIT"},
      {position: "5", fieldname: "ZOSD_H1_UNIT", keyflag: "", rollname: "", datatype: "UNIT", leng: "3", decimals: "0", inttype: "C", notnull: ""},
    ];
    const byName = new Map(ddicFields(rows).map((f) => [f.fieldname, f]));
    expect(byName.get("ZOSD_H1_AMT")).to.include({datatype: "CURR", intlen: "000007", reftable: "ZOSD_H1_REF", reffield: "ZOSD_H1_WAERS"});
    expect(byName.get("ZOSD_H1_QTY")).to.include({datatype: "QUAN", reftable: "ZOSD_H1_REF", precfield: "ZOSD_H1_AMT", reffield: "ZOSD_H1_UNIT"});
    // what the row leaves blank stays absent: an empty tag would drift from
    // what a system's own export writes
    expect(byName.get("ZOSD_H1_WAERS")).to.not.have.property("reffield");
    expect(byName.get("ZOSD_H1_WAERS")).to.not.have.property("precfield");
    // the XML, in DD03P's own component order: INTLEN, then the reference,
    // then NOTNULL
    const xml = tablXml({name: "ZOSD_H1_REF", text: "reference fixture table", fields: ddicFields(rows)});
    expect(xml).to.match(/<FIELDNAME>ZOSD_H1_AMT<\/FIELDNAME>[\s\S]*?<INTLEN>000007<\/INTLEN>\s*<REFTABLE>ZOSD_H1_REF<\/REFTABLE>\s*<REFFIELD>ZOSD_H1_WAERS<\/REFFIELD>/);
    expect(xml).to.match(/<FIELDNAME>ZOSD_H1_QTY<\/FIELDNAME>[\s\S]*?<REFTABLE>ZOSD_H1_REF<\/REFTABLE>\s*<PRECFIELD>ZOSD_H1_AMT<\/PRECFIELD>\s*<REFFIELD>ZOSD_H1_UNIT<\/REFFIELD>/);
  });

  it("names an .INCLUDE row's structure in the refusal, from DD03L's PRECFIELD", () => {
    // ddicFields reads PRECFIELD for the include's name -- the same column
    // the mapping carries for ordinary rows, and the one
    // tools/dsl-ddic.mjs reads for key includes. The row is keyed as the
    // client delivers it: until fix round 3 the map read `row.preffield`,
    // an ff spelling that matches neither the column nor what query()
    // hands over, and the refusal said "(no name)" against a real DD03L.
    const rows = [{position: "1", fieldname: ".INCLUDE", precfield: "ZOSD_H1_SUB"}];
    let error;
    try { ddicFields(rows); } catch (e) { error = e; }
    expect(error?.message).to.include("ZOSD_H1_SUB");
  });

  it("says which tables have MANDT as the first key field", () => {
    expect(mandtFirstKey(ddicFields(dd03l, {elements, domains}))).to.equal(true);
    const noClient = ddicFields([
      {position: "1", fieldname: "ZOSD_H1_PLAIN_KEY", keyflag: "X", rollname: "", datatype: "CHAR", leng: "4", decimals: "0", inttype: "C", notnull: "X"},
      {position: "2", fieldname: "ZOSD_H1_MANDT", keyflag: "X", rollname: "MANDT", datatype: "CLNT", leng: "3", decimals: "0", inttype: "C", notnull: "X"},
    ], {elements, domains});
    // MANDT as a key is not MANDT as the FIRST key field
    expect(mandtFirstKey(noClient)).to.equal(false);
  });

  it("emits the abapGit TABL XML of this tree", () => {
    const xml = tablXml({name: "ZOSD_H1_HEAD", text: "H1 probe fixture table", clidep: true,
      fields: ddicFields(dd03l, {elements, domains})});
    expect(xml).to.include(`<?xml version="1.0" encoding="utf-8"?>`);
    expect(xml).to.include(`<TABNAME>ZOSD_H1_HEAD</TABNAME>`);
    expect(xml).to.include(`<TABCLASS>TRANSP</TABCLASS>`);
    expect(xml).to.include(`<CLIDEP>X</CLIDEP>`);
    expect(xml).to.include(`<DDTEXT>H1 probe fixture table</DDTEXT>`);
    expect(xml).to.include(`<DD09L>`);
    // the client field, in the shape every table of this tree writes it
    expect(xml).to.include(`<FIELDNAME>MANDT</FIELDNAME>
     <KEYFLAG>X</KEYFLAG>
     <ROLLNAME>MANDT</ROLLNAME>
     <ADMINFIELD>0</ADMINFIELD>
     <NOTNULL>X</NOTNULL>
     <COMPTYPE>E</COMPTYPE>`);
    // the decimal field, resolved and spelled out to the end
    expect(xml).to.match(/<FIELDNAME>ZOSD_H1_AMT<\/FIELDNAME>[\s\S]*?<DATATYPE>DEC<\/DATATYPE>[\s\S]*?<LENG>000015<\/LENG>[\s\S]*?<DECIMALS>000002<\/DECIMALS>/);
    // a non-key field carries neither KEYFLAG nor NOTNULL
    expect(xml).to.not.match(/<FIELDNAME>ZOSD_H1_CODE<\/FIELDNAME>\s*<KEYFLAG/);
    expect(xml).to.include(`<MASK>  DEC</MASK>`);
  });

  // the dump path (H5a): a dump carries every DD02L table's DD03L, so an
  // .INCLUDE row is not a refusal there -- the include's fields arrive in
  // the include's place, in their own POSITION order. The outer rows keep
  // the order their positions give them, and the spliced rows are not
  // re-sorted against them (their positions are their own table's and would
  // collide with the outer ones).
  it("splices an .INCLUDE row from the other DD03L reads of the same dump (H5a)", () => {
    const rows = [
      {position: "1", fieldname: "MANDT", keyflag: "X", rollname: "MANDT", datatype: "CLNT", leng: "3", decimals: "0", inttype: "C", intlen: "000006", notnull: "X"},
      {position: "3", fieldname: ".INCLUDE", precfield: "ZOSD_H1_STAMP"},
      {position: "5", fieldname: "ZOSD_H1_TAIL", keyflag: "", rollname: "", datatype: "CHAR", leng: "2", decimals: "0", inttype: "C", intlen: "000004", notnull: ""},
    ];
    const includes = new Map([["ZOSD_H1_STAMP", [
      // the include's own positions decide inside it, here 2 then 1
      {position: "2", fieldname: "ZOSD_H1_STAMP_A", keyflag: "", rollname: "", datatype: "TIMS", leng: "6", decimals: "0", inttype: "T", intlen: "000012", notnull: ""},
      {position: "1", fieldname: "ZOSD_H1_STAMP_D", keyflag: "", rollname: "", datatype: "DATS", leng: "8", decimals: "0", inttype: "D", intlen: "000016", notnull: ""},
    ]]]);
    const fields = ddicFieldsWithIncludes(rows, {}, includes);
    expect(fields.map((f) => f.fieldname)).to.deep.equal(
      ["MANDT", "ZOSD_H1_STAMP_D", "ZOSD_H1_STAMP_A", "ZOSD_H1_TAIL"]);
  });

  it("an include whose DD03L is not in the dump is refused by name, and a cycle too", () => {
    const row = {position: "1", fieldname: ".INCLUDE", precfield: "ZOSD_H1_ABSENT"};
    let error;
    try { ddicFieldsWithIncludes([row], {}, new Map()); } catch (e) { error = e; }
    expect(error?.message).to.include("ZOSD_H1_ABSENT");
    const cycle = new Map([["ZOSD_H1_A", [{position: "1", fieldname: ".INCLUDE", precfield: "ZOSD_H1_B"}]],
      ["ZOSD_H1_B", [{position: "1", fieldname: ".INCLUDE", precfield: "ZOSD_H1_A"}]]]);
    error = undefined;
    try {
      ddicFieldsWithIncludes(cycle.get("ZOSD_H1_A"), {}, cycle, new Set(["ZOSD_H1_B"]));
    } catch (e) { error = e; }
    expect(error?.message).to.match(/cycle/);
  });

  // CRITIC-926 SHOULD 5: every .INCLU- form names its structure in
  // PRECFIELD -- abaplint reads it there for every form (table.js). The
  // suffix rides on the marker: a .INCLU-01 row splices the structure with
  // "01" appended to every name it brings in, the rename abaplint applies
  // reading the same DD03P; an append (.APPEND, and .INCLU--AP, which is
  // how the dictionary spells an append) splices without a rename.
  it("splices .INCLU-01 and .APPEND rows like .INCLUDE, the suffix kept on the names", () => {
    const rows = [
      {position: "1", fieldname: "MANDT", keyflag: "X", rollname: "MANDT", datatype: "CLNT", leng: "3", decimals: "0", inttype: "C", intlen: "000006", notnull: "X"},
      {position: "2", fieldname: ".INCLU-01", precfield: "ZOSD_H1_STAMP"},
      {position: "3", fieldname: ".APPEND", precfield: "ZOSD_H1_APPEND"},
      {position: "4", fieldname: "ZOSD_H1_TAIL", keyflag: "", rollname: "", datatype: "CHAR", leng: "2", decimals: "0", inttype: "C", intlen: "000004", notnull: ""},
    ];
    const includes = new Map([
      ["ZOSD_H1_STAMP", [
        // the include itself carries an .INCLUDE: the outer suffix renames
        // the whole subtree it splices in
        {position: "1", fieldname: ".INCLUDE", precfield: "ZOSD_H1_DEEP"},
        {position: "2", fieldname: "ZOSD_H1_STAMP_A", keyflag: "", rollname: "", datatype: "TIMS", leng: "6", decimals: "0", inttype: "T", intlen: "000012", notnull: ""},
      ]],
      ["ZOSD_H1_DEEP", [
        {position: "1", fieldname: "ZOSD_H1_DEEP_D", keyflag: "", rollname: "", datatype: "DATS", leng: "8", decimals: "0", inttype: "D", intlen: "000016", notnull: ""},
      ]],
      ["ZOSD_H1_APPEND", [
        {position: "1", fieldname: "ZOSD_H1_AP_F1", keyflag: "", rollname: "", datatype: "CHAR", leng: "4", decimals: "0", inttype: "C", intlen: "000008", notnull: ""},
      ]],
    ]);
    const fields = ddicFieldsWithIncludes(rows, {}, includes);
    expect(fields.map((f) => f.fieldname)).to.deep.equal(
      ["MANDT", "ZOSD_H1_DEEP_D01", "ZOSD_H1_STAMP_A01", "ZOSD_H1_AP_F1", "ZOSD_H1_TAIL"]);
    // .INCLU--AP is the dictionary's append spelling: no rename
    const ap = ddicFieldsWithIncludes([{position: "1", fieldname: ".INCLU--AP", precfield: "ZOSD_H1_APPEND"}], {}, includes);
    expect(ap.map((f) => f.fieldname)).to.deep.equal(["ZOSD_H1_AP_F1"]);
  });

  it("refuses a dot row by its marker when PRECFIELD is blank, and names both otherwise", () => {
    let error;
    try { ddicFieldsWithIncludes([{position: "1", fieldname: ".INCLU-02"}], {}, new Map()); } catch (e) { error = e; }
    expect(error?.message).to.include(".INCLU-02");
    error = undefined;
    try { ddicFieldsWithIncludes([{position: "1", fieldname: ".INCLU-05", precfield: "ZOSD_H1_ABSENT"}], {}, new Map()); } catch (e) { error = e; }
    expect(error?.message).to.include(".INCLU-05");
    expect(error?.message).to.include("ZOSD_H1_ABSENT");
  });

  it("a structured component carries its own COMPTYPE (H5a: DD03L COMPTYPE S)", () => {
    const fields = ddicFields([
      {position: "1", fieldname: "ZOSD_H1_ADDR", keyflag: "", rollname: "ZOSD_H1_STRUCT", comptype: "S", datatype: "STRU", leng: "000000", decimals: "000000", inttype: "", intlen: "000000", notnull: ""},
    ], {});
    expect(fields[0]).to.include({rollname: "ZOSD_H1_STRUCT", comptype: "S", datatype: "STRU"});
    // a structure is not a TRANSP table: the dump's INTTAB rows go out in the
    // include shape, no DD09L and no client
    const xml = tablXml({name: "ZOSD_H1_WITH_STRUCT", text: "h1 fixture structure", clidep: false, tabclass: "INTTAB", fields});
    expect(xml).to.include(`<TABCLASS>INTTAB</TABCLASS>`);
    expect(xml).to.not.include(`<DD09L>`);
    expect(xml).to.include(`<ROLLNAME>ZOSD_H1_STRUCT</ROLLNAME>
     <COMPTYPE>S</COMPTYPE>`);
    // a structured component's DD03L row carries INTTYPE blank: an empty
    // tag is the drift the module refuses everywhere else, so the tag only
    // goes out when there is a letter (CRITIC-926 SHOULD 2). MASK spells
    // the component kind the way a system's own export does -- "      S",
    // not "  STRU" (abaplint reads neither for COMPTYPE S)
    expect(xml).to.not.include(`<INTTYPE></INTTYPE>`);
    expect(xml).to.include(`<MASK>      S</MASK>`);
    // the live path's tables, with no TABCLASS named, stay TRANSP
    expect(tablXml({name: "ZOSD_H1_HEAD", text: "", clidep: true, fields: []})).to.include(`<TABCLASS>TRANSP</TABCLASS>`);
  });

  // CRITIC-926 SHOULD 3: TABCLASS was reduced to a boolean, and an APPEND/
  // VIEW/POOL row went out silently as an INTTAB structure -- a pool as a
  // type that holds no rows, an append as a free-standing structure. The
  // two kinds this path writes are TRANSP and INTTAB; anything else is
  // refused by name.
  it("refuses a TABCLASS this path does not write, by name", () => {
    for (const tabclass of ["APPEND", "VIEW", "POOL", "CLUSTER"]) {
      let error;
      try { tablXml({name: `ZOSD_H1_${tabclass}`, text: "", clidep: true, tabclass, fields: []}); } catch (e) { error = e; }
      expect(error?.message, tabclass).to.include(`ZOSD_H1_${tabclass}`);
      expect(error?.message, tabclass).to.include(tabclass);
    }
    expect(tablXml({name: "ZOSD_H1_TRANSP", text: "", clidep: true, tabclass: "TRANSP", fields: []})).to.include(`<TABCLASS>TRANSP</TABCLASS>`);
    expect(tablXml({name: "ZOSD_H1_INTTAB", text: "", clidep: false, tabclass: "INTTAB", fields: []})).to.include(`<TABCLASS>INTTAB</TABCLASS>`);
  });

  // CRITIC-926 SHOULD 4: the TABL header's DDLANGUAGE was a hard-coded E
  // while the DDTEXT was picked in the master language. The language rides
  // with the text, and a table with no text in that language goes out
  // without the DDTEXT, not with an empty tag.
  it("the TABL header carries the master language, and drops an empty DDTEXT", () => {
    const german = tablXml({name: "ZOSD_H1_LANG", text: "h1 fixture (de)", clidep: true, tabclass: "TRANSP", language: "D", fields: []});
    expect(german).to.include(`<DDLANGUAGE>D</DDLANGUAGE>`);
    expect(german).to.include(`<DDTEXT>h1 fixture (de)</DDTEXT>`);
    const noText = tablXml({name: "ZOSD_H1_NOTEXT", text: "", clidep: false, fields: []});
    expect(noText).to.include(`<DDLANGUAGE>E</DDLANGUAGE>`);
    expect(noText).to.not.include(`<DDTEXT>`);
  });
});

// CRITIC-926 SHOULD 1 + 6: the DTEL/DOMA writers pinned whole-file, tag
// order and all -- swapping two tags (the critic's mutations) has to go
// red. The element rows are shaped like the real dump's DD04L (measured
// 2026-11-12): a domain-typed row is REFKIND D with DOMNAME and the
// domain's own DATATYPE/LENG/DECIMALS/OUTPUTLEN copied onto the element
// row -- abapGit clears the copy and resolves the type through the domain
// -- and a predefined row is REFKIND blank with its own DATATYPE, the
// initial values dropped.
describe("dtelXml/domaXml: the abapGit file byte for byte", () => {
  const envelope = (serializer, values) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_${serializer}" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
${values}  </asx:values>
 </asx:abap>
</abapGit>
`;

  it("a domain-typed element: DOMNAME third, none of the type tags", () => {
    const xml = dtelXml({
      name: "ZOSD_H1_DTEL_DOM",
      // the copied type fields sit on the row and must not reach the XML;
      // the keys are the dumpRows-folded lower-case ones the generator
      // hands the writer
      row: {rollname: "ZOSD_H1_DTEL_DOM", domname: "ZOSD_H1_DOMA", datatype: "CHAR",
        leng: "000001", decimals: "000000", outputlen: "000001",
        headlen: "12", scrlen1: "10", scrlen2: "12", scrlen3: "12",
        dtelmaster: "E", refkind: "D"},
      trow: {ddtext: "h1 fixture element", reptext: "Elem", scrtext_s: "El", scrtext_m: "Elem", scrtext_l: "Element"},
      masterLanguage: "E",
    });
    expect(xml).to.equal(`${envelope("DTEL", `   <DD04V>
    <ROLLNAME>ZOSD_H1_DTEL_DOM</ROLLNAME>
    <DDLANGUAGE>E</DDLANGUAGE>
    <DOMNAME>ZOSD_H1_DOMA</DOMNAME>
    <HEADLEN>12</HEADLEN>
    <SCRLEN1>10</SCRLEN1>
    <SCRLEN2>12</SCRLEN2>
    <SCRLEN3>12</SCRLEN3>
    <DDTEXT>h1 fixture element</DDTEXT>
    <REPTEXT>Elem</REPTEXT>
    <SCRTEXT_S>El</SCRTEXT_S>
    <SCRTEXT_M>Elem</SCRTEXT_M>
    <SCRTEXT_L>Element</SCRTEXT_L>
    <DTELMASTER>E</DTELMASTER>
    <REFKIND>D</REFKIND>
   </DD04V>
`)}`);
  });

  it("a predefined-typed element: the type tags after DTELMASTER, the zeros dropped", () => {
    const xml = dtelXml({
      name: "ZOSD_H1_DTEL_STRG",
      // the real dump's one string element: LENG/DECIMALS/OUTPUTLEN all
      // zero, and the export spells DATATYPE alone
      row: {rollname: "ZOSD_H1_DTEL_STRG", datatype: "STRG", leng: "000000",
        decimals: "000000", outputlen: "000000", headlen: "11",
        scrlen1: "10", scrlen2: "11", scrlen3: "11", dtelmaster: "E", refkind: ""},
      trow: {ddtext: "h1 fixture string"},
      masterLanguage: "E",
    });
    expect(xml).to.equal(`${envelope("DTEL", `   <DD04V>
    <ROLLNAME>ZOSD_H1_DTEL_STRG</ROLLNAME>
    <DDLANGUAGE>E</DDLANGUAGE>
    <HEADLEN>11</HEADLEN>
    <SCRLEN1>10</SCRLEN1>
    <SCRLEN2>11</SCRLEN2>
    <SCRLEN3>11</SCRLEN3>
    <DDTEXT>h1 fixture string</DDTEXT>
    <DTELMASTER>E</DTELMASTER>
    <DATATYPE>STRG</DATATYPE>
   </DD04V>
`)}`);
  });

  it("a domain with values: the DD01V and the DD07V_TAB", () => {
    const xml = domaXml({
      name: "ZOSD_H1_DOMA",
      row: {domname: "ZOSD_H1_DOMA", datatype: "CHAR", leng: "000001",
        decimals: "000000", outputlen: "000001", lowercase: "X", valexi: "X", dommaster: "E"},
      text: "h1 fixture domain",
      masterLanguage: "E",
      // given out of VALPOS order: the writer sorts
      values: [
        {domname: "ZOSD_H1_DOMA", valpos: "0002", domvalue_l: "C", domvalue_h: "Z", ddtext: "custom"},
        {domname: "ZOSD_H1_DOMA", valpos: "0001", domvalue_l: "N", domvalue_h: "", ddtext: "no"},
      ],
    });
    expect(xml).to.equal(`${envelope("DOMA", `   <DD01V>
    <DOMNAME>ZOSD_H1_DOMA</DOMNAME>
    <DDLANGUAGE>E</DDLANGUAGE>
    <DATATYPE>CHAR</DATATYPE>
    <LENG>000001</LENG>
    <DECIMALS>000000</DECIMALS>
    <OUTPUTLEN>000001</OUTPUTLEN>
    <LOWERCASE>X</LOWERCASE>
    <VALEXI>X</VALEXI>
    <DDTEXT>h1 fixture domain</DDTEXT>
   </DD01V>
   <DD07V_TAB>
    <DD07V>
     <DOMNAME>ZOSD_H1_DOMA</DOMNAME>
     <VALPOS>0001</VALPOS>
     <DDLANGUAGE>E</DDLANGUAGE>
     <DOMVALUE_L>N</DOMVALUE_L>
     <DDTEXT>no</DDTEXT>
    </DD07V>
    <DD07V>
     <DOMNAME>ZOSD_H1_DOMA</DOMNAME>
     <VALPOS>0002</VALPOS>
     <DDLANGUAGE>E</DDLANGUAGE>
     <DOMVALUE_L>C</DOMVALUE_L>
     <DOMVALUE_H>Z</DOMVALUE_H>
     <DDTEXT>custom</DDTEXT>
    </DD07V>
   </DD07V_TAB>
`)}`);
  });
});

import {expect} from "chai";
import {mkdtempSync, readdirSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SQLiteDatabaseClient} from "@abaplint/database-sqlite";
import {ABAP, MemoryConsole} from "@abaplint/runtime";
import {modulesOf} from "../tools/osd-transpile.mjs";
import {installTableProxy, parseRows, readTables, tableAllowMatcher, tableJournal} from "../tools/rfc-table-proxy.mjs";

const FOLDER = "test/fixtures/rfc";
const FIXTURES = "test/fixtures/rfc-table-proxy";
const CONNECTION = {ashost: "h", client: "001", user: "U", passwd: "p"};

// what an open-rfc Client looks like from here, as in test/rfc-proxy.mjs
function fakeOpenRfc(script) {
  const log = [];
  const factory = async () => ({
    async open() { log.push("open"); },
    async close() { log.push("close"); },
    async call(fm, input) {
      log.push({fm, input});
      return script(fm, input);
    },
  });
  return {factory, log};
}

// RFC_READ_TABLE's answer for a table: FIELDS with the offsets of DATA rows
// that carry a delimiter between the fields, and DATA by those offsets
function readTableResult(columns, rows, delimiter = "|") {
  let offset = 0;
  const FIELDS = columns.map(([FIELDNAME, length]) => {
    const f = {FIELDNAME, OFFSET: String(offset).padStart(6, "0"), LENGTH: String(length).padStart(6, "0"), TYPE: "C", FIELDTEXT: ""};
    offset += length + delimiter.length;
    return f;
  });
  const DATA = rows.map((row) => ({WA: row.map((v, i) => v.padEnd(columns[i][1])).join(delimiter).trimEnd()}));
  return {FIELDS, DATA};
}
const A = [["MANDT", 3], ["ID", 4], ["TXT", 20], ["AMT", 10]];
const B = [["MANDT", 3], ["ID", 4], ["NOTE", 10]];
const SYSTEM = {
  ZTPROXY_A: [A, [["001", "A1", "one", "12.50"], ["001", "B2", "a|b|c", "3.00-"]]],
  ZTPROXY_B: [B, [["001", "A1", "note one"], ["001", "C3", "note three"]]],
};
const system = (fm, input) => {
  const table = String(input.QUERY_TABLE).trim();
  const [columns, rows] = SYSTEM[table] ?? [undefined, undefined];
  if (columns === undefined) {
    throw new Error(`no such table ${table}`);
  }
  return readTableResult(columns, rows.slice(0, input.ROWCOUNT));
};

describe("tools/rfc-table-proxy: a table without rows is filled from the system on its first read", () => {
  let saved;
  let probe;
  let schemas;
  let db;
  let installed;

  before(async () => {
    saved = globalThis.abap;
    globalThis.abap = new ABAP({console: new MemoryConsole()});
    // the real transpiler on a small class and three small tables
    const {Transpiler, core} = modulesOf(process.cwd());
    const reg = new core.Registry();
    for (const f of readdirSync(FIXTURES)) {
      reg.addFile(new core.MemoryFile(f, readFileSync(join(FIXTURES, f), "utf8")));
    }
    const out = await new Transpiler({ignoreSourceMap: true}).run(reg);
    schemas = out.databaseSetup.schemas.sqlite;
    const code = out.objects.map((o) => o.chunk.getCode()).join("\n");
    probe = new Function(`${code}\nreturn zcl_tproxy_probe;`)();
  });

  after(() => {
    globalThis.abap = saved;
  });

  // a fresh empty database per test, the tables from the DDIC
  beforeEach(async () => {
    db = new SQLiteDatabaseClient();
    abap.context.databaseConnections["DEFAULT"] = db;
    await db.connect();
    await db.execute(schemas);
  });

  afterEach(async () => {
    installed?.uninstall();
    installed = undefined;
    await db.disconnect();
  });

  const install = async (options) => {
    installed = await installTableProxy(abap, {destination: "SYN", mode: "replay", folder: FOLDER, ...options});
    return installed;
  };
  const rows = async (table) => (await db.select({select: `SELECT * FROM "${table}" ORDER BY id`})).rows;
  const fails = async (call) => {
    try {
      await call();
    } catch (e) {
      return e;
    }
    return undefined;
  };

  it("an allow-listed empty table: the first SELECT returns the system's rows, the second does not call RFC again", async () => {
    const {factory, log} = fakeOpenRfc(system);
    await install({mode: "live", allow: "ZTPROXY_A", clientFactory: factory, connection: CONNECTION});
    expect((await probe.read_a()).get()).to.equal("123/A1/one/12.50;123/B2/a|b|c/-3.00;");
    const calls = () => log.filter((l) => l.fm === "RFC_READ_TABLE");
    expect(calls()).to.have.length(1);
    // the call is RFC_READ_TABLE of this table with the DDIC's columns and the row limit
    expect(calls()[0].input.QUERY_TABLE.trim()).to.equal("ZTPROXY_A");
    expect(calls()[0].input).to.deep.include({DELIMITER: "|", ROWCOUNT: 1000});
    expect(calls()[0].input.FIELDS.map((f) => f.FIELDNAME.trim())).to.deep.equal(["MANDT", "ID", "TXT", "AMT"]);
    expect((await probe.read_a()).get()).to.contain("A1");
    expect(calls()).to.have.length(1);
    expect(tableJournal()).to.have.length(1);
    expect(tableJournal()[0]).to.include({table: "ZTPROXY_A", state: "hydrated", source: "live", rows: 2, truncated: false});
  });

  it("record writes a capture from a fake live system; replay without live gives the same rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stg-tproxy-"));
    try {
      const {factory, log} = fakeOpenRfc(system);
      await install({mode: "record", allow: "ZTPROXY_A", folder: dir, clientFactory: factory, connection: CONNECTION});
      const first = (await probe.read_a()).get();
      expect(tableJournal()[0].source).to.equal("record");
      expect(readdirSync(join(dir, "RFC_READ_TABLE"))).to.deep.equal(["1.json"]);
      const capture = JSON.parse(readFileSync(join(dir, "RFC_READ_TABLE", "1.json"), "utf8"));
      expect(capture.params.QUERY_TABLE.trim()).to.equal("ZTPROXY_A");
      installed.uninstall();
      installed = undefined;

      // a new, empty database, and no live client at all
      await db.disconnect();
      db = new SQLiteDatabaseClient();
      abap.context.databaseConnections["DEFAULT"] = db;
      await db.connect();
      await db.execute(schemas);
      const live = log.length;
      await install({mode: "live", noLive: true, allow: "ZTPROXY_A", folder: dir, clientFactory: () => { throw new Error("no live client in replay"); }});
      expect((await probe.read_a()).get()).to.equal(first);
      expect(tableJournal()[0].source).to.equal("replay");
      expect(log.length).to.equal(live);
    } finally {
      rmSync(dir, {recursive: true});
    }
  });

  it("MANDT is rewritten to the local client", async () => {
    await install({allow: "ZTPROXY_A"});
    expect((await probe.client()).get()).to.equal("123");
    await probe.read_a();
    // the capture says 001, which is the system's client
    expect(JSON.parse(readFileSync(join(FOLDER, "RFC_READ_TABLE", "1.json"), "utf8")).result.DATA[0].WA.slice(0, 3)).to.equal("001");
    expect((await rows("ztproxy_a")).map((r) => r.mandt)).to.deep.equal(["123", "123"]);
  });

  it("a table outside the allow list stays empty and gets no RFC call", async () => {
    const {factory, log} = fakeOpenRfc(system);
    await install({mode: "live", allow: "ZTPROXY_A", clientFactory: factory, connection: CONNECTION});
    expect((await probe.read_c()).get()).to.equal("0:");
    expect(log.filter((l) => l.fm === "RFC_READ_TABLE")).to.have.length(0);
    expect(tableJournal()).to.have.length(0);
  });

  it("a table written locally before its first read is never hydrated, and the journal says so", async () => {
    const {factory, log} = fakeOpenRfc(system);
    await install({mode: "live", allow: "ZTPROXY_A", clientFactory: factory, connection: CONNECTION});
    await probe.write_a({iv_id: new abap.types.Character(4).set("L1")});
    await db.delete({table: "\"ztproxy_a\"", where: ""});
    // empty again, but written: still local
    expect((await probe.read_a()).get()).to.equal("");
    expect(log.filter((l) => l.fm === "RFC_READ_TABLE")).to.have.length(0);
    expect(tableJournal()).to.have.length(1);
    expect(tableJournal()[0]).to.include({table: "ZTPROXY_A", state: "skipped-written"});
  });

  it("an update or a delete that is committed makes the table local for good", async () => {
    const {factory, log} = fakeOpenRfc(system);
    await install({mode: "live", allow: "ZTPROXY_*", clientFactory: factory, connection: CONNECTION});
    const wrapped = abap.context.databaseConnections["DEFAULT"];
    const put = (table, id) => wrapped.insert({table: `"${table}"`, columns: ["mandt", "id"], values: ["'123'", `'${id}'`]});
    await put("ztproxy_a", "U1");
    await put("ztproxy_b", "D1");
    await wrapped.commit();
    await wrapped.update({table: "\"ztproxy_a\"", where: "id = 'U1'", set: ["mandt = '123'"]});
    await wrapped.delete({table: "\"ztproxy_b\"", where: "id = 'D1'"});
    await wrapped.commit();
    await probe.read_a();
    await probe.read_join();
    expect(log.filter((l) => l.fm === "RFC_READ_TABLE")).to.have.length(0);
    // written, not merely "has rows": the state is the first thing asked
    expect(tableJournal().map((e) => `${e.table}:${e.state}`).sort()).to.deep.equal(["ZTPROXY_A:skipped-written", "ZTPROXY_B:skipped-written"]);
  });

  it("a write that is rolled back does not make the table local: the first read after it hydrates", async () => {
    const {factory, log} = fakeOpenRfc(system);
    await install({mode: "live", allow: "ZTPROXY_A", clientFactory: factory, connection: CONNECTION});
    const wrapped = abap.context.databaseConnections["DEFAULT"];
    await probe.write_a({iv_id: new abap.types.Character(4).set("L1")});
    await wrapped.rollback();
    expect((await probe.read_a()).get()).to.equal("123/A1/one/12.50;123/B2/a|b|c/-3.00;");
    expect(log.filter((l) => l.fm === "RFC_READ_TABLE")).to.have.length(1);
  });

  it("a read inside the LUW of an uncommitted write skips, and a rollback lifts that decision", async () => {
    const {factory, log} = fakeOpenRfc(system);
    await install({mode: "live", allow: "ZTPROXY_A", clientFactory: factory, connection: CONNECTION});
    const wrapped = abap.context.databaseConnections["DEFAULT"];
    await probe.write_a({iv_id: new abap.types.Character(4).set("L1")});
    await db.delete({table: "\"ztproxy_a\"", where: ""});
    expect((await probe.read_a()).get()).to.equal("");
    expect(tableJournal()[0].state).to.equal("skipped-written");
    await wrapped.rollback();
    expect((await probe.read_a()).get()).to.contain("A1");
    expect(log.filter((l) => l.fm === "RFC_READ_TABLE")).to.have.length(1);
  });

  it("a write that is committed makes the table local", async () => {
    const {factory, log} = fakeOpenRfc(system);
    await install({mode: "live", allow: "ZTPROXY_A", clientFactory: factory, connection: CONNECTION});
    const wrapped = abap.context.databaseConnections["DEFAULT"];
    await probe.write_a({iv_id: new abap.types.Character(4).set("L1")});
    await wrapped.commit();
    await db.delete({table: "\"ztproxy_a\"", where: ""});
    await wrapped.commit();
    await wrapped.rollback();
    expect((await probe.read_a()).get()).to.equal("");
    expect(log.filter((l) => l.fm === "RFC_READ_TABLE")).to.have.length(0);
    expect(tableJournal()[0].state).to.equal("skipped-written");
  });

  it("a failed write (the client reports it) does not mark the table", async () => {
    const {factory, log} = fakeOpenRfc(system);
    await install({mode: "live", allow: "ZTPROXY_B", clientFactory: factory, connection: CONNECTION});
    const wrapped = abap.context.databaseConnections["DEFAULT"];
    const failed = await wrapped.insert({table: "\"ztproxy_b\"", columns: ["nonexistent"], values: ["'x'"]});
    expect(failed.subrc).to.not.equal(0);
    await wrapped.commit();
    await probe.read_join();
    expect(log.filter((l) => l.fm === "RFC_READ_TABLE").map((l) => l.input.QUERY_TABLE.trim())).to.deep.equal(["ZTPROXY_B"]);
    expect(tableJournal()[0].state).to.equal("hydrated");
  });

  it("a failed write (the client throws) does not mark the table", async () => {
    const {factory, log} = fakeOpenRfc(system);
    const real = db.insert;
    db.insert = async () => { throw new Error("boom"); };
    try {
      await install({mode: "live", allow: "ZTPROXY_B", clientFactory: factory, connection: CONNECTION});
      const wrapped = abap.context.databaseConnections["DEFAULT"];
      const thrown = await fails(() => wrapped.insert({table: "\"ztproxy_b\"", columns: ["id"], values: ["'x'"]}));
      expect(thrown?.message).to.equal("boom");
      await wrapped.commit();
      db.insert = real;
      await probe.read_join();
      expect(log.filter((l) => l.fm === "RFC_READ_TABLE")).to.have.length(1);
    } finally {
      db.insert = real;
    }
  });

  it("MANDT is rewritten only for a client-dependent table: the first key field is MANDT", async () => {
    await install({allow: "ZTPROXY_I"});
    await abap.context.databaseConnections["DEFAULT"].select({select: "SELECT * FROM \"ztproxy_i\""});
    expect(tableJournal()[0]).to.include({table: "ZTPROXY_I", state: "hydrated"});
    // a MANDT that is a plain column of a client-independent table is data
    expect((await db.select({select: "SELECT id, mandt FROM \"ztproxy_i\""})).rows[0]).to.deep.include({mandt: "001"});
    expect((await rows("ztproxy_i"))[0].id.trimEnd()).to.equal("I1");
  });

  it("rows the local table refuses (a duplicate key) fail the read and leave the table empty and undecided", async () => {
    await install({allow: "ZTPROXY_C"});
    const error = await fails(() => probe.read_c());
    expect(error?.message).to.contain("ZTPROXY_C");
    expect(error.message).to.contain("could not be inserted");
    expect(await rows("ztproxy_c")).to.have.length(0);
    expect(tableJournal()).to.have.length(0);
  });

  it("a table that already has rows here is not hydrated", async () => {
    const {factory, log} = fakeOpenRfc(system);
    await db.execute("INSERT INTO ztproxy_a (mandt, id, txt, amt) VALUES ('123', 'S1', 'seeded', 1)");
    await install({mode: "live", allow: "ZTPROXY_A", clientFactory: factory, connection: CONNECTION});
    expect((await probe.read_a()).get()).to.equal("123/S1/seeded/1.00;");
    expect(log.filter((l) => l.fm === "RFC_READ_TABLE")).to.have.length(0);
    expect(tableJournal()[0]).to.include({state: "skipped-local-rows"});
  });

  it("a JOIN of two allow-listed tables hydrates both", async () => {
    const {factory, log} = fakeOpenRfc(system);
    await install({mode: "live", allow: "ZTPROXY_*", clientFactory: factory, connection: CONNECTION});
    expect((await probe.read_join()).get()).to.equal("A1/note one;");
    expect(log.filter((l) => l.fm === "RFC_READ_TABLE").map((l) => l.input.QUERY_TABLE.trim()).sort()).to.deep.equal(["ZTPROXY_A", "ZTPROXY_B"]);
    expect(tableJournal().map((e) => e.table).sort()).to.deep.equal(["ZTPROXY_A", "ZTPROXY_B"]);
  });

  it("noLive with no capture is an error naming the table and the capture path, never an empty table", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stg-tproxy-"));
    try {
      await install({mode: "live", noLive: true, allow: "ZTPROXY_A", folder: dir,
        clientFactory: () => { throw new Error("must not be reached"); }});
      const error = await fails(() => probe.read_a());
      expect(error?.message).to.contain("ZTPROXY_A");
      expect(error.message).to.contain(join(dir, "RFC_READ_TABLE"));
      // not marked: nothing says it was hydrated
      expect(tableJournal()).to.have.length(0);
      expect(await rows("ztproxy_a")).to.have.length(0);
    } finally {
      rmSync(dir, {recursive: true});
    }
  });

  it("replay takes the capture of the table asked for, not the first of RFC_READ_TABLE", async () => {
    await install({allow: "ZTPROXY_B"});
    expect((await probe.read_join()).get()).to.equal("");
    expect((await rows("ztproxy_b")).map((r) => r.id.trimEnd())).to.deep.equal(["A1", "C3"]);
  });

  it("truncation at maxRows is journaled", async () => {
    const {factory, log} = fakeOpenRfc(system);
    await install({mode: "live", allow: "ZTPROXY_A", maxRows: 2, clientFactory: factory, connection: CONNECTION});
    await probe.read_a();
    expect(log.find((l) => l.fm === "RFC_READ_TABLE").input.ROWCOUNT).to.equal(2);
    expect(tableJournal()[0]).to.include({state: "hydrated", rows: 2, truncated: true});
  });

  it("maxRows also cuts a longer capture, and fewer rows than the limit is not truncated", async () => {
    await install({allow: "ZTPROXY_A", maxRows: 1});
    await probe.read_a();
    expect(tableJournal()[0]).to.include({rows: 1, truncated: true});
    installed.uninstall();
    await db.execute("DELETE FROM ztproxy_a");
    await install({allow: "ZTPROXY_A", maxRows: 5});
    await probe.read_a();
    expect(tableJournal()[0]).to.include({rows: 2, truncated: false});
  });

  it("fields are parsed by offset and length: a delimiter inside a value is part of the value", async () => {
    await install({allow: "ZTPROXY_A"});
    await probe.read_a();
    expect((await rows("ztproxy_a")).map((r) => r.txt.trimEnd())).to.deep.equal(["one", "a|b|c"]);
    // the unit under it: the layout is checked, not guessed
    const {FIELDS, DATA} = readTableResult(A, [["001", "X", "p|q", "1"]]);
    expect(parseRows("T", ["ID", "TXT"], FIELDS, DATA, "|")).to.deep.equal([{ID: "X", TXT: "p|q"}]);
    const layoutOffsets = FIELDS.map((f, i) => ({...f, OFFSET: String(A.slice(0, i).reduce((s, [, l]) => s + l, 0)).padStart(6, "0")}));
    expect(() => parseRows("T", ["ID", "TXT"], layoutOffsets, DATA, "|")).to.throw(/refusing to guess/);
    expect(() => parseRows("T", ["NOPE"], FIELDS, DATA, "|")).to.throw(/did not return field NOPE/);
  });

  it("a row wider than RFC_READ_TABLE's 512 is refused, not cut", async () => {
    const {factory, log} = fakeOpenRfc(system);
    await install({mode: "live", allow: "ZTPROXY_W", clientFactory: factory, connection: CONNECTION});
    const error = await fails(() => probe.read_w());
    expect(error?.message).to.match(/ZTPROXY_W is 610 characters wide.*512/);
    expect(log.filter((l) => l.fm === "RFC_READ_TABLE")).to.have.length(0);
  });

  it("an allow-listed table with no DDIC here is an error, not a guess", async () => {
    await install({allow: "ZTPROXY_NODDIC"});
    await db.execute("CREATE TABLE ztproxy_noddic (id NCHAR(4))");
    const error = await fails(() => abap.context.databaseConnections["DEFAULT"].select({select: "SELECT * FROM \"ztproxy_noddic\""}));
    expect(error?.message).to.contain("ZTPROXY_NODDIC");
    expect(error.message).to.contain("no DDIC");
  });

  it("a rollback takes the hydrated rows back and the next read fetches again", async () => {
    const {factory, log} = fakeOpenRfc(system);
    await install({mode: "live", allow: "ZTPROXY_A", clientFactory: factory, connection: CONNECTION});
    await probe.read_a();
    await abap.context.databaseConnections["DEFAULT"].rollback();
    expect(await rows("ztproxy_a")).to.have.length(0);
    expect((await probe.read_a()).get()).to.contain("A1");
    expect(log.filter((l) => l.fm === "RFC_READ_TABLE")).to.have.length(2);
    // a commit keeps them, and the table stays decided
    await abap.context.databaseConnections["DEFAULT"].commit();
    await abap.context.databaseConnections["DEFAULT"].rollback();
    expect(await rows("ztproxy_a")).to.have.length(2);
    await probe.read_a();
    expect(log.filter((l) => l.fm === "RFC_READ_TABLE")).to.have.length(2);
  });

  it("a statement that cannot be classified hydrates nothing and is journaled as unclassified", async () => {
    const {factory, log} = fakeOpenRfc(system);
    await install({mode: "live", allow: "ZTPROXY_A", clientFactory: factory, connection: CONNECTION});
    const wrapped = abap.context.databaseConnections["DEFAULT"];
    await fails(() => wrapped.select({select: "SELECT * FROM 'ztproxy_a'"}));
    await fails(() => wrapped.select({select: "SELECT * FROM ztproxy_a_fn(1)"}));
    expect(log.filter((l) => l.fm === "RFC_READ_TABLE")).to.have.length(0);
    expect(tableJournal().map((e) => e.state)).to.deep.equal(["unclassified", "unclassified"]);
    expect(tableJournal()[0].reason).to.contain("FROM");
  });

  it("a statement with an unsupported construct hydrates none of its tables, also the ones before it", async () => {
    const {factory, log} = fakeOpenRfc(system);
    await install({mode: "live", allow: "ZTPROXY_*", clientFactory: factory, connection: CONNECTION});
    await fails(() => abap.context.databaseConnections["DEFAULT"].select({select: "SELECT * FROM \"ztproxy_a\" WHERE 1 IN (SELECT 1 FROM generate_series(1, 2))"}));
    expect(log.filter((l) => l.fm === "RFC_READ_TABLE")).to.have.length(0);
  });

  it("a statement with a WITH clause makes no RFC call and is journaled as unclassified", async () => {
    const {factory, log} = fakeOpenRfc(system);
    await install({mode: "live", allow: "ZTPROXY_*", clientFactory: factory, connection: CONNECTION});
    const wrapped = abap.context.databaseConnections["DEFAULT"];
    await wrapped.select({select: "WITH ztproxy_a AS (SELECT id FROM \"ztproxy_b\") SELECT * FROM ztproxy_a"});
    await wrapped.select({select: "WITH unused AS (SELECT * FROM \"ztproxy_a\") SELECT 1"});
    expect(log.filter((l) => l.fm === "RFC_READ_TABLE")).to.have.length(0);
    expect(tableJournal().map((e) => e.state)).to.deep.equal(["unclassified", "unclassified"]);
    expect(tableJournal()[0].reason).to.equal("WITH (common table expression) is not produced by Open SQL; not classified");
  });

  it("writes never reach the system, and the wrapped connection otherwise behaves as before", async () => {
    const {factory, log} = fakeOpenRfc(system);
    await install({mode: "live", allow: "ZTPROXY_C", clientFactory: factory, connection: CONNECTION});
    const wrapped = abap.context.databaseConnections["DEFAULT"];
    expect(wrapped).to.not.equal(db);
    expect(wrapped.name).to.equal("sqlite");
    await wrapped.insert({table: "\"ztproxy_c\"", columns: ["mandt", "id"], values: ["'123'", "'K1'"]});
    expect(await rows("ztproxy_c")).to.have.length(1);
    expect(log).to.have.length(0);
    installed.uninstall();
    installed = undefined;
    expect(abap.context.databaseConnections["DEFAULT"]).to.equal(db);
  });

  it("refuses an allow entry that names every table, a missing destination and a second install", async () => {
    for (const a of ["*", "ZTPROXY_A,*", " ** "]) {
      expect(() => tableAllowMatcher(a), a).to.throw(/every table/);
    }
    const m = tableAllowMatcher("ztproxy_a, ZT_PRE*");
    expect(m("ZTPROXY_A")).to.equal(true);
    expect(m("ZT_PREFIXED")).to.equal(true);
    expect(m("ZTPROXY_AB")).to.equal(false);
    expect(tableAllowMatcher("")("ANY")).to.equal(false);
    let error;
    try { await installTableProxy(abap, {allow: "X"}); } catch (e) { error = e; }
    expect(error?.message).to.contain("destination");
    await install({allow: "ZTPROXY_A"});
    error = undefined;
    try { await installTableProxy(abap, {destination: "SYN", mode: "replay", allow: "X"}); } catch (e) { error = e; }
    expect(error?.message).to.contain("already installed");
  });
});

describe("tools/rfc-table-proxy: which tables a statement reads", () => {
  const cases = [
    ["SELECT * FROM \"ztab\"", ["ZTAB"]],
    ["SELECT * FROM \"ztab\" WHERE a = 'FROM x'", ["ZTAB"]],
    ["SELECT a.x FROM \"t1\" AS a INNER JOIN \"t2\" AS b ON a.k = b.k LEFT OUTER JOIN \"t3\" c ON c.k = a.k", ["T1", "T2", "T3"]],
    ["SELECT * FROM \"t1\", \"t2\" WHERE 1 = 1", ["T1", "T2"]],
    ["SELECT * FROM t1 a, t2 b WHERE a.k = b.k", ["T1", "T2"]],
    ["SELECT * FROM \"t1\" WHERE k IN (SELECT k FROM \"t2\" WHERE z > 1)", ["T1", "T2"]],
    ["SELECT * FROM (SELECT k FROM \"t1\") AS sub JOIN \"t2\" ON sub.k = t2.k", ["T1", "T2"]],
    ["SELECT * FROM \"myschema\".\"ztab\"", ["ZTAB"]],
    ["SELECT * FROM \"/ns/tab\"", ["/NS/TAB"]],
    ["SELECT * FROM /ns/tab", ["/NS/TAB"]],
    ["SELECT * FROM \"t1\" UNION SELECT * FROM \"t2\"", ["T1", "T2"]],
    ["SELECT TRIM(LEADING '0' FROM id) FROM \"t1\"", ["T1"]],
    ["SELECT EXTRACT(YEAR FROM d) FROM \"t1\"", ["T1"]],
    ["SELECT * FROM \"t1\" -- from t9\n", ["T1"]],
    ["SELECT 1", []],
    ["select * from \"T1\" where a = 'it''s from t2'", ["T1"]],
  ];
  for (const [sql, tables] of cases) {
    it(`reads ${JSON.stringify(tables)} from ${sql.replace(/\n/g, " ")}`, () => {
      const r = readTables(sql);
      expect(r.unclassified).to.equal(undefined);
      expect(r.tables.sort()).to.deep.equal(tables);
    });
  }

  it("strips the table prefix of abap.dbo", () => {
    expect(readTables("SELECT * FROM \"pfx_ztab\"", "pfx_").tables).to.deep.equal(["ZTAB"]);
  });

  it("an unclassified statement names no table at all, not even the ones read before the construct", () => {
    const r = readTables("SELECT * FROM t1 JOIN t2 ON 1 = 1 WHERE x IN (SELECT y FROM generate_series(1, 3))");
    expect(r.unclassified).to.be.a("string");
    expect(r.tables).to.deep.equal([]);
    expect(readTables("SELECT * FROM t1 WHERE x IN (SELECT 1 FROM 'bad')").tables).to.deep.equal([]);
  });

  for (const sql of [
    "WITH ZTPROXY_A AS (SELECT id FROM ZTPROXY_B) SELECT * FROM ZTPROXY_A",
    "WITH a AS (SELECT * FROM t1), b AS (SELECT * FROM a JOIN t2 ON 1 = 1) SELECT * FROM b",
    "WITH RECURSIVE a (x) AS (SELECT 1) SELECT * FROM a JOIN t9 ON 1 = 1",
    "SELECT * FROM t1 WHERE k IN (WITH c AS (SELECT k FROM t2) SELECT k FROM c)",
    "WITH t1 AS (SELECT * FROM t1) SELECT * FROM t1",
    "SELECT * FROM ztproxy_a WHERE 1 IN (WITH ztproxy_a AS (SELECT 1) SELECT * FROM ztproxy_a)",
    "WITH unused AS (SELECT * FROM ztproxy_a) SELECT 1",
    "with lower as (select 1) select * from t1",
  ]) {
    it(`a WITH clause is unclassified and names no table: ${sql}`, () => {
      expect(readTables(sql)).to.deep.equal({tables: [], unclassified: "WITH (common table expression) is not produced by Open SQL; not classified"});
    });
  }

  it("WITH inside a string literal or a quoted name is not a WITH clause", () => {
    expect(readTables("SELECT * FROM t1 WHERE a = 'x WITH y'").tables).to.deep.equal(["T1"]);
    expect(readTables("SELECT * FROM \"with\"").tables).to.deep.equal(["WITH"]);
  });

  for (const sql of [
    "SELECT * FROM 'ztab'",
    "SELECT * FROM",
    "SELECT * FROM @tab",
    "SELECT * FROM unnest(x)",
    "SELECT * FROM generate_series(1, 3)",
    "SELECT * FROM \"ztab",
    "SELECT * FROM t1 JOIN 5 ON 1 = 1",
  ]) {
    it(`does not guess at ${sql}`, () => {
      expect(readTables(sql).unclassified).to.be.a("string");
    });
  }
});

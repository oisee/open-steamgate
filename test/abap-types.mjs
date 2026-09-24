// `STRING` is a word, and its first letter is a short integer.
//
// Every client bound its parameters by switching on `type.charAt(0)`, which
// is right for `I`, `P(15,2)` and `C(10)` and wrong for exactly one code:
// `STRING`. Bound as `S`, a text value went through `Number()`. On sql.js
// and SQLite that is NaN and lands without complaint; HANA refuses the
// statement -- "Cannot set parameter at row: 1. Argument must be a string" --
// which is the only reason it was ever seen (2026-09-19).
//
// The same defect had been found and fixed in `declaredAs()` the day before,
// and written up: "a test on the first letter is wider than the letters it
// means". It was fixed where it had been noticed. Four binds nobody looked
// at kept it, which is this tree's other standing rule -- a rule written
// next to its one caller does not survive the second.
//
// So the rule is a module now, and this suite checks it two ways: the rule
// itself, and the BEHAVIOUR of every client that is supposed to be using it.
// The second half is the one that matters: a client could stop importing it
// tomorrow and the first half would stay green.
import {expect} from "chai";
import {abapTypeLetter, isNumericType, isHexType, bindValue} from "../tools/abap-types.mjs";

describe("an ABAP type code that is a word is not read as a letter", () => {
  it("STRING is text, whatever its first letter is", () => {
    expect(abapTypeLetter("STRING"), "S would be a short integer").to.equal("");
    expect(isNumericType("STRING")).to.equal(false);
    expect(bindValue({type: "STRING", value: "aa"}), "Number('aa') is NaN, and hdb refuses it").to.equal("aa");
  });

  it("and the letters still mean what they meant", () => {
    for (const code of ["I", "B", "S", "P(15,2)", "F"]) expect(isNumericType(code), code).to.equal(true);
    for (const code of ["I", "B", "S", "F"]) expect(bindValue({type: code, value: "7"}), code).to.equal(7);
    expect(bindValue({type: "P(15,2)", value: 7}), "a packed number stays a number").to.equal(7);
    for (const code of ["C(10)", "N(4)", "D", "T"]) expect(isNumericType(code), code).to.equal(false);
  });

  it("a packed value given as its decimal string binds as that string, every digit of it", () => {
    // Number() would give 12345678901234568 for the first: a double's 15 digits
    expect(bindValue({type: "P(31,14)", value: "12345678901234567.12345678901234"})).to.equal("12345678901234567.12345678901234");
    expect(bindValue({type: "P(15,2)", value: "7.00"})).to.equal("7.00");
    expect(bindValue({type: "P(15,2)", value: "7.00", isNull: true})).to.equal(null);
  });

  it("an INT8 given as a BigInt binds as that BigInt, past 2^53", () => {
    expect(bindValue({type: "INT8", value: 9007199254740993n})).to.equal(9007199254740993n);
  });

  it("X and XSTRING bind as bytes when the client asks for it", () => {
    expect(isHexType("X")).to.equal(true);
    expect(isHexType("XSTRING")).to.equal(true);
    expect(bindValue({type: "X", value: "4142"}, {hex: (s) => Buffer.from(s, "hex")}).toString()).to.equal("AB");
    // a client with no hex handling gets the text, rather than a wrong number
    expect(bindValue({type: "X", value: "4142"})).to.equal("4142");
  });

  it("a NULL is a NULL before anything else is decided", () => {
    expect(bindValue({type: "I", isNull: true, value: 7})).to.equal(null);
  });
});

// The half that cannot be satisfied by the rule alone.
describe("every client that binds parameters binds a STRING as text", function () {
  this.timeout(30000);

  const clients = {
    async duckdb() {
      const {DuckDBDatabaseClient} = await import("../tools/duckdb-client.mjs");
      const c = new DuckDBDatabaseClient({path: ":memory:"});
      await c.connect();
      return c;
    },
    async sqlite_node() {
      const {FileSqliteClient} = await import("../tools/sqlite-file-client.mjs");
      const c = new FileSqliteClient({path: ":memory:"});
      await c.connect();
      return c;
    },
    async sqljs() {
      const initSqlJs = (await import("sql.js")).default;
      const SQL = await initSqlJs({
        locateFile: () => new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname,
      });
      const {installNative} = await import("../tools/sqljs-native.mjs");
      const c = {sqlite: new SQL.Database()};
      installNative(c);
      return c;
    },
  };

  it("through the native channel, on each of the three that run here", async () => {
    const stored = {};
    for (const [name, make] of Object.entries(clients)) {
      const client = await make();
      try {
        await client.native({sql: "CREATE TABLE t (v VARCHAR)", expect: "none"});
        await client.native({sql: "INSERT INTO t VALUES (?)", expect: "none",
          params: [{name: "v", value: "aa", type: "STRING"}]});
        const {rows} = await client.native({sql: "SELECT v FROM t"});
        stored[name] = String(rows[0].v ?? rows[0].V);
      } finally {
        await client.disconnect?.();
      }
    }
    // bound as a number this is "NaN" or null, never "aa"
    expect(stored, JSON.stringify(stored)).to.deep.equal({duckdb: "aa", sqlite_node: "aa", sqljs: "aa"});
  });
});

// The cross-reference tables of OSD, derived rather than authored.
//
// vsp's graph tools (who-calls, references, boundaries, loads) do not use a
// special endpoint: they read SAP's own tables over freestyle SQL. So if the
// local system carries those tables, the whole graph layer works with no
// façade code beyond the SQL endpoint. And it costs nothing to fill them,
// because the parse that the syntax check already does knows what names
// what.
//
// The columns are the ones vsp's own SQL selects and filters on, taken from
// its source (cmd/vsp/*.go), not from a memory of SAP's DDIC, which we do
// not have:
//
//   CROSS      TYPE NAME INCLUDE        TYPE 'F' a function module,
//                                       'P' a program (SUBMIT), 'S' a table
//   WBCROSSGT  OTYPE NAME INCLUDE       OTYPE 'TY', every type reference:
//                                       classes, interfaces, DDIC types
//   WBCROSSGTX same, for names that do not fit the short field
//   D010INC    MASTER INCLUDE OBSOLETE_IN_VERSION   the load graph
//
// INCLUDE is the object that holds the reference. A real system writes
// ZCL_FOO=======CM001 there; we write the object's own name, which vsp
// reads the same way and a human can read too.
import {writeFileSync} from "node:fs";
import {join} from "node:path";
import {ObjectStore} from "./osd-store.mjs";
import {runsAs} from "./osd-main.mjs";

// what a reference to another object looks like in a statement
const TYPE_OBJECTS = new Set(["CLAS", "INTF", "TABL", "DTEL", "DOMA", "TTYP", "VIEW", "DDLS"]);

export class CrossReference {
  constructor(store = new ObjectStore()) {
    this.store = store;
    this.cross = [];
    this.wbcrossgt = [];
    this.wbcrossgtx = [];
    this.d010inc = [];
  }

  // every name the store knows, so a token can be recognised as a reference
  #names() {
    if (this.byName !== undefined) {
      return this.byName;
    }
    const byName = new Map();
    for (const object of this.store.list()) {
      if (TYPE_OBJECTS.has(object.type)) {
        byName.set(object.name, object.type);
      }
    }
    this.byName = byName;
    return byName;
  }

  #add(set, row) {
    const key = Object.values(row).join("|");
    if (this.seen === undefined) {
      this.seen = new Set();
    }
    if (this.seen.has(key)) {
      return;
    }
    this.seen.add(key);
    set.push(row);
  }

  // a quoted literal in a statement: 'BAPI_TRANSACTION_COMMIT' -> the name
  #literal(tokens) {
    for (const token of tokens) {
      const text = token.getStr();
      if (text.startsWith("'") && text.endsWith("'") && text.length > 2) {
        return text.slice(1, -1).toUpperCase();
      }
    }
    return undefined;
  }

  build() {
    const registry = this.store.registry();
    const names = this.#names();

    for (const object of registry.getObjects()) {
      const objectName = object.getName().toUpperCase();
      const type = object.getType();
      if (object.getABAPFiles === undefined) {
        continue;
      }
      for (const file of object.getABAPFiles()) {
        for (const statement of file.getStatements()) {
          const kind = statement.get().constructor.name;
          const tokens = statement.getTokens();

          // what the statement calls, submits or reads
          if (kind === "CallFunction") {
            const name = this.#literal(tokens);
            if (name !== undefined) {
              this.#add(this.cross, {TYPE: "F", NAME: name, INCLUDE: objectName});
            }
          } else if (kind === "Submit") {
            const name = tokens[1]?.getStr().toUpperCase().replace(/^'|'$/g, "");
            if (name !== undefined) {
              this.#add(this.cross, {TYPE: "P", NAME: name, INCLUDE: objectName});
            }
          } else if (kind === "Include") {
            const name = tokens[1]?.getStr().toUpperCase();
            if (name !== undefined) {
              this.#add(this.d010inc, {MASTER: objectName, INCLUDE: name, OBSOLETE_IN_VERSION: "0000"});
            }
          }

          // every token that names an object of the system is a reference;
          // a table read is also a CROSS row of type S, the way vsp asks
          // "who touches TVARVC"
          const sql = ["Select", "SelectLoop", "Insert", "Update", "Delete", "Modify"].includes(kind);
          for (const token of tokens) {
            const text = token.getStr().toUpperCase();
            const referenced = names.get(text);
            if (referenced === undefined || text === objectName) {
              continue;
            }
            const row = {OTYPE: "TY", NAME: text, INCLUDE: objectName};
            this.#add(text.length > 30 ? this.wbcrossgtx : this.wbcrossgt, row);
            if (sql === true && ["TABL", "VIEW", "DDLS"].includes(referenced)) {
              this.#add(this.cross, {TYPE: "S", NAME: text, INCLUDE: objectName});
            }
          }
        }
      }

      // a class carries its own includes, which is what the load graph of a
      // class is on a system
      if (type === "CLAS") {
        for (const file of object.getABAPFiles()) {
          const name = file.getFilename().split("/").pop();
          if (name.includes(".clas.") && !name.endsWith(".clas.abap")) {
            this.#add(this.d010inc, {
              MASTER: objectName,
              INCLUDE: `${objectName} ${name.replace(/^.*\.clas\./, "").replace(/\.abap$/, "")}`.toUpperCase(),
              OBSOLETE_IN_VERSION: "0000",
            });
          }
        }
      }
    }
    return this;
  }

  tables() {
    return {
      cross: this.cross,
      wbcrossgt: this.wbcrossgt,
      wbcrossgtx: this.wbcrossgtx,
      d010inc: this.d010inc,
    };
  }

  // the rows land where the runtime's seed reads them, so they are in the
  // database the freestyle SQL endpoint queries
  write(dataDir = "data") {
    const written = {};
    for (const [table, rows] of Object.entries(this.tables())) {
      const file = join(dataDir, `${table}.tabu.json`);
      writeFileSync(file, JSON.stringify(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v]))), undefined, 1) + "\n");
      written[table] = rows.length;
    }
    return written;
  }
}

function main(args) {
  const xref = new CrossReference().build();
  const counts = Object.fromEntries(Object.entries(xref.tables()).map(([t, rows]) => [t, rows.length]));
  if (args.includes("--write")) {
    console.log(`written to data/: ${Object.entries(xref.write()).map(([t, n]) => `${t} ${n}`).join(", ")}`);
    return 0;
  }
  if (args[0] === "--who-calls" && args[1] !== undefined) {
    const needle = args[1].toUpperCase();
    for (const row of [...xref.cross, ...xref.wbcrossgt, ...xref.wbcrossgtx]) {
      if (row.NAME === needle) {
        console.log(`${row.INCLUDE} (${row.TYPE ?? row.OTYPE})`);
      }
    }
    return 0;
  }
  console.log(`cross ${counts.cross}, wbcrossgt ${counts.wbcrossgt}, wbcrossgtx ${counts.wbcrossgtx}, d010inc ${counts.d010inc}`);
  console.log("usage: osd-xref.mjs [--write] [--who-calls NAME]");
  return 0;
}

if (runsAs("osd-xref.mjs")) {
  process.exit(main(process.argv.slice(2)));
}

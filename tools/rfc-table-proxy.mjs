// Table proxy, spike P2: a transparent table whose DDIC is here (so it exists
// locally) and which has no rows here is filled, on the first read of a
// process, from a system through RFC_READ_TABLE. Opt-in (STG_TABLE_PROXY in
// test/setup.mjs); docs/rfc-proxy.md, "P2: tables".
//
// The seam is the runtime's DatabaseClient (docs/db-backends.md): the object
// in abap.context.databaseConnections.DEFAULT is wrapped, nothing in the
// runtime is forked. A `select` / `openCursor` whose SQL reads an allow-listed
// table that is not yet decided in this process
//
//   1. fetches the rows with RFC_READ_TABLE (QUERY_TABLE, DELIMITER, FIELDS
//      from the local DDIC so the columns match, ROWCOUNT = maxRows) through
//      the one client tools/rfc-replay.mjs builds for the destination, so
//      live, record and replay share the capture format of P1;
//   2. parses DATA by the FIELDS offsets and lengths, never by the delimiter
//      alone (a value may contain the delimiter);
//   3. rewrites MANDT to the local client, inserts, marks the table hydrated;
//   4. runs the original statement.
//
// Rules, all measured by test/rfc-table-proxy.mjs:
//   - a write (insert, update, delete) never goes to the system, and a table
//     written locally before its first read is not hydrated: local data wins;
//   - a table that already has rows here is not hydrated either;
//   - the tables a statement reads are found by tokenising the SQL (quoted
//     identifiers, JOINs, subqueries, comma lists); a statement this reading
//     cannot classify hydrates nothing and is journaled as such;
//   - hydrated rows are part of the open LUW: a rollback takes them back and
//     the table is unmarked, so the next read fetches again.
import {join} from "node:path";
import {DEFAULT_CAPTURE_FOLDER, clientFor, loadCaptures, loadDestinations, localClient, toJson} from "./rfc-replay.mjs";

const JOURNAL = Symbol.for("osd.rfc.tableJournal");
const INSTALLED = Symbol.for("osd.rfc.tableProxy");

export const READ_TABLE = "RFC_READ_TABLE";
/** RFC_READ_TABLE's DATA row is a TAB512: SAP documentation, not measured here */
export const ROW_WIDTH = 512;
export const DEFAULT_MAX_ROWS = 1000;

/** `NAME` exact or `PREFIX*`, case-insensitive, as a predicate; a bare `*` is refused */
export function tableAllowMatcher(allow) {
  const entries = (Array.isArray(allow) ? allow : String(allow ?? "").split(","))
    .map((e) => e.trim().toUpperCase()).filter((e) => e !== "");
  const unbounded = entries.find((e) => /^\**$/.test(e));
  if (unbounded !== undefined) {
    throw new Error(`table proxy: allow entry '${unbounded}' names every table; give exact names or a non-empty PREFIX*`);
  }
  const exact = new Set(entries.filter((e) => !e.endsWith("*")));
  const prefixes = entries.filter((e) => e.endsWith("*")).map((e) => e.slice(0, -1));
  return (name) => exact.has(name) || prefixes.some((p) => name.startsWith(p));
}

/** every decision so far, [{table, state, source, rows, truncated, destination, ...}] (a copy) */
export function tableJournal(abap = globalThis.abap) {
  return (abap[JOURNAL] ?? []).map((e) => ({...e}));
}

// ---------------------------------------------------------------- SQL reading

const FUNCTIONS_WITH_FROM = new Set(["TRIM", "EXTRACT", "SUBSTRING", "OVERLAY", "POSITION"]);
const NOT_AN_ALIAS = new Set(["WHERE", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER", "JOIN", "ON", "USING", "GROUP",
  "ORDER", "UNION", "INTERSECT", "EXCEPT", "HAVING", "UP", "INTO", "FOR", "LIMIT", "OFFSET", "FETCH", "WINDOW", "AS"]);
const NOT_A_TABLE = new Set(["SELECT", "WITH", "VALUES", "LATERAL", "ONLY", "TABLE", "UNNEST"]);

/** the SQL as tokens; undefined when a literal or comment is not closed */
function tokenize(sql) {
  const tokens = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i += 1;
    } else if (c === "'" || c === "`" || c === "\"") {
      let j = i + 1;
      let text = "";
      for (;;) {
        if (j >= sql.length) {
          return undefined;
        }
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            text += c;
            j += 2;
            continue;
          }
          break;
        }
        text += sql[j];
        j += 1;
      }
      tokens.push(c === "\"" ? {t: "id", v: text} : {t: "str", v: text});
      i = j + 1;
    } else if (c === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end + 1;
    } else if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) {
        return undefined;
      }
      i = end + 2;
    } else {
      const m = /^(?:\/\w+\/\w+|[A-Za-z_][\w$#]*)/.exec(sql.slice(i));
      if (m) {
        tokens.push({t: "word", v: m[0]});
        i += m[0].length;
      } else if (/[0-9]/.test(c)) {
        const n = /^[0-9][\w.]*/.exec(sql.slice(i))[0];
        tokens.push({t: "num", v: n});
        i += n.length;
      } else {
        tokens.push({t: "p", v: c});
        i += 1;
      }
    }
  }
  return tokens;
}

/**
 * The tables a statement reads: every FROM and JOIN, at any depth, with a
 * comma list after a FROM. `{tables: [NAME...], unclassified: reason|undefined}`.
 * A FROM or JOIN followed by anything but an identifier or `(` is not guessed
 * at: the whole statement is reported unclassified.
 */
export function readTables(sql, prefix = "") {
  const tokens = tokenize(String(sql));
  if (tokens === undefined) {
    return {tables: [], unclassified: "an unterminated literal, quoted name or comment"};
  }
  // Open SQL of 7.02 has no WITH, so the SQL this sees never has one; one
  // that does is not read, and CTE scoping is not chased
  if (tokens.some((t) => t.t === "word" && t.v.toUpperCase() === "WITH")) {
    return {tables: [], unclassified: "WITH (common table expression) is not produced by Open SQL; not classified"};
  }
  const tables = new Set();
  const parens = [];
  const refName = (token) => {
    let name = token.v.toUpperCase();
    if (prefix !== "" && name.startsWith(prefix.toUpperCase())) {
      name = name.slice(prefix.length);
    }
    return name;
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.t === "p" && tok.v === "(") {
      const before = tokens[i - 1];
      parens.push(before?.t === "word" ? before.v.toUpperCase() : "");
      continue;
    }
    if (tok.t === "p" && tok.v === ")") {
      parens.pop();
      continue;
    }
    if (tok.t !== "word" || !/^(FROM|JOIN)$/i.test(tok.v)) {
      continue;
    }
    if (/^FROM$/i.test(tok.v) && FUNCTIONS_WITH_FROM.has(parens[parens.length - 1])) {
      continue;
    }
    const isFrom = /^FROM$/i.test(tok.v);
    let j = i + 1;
    for (;;) {
      const next = tokens[j];
      if (next?.t === "p" && next.v === "(") {
        break; // a subselect or a join group: its own FROM and JOIN are read in turn
      }
      if (next === undefined || (next.t !== "id" && next.t !== "word")
          || (next.t === "word" && NOT_A_TABLE.has(next.v.toUpperCase()))) {
        return {tables: [], unclassified: `${tok.v.toUpperCase()} is followed by ${next === undefined ? "nothing" : `'${next.v}'`}`};
      }
      // schema . table
      let name = next;
      j += 1;
      while (tokens[j]?.t === "p" && tokens[j].v === "." && (tokens[j + 1]?.t === "id" || tokens[j + 1]?.t === "word")) {
        name = tokens[j + 1];
        j += 2;
      }
      if (tokens[j]?.t === "p" && tokens[j].v === "(" && name.t === "word") {
        return {tables: [], unclassified: `${name.v} is called as a table function`};
      }
      tables.add(refName(name));
      // alias
      if (tokens[j]?.t === "word" && tokens[j].v.toUpperCase() === "AS") {
        j += 2;
      } else if (tokens[j]?.t === "id" || (tokens[j]?.t === "word" && !NOT_AN_ALIAS.has(tokens[j].v.toUpperCase()))) {
        j += 1;
      }
      if (isFrom && tokens[j]?.t === "p" && tokens[j].v === ",") {
        j += 1;
        continue;
      }
      break;
    }
  }
  return {tables: [...tables], unclassified: undefined};
}

// ---------------------------------------------------------------- fetching

const FIELD_NAME = (field) => String(field).trim().toUpperCase();
const NUMERIC = new Set(["Packed", "Integer", "Integer8", "Float", "DecFloat", "DecFloat16", "DecFloat34"]);
const UNREADABLE = new Set(["String", "XString", "Table", "HashedTable", "DataReference", "ObjectReference", "FieldSymbol"]);

/** the local DDIC's columns of a table: [{name, field}] in DDIC order, groups skipped */
function ddicColumns(abap, table) {
  const entry = abap.DDIC?.[table];
  if (entry === undefined || typeof entry.type !== "function") {
    throw new Error(`table proxy: ${table} is allow-listed but has no DDIC here; transpile its TABL first, the proxy takes the columns from it`);
  }
  const structure = entry.type().get();
  return Object.entries(structure)
    .filter(([, field]) => field.constructor.name !== "Structure")
    .map(([name, field]) => ({name: name.toUpperCase(), field}));
}

// the DDIC length of a column, an estimate of its width in a DATA row
function lengthOf(field) {
  const kind = field.constructor.name;
  if (kind === "Date") return 8;
  if (kind === "Time") return 6;
  return typeof field.getLength === "function" ? field.getLength() : 16;
}

function rowText(value) {
  return value === undefined || value === null ? "" : String(value);
}

/**
 * DATA rows -> one object per row, by the FIELDS the system returned: each
 * value is DATA[offset .. offset+length), and where a delimiter was asked for
 * it must stand in the position before a field that is not the first, or the
 * offsets are not the layout this reads and nothing is guessed.
 */
export function parseRows(table, wanted, fields, data, delimiter) {
  const byName = new Map(fields.map((f) => [FIELD_NAME(f.FIELDNAME), {offset: parseInt(f.OFFSET, 10), length: parseInt(f.LENGTH, 10)}]));
  const layout = wanted.map((name) => {
    const f = byName.get(name);
    if (f === undefined || Number.isNaN(f.offset) || Number.isNaN(f.length)) {
      throw new Error(`table proxy: RFC_READ_TABLE for ${table} did not return field ${name} with an offset and a length`);
    }
    return {name, ...f};
  });
  const width = Math.max(0, ...layout.map((f) => f.offset + f.length));
  return data.map((row, n) => {
    const line = rowText(row.WA).padEnd(width, " ");
    const out = {};
    for (const f of layout) {
      if (delimiter !== "" && f.offset > 0 && line[f.offset - 1] !== delimiter) {
        throw new Error(`table proxy: ${table} row ${n + 1}: no delimiter '${delimiter}' before ${f.name} at offset ${f.offset}; `
          + "the offsets of FIELDS are not the layout of DATA, refusing to guess");
      }
      out[f.name] = line.slice(f.offset, f.offset + f.length).replace(/ +$/, "");
    }
    return out;
  });
}

/**
 * The client column a table's rows carry, or undefined for a client-independent
 * table: its first key field, when that is typed MANDT (the data element) or,
 * where the transpiled DDIC keeps no type name (a CLNT datatype shows as a
 * plain CHAR 3), is called MANDT. A MANDT that is not the first key field is
 * data, and keeps the system's value.
 */
export function clientColumnOf(abap, table, columns) {
  const first = String(abap.DDIC?.[table]?.keyFields?.[0] ?? "").toUpperCase();
  const column = columns.find((c) => c.name === first);
  if (column === undefined || column.field.constructor.name !== "Character" || lengthOf(column.field) !== 3) {
    return undefined;
  }
  const typed = typeof column.field.getDDICName === "function" ? column.field.getDDICName() : undefined;
  return String(typed ?? "").toUpperCase() === "MANDT" || first === "MANDT" ? first : undefined;
}

/** a text from the system as the SQL value the runtime's own INSERT would write for this column */
function sqlValue(abap, column, text, local, clientColumn) {
  const kind = column.field.constructor.name;
  let value = text;
  if (column.name === clientColumn) {
    value = local.mandt;
  } else if (NUMERIC.has(kind)) {
    value = text.trim();
    if (value.endsWith("-")) {
      value = `-${value.slice(0, -1).trim()}`;
    }
    if (value === "") {
      value = "0";
    }
  } else if (kind !== "Hex" && kind !== "Numc") {
    value = text.replace(/ +$/, "");
  } else {
    value = text.trim();
  }
  const typed = column.field.clone();
  typed.set(value);
  const got = typed.get();
  return typeof got === "string" ? `'${got.replace(/'/g, "''")}'` : got;
}

// ---------------------------------------------------------------- install

/**
 * @param options.destination destination name (messages, capture header)
 * @param options.allow table names, `PREFIX*` allowed; array or comma list
 * @param options.mode live | record | replay | fallback (default: the entry of
 *   the destinations file for that name, else replay)
 * @param options.folder capture folder, <folder>/RFC_READ_TABLE/<n>.json
 * @param options.connection live/record: see resolveConnection (rfc-live.mjs)
 * @param options.noLive CI: live and record fall back to replay, and a missing
 *   capture is an error naming the table and the path
 * @param options.maxRows ROWCOUNT, default 1000
 * @param options.delimiter DELIMITER of RFC_READ_TABLE, default '|'; blank asks
 *   for fixed-width rows (the offsets are then the table's layout)
 * @param options.clientFactory open-rfc Client factory, for tests
 * @returns {uninstall()} puts the original connection back
 */
export async function installTableProxy(abap, options = {}) {
  const destination = (options.destination ?? "").toUpperCase();
  if (destination === "") {
    throw new Error("table proxy: a destination is required");
  }
  if (abap[INSTALLED] !== undefined) {
    throw new Error("table proxy: already installed on this runtime");
  }
  const original = abap.context.databaseConnections["DEFAULT"];
  if (original === undefined) {
    throw new Error("table proxy: no DEFAULT database connection to wrap; install it after the database is set up");
  }
  const matches = tableAllowMatcher(options.allow);
  const maxRows = options.maxRows === undefined ? DEFAULT_MAX_ROWS : Number(options.maxRows);
  if (!Number.isInteger(maxRows) || maxRows <= 0) {
    throw new Error(`table proxy: maxRows must be a positive integer, not '${options.maxRows}'`);
  }
  const delimiter = options.delimiter === undefined ? "|" : String(options.delimiter);
  if (delimiter.length > 1) {
    throw new Error("table proxy: the delimiter is one character, or blank for fixed-width rows");
  }
  const folder = options.folder ?? process.env.STG_RFC_CAPTURE ?? DEFAULT_CAPTURE_FOLDER;
  const entry = options.mode !== undefined
    ? {kind: options.mode, capture: options.folder, connection: options.connection}
    : (options.destinations ?? loadDestinations(options.config))[destination] ?? {kind: "replay"};
  if (!["live", "record", "replay", "fallback"].includes(entry.kind)) {
    throw new Error(`table proxy: mode '${entry.kind}' is not live, record or replay`);
  }
  const source = options.noLive === true || entry.kind === "replay" ? "replay"
    : entry.kind === "record" ? "record" : "live";
  const captureFolder = entry.capture ?? folder;
  // a replay never builds a client: it picks the capture of this very table
  // itself (the generic replay client falls back to the first capture of the
  // module, which here would be another table's rows)
  const client = source === "replay" ? undefined : await clientFor(destination, entry, {
    local: localClient(), folder, trace: options.trace, clientFactory: options.clientFactory,
  });
  const prefix = () => abap.dbo?.tablePrefix ?? "";
  const journal = abap[JOURNAL] = [];
  const decided = new Map(); // table -> "hydrated" | "skipped" | Promise
  const written = new Set(); // committed local writes
  const writtenPending = new Set(); // in the open LUW
  const skippedOnPending = new Set(); // read-and-skipped because of a pending write
  const pending = new Set(); // hydrated inside the open LUW
  const unclassifiedSeen = new Set();

  const fetchRows = async (table, columns) => {
    const wanted = columns.map((c) => c.name);
    const width = columns.reduce((sum, c) => sum + lengthOf(c.field), 0) + (delimiter === "" ? 0 : columns.length - 1);
    if (width > ROW_WIDTH) {
      throw new Error(`table proxy: ${table} is ${width} characters wide with its readable fields, RFC_READ_TABLE returns at most ${ROW_WIDTH} per row; `
        + "not hydrated (a narrower table, or a capture of the columns you need, is the way)");
    }
    if (source === "replay") {
      const dir = join(captureFolder, READ_TABLE);
      const capture = loadCaptures(captureFolder, READ_TABLE)
        .find((c) => String(c.params.QUERY_TABLE ?? "").trim().toUpperCase() === table);
      if (capture === undefined) {
        throw new Error(`table proxy: no capture of ${table} for destination '${destination}' under ${dir}/; `
          + `record one: a ${READ_TABLE} call with QUERY_TABLE '${table}' saved as ${join(dir, "<n>.json")} `
          + "(STG_TABLE_PROXY_MODE=record with a live connection writes it)");
      }
      if (capture.exception !== undefined) {
        throw new Error(`table proxy: the capture ${capture.file} of ${table} is the exception ${capture.exception}`);
      }
      return {fields: capture.result.FIELDS ?? [], data: capture.result.DATA ?? []};
    }
    const type = (n) => new abap.types.Character(n);
    const itable = (row) => new abap.types.Table(row, {withHeader: false, keyType: "DEFAULT",
      primaryKey: {name: "primary_key", type: "STANDARD", keyFields: [], isUnique: false}, secondary: []});
    const fields = itable(new abap.types.Structure({fieldname: type(30), offset: new abap.types.Numc({length: 6}),
      length: new abap.types.Numc({length: 6}), type: type(1), fieldtext: type(60)}));
    for (const name of wanted) {
      const row = fields.getRowType().clone();
      row.get().fieldname.set(name);
      fields.append(row);
    }
    const data = itable(new abap.types.Structure({wa: type(ROW_WIDTH)}));
    const options_ = itable(new abap.types.Structure({text: type(72)}));
    try {
      await client.call(READ_TABLE, {
        exporting: {query_table: type(30).set(table), delimiter: type(1).set(delimiter),
          rowcount: new abap.types.Integer().set(maxRows)},
        tables: {fields, data, options: options_},
      });
    } catch (error) {
      throw new Error(`table proxy: ${READ_TABLE} of ${table} on '${destination}' failed: ${error?.message ?? error}`, {cause: error});
    }
    return {fields: toJson(fields), data: toJson(data)};
  };

  const hydrate = async (table) => {
    const base = {table, destination};
    if (written.has(table) || writtenPending.has(table)) {
      if (!written.has(table)) {
        skippedOnPending.add(table);
      }
      journal.push({...base, state: "skipped-written", source: undefined, rows: 0, truncated: false});
      return "skipped";
    }
    const quoted = abap.buildDbTableName(table.toLowerCase());
    const have = await original.select({select: `SELECT COUNT(*) AS n FROM ${quoted}`});
    if (Number(Object.values(have.rows[0] ?? {n: 0})[0]) > 0) {
      journal.push({...base, state: "skipped-local-rows", source: undefined, rows: 0, truncated: false});
      return "skipped";
    }
    const columns = ddicColumns(abap, table).filter((c) => !UNREADABLE.has(c.field.constructor.name));
    const {fields, data} = await fetchRows(table, columns);
    const rows = parseRows(table, columns.map((c) => c.name), fields, data.slice(0, maxRows), delimiter);
    const local = {mandt: abap.builtin.sy.get().mandt.get()};
    const clientColumn = clientColumnOf(abap, table, columns);
    try {
      for (const row of rows) {
        const {subrc} = await original.insert({
          table: quoted,
          columns: columns.map((c) => c.name.toLowerCase()),
          values: columns.map((c) => sqlValue(abap, c, row[c.name], local, clientColumn)),
        });
        if (subrc !== 0) {
          throw new Error(`table proxy: a row of ${table} could not be inserted (duplicate key?)`);
        }
      }
    } catch (error) {
      // the table had no rows when this started, so this takes back only ours
      await original.delete({table: quoted, where: ""});
      throw error;
    }
    pending.add(table);
    journal.push({...base, state: "hydrated", source, rows: rows.length, truncated: rows.length >= maxRows});
    return "hydrated";
  };

  const ensure = async (sql) => {
    const {tables, unclassified} = readTables(sql, prefix());
    if (unclassified !== undefined && !unclassifiedSeen.has(sql)) {
      unclassifiedSeen.add(sql);
      journal.push({table: undefined, destination, state: "unclassified", source: undefined, rows: 0, truncated: false,
        reason: unclassified, sql: String(sql).slice(0, 200)});
    }
    for (const table of [...tables].sort()) {
      if (!matches(table)) {
        continue;
      }
      if (!decided.has(table)) {
        const work = hydrate(table).then((state) => { decided.set(table, state); return state; },
          (error) => { decided.delete(table); throw error; });
        decided.set(table, work);
      }
      await decided.get(table);
    }
  };

  const noted = (table) => {
    let name = String(table).replace(/^"[^"]*"\./, "").replace(/^"|"$/g, "").toUpperCase();
    if (prefix() !== "" && name.startsWith(prefix().toUpperCase())) {
      name = name.slice(prefix().length);
    }
    writtenPending.add(name);
  };

  const wrapped = new Proxy(original, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") {
        return value;
      }
      switch (key) {
        case "select":
        case "openCursor":
          return async (opts, ...rest) => {
            await ensure(opts?.select ?? "");
            return value.call(target, opts, ...rest);
          };
        case "insert":
        case "update":
        case "delete":
          // marked once the client says the write happened; made local for
          // good only when it is committed
          return async (opts, ...rest) => {
            const result = await value.call(target, opts, ...rest);
            if (result?.subrc === undefined || result.subrc === 0) {
              noted(opts?.table ?? "");
            }
            return result;
          };
        case "commit":
          return async (...rest) => {
            const result = await value.apply(target, rest);
            pending.clear();
            for (const table of writtenPending) written.add(table);
            writtenPending.clear();
            skippedOnPending.clear();
            return result;
          };
        case "rollback":
          return async (...rest) => {
            const result = await value.apply(target, rest);
            for (const table of pending) {
              decided.delete(table);
              journal.push({table, destination, state: "rolled-back", source: undefined, rows: 0, truncated: false});
            }
            pending.clear();
            // an uncommitted write did not happen, nor does what it decided
            writtenPending.clear();
            for (const table of skippedOnPending) decided.delete(table);
            skippedOnPending.clear();
            return result;
          };
        default:
          return value.bind(target);
      }
    },
  });
  abap.context.databaseConnections["DEFAULT"] = wrapped;
  abap[INSTALLED] = {original, wrapped};
  return {
    uninstall() {
      if (abap.context.databaseConnections["DEFAULT"] === wrapped) {
        abap.context.databaseConnections["DEFAULT"] = original;
      }
      delete abap[INSTALLED];
      delete abap[JOURNAL];
    },
  };
}

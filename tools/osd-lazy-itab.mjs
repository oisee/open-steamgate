// RESEARCH, opt-in (OSD_LAZY_ITAB=1), not a product feature:
// docs/research-db-itab-shared-memory.md.
//
// SELECT ... INTO TABLE without building the internal table. The runtime
// builds one Structure and one field object per column for every row the
// database answers, before ABAP has asked for any of them. Here the table
// is filled with rows that hold a reference into the result as the engine
// gave it, and a row's fields are made the first time something reads them:
//
//   - the source is the client's rows (any DatabaseClient), or, when the
//     client offers selectChunks(), the engine's own result chunks -- for
//     DuckDB that is the engine's memory, never copied into row objects;
//   - a row is a Structure by prototype (instanceof, constructor and every
//     method of the runtime's Structure hold), so no statement of the
//     runtime had to learn about it: LOOP, READ, SORT, DELETE, MODIFY,
//     INSERT, COLLECT, a copy, a comparison all go through Structure.get()
//     or its private `value`, and both are where the fields get made;
//   - a field is made by the same two calls the runtime's rowsToTarget
//     makes at SELECT time -- a clone of the row type's component and
//     set(value), or clear() for NULL -- so the value is the one the eager
//     path would have stored. What moves is WHEN: a value the type refuses
//     raises where the field is first read, not at the SELECT.
//
// Lifetime: nothing here outlives what an eager table outlives. A lazy row
// holds the row type's components (as an eager row's clones came from them)
// and a reference to an immutable result; no table of the database is
// aliased, so a later UPDATE cannot be seen through an old internal table,
// exactly as with a copy. The result is released when its last unread row
// is read in full or dropped.
//
// What is NOT lazy falls back to the runtime's own select, whole statement:
// a sorted or hashed target, a target with a header line, a row type that
// is not a flat structure (nested structure, table, include group), an
// unstructured row type, INTO a work area or a field list. The counters say
// which reason was hit, so a fallback is visible and never a wrong answer.

const counters = {lazySelects: 0, lazyRows: 0, chunkSelects: 0, columnsDecoded: 0, rowsTouched: 0, rowsFull: 0, fields: 0, lazyClones: 0, fallback: {}};

// what the process did in all, kept across reset(): OSD_LAZY_ITAB_REPORT=1
// prints it at exit, which is how a run of somebody else's suite shows that
// the switch was on and how often the runtime's own select answered instead
const totals = {};
function fold() {
  for (const [name, value] of Object.entries(counters)) {
    if (typeof value === "number") totals[name] = (totals[name] ?? 0) + value;
    else for (const [reason, n] of Object.entries(value)) (totals.fallback ??= {})[reason] = (totals.fallback[reason] ?? 0) + n;
  }
}

function resetCounters() {
  fold();
  Object.assign(counters, {lazySelects: 0, lazyRows: 0, chunkSelects: 0, columnsDecoded: 0, rowsTouched: 0, rowsFull: 0, fields: 0, lazyClones: 0, fallback: {}});
  return counters;
}

// one object literal with every component as an own key, in the row type's
// order, so the keys of a half-read row are the keys of the type and in its
// order; made by a compiled factory so that all rows of a shape share one
// hidden class
const blankFactories = new Map();
function blankFactory(keys) {
  const id = keys.join("\u0000");
  let factory = blankFactories.get(id);
  if (factory === undefined) {
    factory = new Function(`return {${keys.map((k) => `${JSON.stringify(k)}: undefined`).join(", ")}};`);
    blankFactories.set(id, factory);
  }
  return factory;
}

export function installLazyItab(abap, {env = globalThis.process?.env ?? {}} = {}) {
  if (abap.statements.osdLazyItab === true) return;
  const {Structure, Table, HashedTable, FieldSymbol} = abap.types;
  const eagerSelect = abap.statements.select;
  const useChunks = env.OSD_LAZY_ITAB_CHUNKS !== "0";
  const fullAfter = Number(env.OSD_LAZY_ITAB_FULL_AFTER ?? 0.5);

  // ---- the shape of one SELECT's rows: the row type's components and
  // which of them the result has a column for
  class Shape {
    constructor(rowType, columns) {
      this.rowType = rowType;
      this.templates = rowType.get();
      this.keys = Object.keys(this.templates);
      this.blank = blankFactory(this.keys);
      // rowsToTarget walks the columns of a row, lower-cases the name and
      // reads the ROW by the lower-cased name: a column is a component's
      // source when its lower-cased name is the component, and its value is
      // what the result holds under that lower-cased name
      this.has = Object.create(null);
      for (const column of columns) {
        const key = column.toLowerCase();
        if (this.templates[key] !== undefined) this.has[key] = true;
      }
      this.fullAfter = Math.max(1, Math.floor(this.keys.length * fullAfter));
      this.qualifiedName = rowType.getQualifiedName();
      this.ddicName = rowType.getDDICName();
      this.suffix = rowType.getRenamingSuffix();
      this.asInclude = rowType.getAsInclude();
    }

    /** the value of a component of a row as the client would have put it
     *  into its row object; overridden by the chunk source */
    valueOf(source, key) {
      return source[key];
    }

    make(source, key) {
      const field = this.templates[key].clone();
      if (this.has[key] === true) {
        const value = this.valueOf(source, key);
        if (value === null) field.clear();
        else field.set(value);
      }
      counters.fields++;
      return field;
    }
  }

  // ---- a row. No constructor of Structure runs: the prototype chain makes
  // it one, and `value` -- an own field of an ordinary Structure -- is an
  // accessor here, so every inherited method that reads this.value gets
  // the row in full.
  function LazyRow(shape, source) {
    this.osdShape = shape;
    this.osdSource = source;
    this.osdFields = undefined;
    this.osdProxy = undefined;
    this.osdMade = 0;
    this.osdFull = false;
  }
  const proto = Object.create(Structure.prototype);
  LazyRow.prototype = proto;

  // A reader of one or two fields of a wide row pays for those; a reader
  // that is past half of them is taken to want the row, which is then made
  // in one go and read without a trap from there on (FULL_AFTER of the
  // fields, OSD_LAZY_ITAB_FULL_AFTER, 0.5 by default; 1 = never in advance).
  const handler = {
    get(target, key) {
      const have = target[key];
      if (have !== undefined || typeof key !== "string") return have;
      const row = this.row;
      const shape = row.osdShape;
      if (shape.templates[key] === undefined) return undefined;
      if (++row.osdMade > shape.fullAfter) return row.value[key];
      return target[key] = shape.make(row.osdSource, key);
    },
    getOwnPropertyDescriptor(target, key) {
      if (target[key] === undefined && typeof key === "string" && this.row.osdShape.templates[key] !== undefined) {
        // somebody enumerates the row: all of it
        void this.row.value;
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  };

  Object.defineProperties(proto, {
    value: {
      get() {
        if (this.osdFull === true) return this.osdFields;
        const shape = this.osdShape;
        const fields = this.osdFields ??= shape.blank();
        const source = this.osdSource;
        for (const key of shape.keys) {
          if (fields[key] === undefined) fields[key] = shape.make(source, key);
        }
        this.osdFull = true;
        this.osdSource = undefined;
        // the view, if one was handed out, stays valid: it is over these
        // same fields and finds every one of them made
        this.osdProxy = undefined;
        counters.rowsFull++;
        return fields;
      },
      set() { throw new Error("osd-lazy-itab: the fields of a row are not replaced"); },
    },
    qualifiedName: {get() { return this.osdShape.qualifiedName; }},
    ddicName: {get() { return this.osdShape.ddicName; }},
    suffix: {get() { return this.osdShape.suffix; }},
    asInclude: {get() { return this.osdShape.asInclude; }},
  });

  /** the fields: the plain object when the row is in full, else a view
   *  over that same object which makes a field when it is read. A view
   *  somebody kept stays valid after the row is full, but it is then not
   *  the object get() answers: two answers of get() are the same fields
   *  and need not be === (nothing in the runtime compares them). */
  proto.get = function () {
    if (this.osdFull === true) return this.osdFields;
    if (this.osdProxy !== undefined) return this.osdProxy;
    this.osdFields ??= this.osdShape.blank();
    counters.rowsTouched++;
    const h = Object.create(handler);
    h.row = this;
    return this.osdProxy = new Proxy(this.osdFields, h);
  };

  /** a copy of a row nobody read in full is a row over the same immutable
   *  result, plus a clone of each field already made (it may have been
   *  changed since) */
  proto.clone = function () {
    if (this.osdFull === true) return Structure.prototype.clone.call(this);
    const copy = new LazyRow(this.osdShape, this.osdSource);
    const fields = this.osdFields;
    if (fields !== undefined) {
      const mine = copy.osdFields = this.osdShape.blank();
      for (const key of this.osdShape.keys) {
        if (fields[key] !== undefined) mine[key] = fields[key].clone();
      }
      copy.osdMade = this.osdMade;
    }
    counters.lazyClones++;
    return copy;
  };

  // ---- the chunk source: a row is (chunk, index). A column of a chunk
  // leaves the engine's vector in one go, the first time a field of it is
  // made (some 2000 values in a tight loop; item by item out of the loop
  // of an ABAP program, a loop over every field of 100k rows took 1758 ms
  // against 1235 ms this way), and a column nobody reads never leaves it.
  class ChunkShape extends Shape {
    constructor(rowType, columns, chunk, convert) {
      super(rowType, columns);
      const vectors = chunk.vectors;
      // a vector does not keep its chunk alive (tools/duckdb-client.mjs,
      // selectChunks): the chunk is held here for as long as a row of it is
      this.owner = chunk.owner;
      this.undecoded = columns.length;
      this.vectors = Object.create(null);
      columns.forEach((column, i) => { this.vectors[column] = vectors[i]; });
      this.decoded = Object.create(null);
      this.convert = convert;
    }

    decode(key) {
      const vector = this.vectors[key];
      if (vector === undefined) return this.decoded[key] = [];
      const count = vector.itemCount;
      const convert = this.convert;
      const values = new Array(count);
      for (let i = 0; i < count; i++) values[i] = convert(vector.getItem(i));
      this.vectors[key] = undefined;
      // the last column out: nothing reads the engine's memory any more
      if (--this.undecoded === 0) this.owner = undefined;
      counters.columnsDecoded++;
      return this.decoded[key] = values;
    }

    valueOf(index, key) {
      return (this.decoded[key] ?? this.decode(key))[index];
    }
  }

  function refusal(target, runtimeOptions) {
    if (target instanceof HashedTable) return "hashed target";
    if (!(target instanceof Table)) return "not a table target";
    const options = target.getOptions();
    if (options?.withHeader === true) return "header line";
    const kind = options?.primaryKey?.type;
    if (kind !== undefined && kind !== "STANDARD") return "sorted target";
    if (runtimeOptions?.positional === true) return "positional";
    const rowType = target.getRowType();
    if (!(rowType instanceof Structure)) return "unstructured row";
    if (rowType.osdShape !== undefined) return "row type is a lazy row";
    const include = rowType.getAsInclude();
    if (include !== undefined && Object.keys(include).length > 0) return "include group";
    const fields = rowType.get();
    for (const key in fields) {
      const field = fields[key];
      if (field instanceof Structure || field instanceof Table || field instanceof HashedTable
          || typeof field?.clone !== "function" || typeof field?.set !== "function" || typeof field?.clear !== "function") {
        return "deep row";
      }
    }
    return undefined;
  }

  abap.statements.select = async function (target, input, runtimeOptions) {
    const pointer = target instanceof FieldSymbol && target.isAssigned() ? target.getPointer() : target;
    const reason = refusal(pointer, runtimeOptions);
    if (reason !== undefined) {
      counters.fallback[reason] = (counters.fallback[reason] ?? 0) + 1;
      return eagerSelect.call(this, target, input, runtimeOptions);
    }
    const table = pointer;
    const sy = abap.builtin.sy.get();
    const db = abap.context.defaultDB();
    const append = (row) => table.insertIndex(row, table.getArrayLength(), true);
    const nothing = () => {
      // INTO TABLE initialises the target also when nothing is found
      if (runtimeOptions?.appending !== true) table.clear();
      sy.dbcnt.set(0);
      sy.subrc.set(4);
    };
    let count = 0;

    if (useChunks && typeof db.selectChunks === "function") {
      const result = await db.selectChunks(input);
      if (result.rowCount === 0) return nothing();
      if (runtimeOptions?.appending !== true) table.clear();
      for (const chunk of result.chunks) {
        const shape = new ChunkShape(table.getRowType(), result.columns, chunk, result.convert);
        for (let i = 0; i < chunk.rowCount; i++) append(new LazyRow(shape, i));
        count += chunk.rowCount;
      }
      counters.chunkSelects++;
    } else {
      const {rows} = await db.select(input);
      if (rows.length === 0) return nothing();
      if (runtimeOptions?.appending !== true) table.clear();
      const shape = new Shape(table.getRowType(), Object.keys(rows[0]));
      for (const row of rows) append(new LazyRow(shape, row));
      count = rows.length;
    }
    counters.lazySelects++;
    counters.lazyRows += count;
    sy.dbcnt.set(count);
    sy.subrc.set(0);
  };
  abap.statements.osdLazyItab = true;
  if (env.OSD_LAZY_ITAB_REPORT === "1") {
    globalThis.process?.on("exit", () => {
      fold();
      console.log("osd-lazy-itab: " + JSON.stringify(totals));
    });
  }
  globalThis.osdLazyItab = {reset: resetCounters, read: () => JSON.parse(JSON.stringify(counters))};
}

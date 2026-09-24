//go:build js && wasm

package abap

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"syscall/js"
	"time"
)

// openSQL under GOOS=js: the database is sql.js, the SQLite the browser
// preview already runs (web/preview-backend.mjs), reached through
// syscall/js by a database/sql driver registered here as "sqljs". Nothing
// above openSQL knows which driver it got: the LUW (luw.go) is database/sql's
// Tx, which this driver runs as BEGIN / COMMIT / ROLLBACK on the one
// connection the pool keeps (db.go).
//
// sql.js is synchronous once it is loaded, and so is this driver: the host
// loads it before Go starts and leaves the module at globalThis.SQL (what
// initSqlJs() resolves to). A DSN other than ":memory:" is the host's to
// answer: globalThis.osgoOpenDatabase(dsn) returns a sql.js Database (a file
// read into memory, a copy kept in cache storage) or null, and without that
// hook such a DSN is refused. When the host also has
// globalThis.osgoSaveDatabase(dsn, bytes), such a database is exported to it
// after every COMMIT and every write outside a transaction (a file DSN under
// Node: osgo --db). A page host exports when it chooses (SqljsExport).
//
// sql.js's export() closes and reopens the database, which forgets what a
// PRAGMA set on the connection (case_sensitive_like, dbstore.go): the driver
// keeps each PRAGMA ... = ... it ran and runs them again after an export.
//
// Values: sql.js reads an INTEGER column with useBigInt, so an int64 comes
// back whole, not through a double; a REAL stays float64, a TEXT string, a
// BLOB []byte, NULL nil, which are the types modernc.org/sqlite answers. An
// int64 argument beyond 2^53 is bound as a BigInt, which sql.js binds as its
// decimal text (SQLite's INTEGER affinity takes it back as an integer).
func openSQL(dsn string) (*sql.DB, error) { return sql.Open("sqljs", dsn) }

func init() { sql.Register("sqljs", sqljsDriver{}) }

// the rows of one statement cross from JS to Go as one JSON text: a call
// through syscall/js per value would cost more than the parse. A value JSON
// cannot carry as it is travels as a string tagged with a NUL: "\x00i" an
// integer beyond 2^53, "\x00f" a REAL with an integral value (or NaN,
// Infinity), "\x00b" a BLOB in hex, "\x00s" a TEXT that itself starts with NUL.
const sqljsHelper = `
const enc = (v) => {
  switch (typeof v) {
    case "bigint": return (v >= -9007199254740991n && v <= 9007199254740991n) ? Number(v) : "\u0000i" + v;
    case "number": return Number.isInteger(v) || !Number.isFinite(v) ? "\u0000f" + v : v;
    case "string": return v.charCodeAt(0) === 0 ? "\u0000s" + v : v;
    case "object":
      if (v === null) return null;
      if (v instanceof Uint8Array) { let h = ""; for (const b of v) h += (b < 16 ? "0" : "") + b.toString(16); return "\u0000b" + h; }
  }
  throw new Error("sqljs: a value of type " + typeof v);
};
const opt = {useBigInt: true};
return {
  query(db, sql, params) {
    let st;
    try {
      st = db.prepare(sql);
      if (params) st.bind(params);
      const out = [st.getColumnNames()];
      while (st.step()) out.push(st.get(null, opt).map(enc));
      return JSON.stringify(out);
    } catch (e) {
      return "\u0000" + (e && e.message ? e.message : String(e));
    } finally {
      if (st) st.free();
    }
  },
  exec(db, sql, params) {
    try {
      if (params) db.run(sql, params); else db.exec(sql);
      return db.getRowsModified();
    } catch (e) {
      return "\u0000" + (e && e.message ? e.message : String(e));
    }
  },
};
`

var sqljsJS js.Value

func sqljs() js.Value {
	if sqljsJS.IsUndefined() {
		sqljsJS = js.Global().Get("Function").New(sqljsHelper).Invoke()
	}
	return sqljsJS
}

type sqljsDriver struct{}

func (sqljsDriver) Open(dsn string) (driver.Conn, error) {
	var d js.Value
	if hook := js.Global().Get("osgoOpenDatabase"); hook.Type() == js.TypeFunction {
		d = hook.Invoke(dsn)
	}
	if d.IsUndefined() || d.IsNull() {
		if dsn != ":memory:" {
			return nil, fmt.Errorf("sqljs: no database for %q (the host has no osgoOpenDatabase hook, or it answered none)", dsn)
		}
		mod := js.Global().Get("SQL")
		if mod.Type() != js.TypeObject && mod.Type() != js.TypeFunction {
			return nil, errors.New("sqljs: sql.js is not loaded (globalThis.SQL is what initSqlJs() resolves to)")
		}
		d = mod.Get("Database").New()
	}
	return &sqljsConn{db: d, dsn: dsn}, nil
}

// SqljsError is an error sql.js threw. Code answers the extended result code
// dbwrite.go's duplicateKey asks for, read off the message since sql.js
// reports only the text: a PRIMARY KEY and a UNIQUE violation both read
// "UNIQUE constraint failed", as SQLite words them.
type SqljsError struct{ Msg string }

func (e *SqljsError) Error() string { return e.Msg }
func (e *SqljsError) Code() int {
	switch {
	case strings.HasPrefix(e.Msg, "UNIQUE constraint failed"):
		return 2067 // SQLITE_CONSTRAINT_UNIQUE
	case strings.Contains(e.Msg, "constraint failed"):
		return 19 // SQLITE_CONSTRAINT
	}
	return 1
}

type sqljsConn struct {
	db      js.Value
	dsn     string
	closed  bool
	inTx    bool
	pragmas []string
}

func (c *sqljsConn) Prepare(query string) (driver.Stmt, error) {
	return &sqljsStmt{c: c, q: query}, nil
}

func (c *sqljsConn) Close() error {
	if !c.closed {
		c.closed = true
		c.db.Call("close")
	}
	return nil
}

func (c *sqljsConn) Begin() (driver.Tx, error) {
	if _, err := c.exec("BEGIN", nil); err != nil {
		return nil, err
	}
	c.inTx = true
	return sqljsTx{c}, nil
}

type sqljsTx struct{ c *sqljsConn }

func (t sqljsTx) Commit() error {
	t.c.inTx = false
	if _, err := t.c.exec("COMMIT", nil); err != nil {
		return err
	}
	return t.c.saved()
}

func (t sqljsTx) Rollback() error {
	t.c.inTx = false
	_, err := t.c.exec("ROLLBACK", nil)
	return err
}

// export is sql.js's export(), with the connection's PRAGMAs set again
func (c *sqljsConn) export() ([]byte, error) {
	if c.inTx {
		return nil, errors.New("sqljs: export inside a transaction would end it")
	}
	u := c.db.Call("export")
	b := make([]byte, u.Get("length").Int())
	js.CopyBytesToGo(b, u)
	for _, p := range c.pragmas {
		if _, err := c.exec(p, nil); err != nil {
			return nil, err
		}
	}
	return b, nil
}

// saved hands the database to the host's osgoSaveDatabase, when it has one
// and the database is not the in-memory one
func (c *sqljsConn) saved() error {
	hook := js.Global().Get("osgoSaveDatabase")
	if c.dsn == ":memory:" || hook.Type() != js.TypeFunction {
		return nil
	}
	b, err := c.export()
	if err != nil {
		return err
	}
	u := js.Global().Get("Uint8Array").New(len(b))
	js.CopyBytesToJS(u, b)
	hook.Invoke(c.dsn, u)
	return nil
}

// SqljsExport is the process's database as an SQLite file image, for a host
// that keeps it (the service worker's cache storage): refused while a dialog
// step runs.
func SqljsExport() ([]byte, error) {
	if db == nil {
		return nil, errors.New("sqljs: no database is open")
	}
	var out []byte
	c, err := db.Conn(context.Background())
	if err != nil {
		return nil, err
	}
	defer c.Close()
	err = c.Raw(func(dc any) error {
		var e error
		out, e = dc.(*sqljsConn).export()
		return e
	})
	return out, err
}

// OpenDBImage opens a database the host already holds (osgoOpenDatabase
// answers dsn with it: a copy read back from cache storage) without seeding
// it again, and brings it to the store's form (dbstore.go) as OpenDB does.
func OpenDBImage(dsn string) error {
	d, err := openSQL(dsn)
	if err != nil {
		return err
	}
	d.SetMaxOpenConns(1)
	if err := prepareStore(d); err != nil {
		d.Close()
		return err
	}
	db = d
	return nil
}

// args binds driver values as sql.js takes them
func sqljsArgs(args []driver.NamedValue) (js.Value, error) {
	if len(args) == 0 {
		return js.Undefined(), nil
	}
	out := js.Global().Get("Array").New(len(args))
	for i, a := range args {
		if a.Name != "" {
			return js.Value{}, errors.New("sqljs: named parameters are not supported")
		}
		var v any
		switch x := a.Value.(type) {
		case nil:
			v = nil
		case int64:
			if x > 1<<53 || x < -(1<<53) {
				v = js.Global().Call("BigInt", strconv.FormatInt(x, 10))
			} else {
				v = float64(x)
			}
		case float64:
			v = x
		case bool:
			if x {
				v = 1
			} else {
				v = 0
			}
		case string:
			v = x
		case []byte:
			u := js.Global().Get("Uint8Array").New(len(x))
			js.CopyBytesToJS(u, x)
			v = u
		case time.Time:
			// modernc.org/sqlite's default text form of a time
			v = x.Format("2006-01-02 15:04:05.999999999-07:00")
		default:
			return js.Value{}, fmt.Errorf("sqljs: an argument of type %T", a.Value)
		}
		out.SetIndex(i, js.ValueOf(v))
	}
	return out, nil
}

func (c *sqljsConn) exec(query string, args []driver.NamedValue) (int64, error) {
	p, err := sqljsArgs(args)
	if err != nil {
		return 0, err
	}
	var r js.Value
	if p.IsUndefined() {
		r = sqljs().Call("exec", c.db, query)
	} else {
		r = sqljs().Call("exec", c.db, query, p)
	}
	if r.Type() == js.TypeString {
		return 0, &SqljsError{strings.TrimPrefix(r.String(), "\x00")}
	}
	return int64(r.Float()), nil
}

func (c *sqljsConn) query(query string, args []driver.NamedValue) (driver.Rows, error) {
	p, err := sqljsArgs(args)
	if err != nil {
		return nil, err
	}
	var s string
	if p.IsUndefined() {
		s = sqljs().Call("query", c.db, query).String()
	} else {
		s = sqljs().Call("query", c.db, query, p).String()
	}
	if strings.HasPrefix(s, "\x00") {
		return nil, &SqljsError{s[1:]}
	}
	dec := json.NewDecoder(strings.NewReader(s))
	dec.UseNumber()
	var raw [][]any
	if err := dec.Decode(&raw); err != nil {
		return nil, fmt.Errorf("sqljs: %w", err)
	}
	rows := &sqljsRows{rows: make([][]driver.Value, 0, len(raw)-1)}
	for _, n := range raw[0] {
		rows.cols = append(rows.cols, n.(string))
	}
	for _, r := range raw[1:] {
		row := make([]driver.Value, len(r))
		for i, v := range r {
			if row[i], err = sqljsValue(v); err != nil {
				return nil, err
			}
		}
		rows.rows = append(rows.rows, row)
	}
	return rows, nil
}

func sqljsValue(v any) (driver.Value, error) {
	switch x := v.(type) {
	case nil:
		return nil, nil
	case json.Number:
		t := string(x)
		if !strings.ContainsAny(t, ".eE") {
			return strconv.ParseInt(t, 10, 64)
		}
		return strconv.ParseFloat(t, 64)
	case string:
		if !strings.HasPrefix(x, "\x00") || len(x) < 2 {
			return x, nil
		}
		switch x[1] {
		case 'i':
			return strconv.ParseInt(x[2:], 10, 64)
		case 'f':
			return strconv.ParseFloat(x[2:], 64) // takes NaN and Infinity as JS writes them
		case 'b':
			return hex.DecodeString(x[2:])
		case 's':
			return x[2:], nil
		}
	}
	return nil, fmt.Errorf("sqljs: a value %v", v)
}

func (c *sqljsConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	n, err := c.exec(query, args)
	if err != nil {
		return nil, err
	}
	if t := strings.ToUpper(strings.TrimSpace(query)); strings.HasPrefix(t, "PRAGMA ") && strings.Contains(t, "=") && !strings.Contains(t, "USER_VERSION") {
		c.pragmas = append(c.pragmas, query)
	}
	if !c.inTx {
		if err := c.saved(); err != nil {
			return nil, err
		}
	}
	return sqljsResult{c: c, n: n}, nil
}

func (c *sqljsConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return c.query(query, args)
}

type sqljsResult struct {
	c *sqljsConn
	n int64
}

func (r sqljsResult) RowsAffected() (int64, error) { return r.n, nil }

// LastInsertId asks when asked: nothing in go/abap does (rowid tables are
// not how ABAP keys a row)
func (r sqljsResult) LastInsertId() (int64, error) {
	rows, err := r.c.query("SELECT last_insert_rowid()", nil)
	if err != nil {
		return 0, err
	}
	v := make([]driver.Value, 1)
	if err := rows.Next(v); err != nil {
		return 0, err
	}
	n, _ := v[0].(int64)
	return n, nil
}

type sqljsStmt struct {
	c *sqljsConn
	q string
}

func (s *sqljsStmt) Close() error  { return nil }
func (s *sqljsStmt) NumInput() int { return -1 }
func (s *sqljsStmt) Exec(args []driver.Value) (driver.Result, error) {
	return s.c.ExecContext(context.Background(), s.q, sqljsNamed(args))
}
func (s *sqljsStmt) Query(args []driver.Value) (driver.Rows, error) {
	return s.c.query(s.q, sqljsNamed(args))
}

func sqljsNamed(args []driver.Value) []driver.NamedValue {
	out := make([]driver.NamedValue, len(args))
	for i, a := range args {
		out[i] = driver.NamedValue{Ordinal: i + 1, Value: a}
	}
	return out
}

type sqljsRows struct {
	cols []string
	rows [][]driver.Value
	i    int
}

func (r *sqljsRows) Columns() []string { return r.cols }
func (r *sqljsRows) Close() error      { return nil }
func (r *sqljsRows) Next(dest []driver.Value) error {
	if r.i >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.i])
	r.i++
	return nil
}

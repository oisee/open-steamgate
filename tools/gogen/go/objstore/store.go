// Package objstore is the object store for the Go host: ZOSD_STORE over
// abapGit-named files, history from git, CHECK/ACTIVATE refused. It does not
// import go/abap; go/abap keeps the ZOSD_STORE adapter and the Store* names.
package objstore

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The object store: CALL FUNCTION 'ZOSD_STORE' DESTINATION
// 'STORE' answered over the same files the Node host answers it over
// (tools/osd-store.mjs, tools/osd-store-destination.mjs). OSG's rule is that
// the files, named the abapGit way, are the truth and git is the history, so
// there is no second copy of a source anywhere: a READ reads the file, a
// WRITE writes it in the working tree.
//
// What a version is here. Active is what the running generation was built
// from: the build records a digest of every file of a writable root
// (tools/gogen/store.mjs), and an object whose files still hash to that is
// active. Inactive is a working file that differs, or one this process
// wrote, which is what the Node store calls inactive after a WRITE.
//
// What it cannot do. CHECK and ACTIVATE are abaplint over the whole registry
// and then a build, and this binary carries neither: it IS a build. They
// answer that, as an error and as an issue that stands, so a screen that
// only reads the issue table does not call an activation that did not
// happen a success. TOKENS (the parser's keyword colouring) is refused the
// same way and a screen falls back to plain text.
//
// Shapes are the Node destination's, field for field, including the answer
// of every scalar on every call (its EMPTY), the tally of what the filter
// matched and the order, which is JavaScript's localeCompare (ICU root
// collation, collateLess in index.go) and not byte order.

// Root is one root of the index: a folder walked, or a library's file
// list as the build reads it.
type Root struct {
	Path      string   `json:"path"`
	Writable  bool     `json:"writable"`
	Library   bool     `json:"library"`
	Imported  bool     `json:"imported"`
	Package   string   `json:"package"`
	Tmp       bool     `json:"tmp"`
	Abapgit   *Abapgit `json:"abapgit"`
	Overlay   string   `json:"overlay"`
	OverlayOf string   `json:"overlayOf"`
	Files     []string `json:"files"`
}

type Abapgit struct {
	StartingFolder string `json:"startingFolder"`
	FolderLogic    string `json:"folderLogic"`
	MasterLanguage string `json:"masterLanguage"`
	Declared       bool   `json:"declared"`
}

// Config is what the build says about the tree (tools/gogen/store.mjs).
type Config struct {
	Roots    []Root            `json:"roots"`
	Libs     []Root            `json:"libs"`
	Excluded []string          `json:"excluded"`
	Built    map[string]string `json:"built"`
	Active   map[string]string `json:"active"`
}

type storeEntry struct {
	Type, Name, File, Root string
	Writable, Library      bool
	Imported               bool
	Package                string
	Packages               []string
	ChangedBy              string
	Synthetic              bool
	Overlay                string
}

var storeState struct {
	mu       sync.Mutex
	root     string
	cfg      *Config
	excluded []*regexp.Regexp
	written  map[string]bool
	reason   string
}

// SetStore points the store at a tree and the build's facts about it. An
// empty root, or no configuration, is a binary with no tree: every call is
// answered "no object store here" with the reason.
func SetStore(root string, config []byte, reason string) error {
	storeState.mu.Lock()
	defer storeState.mu.Unlock()
	storeState.root, storeState.cfg, storeState.excluded = "", nil, nil
	storeState.written = map[string]bool{}
	storeState.reason = reason
	if root == "" || len(config) == 0 {
		if reason == "" {
			storeState.reason = "this binary was built without the facts of a source tree"
		}
		return nil
	}
	var cfg Config
	if err := json.Unmarshal(config, &cfg); err != nil {
		return err
	}
	for _, p := range cfg.Excluded {
		re, err := regexp.Compile(p)
		if err != nil {
			return fmt.Errorf("store exclusion %q: %v", p, err)
		}
		storeState.excluded = append(storeState.excluded, re)
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	if st, err := os.Stat(filepath.Join(abs, "abap_transpile.json")); err != nil || st.IsDir() {
		storeState.reason = "no tree at " + abs + ": abap_transpile.json is not there"
		return nil
	}
	storeState.root, storeState.cfg = abs, &cfg
	return nil
}

// Row is one object as the screen lists it (ZOSD_OBJECT_S).
type Row struct {
	TYPE, NAME, PACKAGE, FILE, WRITABLE, VERSION, CHANGED_AT string
}

// Issue is one issue (ZOSD_ISSUE_S).
type Issue struct {
	OBJ_TYPE, OBJ_NAME string
	LINE, COL          int32
	RULE, MESSAGE      string
}

// Tally is one type and how many of it matched (ZOSD_TYPE_S).
type Tally struct {
	TYPE  string
	COUNT int32
}

// Answer is every exporting parameter and table of ZOSD_STORE.
type Answer struct {
	Scalars map[string]string
	Objects []Row
	Issues  []Issue
	Types   []Tally
	// HISTORY's versions (ET_REVISION, history.go)
	Revisions []Revision
}

func storeEmpty() Answer {
	a := Answer{Scalars: map[string]string{}, Objects: []Row{}, Issues: []Issue{}, Types: []Tally{}, Revisions: []Revision{}}
	for _, k := range []string{"EV_LIVE", "EV_NOTE", "EV_SOURCE", "EV_FILE", "EV_STATE", "EV_CHANGED", "EV_PACKAGE", "EV_VERSION", "EV_WRITABLE", "EV_ACTIVE", "EV_ERROR", "EV_JSON"} {
		a.Scalars[k] = ""
	}
	a.Scalars["EV_COUNT"], a.Scalars["EV_MS"] = "0", "0"
	return a
}

func storeRowOf(e *storeEntry, file string) Row {
	version, changed := storeStateOf(e, file)
	w := "X"
	if !e.Writable && e.Overlay == "" {
		w = ""
	}
	return Row{TYPE: e.Type, NAME: e.Name, PACKAGE: e.Package, FILE: file, WRITABLE: w, VERSION: version, CHANGED_AT: changed}
}

type storeRefusal string

func (r storeRefusal) Error() string { return string(r) }

func storeNotFound(typ, name string) error { return storeRefusal(typ + " " + name + " does not exist") }

// Capabilities is what CAPABILITIES names: the commands this host does,
// as opposed to the ones it only refuses (CHECK, ACTIVATE: storeNoCompiler).
var Capabilities = []string{"LIST", "READ", "WRITE", "HISTORY", "REVISION", "OBJECT", "PACKAGE", "PACKAGES", "SEARCH"}

// Commands lists the implemented protocol commands, including discovery.
// CHECK, ACTIVATE and TOKENS answer a compiler refusal on this host.
var Commands = []string{"LIST", "READ", "WRITE", "CHECK", "ACTIVATE", "TOKENS", "CAPABILITIES", "HISTORY", "REVISION", "OBJECT", "PACKAGE", "PACKAGES", "SEARCH", "COMMANDS"}

// Call answers one call of ZOSD_STORE. in holds the importing values
// that were passed (IV_*), present or absent the way the caller passed them.
func Call(in map[string]*string) Answer {
	storeState.mu.Lock()
	defer storeState.mu.Unlock()
	a := storeEmpty()
	text := func(k, fallback string) string {
		if v, ok := in[k]; ok && v != nil {
			return strings.TrimSpace(*v)
		}
		return fallback
	}
	command := strings.ToUpper(text("IV_COMMAND", "LIST"))

	switch command {
	case "LIST", "READ", "WRITE", "CHECK", "ACTIVATE", "TOKENS", "HISTORY", "REVISION", "OBJECT", "PACKAGE", "PACKAGES", "SEARCH":
	case "COMMANDS":
		value, _ := json.Marshal(map[string]any{"commands": Commands})
		a.Scalars["EV_JSON"] = string(value)
		a.Scalars["EV_NOTE"] = strings.Join(Commands, " ")
		return a
	case "CAPABILITIES":
		// what this host can do, for a screen that draws a button only for
		// a command named here (ZCL_OSD_EDIT): no CHECK and no ACTIVATE,
		// since this binary carries no compiler and is a built generation.
		// Node answers all five (tools/osd-store-destination.mjs).
		a.Scalars["EV_NOTE"] = strings.Join(Capabilities, " ")
		return a
	default:
		a.Scalars["EV_ERROR"] = "unknown store command " + command
		value, _ := json.Marshal(map[string]any{"error": map[string]string{"code": "NOT_SUPPORTED", "message": a.Scalars["EV_ERROR"]}})
		a.Scalars["EV_JSON"] = string(value)
		return a
	}
	if storeState.cfg == nil {
		// named, and with the reason: an empty list would say the system
		// has no objects, which is a different and false statement
		a.Scalars["EV_ERROR"] = "no object store here: " + storeState.reason
		return a
	}

	typ := strings.ToUpper(text("IV_TYPE", ""))
	name := strings.ToUpper(text("IV_NAME", ""))
	include := text("IV_INCLUDE", "main")
	if include == "" {
		include = "main"
	}
	started := time.Now()
	ms := func() string { return strconv.FormatInt(time.Since(started).Milliseconds(), 10) }
	ix := storeBuild()
	var err error
	switch command {
	case "LIST":
		storeList(ix, &a, typ, strings.ToUpper(text("IV_FILTER", "")), text("IV_LIMIT", ""))
		return a
	case "READ":
		err = storeRead(ix, &a, typ, name, include, text("IV_REVISION", "inactive"))
	case "WRITE":
		src, ok := in["IV_SOURCE"]
		if !ok || src == nil {
			a.Scalars["EV_ERROR"] = "WRITE without IV_SOURCE: nothing was written"
			return a
		}
		err = storeWrite(ix, &a, typ, name, include, *src)
		if err == nil {
			a.Scalars["EV_MS"] = ms()
		}
	case "HISTORY", "REVISION":
		// the versions of an object are its file's commits, stored nowhere
		// (docs/backlog/adt.md); outside git "no history" and why, with no
		// count, as tools/osd-store-destination.mjs answers
		e := ix.find(typ, name)
		if e == nil && typ == "DDLS" {
			e = ix.ddlsEntity(name)
		}
		if e == nil {
			err = storeNotFound(typ, name)
			break
		}
		file := e.File
		if typ == "CLAS" && include != "main" {
			suffix, ok := storeIncludeSuffix(include)
			if !ok {
				err = storeNotFound(typ, name+" include "+include)
				break
			}
			file = strings.TrimSuffix(e.File, ".clas.abap") + suffix
		}
		if command == "HISTORY" {
			if typ == "CLAS" && include != "main" {
				if _, statErr := os.Stat(filepath.Join(storeState.root, file)); statErr != nil {
					a.Scalars["EV_NOTE"], a.Scalars["EV_COUNT"] = "the include has no file", "0"
					break
				}
			}
			limit, perr := strconv.Atoi(text("IV_LIMIT", ""))
			if perr != nil || limit <= 0 {
				limit = 50
			}
			a.Scalars["EV_FILE"] = file
			a.Scalars["EV_STATE"], a.Scalars["EV_CHANGED"] = storeHistoryState(storeState.root, file)
			revs, reason := storeHistory(storeState.root, file, limit)
			if reason != "" {
				a.Scalars["EV_NOTE"], a.Scalars["EV_COUNT"] = "no history: "+reason, ""
				break
			}
			a.Revisions = revs
			a.Scalars["EV_COUNT"] = strconv.Itoa(len(revs))
		} else {
			rev := text("IV_REVISION", "")
			src, path, rerr := storeRevisionAt(storeState.root, file, rev)
			if rerr != nil {
				err = rerr
				break
			}
			a.Scalars["EV_SOURCE"], a.Scalars["EV_FILE"] = src, path
			if len(rev) >= 12 {
				a.Scalars["EV_VERSION"] = strings.ToLower(rev[:12])
			}
		}
	case "CHECK", "ACTIVATE", "TOKENS":
		err = storeNoCompiler(ix, &a, command, typ, name)
		if err == nil {
			a.Scalars["EV_MS"] = ms()
		}
	case "OBJECT":
		var value string
		value, err = storeObject(ix, typ, name)
		if err == nil {
			a.Scalars["EV_JSON"] = value
		}
	case "PACKAGE", "PACKAGES", "SEARCH":
		var input struct {
			Name   string `json:"name"`
			Mode   string `json:"mode"`
			User   string `json:"user"`
			Format string `json:"format"`
			Seed   string `json:"seed"`
			Type   string `json:"type"`
			Limit  *int   `json:"limit"`
		}
		if err = json.Unmarshal([]byte(text("IV_JSON", "")), &input); err != nil {
			err = storeRefusal("Unexpected token in JSON: " + text("IV_JSON", ""))
			break
		}
		if command == "PACKAGE" {
			if input.Mode != "raw" && input.Mode != "local" {
				a.Scalars["EV_ERROR"] = "PACKAGE mode must be raw or local"
				a.Scalars["EV_JSON"] = storeJSONRefusal(a.Scalars["EV_ERROR"], "INVALID_NAME")
				break
			}
			var value string
			value, err = storePackageRows(ix, strings.ToUpper(input.Name), input.Mode, strings.ToUpper(input.User))
			if err == nil {
				a.Scalars["EV_JSON"] = value
			}
			break
		}
		if command == "PACKAGES" {
			if input.Format == "lines" || input.Format == "vfs-lines" {
				a.Scalars["EV_SOURCE"] = storePackagesLines(ix, input.Format)
			} else {
				a.Scalars["EV_JSON"] = storePackagesJSON(ix)
			}
			break
		}
		limit := -1
		if input.Limit != nil {
			limit = *input.Limit
		}
		rows := storeSearch(ix, input.Seed, input.Type, limit)
		if input.Format == "lines" {
			a.Scalars["EV_SOURCE"] = storeSearchLines(rows)
		} else {
			a.Scalars["EV_JSON"] = storeSearchJSON(rows)
		}
	}
	if err != nil {
		a.Scalars["EV_ERROR"] = err.Error()
		if a.Scalars["EV_JSON"] == "" {
			code := "INTERNAL"
			if strings.HasSuffix(err.Error(), " does not exist") {
				code = "NOT_FOUND"
			} else if strings.Contains(err.Error(), "comes from a library and cannot be changed here") {
				code = "READ_ONLY"
			}
			a.Scalars["EV_JSON"] = storeJSONRefusal(err.Error(), code)
		}
		a.Scalars["EV_MS"] = ms()
	}
	return a
}

func storeList(ix *storeIndex, a *Answer, typ, filter, limitText string) {
	limit, err := strconv.ParseFloat(limitText, 64)
	if err != nil || limit == 0 || limit != limit {
		limit = 200
	}
	var matching []*storeEntry
	for _, k := range ix.keys {
		e := ix.by[k]
		if filter == "" || strings.Contains(e.Name, filter) {
			matching = append(matching, e)
		}
	}
	// list() sorts first, the destination filters in that order
	sort.SliceStable(matching, func(i, j int) bool {
		return collateLess(matching[i].Type+matching[i].Name, matching[j].Type+matching[j].Name)
	})
	tally := map[string]int32{}
	var order []string
	for _, e := range matching {
		if _, ok := tally[e.Type]; !ok {
			order = append(order, e.Type)
		}
		tally[e.Type]++
	}
	var all []*storeEntry
	for _, e := range matching {
		if typ == "" || e.Type == typ {
			all = append(all, e)
		}
	}
	a.Scalars["EV_COUNT"] = strconv.Itoa(len(all))
	n := len(all)
	if limit >= 0 && float64(n) > limit {
		n = int(limit)
	} else if limit < 0 {
		// slice(0, negative) drops from the end, as JavaScript does
		n = max(0, n+int(limit))
	}
	for _, e := range all[:n] {
		a.Objects = append(a.Objects, storeRowOf(e, e.File))
	}
	sort.SliceStable(order, func(i, j int) bool {
		if tally[order[i]] != tally[order[j]] {
			return tally[order[i]] > tally[order[j]]
		}
		return collateLess(order[i], order[j])
	})
	for _, t := range order {
		a.Types = append(a.Types, Tally{TYPE: t, COUNT: tally[t]})
	}
}

func storeRead(ix *storeIndex, a *Answer, typ, name, include, version string) error {
	e := ix.find(typ, name)
	if e == nil && typ == "DDLS" {
		e = ix.ddlsEntity(name)
	}
	if e == nil {
		return storeNotFound(typ, name)
	}
	file, source := e.File, ""
	classInclude := typ == "CLAS" && include != "main"
	includePresent := true
	if typ == "CLAS" && include != "main" {
		suffix, ok := storeIncludeSuffix(include)
		if !ok {
			return storeNotFound(typ, name+" include "+include)
		}
		f := strings.TrimSuffix(e.File, ".clas.abap") + suffix
		file = f
		if _, statErr := os.Stat(filepath.Join(storeState.root, f)); statErr == nil {
			b, err := os.ReadFile(filepath.Join(storeState.root, f))
			if err != nil {
				return storeRefusal(err.Error())
			}
			source = string(b)
		} else {
			includePresent = false
		}
	} else {
		b, err := os.ReadFile(filepath.Join(storeState.root, e.File))
		if err != nil {
			if !os.IsNotExist(err) {
				return storeRefusal(err.Error())
			}
			return storeRefusal(fmt.Sprintf("ENOENT: no such file or directory, open '%s'", filepath.Join(storeState.root, e.File)))
		}
		source = string(b)
	}
	if version == "active" {
		b, proven := storeActiveBytes(file)
		if proven {
			source = string(b)
		} else {
			digest, built := storeState.cfg.Built[file]
			proven = built && len(digest) == 64 && digest == storeDigest(file)
			if !proven {
				if !classInclude {
					return storeNotFound(typ, name+" active version ("+include+")")
				}
				source = ""
			}
		}
		includePresent = proven
	}
	row := storeRowOf(e, file)
	empty := classInclude && !includePresent
	etag := sha256.Sum256([]byte(source))
	if version == "active" {
		active := sha256.Sum256([]byte("active\x00" + source))
		etag = active
	}
	value, _ := json.Marshal(struct {
		Name      string `json:"name"`
		ChangedBy string `json:"changedBy,omitempty"`
		Empty     bool   `json:"empty"`
		ETag      string `json:"etag"`
	}{e.Name, e.ChangedBy, empty, hex.EncodeToString(etag[:])[:32]})
	a.Scalars["EV_SOURCE"] = source
	a.Scalars["EV_FILE"] = file
	a.Scalars["EV_PACKAGE"] = e.Package
	a.Scalars["EV_WRITABLE"] = row.WRITABLE
	a.Scalars["EV_VERSION"] = row.VERSION
	a.Scalars["EV_JSON"] = string(value)
	a.Objects = append(a.Objects, row)
	return nil
}

// the path a write may touch: inside the tree and inside a writable root,
// whatever a name holds (fileOf turns every / into #, so a name has no way
// out of its folder; this says so rather than relying on it)
func storeConfined(file string) bool {
	clean := filepath.ToSlash(filepath.Clean(file))
	if filepath.IsAbs(file) || clean == ".." || strings.HasPrefix(clean, "../") {
		return false
	}
	for _, r := range storeState.cfg.Roots {
		if r.Writable && strings.HasPrefix(clean, strings.TrimSuffix(r.Path, "/")+"/") {
			return true
		}
	}
	return false
}

func storeWrite(ix *storeIndex, a *Answer, typ, name, include, source string) error {
	ext, ok := storeTypeExt(typ)
	if !ok {
		return storeRefusal("object type " + typ + " is not supported")
	}
	e := ix.find(typ, name)
	if e != nil && !e.Writable && e.Overlay == "" {
		return storeRefusal(e.Type + " " + e.Name + " comes from a library and cannot be changed here")
	}
	if e == nil {
		var root *Root
		for i := range storeState.cfg.Roots {
			if storeState.cfg.Roots[i].Writable {
				root = &storeState.cfg.Roots[i]
				break
			}
		}
		if root == nil {
			return storeRefusal("object type " + typ + " is not supported")
		}
		file := root.Path + "/osd/" + storeFileOf(name) + ext
		chain := storePackagesOf(file, *root)
		e = &storeEntry{Type: typ, Name: strings.ToUpper(name), File: file, Root: root.Path, Writable: true,
			Imported: root.Imported, Package: chain[len(chain)-1], Packages: chain}
	}
	file := e.File
	if typ == "CLAS" && include != "main" {
		suffix, ok := storeIncludeSuffix(include)
		if !ok {
			return storeRefusal("class include " + include + " is not supported")
		}
		file = strings.TrimSuffix(e.File, ".clas.abap") + suffix
	}
	if !storeConfined(file) {
		return storeRefusal(e.Type + " " + e.Name + ": " + file + " is outside the writable roots of this tree")
	}
	full := filepath.Join(storeState.root, file)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return storeRefusal(err.Error())
	}
	// one line ending, the repository's (osd-store.mjs write)
	text := strings.ReplaceAll(strings.ReplaceAll(source, "\r\n", "\n"), "\r", "\n")
	if err := os.WriteFile(full, []byte(text), 0o644); err != nil {
		return storeRefusal(err.Error())
	}
	storeState.written[e.Type+" "+e.Name] = true
	version, _ := storeStateOf(e, file)
	a.Scalars["EV_FILE"] = file
	a.Scalars["EV_PACKAGE"] = e.Package
	a.Scalars["EV_VERSION"] = version
	a.Scalars["EV_WRITABLE"] = "X"
	return nil
}

// CHECK, ACTIVATE and TOKENS: the compiler's work, and this binary has none
func storeNoCompiler(ix *storeIndex, a *Answer, command, typ, name string) error {
	e := ix.find(typ, name)
	if e == nil {
		return storeNotFound(typ, name)
	}
	var why, rule string
	switch command {
	case "ACTIVATE":
		rule = "rebuild"
		why = "activation needs a new generation (rebuild): this binary is a built generation and carries no abaplint and no transpiler, " +
			"so " + e.Type + " " + e.Name + " stays as it is in " + e.File + " and is active once the binary is built again from this tree"
	case "CHECK":
		rule = "no_compiler"
		why = "check needs the compiler (abaplint over the whole system), and this binary carries none: nothing was checked. " +
			"Check on the Node host, or build the binary again from this tree"
	default:
		rule = "no_compiler"
		why = "tokens need the parser (abaplint), and this binary carries none"
	}
	a.Scalars["EV_ERROR"] = why
	a.Scalars["EV_ACTIVE"] = ""
	if command == "TOKENS" {
		return nil
	}
	// an issue that stands, as well as the error: a screen that reads only
	// the issue table must not call this a clean check or an activation
	a.Issues = append(a.Issues, Issue{OBJ_TYPE: e.Type, OBJ_NAME: e.Name, LINE: 0, COL: 0, RULE: rule, MESSAGE: why})
	a.Scalars["EV_COUNT"] = "1"
	return nil
}

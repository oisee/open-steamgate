package abap

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

// The object store, for the Go host: CALL FUNCTION 'ZOSD_STORE' DESTINATION
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
// collation, collateLess below) and not byte order.

// StoreRoot is one root of the index: a folder walked, or a library's file
// list as the build reads it.
type StoreRoot struct {
	Path     string   `json:"path"`
	Writable bool     `json:"writable"`
	Library  bool     `json:"library"`
	Imported bool     `json:"imported"`
	Package  string   `json:"package"`
	Files    []string `json:"files"`
}

// StoreConfig is what the build says about the tree (tools/gogen/store.mjs).
type StoreConfig struct {
	Roots    []StoreRoot       `json:"roots"`
	Libs     []StoreRoot       `json:"libs"`
	Excluded []string          `json:"excluded"`
	Built    map[string]string `json:"built"`
}

type storeEntry struct {
	Type, Name, File, Root string
	Writable, Library      bool
	Imported               bool
	Package                string
	Packages               []string
}

var storeState struct {
	mu       sync.Mutex
	root     string
	cfg      *StoreConfig
	excluded []*regexp.Regexp
	written  map[string]bool
	reason   string
}

// SetStore points the host at a tree and the build's facts about it. An
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
	var cfg StoreConfig
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

// the object types, in the order the Node store tries them (osd-store.mjs TYPES)
var storeTypes = []struct {
	Type, Ext  string
	SameFileAs string
}{
	{"CLAS", ".clas.abap", ""}, {"INTF", ".intf.abap", ""}, {"PROG", ".prog.abap", ""},
	{"FUGR", ".fugr.xml", ""}, {"TABL", ".tabl.xml", ""}, {"DTEL", ".dtel.xml", ""},
	{"DOMA", ".doma.xml", ""}, {"TTYP", ".ttyp.xml", ""}, {"DDLS", ".ddls.asddls", ""},
	{"SRVD", ".srvd.srvdsrv", ""}, {"VIEW", ".view.xml", ""}, {"SHLP", ".shlp.xml", ""},
	{"MSAG", ".msag.xml", ""}, {"DEVC", ".devc.xml", ""}, {"INCL", ".prog.abap", "PROG"},
}

func storeTypeExt(t string) (string, bool) {
	for _, x := range storeTypes {
		if x.Type == t {
			return x.Ext, true
		}
	}
	return "", false
}

// a class's parts, by the suffix abapGit gives them (osd-store.mjs INCLUDES)
var storeIncludes = []struct{ Name, Suffix string }{
	{"main", ".clas.abap"}, {"definitions", ".clas.locals_def.abap"}, {"implementations", ".clas.locals_imp.abap"},
	{"macros", ".clas.macros.abap"}, {"testclasses", ".clas.testclasses.abap"},
}

func storeIncludeSuffix(include string) (string, bool) {
	for _, x := range storeIncludes {
		if x.Name == include {
			return x.Suffix, true
		}
	}
	return "", false
}

// the packages of the tree's own layout (osd-store.mjs ROOT_PACKAGES,
// FOLDER_PACKAGES); a pack names its own and a library's comes from its path
var storeRootPackages = map[string]string{"src": "$STG", "local": "$OSD", "test": "$STG_TEST", "gen": "$STG_GEN"}
var storeFolderPackages = []struct{ Folder, Package string }{{"src/zosd_test", "$ZOSD_TEST"}}

var storeNotWord = regexp.MustCompile(`[^A-Z0-9]+`)

func storePackageWord(s string) string { return storeNotWord.ReplaceAllString(strings.ToUpper(s), "_") }

func storeFileOf(name string) string {
	return strings.ReplaceAll(strings.ToLower(name), "/", "#")
}

func storeNameOf(file string) string {
	return strings.ReplaceAll(strings.ToUpper(file), "#", "/")
}

// the chain of packages a file sits in (osd-store.mjs #packagesOf)
func storePackagesOf(file string, root StoreRoot) []string {
	own := ""
	for _, f := range storeFolderPackages {
		if strings.HasPrefix(file, f.Folder+"/") {
			own = f.Folder
			break
		}
	}
	var bases []string
	switch {
	case own != "":
		for _, f := range storeFolderPackages {
			if f.Folder == own {
				bases = []string{f.Package}
			}
		}
	case root.Package != "":
		bases = []string{root.Package}
	case storeRootPackages[root.Path] != "":
		bases = []string{storeRootPackages[root.Path]}
	case strings.HasPrefix(root.Path, "local/"):
		bases = []string{storeRootPackages["local"], storeRootPackages["local"] + "_" + storePackageWord(root.Path[len("local/"):])}
	default:
		last := root.Path
		for _, p := range strings.Split(root.Path, "/") {
			if p != "src" && p != "." && p != ".local" && p != "lars" {
				last = p
			}
		}
		bases = []string{"$" + storePackageWord(last)}
	}
	from := root.Path
	if own != "" {
		from = own
	}
	var inside []string
	for _, p := range strings.Split(file[min(len(from), len(file)):], "/") {
		if p != "" {
			inside = append(inside, p)
		}
	}
	if len(inside) > 0 {
		inside = inside[:len(inside)-1]
	}
	chain := append([]string{}, bases...)
	for _, folder := range inside {
		chain = append(chain, chain[len(chain)-1]+"_"+storeNotWord.ReplaceAllString(strings.ToUpper(folder), "_"))
	}
	return chain
}

// the files under one root, sorted, the build's exclusions left out
// (osd-store.mjs #walk)
func storeWalk(base, dir string, out []string) []string {
	entries, err := os.ReadDir(filepath.Join(base, dir))
	if err != nil {
		return out
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	for _, name := range names {
		if name == "node_modules" || name == ".git" {
			continue
		}
		rel := filepath.ToSlash(filepath.Join(dir, name))
		st, err := os.Stat(filepath.Join(base, rel))
		if err != nil {
			continue
		}
		if st.IsDir() {
			out = storeWalk(base, rel, out)
			continue
		}
		skip := false
		for _, re := range storeState.excluded {
			if re.MatchString("/" + rel) {
				skip = true
				break
			}
		}
		if !skip {
			out = append(out, rel)
		}
	}
	return out
}

type storeIndex struct {
	keys []string
	by   map[string]*storeEntry
}

func (ix *storeIndex) set(key string, e *storeEntry) {
	if _, ok := ix.by[key]; !ok {
		ix.keys = append(ix.keys, key)
	}
	ix.by[key] = e
}

// every object of every root, by type and name (osd-store.mjs build). Built
// again for every call: the walk is milliseconds, and a file an editor or a
// git pull changed is then never answered from a stale index.
func storeBuild() *storeIndex {
	ix := &storeIndex{by: map[string]*storeEntry{}}
	cfg := storeState.cfg
	roots := append(append([]StoreRoot{}, cfg.Roots...), cfg.Libs...)
	for _, root := range roots {
		files := root.Files
		if !root.Library {
			files = storeWalk(storeState.root, root.Path, nil)
		}
		for _, file := range files {
			name := file[strings.LastIndex(file, "/")+1:]
			for _, t := range storeTypes {
				if !strings.HasSuffix(name, t.Ext) || t.SameFileAs != "" {
					continue
				}
				if root.Library {
					// a library file the build listed and this tree does not
					// have (a copied tree without the clones) is no object
					if _, err := os.Stat(filepath.Join(storeState.root, file)); err != nil {
						break
					}
				}
				chain := storePackagesOf(file, root)
				objectName := storeNameOf(name[:len(name)-len(t.Ext)])
				if t.Type == "DEVC" && name == "package.devc.xml" {
					objectName = chain[len(chain)-1]
				}
				key := t.Type + " " + objectName
				if _, has := ix.by[key]; !root.Library || !has {
					own := t.Type == "DEVC" && objectName == chain[len(chain)-1]
					home := chain
					if own && len(chain) > 1 {
						home = chain[:len(chain)-1]
					}
					ix.set(key, &storeEntry{Type: t.Type, Name: objectName, File: file, Root: root.Path,
						Writable: root.Writable, Library: root.Library, Imported: root.Imported,
						Package: home[len(home)-1], Packages: home})
				}
				break
			}
		}
	}
	return ix
}

func (ix *storeIndex) find(typ, name string) *storeEntry {
	key := strings.ToUpper(name)
	if e, ok := ix.by[typ+" "+key]; ok {
		return e
	}
	if typ == "INCL" {
		if p, ok := ix.by["PROG "+key]; ok {
			c := *p
			c.Type = "INCL"
			return &c
		}
		return nil
	}
	if typ == "STRU" {
		t, ok := ix.by["TABL "+key]
		if !ok {
			return nil
		}
		b, err := os.ReadFile(filepath.Join(storeState.root, t.File))
		if err != nil || !strings.Contains(string(b), "<TABCLASS>INTTAB</TABCLASS>") {
			return nil
		}
		c := *t
		c.Type = "STRU"
		return &c
	}
	return nil
}

// the name after `define ... view|entity|table function`, comments skipped
// (tools/ddls-entity.mjs)
var storeDefines = regexp.MustCompile(`(?i)\bdefine\s+(?:root\s+)?(?:table\s+function|table\s+entity|hierarchy|transient\s+view\s+entity|view\s+entity|view|abstract\s+entity|custom\s+entity)\s+([\w/]+)`)

func storeStripComments(text string) string {
	var out strings.Builder
	for i := 0; i < len(text); {
		ch := text[i]
		switch {
		case ch == '\'':
			end := strings.IndexByte(text[i+1:], '\'')
			stop := len(text)
			if end >= 0 {
				stop = i + 1 + end + 1
			}
			out.WriteString(text[i:stop])
			i = stop
		case ch == '/' && i+1 < len(text) && text[i+1] == '*':
			end := strings.Index(text[i+2:], "*/")
			if end < 0 {
				i = len(text)
			} else {
				i = i + 2 + end + 2
			}
			out.WriteByte(' ')
		case (ch == '/' && i+1 < len(text) && text[i+1] == '/') || (ch == '-' && i+1 < len(text) && text[i+1] == '-'):
			end := strings.IndexByte(text[i:], '\n')
			if end < 0 {
				i = len(text)
			} else {
				i += end
			}
			out.WriteByte(' ')
		default:
			out.WriteByte(ch)
			i++
		}
	}
	return out.String()
}

// a DDLS by the entity it defines, when that is not its object name; two
// sources defining one entity are neither taken (osd-store.mjs #ddlsEntities)
func (ix *storeIndex) ddlsEntity(name string) *storeEntry {
	by := map[string]*storeEntry{}
	twice := map[string]bool{}
	for _, k := range ix.keys {
		e := ix.by[k]
		if e.Type != "DDLS" {
			continue
		}
		b, err := os.ReadFile(filepath.Join(storeState.root, e.File))
		if err != nil {
			continue
		}
		m := storeDefines.FindStringSubmatch(storeStripComments(string(b)))
		if m == nil || strings.ToUpper(m[1]) == strings.ToUpper(e.Name) {
			continue
		}
		entity := strings.ToUpper(m[1])
		if _, ok := by[entity]; ok {
			twice[entity] = true
		}
		by[entity] = e
	}
	if twice[strings.ToUpper(name)] {
		return nil
	}
	return by[strings.ToUpper(name)]
}

// the files of an object whose digest decides its version
func storeFilesOf(e *storeEntry) []string {
	if e.Type != "CLAS" {
		return []string{e.File}
	}
	var out []string
	for _, inc := range storeIncludes {
		out = append(out, strings.TrimSuffix(e.File, ".clas.abap")+inc.Suffix)
	}
	return out
}

func storeDigest(file string) string {
	b, err := os.ReadFile(filepath.Join(storeState.root, file))
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// active or inactive, and the file's time (osd-store.mjs stateOf)
func storeStateOf(e *storeEntry, file string) (version, changedAt string) {
	if st, err := os.Stat(filepath.Join(storeState.root, file)); err == nil {
		changedAt = st.ModTime().UTC().Format("2006-01-02T15:04:05Z")
	}
	version = "active"
	if storeState.written[e.Type+" "+e.Name] {
		version = "inactive"
	} else if e.Writable && !e.Library && storeState.cfg.Built != nil {
		for _, f := range storeFilesOf(e) {
			if storeDigest(f) != storeState.cfg.Built[f] {
				version = "inactive"
				break
			}
		}
	}
	return
}

// collateLess is JavaScript's a.localeCompare(b) < 0 for object names: ICU's
// root collation, where punctuation sorts before symbols, symbols before
// digits, digits before letters, and case only breaks a tie (a before A)
func collateLess(a, b string) bool { return collate(a, b) < 0 }

const collatePunct = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~"

func collateWeight(r rune) (int, int) {
	switch {
	case r == ' ':
		return 1, 0
	case strings.ContainsRune(collatePunct, r):
		return 10 + strings.IndexRune(collatePunct, r), 0
	case r == '$':
		return 100, 0
	case r >= '0' && r <= '9':
		return 200 + int(r-'0'), 0
	case r >= 'a' && r <= 'z':
		return 300 + int(r-'a'), 0
	case r >= 'A' && r <= 'Z':
		return 300 + int(r-'A'), 1
	}
	return 1000 + int(r), 0
}

func collate(a, b string) int {
	ra, rb := []rune(a), []rune(b)
	tie := 0
	for i := 0; i < len(ra) && i < len(rb); i++ {
		pa, ta := collateWeight(ra[i])
		pb, tb := collateWeight(rb[i])
		if pa != pb {
			if pa < pb {
				return -1
			}
			return 1
		}
		if tie == 0 && ta != tb {
			if ta < tb {
				tie = -1
			} else {
				tie = 1
			}
		}
	}
	if len(ra) != len(rb) {
		if len(ra) < len(rb) {
			return -1
		}
		return 1
	}
	return tie
}

// StoreRow is one object as the screen lists it (ZOSD_OBJECT_S).
type StoreRow struct {
	TYPE, NAME, PACKAGE, FILE, WRITABLE, VERSION, CHANGED_AT string
}

// StoreIssue is one issue (ZOSD_ISSUE_S).
type StoreIssue struct {
	OBJ_TYPE, OBJ_NAME string
	LINE, COL          int32
	RULE, MESSAGE      string
}

// StoreTally is one type and how many of it matched (ZOSD_TYPE_S).
type StoreTally struct {
	TYPE  string
	COUNT int32
}

// StoreAnswer is every exporting parameter and table of ZOSD_STORE.
type StoreAnswer struct {
	Scalars map[string]string
	Objects []StoreRow
	Issues  []StoreIssue
	Types   []StoreTally
}

func storeEmpty() StoreAnswer {
	a := StoreAnswer{Scalars: map[string]string{}, Objects: []StoreRow{}, Issues: []StoreIssue{}, Types: []StoreTally{}}
	for _, k := range []string{"EV_LIVE", "EV_NOTE", "EV_SOURCE", "EV_FILE", "EV_PACKAGE", "EV_VERSION", "EV_WRITABLE", "EV_ACTIVE", "EV_ERROR"} {
		a.Scalars[k] = ""
	}
	a.Scalars["EV_COUNT"], a.Scalars["EV_MS"] = "0", "0"
	return a
}

func storeRowOf(e *storeEntry, file string) StoreRow {
	version, changed := storeStateOf(e, file)
	w := "X"
	if !e.Writable {
		w = ""
	}
	return StoreRow{TYPE: e.Type, NAME: e.Name, PACKAGE: e.Package, FILE: file, WRITABLE: w, VERSION: version, CHANGED_AT: changed}
}

type storeRefusal string

func (r storeRefusal) Error() string { return string(r) }

func storeNotFound(typ, name string) error { return storeRefusal(typ + " " + name + " does not exist") }

// StoreCall answers one call of ZOSD_STORE. in holds the importing values
// that were passed (IV_*), present or absent the way the caller passed them.
func StoreCall(in map[string]*string) StoreAnswer {
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
	if storeState.cfg == nil {
		// named, and with the reason: an empty list would say the system
		// has no objects, which is a different and false statement
		a.Scalars["EV_ERROR"] = "no object store here: " + storeState.reason
		return a
	}
	switch command {
	case "LIST", "READ", "WRITE", "CHECK", "ACTIVATE", "TOKENS":
	default:
		a.Scalars["EV_ERROR"] = "unknown store command " + command
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
		err = storeRead(ix, &a, typ, name, include)
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
	case "CHECK", "ACTIVATE", "TOKENS":
		err = storeNoCompiler(ix, &a, command, typ, name)
		if err == nil {
			a.Scalars["EV_MS"] = ms()
		}
	}
	if err != nil {
		a.Scalars["EV_ERROR"] = err.Error()
		a.Scalars["EV_MS"] = ms()
	}
	return a
}

func storeList(ix *storeIndex, a *StoreAnswer, typ, filter, limitText string) {
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
		a.Types = append(a.Types, StoreTally{TYPE: t, COUNT: tally[t]})
	}
}

func storeRead(ix *storeIndex, a *StoreAnswer, typ, name, include string) error {
	e := ix.find(typ, name)
	if e == nil && typ == "DDLS" {
		e = ix.ddlsEntity(name)
	}
	if e == nil {
		return storeNotFound(typ, name)
	}
	file, source := e.File, ""
	if typ == "CLAS" && include != "main" {
		suffix, ok := storeIncludeSuffix(include)
		if !ok {
			return storeNotFound(typ, name+" include "+include)
		}
		f := strings.TrimSuffix(e.File, ".clas.abap") + suffix
		if b, err := os.ReadFile(filepath.Join(storeState.root, f)); err == nil {
			file, source = f, string(b)
		}
	} else {
		b, err := os.ReadFile(filepath.Join(storeState.root, e.File))
		if err != nil {
			return storeRefusal(fmt.Sprintf("ENOENT: no such file or directory, open '%s'", filepath.Join(storeState.root, e.File)))
		}
		source = string(b)
	}
	row := storeRowOf(e, file)
	a.Scalars["EV_SOURCE"] = source
	a.Scalars["EV_FILE"] = file
	a.Scalars["EV_PACKAGE"] = e.Package
	a.Scalars["EV_WRITABLE"] = row.WRITABLE
	a.Scalars["EV_VERSION"] = row.VERSION
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

func storeWrite(ix *storeIndex, a *StoreAnswer, typ, name, include, source string) error {
	ext, ok := storeTypeExt(typ)
	if !ok {
		return storeRefusal("object type " + typ + " is not supported")
	}
	e := ix.find(typ, name)
	if e != nil && !e.Writable {
		return storeRefusal(e.Type + " " + e.Name + " comes from a library and cannot be changed here")
	}
	if e == nil {
		var root *StoreRoot
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
func storeNoCompiler(ix *storeIndex, a *StoreAnswer, command, typ, name string) error {
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
	a.Issues = append(a.Issues, StoreIssue{OBJ_TYPE: e.Type, OBJ_NAME: e.Name, LINE: 0, COL: 0, RULE: rule, MESSAGE: why})
	a.Scalars["EV_COUNT"] = "1"
	return nil
}

// ZOSD_STORE, called with DESTINATION 'STORE' (frontend callFunction): the
// caller's values in, every exporting parameter and table it passed filled
func ZOSD_STORE(s *Session, args map[string]Data) {
	in := map[string]*string{}
	for _, k := range []string{"IV_COMMAND", "IV_TYPE", "IV_NAME", "IV_INCLUDE", "IV_SOURCE", "IV_FILTER", "IV_LIMIT"} {
		if d, ok := fmArg(args, k); ok {
			v := DataString(d)
			in[k] = &v
		}
	}
	a := StoreCall(in)
	for k, v := range a.Scalars {
		if d, ok := fmArg(args, k); ok {
			v := v
			MoveData(d, Data{P: &v, T: TString})
		}
	}
	fillRows := func(param string, n int, row func(i int, set func(field string, v any))) {
		tab, ok := fmArg(args, param)
		if !ok {
			return
		}
		if tab.T.Kind != 'h' || tab.T.Append == nil {
			panic(NotCompiled("ZOSD_STORE", param+" is not a standard table"))
		}
		tab.T.Zero(tab.P)
		for i := 0; i < n; i++ {
			line := Data{P: tab.T.Append(tab.P), T: tab.T.Row}
			row(i, func(field string, v any) {
				c, ok := Component(line, field)
				if !ok {
					// a field the caller's structure does not have is not
					// assigned, as the Node destination's fill does it
					return
				}
				switch x := v.(type) {
				case string:
					MoveData(c, Data{P: &x, T: TString})
				case int32:
					MoveData(c, Data{P: &x, T: TI})
				}
			})
		}
	}
	fillRows("ET_OBJECT", len(a.Objects), func(i int, set func(string, any)) {
		r := a.Objects[i]
		set("TYPE", r.TYPE)
		set("NAME", r.NAME)
		set("PACKAGE", r.PACKAGE)
		set("FILE", r.FILE)
		set("WRITABLE", r.WRITABLE)
		set("VERSION", r.VERSION)
		set("CHANGED_AT", r.CHANGED_AT)
	})
	fillRows("ET_ISSUE", len(a.Issues), func(i int, set func(string, any)) {
		r := a.Issues[i]
		set("OBJ_TYPE", r.OBJ_TYPE)
		set("OBJ_NAME", r.OBJ_NAME)
		set("LINE", r.LINE)
		set("COL", r.COL)
		set("RULE", r.RULE)
		set("MESSAGE", r.MESSAGE)
	})
	fillRows("ET_TYPE", len(a.Types), func(i int, set func(string, any)) {
		set("TYPE", a.Types[i].TYPE)
		set("COUNT", a.Types[i].COUNT)
	})
	fillRows("ET_TOKEN", 0, nil)
}

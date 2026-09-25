// splitproto: a measurement prototype, not the emitter. It splits OSGo's one
// generated main package (go/cmd/osgo) into three packages, so a change to a
// Z class recompiles only the Z package:
//
//	<out>/std  everything that does not reach a Z/Y name (open-abap-core, the libs, the kernel)
//	<out>/z    the tree's objects (Z/Y by name when no owner is known), and every non-Z declaration that references one
//	<out>      main: main.go, status.go, zz_boot.go, zz_status.go and the JSON beside them
//
// What a real split in emit-go.mjs would have to do, done here after the fact
// with go/types: every unexported package-level name, struct field and method
// of the generated code is renamed to an exported one (prefix X), since the
// packages now see each other only through exported names, and std / z are
// dot-imported so no reference needs a qualifier. The declarations that are
// not Z by name but reference Z (the closure) are counted and listed: they are
// what cannot stay in std.
//
// -leaf ZCL_X puts one object nothing references into a package of its own
// (z/leaf); -scc replaces z with one package per strongly connected component
// of the z side (zc/cNNNN, listed in zc/components.txt). The measurement and
// what it found: README.md, "Incremental rebuild: the go build floor".
//
//	node objects.mjs > objects.json
//	go run . -go ../go -pkg ./cmd/osgo -out ../go/cmd/osgosplit -objects objects.json
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"golang.org/x/tools/go/packages"
)

var prefix = regexp.MustCompile(`^(New_|Alloc_|I_|As_|Ptr_|Ensure_|EV_|td_|tn_)`)
var zName = regexp.MustCompile(`^(New_|Alloc_|I_|As_|Ptr_|Ensure_|EV_|td_|tn_)?[ZY]`)

type unit struct {
	key   string
	decls []ast.Node // top-level decls or specs, in file order
	file  *ast.File
	refs  map[string]bool
	z     bool
	why   string
	owner string // the ABAP object, "" when none
	size  int
}

func main() {
	goDir := flag.String("go", "", "the go module directory")
	pkgPath := flag.String("pkg", "./cmd/osgo", "the generated main package")
	out := flag.String("out", "", "output directory for the split main package")
	modPath := flag.String("modpath", "osg/gogen/cmd/osgosplit", "import path of -out")
	sccMode := flag.Bool("scc", false, "one package per strongly connected component of the z side (zc/cNNNN), instead of one z package")
	leaf := flag.String("leaf", "", "an object whose units go into a package of their own (z/leaf), when no other unit references them")
	objects := flag.String("objects", "", "JSON {lib: [...], tree: [...]}: the ABAP objects by origin, Go-spelled (/ as _)")
	flag.Parse()
	cfg := &packages.Config{Mode: packages.NeedName | packages.NeedFiles | packages.NeedCompiledGoFiles | packages.NeedSyntax | packages.NeedTypes | packages.NeedTypesInfo | packages.NeedImports | packages.NeedDeps, Dir: *goDir, Tests: false}
	pkgs, err := packages.Load(cfg, *pkgPath)
	if err != nil || len(pkgs) != 1 {
		panic(fmt.Sprint(err, len(pkgs)))
	}
	p := pkgs[0]
	if len(p.Errors) > 0 {
		panic(fmt.Sprint(p.Errors[:min(5, len(p.Errors))]))
	}
	fset := p.Fset
	info := p.TypesInfo
	var gen *ast.File
	src := map[*ast.File][]byte{}
	for i, f := range p.Syntax {
		b, _ := os.ReadFile(p.CompiledGoFiles[i])
		src[f] = b
		if filepath.Base(p.CompiledGoFiles[i]) == "zz_generated.go" {
			gen = f
		}
	}
	genTok := fset.File(gen.Pos())
	inGen := func(pos token.Pos) bool { return pos.IsValid() && fset.File(pos) == genTok }

	// 1. rename: every object defined in zz_generated.go that is not exported
	// and lives at package level, or is a field or a method
	rename := map[types.Object]string{}
	taken := map[string]bool{}
	for _, o := range info.Defs {
		if o != nil {
			taken[o.Name()] = true
		}
	}
	scope := p.Types.Scope()
	for id, o := range info.Defs {
		if o == nil || id.Name == "_" || id.Name == "init" || o.Exported() || !inGen(o.Pos()) {
			continue
		}
		pkgLevel := o.Parent() == scope
		field := false
		if v, ok := o.(*types.Var); ok && v.IsField() {
			field = true
		}
		method := false
		if f, ok := o.(*types.Func); ok && f.Type().(*types.Signature).Recv() != nil {
			method = true
		}
		if !pkgLevel && !field && !method {
			continue
		}
		n := "X" + o.Name()
		for taken[n] {
			n = "X" + n
		}
		rename[o] = n
	}
	// interface methods of generated interfaces that are unexported: covered by Defs (method *types.Func)
	type edit struct {
		off, end int
		text     string
	}
	edits := map[*ast.File][]edit{}
	fileOf := map[*token.File]*ast.File{}
	for _, f := range p.Syntax {
		fileOf[fset.File(f.Pos())] = f
	}
	add := func(id *ast.Ident, o types.Object) {
		n, ok := rename[o]
		if !ok {
			return
		}
		tf := fset.File(id.Pos())
		f := fileOf[tf]
		off := tf.Offset(id.Pos())
		edits[f] = append(edits[f], edit{off, off + len(id.Name), n})
	}
	for id, o := range info.Defs {
		if o != nil {
			add(id, o)
		}
	}
	for id, o := range info.Uses {
		add(id, o)
	}

	// 2. units: group the generated file's top-level declarations
	units := map[string]*unit{}
	var order []*unit
	unitOfObj := map[types.Object]*unit{}
	get := func(key string) *unit {
		if u, ok := units[key]; ok {
			return u
		}
		u := &unit{key: key, refs: map[string]bool{}}
		units[key] = u
		order = append(order, u)
		return u
	}
	initN := 0
	for _, d := range gen.Decls {
		switch d := d.(type) {
		case *ast.FuncDecl:
			var u *unit
			if d.Recv != nil {
				t := d.Recv.List[0].Type
				if s, ok := t.(*ast.StarExpr); ok {
					t = s.X
				}
				u = get("type " + t.(*ast.Ident).Name)
			} else if d.Name.Name == "init" {
				initN++
				u = get(fmt.Sprintf("init#%d", initN))
			} else {
				u = get("func " + d.Name.Name)
				unitOfObj[info.Defs[d.Name]] = u
			}
			u.decls = append(u.decls, d)
		case *ast.GenDecl:
			if d.Tok == token.IMPORT {
				continue
			}
			for _, s := range d.Specs {
				switch s := s.(type) {
				case *ast.TypeSpec:
					u := get("type " + s.Name.Name)
					unitOfObj[info.Defs[s.Name]] = u
					u.decls = append(u.decls, &ast.GenDecl{Tok: d.Tok, Specs: []ast.Spec{s}, TokPos: d.TokPos})
				case *ast.ValueSpec:
					key := d.Tok.String() + " " + s.Names[0].Name
					if s.Names[0].Name == "_" {
						key = fmt.Sprintf("%s _#%d", d.Tok, len(order))
					}
					u := get(key)
					for _, n := range s.Names {
						if o := info.Defs[n]; o != nil {
							unitOfObj[o] = u
						}
					}
					u.decls = append(u.decls, &ast.GenDecl{Tok: d.Tok, Specs: []ast.Spec{s}, TokPos: d.TokPos, Lparen: d.Lparen, Rparen: d.Rparen})
				}
			}
		}
	}
	// the owner of a declaration: its //line file for a function, else the
	// longest object name its Go name starts with
	var objs struct{ Lib, Tree []string }
	if *objects != "" {
		b, err := os.ReadFile(*objects)
		if err != nil {
			panic(err)
		}
		if err := json.Unmarshal(b, &objs); err != nil {
			panic(err)
		}
	}
	originOf := map[string]string{}
	for _, n := range objs.Lib {
		originOf[n] = "lib"
	}
	for _, n := range objs.Tree {
		originOf[n] = "tree"
	}
	lineFile := regexp.MustCompile(`^//line ([a-z0-9_#]+)\.(clas|intf|fugr)`)
	origin := func(name string, u *unit) string {
		for _, d := range u.decls {
			if f, ok := d.(*ast.FuncDecl); ok && f.Doc != nil {
				for _, c := range f.Doc.List {
					if m := lineFile.FindStringSubmatch(c.Text); m != nil {
						n := strings.ToUpper(strings.ReplaceAll(m[1], "#", "_"))
						if m[2] == "fugr" {
							n = "FUGR_" + strings.SplitN(n, ".", 2)[0]
						}
						if o, ok := originOf[n]; ok {
							u.owner = n
							return o
						}
					}
				}
			}
		}
		n := prefix.ReplaceAllString(name, "")
		best, bo := "", ""
		for obj, o := range originOf {
			if len(obj) > len(best) && (n == obj || strings.HasPrefix(n, obj+"_")) {
				best, bo = obj, o
			}
		}
		u.owner = best
		return bo
	}
	// references between units
	for _, u := range order {
		for _, d := range u.decls {
			ast.Inspect(d, func(n ast.Node) bool {
				if id, ok := n.(*ast.Ident); ok {
					if o := info.Uses[id]; o != nil && o.Parent() == scope {
						if v := unitOfObj[o]; v != nil && v != u {
							u.refs[v.key] = true
						}
					}
				}
				return true
			})
		}
		name := u.key[strings.Index(u.key, " ")+1:]
		switch origin(name, u) {
		case "tree":
			u.z, u.why = true, "Z/Y name"
		case "lib":
		default:
			if zName.MatchString(name) {
				u.z, u.why = true, "Z/Y name"
			}
		}
	}
	// 3. closure: a unit that references a Z unit is Z
	for changed := true; changed; {
		changed = false
		for _, u := range order {
			if u.z {
				continue
			}
			for r := range u.refs {
				if units[r].z {
					u.z, u.why, changed = true, "references "+r, true
					break
				}
			}
		}
	}
	// 3b. the object graph of the z side: strongly connected components and,
	// for a few objects, what a change to them recompiles (Go recompiles every
	// importer of a changed package, measured: a body-only edit in std
	// recompiled z)
	nodeOf, comp := sccReport(order, units, genTok, *leaf)
	// 4. write
	apply := func(f *ast.File, from, to int) string {
		b := src[f]
		es := edits[f]
		var sb strings.Builder
		pos := from
		for _, e := range es {
			if e.off < from || e.off >= to {
				continue
			}
			sb.Write(b[pos:e.off])
			sb.WriteString(e.text)
			pos = e.end
		}
		sb.Write(b[pos:to])
		return sb.String()
	}
	for f := range edits {
		es := edits[f]
		sort.Slice(es, func(i, j int) bool { return es[i].off < es[j].off })
		// dedupe (an ident can be both in Defs and Uses for embedded fields)
		k := 0
		for i := range es {
			if k > 0 && es[k-1].off == es[i].off {
				continue
			}
			es[k] = es[i]
			k++
		}
		edits[f] = es[:k]
	}
	declText := func(d ast.Node) string {
		off := func(p token.Pos) int { return genTok.Offset(p) }
		switch d := d.(type) {
		case *ast.FuncDecl:
			from := off(d.Pos())
			if d.Doc != nil {
				from = off(d.Doc.Pos())
			}
			return apply(gen, from, off(d.End()))
		case *ast.GenDecl:
			s := d.Specs[0]
			var from, to int
			switch s := s.(type) {
			case *ast.TypeSpec:
				from, to = off(s.Pos()), off(s.End())
			case *ast.ValueSpec:
				from, to = off(s.Pos()), off(s.End())
			}
			return d.Tok.String() + " " + apply(gen, from, to)
		}
		panic("decl")
	}
	// the import block of zz_generated.go, then the helper blanks
	imports := ""
	for _, d := range gen.Decls {
		if g, ok := d.(*ast.GenDecl); ok && g.Tok == token.IMPORT {
			imports += string(src[gen][genTok.Offset(g.Pos()):genTok.Offset(g.End())]) + "\n"
		}
	}
	blanks := "var _ = math.Sin\nvar _ = debug.Stack\nvar _ = sort.Ints\nvar _ strings.Builder\nvar _ = abap.AddI\n"
	must := func(err error) {
		if err != nil {
			panic(err)
		}
	}
	for _, sub := range []string{"std", "z"} {
		must(os.MkdirAll(filepath.Join(*out, sub), 0o755))
	}
	// several files per package, so gofmt and the compiler's front end see normal-size files
	const chunk = 400
	writePkg := func(dir, name string, us []*unit, extraImport string) {
		files := 0
		for i := 0; i < len(us); i += chunk {
			var sb strings.Builder
			sb.WriteString("// Code generated by tools/gogen/splitproto. DO NOT EDIT.\n\npackage " + name + "\n\n")
			imp := imports
			if extraImport != "" {
				imp = strings.Replace(imp, "import (", "import (\n\t"+extraImport, 1)
			}
			sb.WriteString(imp + "\n" + blanks)
			if extraImport != "" {
				sb.WriteString("var _ = XstdAnchor\n")
			}
			if strings.Contains(extraImport, "/z\"") {
				sb.WriteString("var _ = XzAnchor\n")
			}
			if name == "std" && i == 0 {
				sb.WriteString("// XstdAnchor keeps the dot import of std used in every z file\nconst XstdAnchor = 0\n")
			}
			for _, u := range us[i:min(i+chunk, len(us))] {
				for _, d := range u.decls {
					sb.WriteString("\n" + declText(d) + "\n")
				}
			}
			must(os.WriteFile(filepath.Join(dir, fmt.Sprintf("zz_%s_%03d.go", name, files)), []byte(sb.String()), 0o644))
			files++
		}
	}
	var std, z, leafUnits []*unit
	isLeaf := map[*unit]bool{}
	if *leaf != "" {
		for _, u := range order {
			if u.z && (u.owner == *leaf || strings.HasPrefix(u.key, "init#") && refsOnlyOwner(u, units, *leaf)) {
				isLeaf[u] = true
			}
		}
		for _, u := range order {
			if isLeaf[u] {
				continue
			}
			for r := range u.refs {
				if isLeaf[units[r]] {
					panic(u.key + " references " + r + ": " + *leaf + " is not a leaf")
				}
			}
		}
	}
	pulled := []string{}
	for _, u := range order {
		if isLeaf[u] {
			leafUnits = append(leafUnits, u)
		} else if u.z {
			z = append(z, u)
			if u.why != "Z/Y name" && !(strings.HasPrefix(u.key, "init#") && strings.HasPrefix(u.why, "references ") && zName.MatchString(u.why[strings.LastIndex(u.why, " ")+1:])) {
				pulled = append(pulled, u.key+" ("+u.why+")")
			}
		} else {
			std = append(std, u)
		}
	}
	writePkg(filepath.Join(*out, "std"), "std", std, "")
	writePkg(filepath.Join(*out, "z"), "z", z, `. "`+*modPath+`/std"`)
	if len(leafUnits) > 0 {
		must(os.MkdirAll(filepath.Join(*out, "zleaf"), 0o755))
		writePkg(filepath.Join(*out, "zleaf"), "zleaf", leafUnits, `. "`+*modPath+`/std"`+"\n\t. \""+*modPath+"/z\"")
	}
	var compPkgs []string
	if *sccMode {
		must(os.RemoveAll(filepath.Join(*out, "z")))
		byComp := map[int][]*unit{}
		for _, u := range z {
			byComp[comp[nodeOf[u]]] = append(byComp[comp[nodeOf[u]]], u)
		}
		ids := []int{}
		for c := range byComp {
			ids = append(ids, c)
		}
		sort.Ints(ids)
		var listing strings.Builder
		for _, c := range ids {
			name := fmt.Sprintf("c%04d", c)
			compPkgs = append(compPkgs, name)
			deps := map[int]bool{}
			owners := map[string]bool{}
			for _, u := range byComp[c] {
				owners[nodeOf[u]] = true
				for r := range u.refs {
					if v := units[r]; v.z && comp[nodeOf[v]] != c {
						deps[comp[nodeOf[v]]] = true
					}
				}
			}
			imps := []string{`. "` + *modPath + `/std"`}
			anchors := []string{"XstdAnchor"}
			ds := []int{}
			for d := range deps {
				ds = append(ds, d)
			}
			sort.Ints(ds)
			for _, d := range ds {
				imps = append(imps, fmt.Sprintf(`. "%s/zc/c%04d"`, *modPath, d))
				anchors = append(anchors, fmt.Sprintf("Xanchor_c%04d", d))
			}
			dir := filepath.Join(*out, "zc", name)
			must(os.MkdirAll(dir, 0o755))
			writePkgN(dir, name, byComp[c], strings.Join(imps, "\n\t"), anchors, fmt.Sprintf("Xanchor_%s", name), imports, blanks, declText)
			os := []string{}
			for o := range owners {
				os = append(os, o)
			}
			sort.Strings(os)
			fmt.Fprintf(&listing, "%s %d %s\n", name, len(ds), strings.Join(os, " "))
		}
		must(os.WriteFile(filepath.Join(*out, "zc", "components.txt"), []byte(listing.String()), 0o644))
	}
	// main: the hand-written files with the renames, dot-importing both
	for i, f := range p.Syntax {
		base := filepath.Base(p.CompiledGoFiles[i])
		if f == gen || strings.HasSuffix(base, "_test.go") {
			continue
		}
		text := apply(f, 0, len(src[f]))
		dots := "\n\t. \"" + *modPath + "/std\"\n\t. \"" + *modPath + "/z\""
		anchorLine := "\nvar _, _ = XstdAnchor, XzAnchor\n"
		if *sccMode {
			dots = "\n\t. \"" + *modPath + "/std\""
			anchorLine = "\nvar _ = XstdAnchor\n"
			for _, c := range compPkgs {
				dots += "\n\t. \"" + *modPath + "/zc/" + c + "\""
				anchorLine += "var _ = Xanchor_" + c + "\n"
			}
		}
		if len(leafUnits) > 0 {
			dots += "\n\t_ \"" + *modPath + "/zleaf\""
		}
		if strings.Contains(text, "import \"osg/gogen/abap\"") {
			text = strings.Replace(text, "import \"osg/gogen/abap\"", "import (\n\t\"osg/gogen/abap\""+dots+"\n)", 1)
		} else {
			text = strings.Replace(text, "\"osg/gogen/abap\"", "\"osg/gogen/abap\""+dots, 1)
		}
		text += anchorLine
		must(os.WriteFile(filepath.Join(*out, base), []byte(text), 0o644))
	}
	if !*sccMode {
		must(os.WriteFile(filepath.Join(*out, "z", "zz_anchor.go"), []byte("package z\n\n// XzAnchor keeps the dot import of z used in main\nconst XzAnchor = 0\n"), 0o644))
	}
	// the embedded JSON beside main.go
	ents, _ := os.ReadDir(filepath.Dir(p.CompiledGoFiles[0]))
	for _, e := range ents {
		if strings.HasSuffix(e.Name(), ".json") {
			b, _ := os.ReadFile(filepath.Join(filepath.Dir(p.CompiledGoFiles[0]), e.Name()))
			must(os.WriteFile(filepath.Join(*out, e.Name()), b, 0o644))
		}
	}
	zByName := len(z) - len(pulled)
	fmt.Printf("units: %d std, %d z (%d by name, %d pulled in by reference); %d renamed objects\n", len(std), len(z), zByName, len(pulled), len(rename))
	kinds := map[string]int{}
	for _, s := range pulled {
		kinds[strings.SplitN(s, " ", 2)[0]]++
	}
	fmt.Printf("pulled in by kind: %v\n", kinds)
	for _, s := range pulled {
		fmt.Println("  pulled:", s)
	}
}

// refsOnlyOwner: an init unit whose references all belong to one object
func refsOnlyOwner(u *unit, units map[string]*unit, owner string) bool {
	if len(u.refs) == 0 {
		return false
	}
	for r := range u.refs {
		if units[r].owner != owner {
			return false
		}
	}
	return true
}

// sccReport prints the strongly connected components of the z side at the
// object level (a unit without an owner is its own node), their sizes in bytes
// of Go, and for a few objects the bytes a change recompiles: the object's
// component plus every component that reaches it (Go recompiles importers).
func sccReport(order []*unit, units map[string]*unit, tf *token.File, leaf string) (map[*unit]string, map[string]int) {
	nodeOf := map[*unit]string{}
	var node func(u *unit) string
	node = func(u *unit) string {
		if n, ok := nodeOf[u]; ok {
			return n
		}
		n := nodeRaw(u, units)
		nodeOf[u] = n
		return n
	}
	size := map[string]int{}
	edges := map[string]map[string]bool{}
	var nodes []string
	for _, u := range order {
		if !u.z {
			continue
		}
		n := node(u)
		if _, ok := size[n]; !ok {
			nodes = append(nodes, n)
			edges[n] = map[string]bool{}
		}
		for _, d := range u.decls {
			size[n] += tf.Offset(d.End()) - tf.Offset(d.Pos())
		}
	}
	for _, u := range order {
		if !u.z {
			continue
		}
		n := node(u)
		for r := range u.refs {
			if v := units[r]; v.z {
				if m := node(v); m != n {
					edges[n][m] = true
				}
			}
		}
	}
	// Tarjan
	index, low, onStack := map[string]int{}, map[string]int{}, map[string]bool{}
	var stack []string
	comp := map[string]int{}
	var comps [][]string
	i := 0
	var strong func(v string)
	strong = func(v string) {
		index[v], low[v] = i, i
		i++
		stack = append(stack, v)
		onStack[v] = true
		for w := range edges[v] {
			if _, seen := index[w]; !seen {
				strong(w)
				low[v] = min(low[v], low[w])
			} else if onStack[w] {
				low[v] = min(low[v], index[w])
			}
		}
		if low[v] == index[v] {
			var c []string
			for {
				w := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				onStack[w] = false
				comp[w] = len(comps)
				c = append(c, w)
				if w == v {
					break
				}
			}
			comps = append(comps, c)
		}
	}
	for _, n := range nodes {
		if _, seen := index[n]; !seen {
			strong(n)
		}
	}
	csize := make([]int, len(comps))
	total := 0
	for n, s := range size {
		csize[comp[n]] += s
		total += s
	}
	idx := make([]int, len(comps))
	for k := range idx {
		idx[k] = k
	}
	sort.Slice(idx, func(a, b int) bool { return csize[idx[a]] > csize[idx[b]] })
	fmt.Printf("z side: %d nodes, %d components, %d KB of Go\n", len(nodes), len(comps), total/1024)
	for _, k := range idx[:min(5, len(idx))] {
		c := comps[k]
		sort.Strings(c)
		fmt.Printf("  component %d KB, %d objects: %s\n", csize[k]/1024, len(c), strings.Join(c[:min(12, len(c))], " "))
	}
	// reverse reachability: who (transitively) references a component
	rev := map[int]map[int]bool{}
	for v, ws := range edges {
		for w := range ws {
			if comp[v] != comp[w] {
				if rev[comp[w]] == nil {
					rev[comp[w]] = map[int]bool{}
				}
				rev[comp[w]][comp[v]] = true
			}
		}
	}
	affected := func(c int) (int, int) {
		seen := map[int]bool{c: true}
		q := []int{c}
		for len(q) > 0 {
			x := q[0]
			q = q[1:]
			for y := range rev[x] {
				if !seen[y] {
					seen[y] = true
					q = append(q, y)
				}
			}
		}
		b := 0
		for y := range seen {
			b += csize[y]
		}
		return len(seen), b
	}
	// the distribution over objects: bytes a change to each recompiles
	type row struct {
		n        string
		own, aff int
	}
	var rows []row
	for _, n := range nodes {
		if !strings.Contains(n, " ") {
			_, b := affected(comp[n])
			rows = append(rows, row{n, csize[comp[n]], b})
		}
	}
	sort.Slice(rows, func(a, b int) bool { return rows[a].aff < rows[b].aff })
	if len(rows) > 0 {
		q := func(p float64) row { return rows[min(len(rows)-1, int(p*float64(len(rows))))] }
		fmt.Printf("  per object (%d), KB recompiled by a change (own component + its importers): p10 %d, p50 %d, p75 %d, p90 %d, max %d\n", len(rows),
			q(0.1).aff/1024, q(0.5).aff/1024, q(0.75).aff/1024, q(0.9).aff/1024, rows[len(rows)-1].aff/1024)
		leaves := 0
		for _, r := range rows {
			if r.aff == r.own && r.own < 200*1024 {
				leaves++
			}
		}
		fmt.Printf("  objects whose component is under 200 KB and nothing imports: %d\n", leaves)
	}
	for _, n := range []string{leaf, "ZCL_OSD_SYSINFO", "ZCL_STG_DISPATCHER", "ZIF_STG_CDS_SOURCE", "ZCL_OSD_WEBGUI", "ZCL_STG_SEGW_GEN"} {
		if c, ok := comp[n]; ok {
			k, b := affected(c)
			fmt.Printf("  %s: component %d KB (%d objects); a change recompiles %d components, %d KB\n", n, csize[c]/1024, len(comps[c]), k, b/1024)
		}
	}
	for _, u := range order {
		if u.z {
			node(u)
		}
	}
	return nodeOf, comp
}

func nodeRaw(u *unit, units map[string]*unit) string {
	if strings.HasPrefix(u.key, "init#") && len(u.refs) > 0 {
		var rs []string
		for r := range u.refs {
			rs = append(rs, r)
		}
		sort.Strings(rs)
		for _, r := range rs {
			if o := units[r].owner; o != "" {
				return o
			}
		}
	}
	if u.owner != "" {
		return u.owner
	}
	return u.key
}

// writePkgN writes one component package: its units, dot imports of std and
// the components it references, a use of each one's anchor, and its own anchor
func writePkgN(dir, name string, us []*unit, imps string, anchors []string, own string, imports, blanks string, declText func(ast.Node) string) {
	var sb strings.Builder
	sb.WriteString("// Code generated by tools/gogen/splitproto. DO NOT EDIT.\n\npackage " + name + "\n\n")
	sb.WriteString(strings.Replace(imports, "import (", "import (\n\t"+imps, 1) + "\n" + blanks)
	for _, a := range anchors {
		sb.WriteString("var _ = " + a + "\n")
	}
	sb.WriteString("\nconst " + own + " = 0\n")
	for _, u := range us {
		for _, d := range u.decls {
			sb.WriteString("\n" + declText(d) + "\n")
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "zz_"+name+".go"), []byte(sb.String()), 0o644); err != nil {
		panic(err)
	}
}

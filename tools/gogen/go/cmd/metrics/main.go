// metrics: the cyclomatic complexity of every function in the Go packages
// under a directory, per package, as JSON (tools/osd-metrics.mjs reads it).
//
//	go run ./cmd/metrics [dir] [-]     (-: stdin lists the files to read)
//
// A function's complexity is 1 plus one for each if, for, range, case and
// comm clause with a condition, and each && and ||: the McCabe count gocyclo
// uses. Test files and the generated zz_ files of cmd/* are left out, as the
// size budget leaves them out.
package main

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type function struct {
	Name       string `json:"name"`
	Line       int    `json:"line"`
	Complexity int    `json:"complexity"`
}

type pkg struct {
	Functions int        `json:"functions"`
	Sum       int        `json:"sum"`
	Max       int        `json:"max"`
	Over15    int        `json:"over15"`
	Top       []function `json:"top"`
}

func complexity(body ast.Node) int {
	n := 1
	ast.Inspect(body, func(node ast.Node) bool {
		switch x := node.(type) {
		case *ast.IfStmt, *ast.ForStmt, *ast.RangeStmt:
			n++
		case *ast.CaseClause:
			if x.List != nil { // default: no condition
				n++
			}
		case *ast.CommClause:
			if x.Comm != nil {
				n++
			}
		case *ast.BinaryExpr:
			if x.Op == token.LAND || x.Op == token.LOR {
				n++
			}
		case *ast.FuncLit:
			return false // a closure is counted as its own function
		}
		return true
	})
	return n
}

func main() {
	root := "."
	if len(os.Args) > 1 && os.Args[1] != "-" {
		root = os.Args[1]
	}
	// with "-" as the last argument, stdin names the files to read (one path
	// per line, relative to root): what git tracks, so a local run and CI
	// count the same code
	var only map[string]bool
	if os.Args[len(os.Args)-1] == "-" {
		only = map[string]bool{}
		data, _ := io.ReadAll(os.Stdin)
		for _, line := range strings.Split(string(data), "\n") {
			if line = strings.TrimSpace(line); line != "" {
				only[filepath.ToSlash(line)] = true
			}
		}
	}
	out := map[string]*pkg{}
	fset := token.NewFileSet()
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if d.Name() == "testdata" || d.Name() == "generated" || strings.HasPrefix(d.Name(), ".") && path != root {
				return filepath.SkipDir
			}
			return nil
		}
		name := d.Name()
		rel, _ := filepath.Rel(root, filepath.Dir(path))
		rel = filepath.ToSlash(rel)
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") || (strings.HasPrefix(name, "zz_") && strings.HasPrefix(rel, "cmd/")) {
			return nil
		}
		if only != nil {
			file, _ := filepath.Rel(root, path)
			if !only[filepath.ToSlash(file)] {
				return nil
			}
		}
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return nil
		}
		p := out[rel]
		if p == nil {
			p = &pkg{}
			out[rel] = p
		}
		ast.Inspect(file, func(node ast.Node) bool {
			var body *ast.BlockStmt
			label := ""
			switch f := node.(type) {
			case *ast.FuncDecl:
				body, label = f.Body, f.Name.Name
				if f.Recv != nil && len(f.Recv.List) > 0 {
					if t, ok := f.Recv.List[0].Type.(*ast.StarExpr); ok {
						if id, ok := t.X.(*ast.Ident); ok {
							label = id.Name + "." + label
						}
					} else if id, ok := f.Recv.List[0].Type.(*ast.Ident); ok {
						label = id.Name + "." + label
					}
				}
			case *ast.FuncLit:
				body, label = f.Body, "func literal"
			}
			if body == nil {
				return true
			}
			c := complexity(body)
			p.Functions++
			p.Sum += c
			if c > p.Max {
				p.Max = c
			}
			if c > 15 {
				p.Over15++
			}
			p.Top = append(p.Top, function{Name: name + ":" + label, Line: fset.Position(body.Pos()).Line, Complexity: c})
			return true
		})
		return nil
	})
	for _, p := range out {
		sort.Slice(p.Top, func(i, j int) bool { return p.Top[i].Complexity > p.Top[j].Complexity })
		if len(p.Top) > 5 {
			p.Top = p.Top[:5]
		}
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", " ")
	_ = enc.Encode(out)
}

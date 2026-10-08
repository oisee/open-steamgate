package objstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Compiler owns validation, not its process. The host supplies an adapter.
type Compiler interface {
	Check(context.Context, CompilerInput) ([]Diagnostic, error)
	Outline(context.Context, CompilerInput) (json.RawMessage, error)
}
type CompilerInput struct {
	Root, Generation, Type, Name, Version string
	Files                                 []string
	Expected                              map[string]string
	Source                                *string
}

// Diagnostic uses the sidecar's A4H coordinates (column zero based).
type Diagnostic struct {
	Severity, Code, Rule, Text, Type, Name, Include string
	Line, Col                                       int
}

var ErrCompilerAbsent = errors.New("compiler absent")

var compilerState struct {
	provider   Compiler
	generation string
}

// SetCompiler injects a lazy provider; nil preserves the standalone refusals.
func SetCompiler(provider Compiler, generation string) {
	storeState.mu.Lock()
	defer storeState.mu.Unlock()
	compilerState.provider, compilerState.generation = provider, generation
}

func compilerInput(ix *storeIndex, typ, name, version string) (CompilerInput, error) {
	in := CompilerInput{Root: storeState.root, Generation: compilerState.generation, Type: typ, Name: name, Version: version, Files: []string{}, Expected: map[string]string{}}
	e := ix.find(typ, name)
	if e == nil {
		return in, storeNotFound(typ, name)
	}
	in.Name = e.Name
	for _, file := range storeFilesOf(e) {
		if version == "active" {
			if _, proven := storeActiveBytes(file); proven {
				in.Files = append(in.Files, storeState.cfg.Active[file])
				in.Expected[storeState.cfg.Active[file]] = storeState.cfg.Built[file]
			} else if file == e.File {
				return in, storeNotFound(typ, name+" active version (main)")
			}
		} else if _, err := os.Stat(filepath.Join(storeState.root, file)); err == nil {
			in.Files = append(in.Files, file)
		} else if !os.IsNotExist(err) {
			return in, err
		}
	}
	if len(in.Files) == 0 {
		return in, storeNotFound(typ, name)
	}
	return in, nil
}

func compilerRefusal(a *Answer, err error) error {
	a.Scalars["EV_JSON"] = storeJSONRefusal(err.Error(), "NOT_SUPPORTED")
	return err
}

func storeCheck(ix *storeIndex, a *Answer, typ, name string, source *string) error {
	if compilerState.provider == nil {
		return storeNoCompiler(ix, a, "CHECK", typ, name)
	}
	version := "inactive"
	if e := ix.find(typ, name); e != nil {
		version, _ = storeStateOf(e, e.File)
	}
	in, err := compilerInput(ix, typ, name, version)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	in.Source = source
	diagnostics, err := compilerState.provider.Check(ctx, in)
	if errors.Is(err, ErrCompilerAbsent) {
		return storeNoCompiler(ix, a, "CHECK", typ, name)
	}
	if err != nil {
		return compilerRefusal(a, err)
	}
	for _, d := range diagnostics {
		// Node CHECK reports the requested object's issues, not activation's dependents.
		if d.Type != in.Type || d.Name != in.Name {
			continue
		}
		file := ""
		if d.Include != "" {
			file = "/" + strings.TrimPrefix(d.Include, "/")
		}
		a.Issues = append(a.Issues, Issue{OBJ_TYPE: d.Type, OBJ_NAME: d.Name, FILE: file, LINE: int32(d.Line), COL: int32(d.Col + 1), RULE: d.Rule, MESSAGE: d.Text})
	}
	a.Scalars["EV_COUNT"] = strconv.Itoa(len(a.Issues))
	if len(a.Issues) == 0 {
		a.Scalars["EV_ACTIVE"] = "X"
	}
	value := struct {
		Active bool    `json:"active"`
		Live   bool    `json:"live"`
		Note   string  `json:"note"`
		Issues []Issue `json:"issues"`
	}{len(a.Issues) == 0, false, "", a.Issues}
	a.Scalars["EV_JSON"], err = storeJSON(value)
	return err
}

func storeParse(ix *storeIndex, a *Answer, raw string) error {
	var input struct{ Kind, Type, Name, Version string }
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		return err
	}
	if input.Kind != "OUTLINE" {
		return compilerRefusal(a, fmt.Errorf("parse kind %s is not supported", input.Kind))
	}
	if compilerState.provider == nil {
		return compilerRefusal(a, fmt.Errorf("unknown store command PARSE"))
	}
	if input.Version == "" {
		input.Version = "inactive"
	}
	if input.Version != "active" && input.Version != "inactive" {
		return compilerRefusal(a, fmt.Errorf("outline version %s is not supported", input.Version))
	}
	typ, name := strings.ToUpper(input.Type), strings.ToUpper(input.Name)
	if ix.find(typ, name) == nil {
		a.Scalars["EV_JSON"] = `{"found":false}`
		return nil
	}
	in, err := compilerInput(ix, typ, name, input.Version)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	value, err := compilerState.provider.Outline(ctx, in)
	if errors.Is(err, ErrCompilerAbsent) {
		err = fmt.Errorf("unknown store command PARSE")
	}
	if err != nil {
		return compilerRefusal(a, err)
	}
	a.Scalars["EV_JSON"] = string(value)
	return nil
}

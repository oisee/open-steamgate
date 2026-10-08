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
	Available(context.Context) error
	Check(context.Context, CompilerInput) ([]Issue, error)
	Outline(context.Context, CompilerInput) (json.RawMessage, error)
}
type CompilerInput struct {
	Root, Generation, Type, Name, Version string
	Files                                 []string
	Expected                              map[string]string
	Logical                               []string
	Source                                *string
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
	in := CompilerInput{Root: storeState.root, Generation: compilerState.generation, Type: typ, Name: name, Version: version, Files: []string{}, Expected: map[string]string{}, Logical: []string{}}
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
				in.Logical = append(in.Logical, file)
			}
		} else if _, err := os.Stat(filepath.Join(storeState.root, file)); err == nil {
			in.Files = append(in.Files, file)
			in.Logical = append(in.Logical, file)
		} else if !os.IsNotExist(err) {
			return in, err
		}
	}
	return in, nil
}

func compilerRefusal(a *Answer, err error) error {
	a.Scalars["EV_JSON"] = storeJSONRefusal(err.Error(), "NOT_SUPPORTED")
	return err
}

func storeCheck(ix *storeIndex, a *Answer, typ, name string, source *string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if compilerState.provider == nil {
		return storeNoCompiler(ix, a, "CHECK", typ, name)
	}
	if err := compilerState.provider.Available(ctx); err != nil {
		if errors.Is(err, ErrCompilerAbsent) {
			return storeNoCompiler(ix, a, "CHECK", typ, name)
		}
		return compilerRefusal(a, err)
	}
	version := "inactive" // Node CHECK always reads the saved registry.
	in, err := compilerInput(ix, typ, name, version)
	if err != nil {
		return err
	}
	in.Source = source
	issues, err := compilerState.provider.Check(ctx, in)
	if errors.Is(err, ErrCompilerAbsent) {
		return storeNoCompiler(ix, a, "CHECK", typ, name)
	}
	if err != nil {
		return compilerRefusal(a, err)
	}
	a.Issues = append(a.Issues, issues...)
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
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if compilerState.provider == nil {
		return compilerRefusal(a, fmt.Errorf("unknown store command PARSE"))
	}
	if err := compilerState.provider.Available(ctx); err != nil {
		if errors.Is(err, ErrCompilerAbsent) {
			err = fmt.Errorf("unknown store command PARSE")
		}
		return compilerRefusal(a, err)
	}
	var input struct{ Kind, Type, Name, Version string }
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		return err
	}
	if input.Kind != "OUTLINE" {
		return compilerRefusal(a, fmt.Errorf("parse kind %s is not supported", input.Kind))
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

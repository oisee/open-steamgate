// Package storecompiler adapts the lifecycle-owning compiler client to objstore.
package storecompiler

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"osg/gogen/compiler"
	"osg/gogen/storecheck"
)

type Adapter struct{ Client *compiler.Client }

var _ storecheck.Compiler = Adapter{}

func (a Adapter) Available(ctx context.Context) error {
	if err := a.Client.Hello(ctx); err != nil {
		var absent *compiler.AbsentError
		if errors.As(err, &absent) {
			return storecheck.ErrCompilerAbsent
		}
		return err
	}
	return nil
}
func (a Adapter) snapshot(ctx context.Context, in storecheck.Input) (compiler.Snapshot, error) {
	if err := a.Available(ctx); err != nil {
		return compiler.Snapshot{}, err
	}
	if in.Source != nil {
		return compiler.Snapshot{}, &compiler.Refusal{Code: "UNSUPPORTED_OP", Text: "CHECK with IV_SOURCE requires a saved draft; write the draft first"}
	}
	snapshot, err := compiler.BuildSnapshot(ctx, in.Root, in.Generation, []compiler.ObjectFiles{{Type: in.Type, Name: in.Name, Version: in.Version, Files: in.Files, Logical: in.Logical}}, a.Client.Status().Limits.MaxSnapshotBytes)
	if err != nil {
		return snapshot, err
	}
	for _, object := range snapshot.Objects {
		for _, file := range object.Files {
			if expected, ok := in.Expected[file.Path]; ok && expected != file.SHA256 {
				return snapshot, &compiler.Refusal{Code: "SNAPSHOT_MISMATCH", Text: "source changed: " + file.Path}
			}
		}
	}
	return snapshot, nil
}
func (a Adapter) Check(ctx context.Context, in storecheck.Input) ([]storecheck.Issue, error) {
	snapshot, err := a.snapshot(ctx, in)
	if err != nil {
		return nil, err
	}
	snapshot.CheckMode, snapshot.Include = in.CheckMode(), in.Include
	result, err := a.Client.Check(ctx, snapshot)
	if err != nil {
		return nil, err
	}
	rows := make([]storecheck.Issue, 0, len(result.Diagnostics))
	for _, d := range result.Diagnostics {
		if d.Object.Type != in.Type || d.Object.Name != in.Name {
			continue
		}
		file := ""
		if d.Include != "" {
			file = "/" + strings.TrimPrefix(d.Include, "/")
		}
		rows = append(rows, storecheck.Issue{OBJ_TYPE: d.Object.Type, OBJ_NAME: d.Object.Name, FILE: file, LINE: int32(d.Line), COL: int32(d.Col + 1), RULE: d.Rule, MESSAGE: d.Text, Severity: d.Severity, URI: d.URI})
	}
	return rows, nil
}
func (a Adapter) Outline(ctx context.Context, in storecheck.Input) (json.RawMessage, error) {
	snapshot, err := a.snapshot(ctx, in)
	if err != nil {
		return nil, err
	}
	return a.Client.Outline(ctx, snapshot, snapshot.Objects[0])
}

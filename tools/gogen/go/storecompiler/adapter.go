// Package storecompiler adapts the lifecycle-owning compiler client to objstore.
package storecompiler

import (
	"context"
	"encoding/json"
	"errors"

	"osg/gogen/compiler"
	"osg/gogen/objstore"
)

type Adapter struct{ Client *compiler.Client }

var _ objstore.Compiler = Adapter{}

func (a Adapter) snapshot(ctx context.Context, in objstore.CompilerInput) (compiler.Snapshot, error) {
	if err := a.Client.Hello(ctx); err != nil {
		var absent *compiler.AbsentError
		if errors.As(err, &absent) {
			return compiler.Snapshot{}, objstore.ErrCompilerAbsent
		}
		return compiler.Snapshot{}, err
	}
	if in.Source != nil {
		return compiler.Snapshot{}, &compiler.Refusal{Code: "UNSUPPORTED_OP", Text: "CHECK with IV_SOURCE requires a saved draft; write the draft first"}
	}
	snapshot, err := compiler.BuildSnapshot(ctx, in.Root, in.Generation, []compiler.ObjectFiles{{Type: in.Type, Name: in.Name, Version: in.Version, Files: in.Files}}, a.Client.Status().Limits.MaxSnapshotBytes)
	if err != nil {
		return snapshot, err
	}
	for _, object := range snapshot.Objects {
		for _, file := range object.Files {
			if expected, ok := in.Expected[file.Path]; ok && expected != file.SHA256 {
				return snapshot, &compiler.Refusal{Code: "SNAPSHOT_MISMATCH", Text: "active source changed: " + file.Path}
			}
		}
	}
	return snapshot, nil
}
func (a Adapter) Check(ctx context.Context, in objstore.CompilerInput) ([]objstore.Diagnostic, error) {
	snapshot, err := a.snapshot(ctx, in)
	if err != nil {
		return nil, err
	}
	result, err := a.Client.Check(ctx, snapshot)
	if err != nil {
		return nil, err
	}
	rows := make([]objstore.Diagnostic, 0, len(result.Diagnostics))
	for _, d := range result.Diagnostics {
		rows = append(rows, objstore.Diagnostic{Severity: d.Severity, Code: d.Code, Rule: d.Rule, Text: d.Text, Type: d.Object.Type, Name: d.Object.Name, Include: d.Include, Line: d.Line, Col: d.Col})
	}
	return rows, nil
}
func (a Adapter) Outline(ctx context.Context, in objstore.CompilerInput) (json.RawMessage, error) {
	snapshot, err := a.snapshot(ctx, in)
	if err != nil {
		return nil, err
	}
	return a.Client.Outline(ctx, snapshot, snapshot.Objects[0])
}

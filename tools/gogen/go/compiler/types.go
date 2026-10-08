// Package compiler implements the v1 compiler-provider client without ADT wiring.
package compiler

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
)

const Contract = 1

// CodeHandshake refuses an incomplete hello locally; it never leaves the client.
const CodeHandshake = "HANDSHAKE"

type Refusal struct {
	Code string `json:"code"`
	Text string `json:"text"`
}

func (e *Refusal) Error() string { return e.Code + ": " + e.Text }

type AbsentError struct{ Paths []string }

func (e *AbsentError) Error() string { return fmt.Sprintf("sidecar absent; tried %v", e.Paths) }

type File struct {
	Path        string `json:"path"`
	LogicalPath string `json:"logicalPath,omitempty"`
	SHA256      string `json:"sha256"`
}
type Object struct {
	Type    string `json:"type"`
	Name    string `json:"name"`
	Version string `json:"version"`
	Files   []File `json:"files"`
}
type ObjectFiles struct {
	Type, Name, Version string
	Files               []string
	Logical             []string
}
type Snapshot struct {
	Include    string   `json:"include,omitempty"`
	CheckMode  string   `json:"checkMode,omitempty"`
	Root       string   `json:"root"`
	Generation string   `json:"generation"`
	Objects    []Object `json:"objects"`
}
type ObjectID struct {
	Type string `json:"type"`
	Name string `json:"name"`
}
type Diagnostic struct {
	URI      string   `json:"uri,omitempty"`
	Severity string   `json:"severity"`
	Code     string   `json:"code"`
	Rule     string   `json:"rule,omitempty"`
	Text     string   `json:"text"`
	Object   ObjectID `json:"object"`
	Include  string   `json:"include"`
	Line     int      `json:"line"`
	Col      int      `json:"col"`
	EndLine  int      `json:"endLine"`
	EndCol   int      `json:"endCol"`
}
type CheckResult struct {
	Diagnostics  []Diagnostic `json:"diagnostics"`
	RegistryHash string       `json:"registryHash"`
	ConfigSha    string       `json:"configSha"`
	InputCount   int          `json:"inputCount"`
	VirtualFiles []string     `json:"virtualFiles"`
}
type Limits struct {
	MaxSnapshotBytes      int64 `json:"maxSnapshotBytes"`
	MaxConcurrentRequests int   `json:"maxConcurrentRequests"`
}
type Status struct {
	Path         string   `json:"path"`
	Found        bool     `json:"found"`
	OSD          string   `json:"osd"`
	Transpiler   string   `json:"transpiler"`
	Contract     int      `json:"contract"`
	Capabilities []string `json:"capabilities"`
	Limits       Limits   `json:"limits"`
	Restarts     int      `json:"restarts"`
	LastError    string   `json:"lastError"`
}

// UnmarshalJSON rejects incomplete successful verdicts as a local INTERNAL refusal.
func (result *CheckResult) UnmarshalJSON(raw []byte) error {
	fields := map[string]json.RawMessage{}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	for _, field := range []string{"diagnostics", "registryHash", "configSha", "inputCount"} {
		value, ok := fields[field]
		if !ok || string(value) == "null" {
			return fmt.Errorf("check result missing %s", field)
		}
	}
	type wireResult CheckResult
	var value wireResult
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	for _, hash := range []string{value.RegistryHash, value.ConfigSha} {
		if _, err := hex.DecodeString(hash); err != nil || len(hash) != 64 {
			return fmt.Errorf("check result requires 64-hex registryHash and configSha")
		}
	}
	if value.Diagnostics == nil || value.InputCount < 0 {
		return fmt.Errorf("check result requires diagnostics array and nonnegative inputCount")
	}
	*result = CheckResult(value)
	return nil
}

type outlineResult struct {
	Outline json.RawMessage `json:"outline"`
}

func (r *outlineResult) UnmarshalJSON(raw []byte) error {
	type wire outlineResult
	var value wire
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	if len(value.Outline) == 0 || value.Outline[0] != '{' {
		return fmt.Errorf("outline result missing outline object")
	}
	var shape struct {
		Found *bool `json:"found"`
	}
	if err := json.Unmarshal(value.Outline, &shape); err != nil {
		return err
	}
	if shape.Found == nil {
		return fmt.Errorf("outline result missing found")
	}
	*r = outlineResult(value)
	return nil
}

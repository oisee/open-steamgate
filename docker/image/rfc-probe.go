// Test-only, schema-bound ADT-over-RFC client. Built inside open-rfc-go so it
// can use its wire codec without requiring RFC_METADATA_GET from the stub.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/oisee/open-rfc-go/internal/classicrfc"
	"github.com/oisee/open-rfc-go/internal/client"
	"github.com/oisee/open-rfc-go/internal/cpic"
	"github.com/oisee/open-rfc-go/internal/rfcserver"
	"github.com/oisee/open-rfc-go/internal/xrfc"
)

func main() {
	if err := probe(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func probe() error {
	if len(os.Args) != 4 {
		return fmt.Errorf("usage: rfc-probe HOST PORT ADT_PATH")
	}
	port, err := strconv.Atoi(os.Args[2])
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if port < 3300 || port > 3399 {
		return fmt.Errorf("expected port 33nn")
	}
	s, err := client.Open(ctx, client.SessionOptions{Host: os.Args[1], Port: port, ApplicationServerService: fmt.Sprintf("sapdp%02d", port-3300), OperationTimeout: 15 * time.Second})
	if err != nil {
		return err
	}
	defer s.Close()
	if err = s.LogonAndPing(ctx, client.LogonOptions{Client: "001", User: "DEVELOPER", Password: "demo", Language: "E"}); err != nil {
		return err
	}
	graph := rfcserver.ADTRestGraph()
	descriptor := classicrfc.FunintParameter{ParameterClass: "I", ParameterName: "REQUEST", TableName: "SADT_REST_REQUEST", Exid: "v"}
	xml, err := xrfc.EncodeRecursiveParameter(descriptor, graph, map[string]any{
		"REQUEST_LINE":  map[string]any{"METHOD": "GET", "URI": os.Args[3], "VERSION": "HTTP/1.1"},
		"HEADER_FIELDS": []any{map[string]any{"NAME": "Accept", "VALUE": "*/*"}},
		"MESSAGE_BODY":  []byte{},
	}, xrfc.RecursiveLimits{})
	if err != nil {
		return err
	}
	wire, err := cpic.EncodeCutFunctionRequest(cpic.CutFunctionRequestInput{FunctionName: "SADT_REST_RFC_ENDPOINT", RequestedOutputs: []string{"RESPONSE"}, XrfcParameters: []cpic.NamedValue{{Name: "REQUEST", Value: xml}}})
	if err != nil {
		return err
	}
	answer, err := s.CallRaw(ctx, wire)
	if err != nil {
		return err
	}
	if !answer.Success {
		return fmt.Errorf("RFC call failed: %+v", answer.Envelope)
	}
	result, err := classicrfc.DecodeResult(answer.Fields)
	if err != nil {
		return err
	}
	for _, parameter := range result.XrfcParameters {
		name, err := xrfc.DecodeParameterName(parameter.Value, xrfc.Limits{})
		if err != nil {
			return err
		}
		if name != "RESPONSE" {
			continue
		}
		descriptor = classicrfc.FunintParameter{ParameterClass: "E", ParameterName: "RESPONSE", TableName: "SADT_REST_RESPONSE", Exid: "v"}
		value, err := xrfc.DecodeRecursiveParameter(descriptor, graph, parameter.Value, xrfc.RecursiveLimits{})
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"RESPONSE": value})
	}
	return fmt.Errorf("RFC returned no RESPONSE")
}

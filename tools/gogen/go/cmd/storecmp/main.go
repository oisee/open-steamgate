// storecmp answers a list of ZOSD_STORE calls with the Go host's object
// store (go/objstore), as JSON, so tools/gogen/storecmp.mjs can put the
// answers beside the Node destination's for the same calls over the same
// files.
//
//	go run ./cmd/storecmp -root <tree> -config <store.json> < calls.json
package main

import (
	"encoding/json"
	"flag"
	"log"
	"os"
	"osg/gogen/compiler"

	"osg/gogen/abap"
	"osg/gogen/objstore"
	"osg/gogen/storecompiler"
)

type adapterRequest struct {
	TableFields map[string][]string  `json:"tableFields"`
	Calls       []map[string]*string `json:"calls"`
	Inputs      map[string]bool      `json:"inputs"`
	Imports     map[string]bool      `json:"imports"`
	Tables      map[string]bool      `json:"tables"`
}

type adapterRow struct {
	fields []string
	values []string
}
type adapterTable []*adapterRow

func stringData(value string) abap.Data {
	return abap.Data{P: &value, T: abap.TString}
}

func adapterRowType(fields ...string) *abap.Type {
	comps := make([]abap.Comp, len(fields))
	for i := range fields {
		comps[i] = abap.Comp{Name: fields[i], T: abap.TString, Get: func(p any) any {
			return &p.(*adapterRow).values[i]
		}}
	}
	return &abap.Type{Kind: 'u', Comps: comps}
}

func adapterTableType(rowType *abap.Type) *abap.Type {
	return &abap.Type{Kind: 'h', Row: rowType,
		Lines: func(p any) int { return len(*p.(*adapterTable)) },
		At:    func(p any, i int) any { return (*p.(*adapterTable))[i] },
		Append: func(p any) any {
			t := p.(*adapterTable)
			row := &adapterRow{fields: make([]string, len(rowType.Comps)), values: make([]string, len(rowType.Comps))}
			for i, comp := range rowType.Comps {
				row.fields[i] = comp.Name
			}
			*t = append(*t, row)
			return row
		},
		Zero: func(p any) { *p.(*adapterTable) = nil },
	}
}

func adapterAnswer(args map[string]abap.Data, imports map[string]bool) map[string]any {
	abap.ZOSD_STORE(new(abap.Session), args)
	out := map[string]any{"Scalars": map[string]string{}, "Objects": []map[string]string{}, "Revisions": []map[string]string{}}
	for name := range imports {
		if value, ok := args[name].P.(*string); ok {
			scalars := out["Scalars"].(map[string]string)
			scalars[name] = *value
		}
	}
	for _, name := range []string{"ET_OBJECT", "ET_REVISION"} {
		tableData, ok := args[name]
		if !ok {
			continue
		}
		table, _ := tableData.P.(*adapterTable)
		key := "Revisions"
		if name == "ET_OBJECT" {
			key = "Objects"
		}
		rows := out[key].([]map[string]string)
		for _, row := range *table {
			values := map[string]string{}
			for i, field := range row.fields {
				values[field] = row.values[i]
			}
			rows = append(rows, values)
		}
		out[key] = rows
	}
	return out
}

func adapterCalls(calls []map[string]*string, request adapterRequest) []map[string]any {
	answers := make([]map[string]any, len(calls))
	for i, call := range calls {
		args := map[string]abap.Data{}
		for name, value := range call {
			if request.Inputs[name] {
				args[name] = stringData(*value)
			}
		}
		for name := range request.Imports {
			value := ""
			args[name] = stringData(value)
		}
		for name := range request.Tables {
			if fields := request.TableFields[name]; len(fields) > 0 {
				values := adapterTable{}
				args[name] = abap.Data{P: &values, T: adapterTableType(adapterRowType(fields...))}
			} else {
				log.Fatalf("missing harness row fields for %s", name)
			}
		}
		answers[i] = adapterAnswer(args, request.Imports)
	}
	return answers
}

func main() {
	root := flag.String("root", "", "the tree")
	config := flag.String("config", "", "the build's facts about it (tools/gogen/store.mjs)")
	sidecar := flag.Bool("compiler", false, "enable the lazy compiler provider")
	flag.Parse()
	cfg, err := os.ReadFile(*config)
	if err != nil {
		log.Fatal(err)
	}
	if err := abap.SetStore(*root, cfg, ""); err != nil {
		log.Fatal(err)
	}
	if *sidecar {
		client := compiler.New(compiler.Options{Root: *root})
		defer client.Close()
		objstore.SetCompiler(storecompiler.Adapter{Client: client}, "test")
	}
	var input json.RawMessage
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		log.Fatal(err)
	}
	var out any
	if input[0] == '[' {
		var calls []map[string]*string
		if err := json.Unmarshal(input, &calls); err != nil {
			log.Fatal(err)
		}
		answers := make([]abap.StoreAnswer, len(calls))
		for i, call := range calls {
			answers[i] = abap.StoreCall(call)
		}
		out = answers
	} else {
		var request adapterRequest
		if err := json.Unmarshal(input, &request); err != nil {
			log.Fatal(err)
		}
		out = adapterCalls(request.Calls, request)
	}
	enc := json.NewEncoder(os.Stdout)
	if err := enc.Encode(out); err != nil {
		log.Fatal(err)
	}
}

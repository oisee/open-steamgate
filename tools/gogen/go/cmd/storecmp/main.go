// storecmp answers a list of ZOSD_STORE calls with the Go host's object
// store (go/abap/store.go), as JSON, so tools/gogen/storecmp.mjs can put the
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

	"osg/gogen/abap"
)

func main() {
	root := flag.String("root", "", "the tree")
	config := flag.String("config", "", "the build's facts about it (tools/gogen/store.mjs)")
	flag.Parse()
	cfg, err := os.ReadFile(*config)
	if err != nil {
		log.Fatal(err)
	}
	if err := abap.SetStore(*root, cfg, ""); err != nil {
		log.Fatal(err)
	}
	var calls []map[string]*string
	if err := json.NewDecoder(os.Stdin).Decode(&calls); err != nil {
		log.Fatal(err)
	}
	out := make([]abap.StoreAnswer, 0, len(calls))
	for _, c := range calls {
		out = append(out, abap.StoreCall(c))
	}
	enc := json.NewEncoder(os.Stdout)
	if err := enc.Encode(out); err != nil {
		log.Fatal(err)
	}
}

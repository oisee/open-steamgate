// The SMW0 check of tools/gogen/mediacheck.mjs: each case read through the
// compiled ABAP and the host's media directory, compared with its file.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"osg/gogen/abap"
)

type testCase struct {
	ID    string `json:"id"`
	Size  int32  `json:"size"`
	File  string `json:"file"`
	Audio bool   `json:"audio"`
}

func main() {
	media := flag.String("media", "", "media directory (w3mi.json and the data files)")
	casesFile := flag.String("cases", "", "the cases, JSON")
	flag.Parse()
	if err := abap.SetMediaDir(*media); err != nil {
		fmt.Println("FAIL media:", err)
		os.Exit(1)
	}
	raw, _ := os.ReadFile(*casesFile)
	var cases []testCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		fmt.Println("FAIL cases:", err)
		os.Exit(1)
	}
	ok, total := 0, 0
	var bytesTotal int
	t0 := time.Now()
	for _, c := range cases {
		s := &abap.Session{}
		var data string
		var subrc int32
		if c.Audio {
			ZCL_GOGEN_T_W3MILOAD_LOAD_AUDIO(s, c.ID, c.Size, &data, &subrc)
		} else {
			ZCL_GOGEN_T_W3MILOAD_LOAD_IMAGE(s, c.ID, c.Size, &data, &subrc)
		}
		total++
		if c.File == "" {
			if subrc == 1 && data == "" {
				ok++
				fmt.Printf("ok   %-28s sy-subrc %d, nothing read (no such object)\n", c.ID, subrc)
			} else {
				fmt.Printf("FAIL %-28s sy-subrc %d, %d bytes\n", c.ID, subrc, len(data))
			}
			continue
		}
		want, err := os.ReadFile(c.File)
		if err != nil {
			fmt.Printf("FAIL %-28s %v\n", c.ID, err)
			continue
		}
		if subrc == 0 && bytes.Equal([]byte(data), want) {
			ok++
			bytesTotal += len(want)
			fmt.Printf("ok   %-28s %8d bytes, sha256 %x\n", c.ID, len(want), sha256.Sum256(want))
		} else {
			fmt.Printf("FAIL %-28s sy-subrc %d, %d bytes read, file %d\n", c.ID, subrc, len(data), len(want))
		}
	}
	fmt.Printf("%d of %d equal, %d bytes, %v\n", ok, total, bytesTotal, time.Since(t0).Round(time.Millisecond))
}

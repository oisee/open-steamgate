package main

import (
	"fmt"
	"os"
	"osg/gogen/abap"
	core "osg/gogen/generated/core"
	"strconv"
	"strings"
	"time"
)

func main() {
	mib, _ := strconv.Atoi(os.Args[1])
	xml := "<root>" + strings.Repeat("<e a=\"1\">x</e>", (mib*1024*1024)/14) + "</root>"
	s := &abap.Session{}
	t := time.Now()
	r := core.CL_SXML_STRING_READER_CREATE(s, xml)
	nodes := 0
	for {
		r.IF_SXML_READER__NEXT_NODE(s, 0)
		if *r.Ptr_IF_SXML_READER__NODE_TYPE() == core.IF_SXML_NODE__CO_NT_FINAL {
			break
		}
		nodes++
	}
	expected := 3*((mib*1024*1024)/14) + 2
	if nodes != expected {
		panic(fmt.Sprintf("nodes=%d, want %d", nodes, expected))
	}
	elapsed := time.Since(t).Seconds()
	fmt.Printf("bytes=%d nodes=%d seconds=%.3f MiB/s=%.2f\n", len(xml), nodes, elapsed, float64(len(xml))/(1024*1024)/elapsed)
}

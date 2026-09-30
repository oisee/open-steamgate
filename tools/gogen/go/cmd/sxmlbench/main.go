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
	// Match open-abap-core/test/sxml-heavy.mjs: the X1 Node element feed.
	if len(os.Args) != 2 {
		panic("usage: sxmlbench <1|10> MiB")
	}
	mib, err := strconv.Atoi(os.Args[1])
	if err != nil || (mib != 1 && mib != 10) {
		panic("size must be 1 or 10 MiB")
	}
	var fields strings.Builder
	for i := 0; i < 15; i++ {
		attr := ""
		if i < 12 {
			attr = fmt.Sprintf(" k=\"%d\"", i)
		}
		value := "v"
		if i == 3 {
			value = "A&amp;B"
		}
		fmt.Fprintf(&fields, "<f%d%s>%s</f%d>", i, attr, value, i)
	}
	record := "<record id=\"000000\" status=\"active\">" + fields.String() + "</record>"
	cdataRecord := strings.Replace(record, "<f9>v</f9>", "<f9><![CDATA[x&]]></f9>", 1)
	start, end := "<list xmlns=\"urn:sanctions\">", "</list>"
	records := (mib*1048576 - len(start) - len(end) + len(record) - 1) / len(record)
	xml := start + strings.Repeat(strings.Repeat(record, 499)+cdataRecord, records/500) + strings.Repeat(record, records%500) + end
	s := &abap.Session{}
	t := time.Now()
	r := core.CL_SXML_STRING_READER_CREATE(s, xml)
	tokens, attributes := 0, 0
	for {
		r.IF_SXML_READER__NEXT_NODE(s, 0)
		kind := *r.Ptr_IF_SXML_READER__NODE_TYPE()
		if kind == core.IF_SXML_NODE__CO_NT_FINAL {
			break
		}
		tokens++
		if kind == core.IF_SXML_NODE__CO_NT_ELEMENT_OPEN {
			for {
				r.IF_SXML_READER__NEXT_ATTRIBUTE(s, 0)
				if *r.Ptr_IF_SXML_READER__NODE_TYPE() == core.IF_SXML_NODE__CO_NT_FINAL {
					break
				}
				tokens++
				attributes++
			}
		}
	}
	expected := 61*records + 2
	if tokens != expected || attributes != 14*records {
		panic(fmt.Sprintf("tokens=%d attributes=%d, want %d/%d", tokens, attributes, expected, 14*records))
	}
	elapsed := time.Since(t).Seconds()
	fmt.Printf("bytes=%d recordBytes=%d records=%d tokens=%d attributes=%d seconds=%.3f MiB/s=%.3f tokens/s=%.0f\n", len(xml), len(record), records, tokens, attributes, elapsed, float64(len(xml))/1048576/elapsed, float64(tokens)/elapsed)
}

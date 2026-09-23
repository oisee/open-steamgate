package main

import (
	"fmt"
	"runtime/debug"
	"strings"

	"osg/gogen/abap"
)

// abapLine is the first frame of the stack that is ABAP source
func abapLine() string {
	for _, l := range strings.Split(string(debug.Stack()), "\n") {
		l = strings.TrimSpace(l)
		if i := strings.Index(l, ".abap:"); i > 0 {
			if j := strings.IndexAny(l[i:], " +"); j > 0 {
				l = l[:i+j]
			}
			return l[strings.LastIndex(l, "/")+1:]
		}
	}
	return "?"
}

func main() {
	func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("ZCL_GOGEN_T_BOOM\tERROR %v at %s\n", r, abapLine())
			}
		}()
		fmt.Printf("ZCL_GOGEN_T_BOOM\t%s\n", ZCL_GOGEN_T_BOOM_RUN(&abap.Session{}))
	}()
	func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("ZCL_GOGEN_T_COPY\tERROR %v at %s\n", r, abapLine())
			}
		}()
		fmt.Printf("ZCL_GOGEN_T_COPY\t%s\n", ZCL_GOGEN_T_COPY_RUN(&abap.Session{}))
	}()
}

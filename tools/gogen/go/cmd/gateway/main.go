package main

import (
	"fmt"
	"os"

	"osg/gogen/abap"
)

func main() {
	s := &abap.Session{}
	defer func() {
		if r := recover(); r != nil {
			fmt.Println("DUMP", r)
			os.Exit(1)
		}
	}()
	ZCL_STG_SEGW_REGISTRY_REGISTER(s)
	res := ZCL_STG_DISPATCHER_DISPATCH(s, "GET", "/sap/opu/odata/sap/ZSTG_DEMO_SRV/", nil, "localhost", "", "", "")
	fmt.Printf("%d %s\n%s\n%s\n", res.status, res.reason, res.content_type, res.body)
}

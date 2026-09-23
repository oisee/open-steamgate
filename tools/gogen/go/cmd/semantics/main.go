package main

import (
	"fmt"

	"osg/gogen/abap"
)

func main() {
	func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("ZCL_GOGEN_T_COPY\tERROR %v\n", r)
			}
		}()
		fmt.Printf("ZCL_GOGEN_T_COPY\t%s\n", ZCL_GOGEN_T_COPY_RUN(&abap.Session{}))
	}()
}

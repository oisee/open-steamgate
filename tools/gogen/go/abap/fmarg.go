package abap

func fmArg(args map[string]Data, name string) (Data, bool) {
	d, ok := args[name]
	return d, ok && d.P != nil
}

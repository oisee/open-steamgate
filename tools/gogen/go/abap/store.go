package abap

import "osg/gogen/objstore"

// The object store (CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE') lives in
// go/objstore, a package with no import of go/abap and no Session. What stays
// here is the names the hosts and the generated code use, and the adapter
// from the caller's Data parameters to the store's strings.

type (
	StoreRoot     = objstore.Root
	StoreConfig   = objstore.Config
	StoreRow      = objstore.Row
	StoreIssue    = objstore.Issue
	StoreTally    = objstore.Tally
	StoreAnswer   = objstore.Answer
	StoreRevision = objstore.Revision
)

// StoreCapabilities is objstore.Capabilities: the commands this host does.
var StoreCapabilities = objstore.Capabilities

// SetStore points the host at a tree and the build's facts about it
// (objstore.SetStore; semantics.mjs, cmd/osgo and cmd/storecmp call it here).
func SetStore(root string, config []byte, reason string) error {
	return objstore.SetStore(root, config, reason)
}

// StoreCall answers one call of ZOSD_STORE (objstore.Call).
func StoreCall(in map[string]*string) StoreAnswer { return objstore.Call(in) }

// storeInputs preserves every importing parameter the caller passed.
func storeInputs(args map[string]Data) map[string]*string {
	in := map[string]*string{}
	for _, k := range []string{"IV_COMMAND", "IV_TYPE", "IV_NAME", "IV_INCLUDE", "IV_SOURCE", "IV_FILTER", "IV_LIMIT", "IV_REVISION", "IV_JSON"} {
		if d, ok := fmArg(args, k); ok {
			v := DataString(d)
			in[k] = &v
		}
	}
	return in
}

// ZOSD_STORE adapts DESTINATION 'STORE': inputs in, scalars and tables out.
func ZOSD_STORE(s *Session, args map[string]Data) {
	a := StoreCall(storeInputs(args))
	for k, v := range a.Scalars {
		if d, ok := fmArg(args, k); ok {
			v := v
			MoveData(d, Data{P: &v, T: TString})
		}
	}
	fillRows := func(param string, n int, row func(i int, set func(field string, v any))) {
		tab, ok := fmArg(args, param)
		if !ok {
			return
		}
		if tab.T.Kind != 'h' || tab.T.Append == nil {
			panic(NotCompiled("ZOSD_STORE", param+" is not a standard table"))
		}
		tab.T.Zero(tab.P)
		for i := 0; i < n; i++ {
			line := Data{P: tab.T.Append(tab.P), T: tab.T.Row}
			row(i, func(field string, v any) {
				c, ok := Component(line, field)
				if !ok {
					// a field the caller's structure does not have is not
					// assigned, as the Node destination's fill does it
					return
				}
				switch x := v.(type) {
				case string:
					MoveData(c, Data{P: &x, T: TString})
				case int32:
					MoveData(c, Data{P: &x, T: TI})
				}
			})
		}
	}
	fillRows("ET_REVISION", len(a.Revisions), func(i int, set func(string, any)) {
		r := a.Revisions[i]
		set("REVISION", r.REVISION)
		set("SHORT", r.SHORT)
		set("AUTHOR", r.AUTHOR)
		set("DATE", r.DATE)
		set("TIME", r.TIME)
		set("SUBJECT", r.SUBJECT)
	})
	fillRows("ET_OBJECT", len(a.Objects), func(i int, set func(string, any)) {
		r := a.Objects[i]
		set("TYPE", r.TYPE)
		set("NAME", r.NAME)
		set("PACKAGE", r.PACKAGE)
		set("FILE", r.FILE)
		set("WRITABLE", r.WRITABLE)
		set("VERSION", r.VERSION)
		set("CHANGED_AT", r.CHANGED_AT)
	})
	fillRows("ET_ISSUE", len(a.Issues), func(i int, set func(string, any)) {
		r := a.Issues[i]
		set("OBJ_TYPE", r.OBJ_TYPE)
		set("OBJ_NAME", r.OBJ_NAME)
		set("LINE", r.LINE)
		set("COL", r.COL)
		set("RULE", r.RULE)
		set("MESSAGE", r.MESSAGE)
	})
	fillRows("ET_TYPE", len(a.Types), func(i int, set func(string, any)) {
		set("TYPE", a.Types[i].TYPE)
		set("COUNT", a.Types[i].COUNT)
	})
	fillRows("ET_TOKEN", 0, nil)
}

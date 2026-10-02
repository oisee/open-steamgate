package abap

import "testing"

func TestStoreInputKeys(t *testing.T) {
	args := map[string]Data{}
	keys := []string{"IV_COMMAND", "IV_TYPE", "IV_NAME", "IV_INCLUDE", "IV_SOURCE", "IV_FILTER", "IV_LIMIT", "IV_REVISION", "IV_JSON"}
	for _, key := range keys {
		value := key + " payload"
		args[key] = Data{P: &value, T: TString}
	}
	payload := `{"type_id":"probe"}`
	args["IV_JSON"] = Data{P: &payload, T: TString}
	in := storeInputs(args)
	for _, key := range keys {
		if in[key] == nil || *in[key] != DataString(args[key]) {
			t.Errorf("input %s was dropped or changed", key)
		}
	}
	if *in["IV_JSON"] != payload {
		t.Fatal("IV_JSON type_id payload was changed")
	}
}

// The ADT exception factory's type_id is a named argument too; it must
// survive the same argument lookup as the destination's IV_JSON.
func TestADTTypeIDInputKey(t *testing.T) {
	value := "ExceptionNotSupported"
	args := map[string]Data{"type_id": {P: &value, T: TString}}
	got, ok := fmArg(args, "type_id")
	if !ok || DataString(got) != value {
		t.Fatal("type_id input was dropped or changed")
	}
}

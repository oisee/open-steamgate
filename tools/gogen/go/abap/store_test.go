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

func TestStoreRevisionFullSubject(t *testing.T) {
	// A backend row with the additional field must preserve every byte. In
	// particular SUBJECT_FULL is not the legacy 80-character SUBJECT.
	type revision struct {
		StoreRevision
		SUBJECT_FULL string
	}
	full := "A complete subject longer than the legacy eighty-character field, including unicode: 世界"
	r := revision{StoreRevision: StoreRevision{REVISION: "revision", SUBJECT: "short subject"}, SUBJECT_FULL: full}
	got := map[string]any{}
	storeRevisionRow(r, func(k string, v any) { got[k] = v })
	if got["SUBJECT_FULL"] != full || got["SUBJECT"] != "short subject" || got["REVISION"] != "revision" {
		t.Fatalf("revision mapping: %#v", got)
	}
	// An older backend cannot supply the field. Keep it empty, rather than
	// claiming its already truncated SUBJECT is the full subject.
	got = map[string]any{}
	storeRevisionRow(r.StoreRevision, func(k string, v any) { got[k] = v })
	if got["SUBJECT_FULL"] != "" {
		t.Fatalf("old backend: %#v", got)
	}
}

// A host answers ZOSD_STORE for the calling step first (adt-i5's SYSTEM
// facts are per session); handled=false or no hook keeps the store's answer.
func TestStoreHookSeesTheStep(t *testing.T) {
	defer func() { StoreHook = nil }()
	s := &Session{}
	command, state := "SYSTEM", ""
	args := map[string]Data{"IV_COMMAND": {P: &command, T: TString}, "EV_STATE": {P: &state, T: TString}}
	var seen any
	StoreHook = func(step any, in map[string]*string) (StoreAnswer, bool) {
		seen = step
		if *in["IV_COMMAND"] != "SYSTEM" {
			return StoreAnswer{}, false
		}
		return StoreAnswer{Scalars: map[string]string{"EV_STATE": "from the host"}}, true
	}
	ZOSD_STORE(s, args)
	if seen != any(s) || state != "from the host" {
		t.Fatalf("hook step %v, EV_STATE %q", seen, state)
	}
	// a declined call is the store's answer: an unknown command's EV_ERROR
	command, failure := "PING", ""
	args["EV_ERROR"] = Data{P: &failure, T: TString}
	StoreHook = func(step any, in map[string]*string) (StoreAnswer, bool) { return StoreAnswer{}, false }
	ZOSD_STORE(s, args)
	if want := StoreCall(storeInputs(args)).Scalars["EV_ERROR"]; failure == "" || failure != want {
		t.Fatalf("a declined hook changed the answer: %q, store says %q", failure, want)
	}
}

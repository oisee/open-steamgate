package enqseam

import "testing"

// critic round 2: Node's request() reads the parameter named like the client
// key, and formats a packed value with String(number) ("1.20" -> "1.2")
func TestRequestMatchesNode(t *testing.T) {
	table := Table{Name: "ZT", Key: []Field{{Name: "CLIENT", Kind: 'C', Length: 3}, {Name: "AMOUNT", Kind: 'P', Length: 4}}}
	r := Request(nil, table, "EZT", Args{"CLIENT": "200", "MANDT": "100", "AMOUNT": "1.20"})
	if r.Client != "200" {
		t.Fatalf("client from the key's own parameter: got %q", r.Client)
	}
	if r.Fields[0].Value != "1.2" {
		t.Fatalf("packed key as Node formats it: got %q", r.Fields[0].Value)
	}
	for in, want := range map[string]string{"-1.20": "-1.2", "1.20-": "-1.2", "17.00": "17", "0.00": "0"} {
		if got := Request(nil, table, "EZT", Args{"CLIENT": "200", "AMOUNT": in}).Fields[0].Value; got != want {
			t.Errorf("%s: got %q, want %q", in, got, want)
		}
	}
}

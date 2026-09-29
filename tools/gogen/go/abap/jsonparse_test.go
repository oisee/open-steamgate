package abap

import "testing"

// the answers of Node's JSON.parse (and of the walk of open-abap-core's
// LCL_JSON_PARSER=>TRAVERSE) for the same texts, recorded with node 22
func TestJSNumberString(t *testing.T) {
	for _, c := range [][2]string{
		{"0", "0"},
		{"-0", "0"},
		{"1", "1"},
		{"1.0", "1"},
		{"1.5", "1.5"},
		{"-2.25", "-2.25"},
		{"1e21", "1e+21"},
		{"1e20", "100000000000000000000"},
		{"123456789012345678901", "123456789012345680000"},
		{"0.000001", "0.000001"},
		{"0.0000001", "1e-7"},
		{"1e-7", "1e-7"},
		{"1.5e-10", "1.5e-10"},
		{"5e-324", "5e-324"},
		{"1.7976931348623157e308", "1.7976931348623157e+308"},
		{"1e999", "Infinity"},
		{"-1e999", "-Infinity"},
		{"0.1", "0.1"},
		{"0.30000000000000004", "0.30000000000000004"},
		{"100", "100"},
		{"1E3", "1000"},
		{"2.5e+2", "250"},
		{"12345678.9", "12345678.9"},
		{"9007199254740993", "9007199254740992"},
		{"4.35", "4.35"},
		{"1e-6", "0.000001"},
		{"123e-20", "1.23e-18"},
	} {
		nodes, ok := JSONNodes(c[0])
		if !ok || len(nodes) != 3 || nodes[1].Value != c[1] {
			t.Errorf("%s: got %v, want %s", c[0], nodes, c[1])
		}
	}
}

func TestJSONNodes(t *testing.T) {
	for _, c := range []struct {
		text  string
		nodes []JSONNode
	}{
		{"{\"b\":1,\"a\":2,\"1\":3,\"0\":4,\"10\":5,\"01\":6,\"b\":7}", []JSONNode{{1, "object", "", ""}, {1, "num", "0", ""}, {4, "", "", "4"}, {2, "num", "", ""}, {1, "num", "1", ""}, {4, "", "", "3"}, {2, "num", "", ""}, {1, "num", "10", ""}, {4, "", "", "5"}, {2, "num", "", ""}, {1, "num", "b", ""}, {4, "", "", "7"}, {2, "num", "", ""}, {1, "num", "a", ""}, {4, "", "", "2"}, {2, "num", "", ""}, {1, "num", "01", ""}, {4, "", "", "6"}, {2, "num", "", ""}, {2, "object", "", ""}}},
		{"[1,[2,{}],[]]", []JSONNode{{1, "array", "", ""}, {1, "num", "", ""}, {4, "", "", "1"}, {2, "num", "", ""}, {1, "array", "", ""}, {1, "num", "", ""}, {4, "", "", "2"}, {2, "num", "", ""}, {1, "object", "", ""}, {2, "object", "", ""}, {2, "array", "", ""}, {1, "array", "", ""}, {2, "array", "", ""}, {2, "array", "", ""}}},
		{"{\"x\":\"a\\u00e9\\ud83d\\ude00\\n\",\"y\":null,\"z\":true,\"w\":false}", []JSONNode{{1, "object", "", ""}, {1, "str", "x", ""}, {4, "", "", "aé😀\n"}, {2, "str", "", ""}, {1, "null", "y", ""}, {2, "null", "", ""}, {1, "bool", "z", ""}, {4, "", "", "true"}, {2, "bool", "", ""}, {1, "bool", "w", ""}, {4, "", "", "false"}, {2, "bool", "", ""}, {2, "object", "", ""}}},
		{" {\"4294967294\":1,\"4294967295\":2,\"-1\":3} ", []JSONNode{{1, "object", "", ""}, {1, "num", "4294967294", ""}, {4, "", "", "1"}, {2, "num", "", ""}, {1, "num", "4294967295", ""}, {4, "", "", "2"}, {2, "num", "", ""}, {1, "num", "-1", ""}, {4, "", "", "3"}, {2, "num", "", ""}, {2, "object", "", ""}}},
		{"\"top\"", []JSONNode{{1, "str", "", ""}, {4, "", "", "top"}, {2, "str", "", ""}}},
	} {
		got, ok := JSONNodes(c.text)
		if !ok || len(got) != len(c.nodes) {
			t.Errorf("%s: got %v", c.text, got)
			continue
		}
		for i := range got {
			if got[i] != c.nodes[i] {
				t.Errorf("%s: node %d is %v, want %v", c.text, i, got[i], c.nodes[i])
			}
		}
	}
	for _, c := range []struct {
		text string
		ok   bool
	}{
		{"{\"a\":1,}", false},
		{"[1,]", false},
		{"01", false},
		{"{a:1}", false},
		{"'x'", false},
		{"\"\\x\"", false},
		{"[1] 2", false},
		{"", false},
		{" ", false},
		{"{\"a\" 1}", false},
		{"-", false},
		{"1.", false},
		{".5", false},
		{"\"a\tb\"", false},
		{"tru", false},
		{"NaN", false},
		{"[1,2", false},
		{"\ufeff1", false},
	} {
		if _, ok := JSONNodes(c.text); ok != c.ok {
			t.Errorf("%q: ok %v, want %v", c.text, ok, c.ok)
		}
	}
}

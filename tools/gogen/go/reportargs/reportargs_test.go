package reportargs

import (
	"reflect"
	"strings"
	"testing"
)

var host = []HostFlag{{"db", Required}, {"allow-read", Required}, {"sapgui", Optional}, {"sapgui-no-launch", NoValue}}

var report = Report{Names: []string{"P_ADD", "P_DB", "P_LOUD", "S_TAG"}, Checkboxes: map[string]bool{"P_LOUD": true}}

func parse(t *testing.T, args ...string) Result {
	t.Helper()
	r, err := Parse(args, host, report)
	if err != nil {
		t.Fatalf("%v: %v", args, err)
	}
	return r
}

func refused(t *testing.T, want string, args ...string) {
	t.Helper()
	if _, err := Parse(args, host, report); err == nil || !strings.Contains(err.Error(), want) {
		t.Fatalf("%v: want an error with %q, got %v", args, want, err)
	}
}

// the same name in both namespaces: -db is the host's file, --db the report's P_DB
func TestTwoNamespaces(t *testing.T) {
	r := parse(t, "-db", "x.db", "--db", "report value", "-allow-read=in", "--add=one", "--s-tag", "a", "--p-add", "two", "--loud", "pos")
	if want := []Arg{{"db", "x.db", true}, {"allow-read", "in", true}}; !reflect.DeepEqual(r.Host, want) {
		t.Fatalf("host %v", r.Host)
	}
	want := []Arg{{"P_DB", "report value", true}, {"P_ADD", "one", true}, {"S_TAG", "a", true}, {"P_ADD", "two", true}, {"P_LOUD", "", false}}
	if !reflect.DeepEqual(r.Options, want) {
		t.Fatalf("options %v", r.Options)
	}
	if !reflect.DeepEqual(r.Positionals, []string{"pos"}) || len(r.Warnings) != 0 {
		t.Fatalf("positionals %v warnings %v", r.Positionals, r.Warnings)
	}
}

func TestValuesStartingWithADash(t *testing.T) {
	r := parse(t, "--add", "-5", "--add=-x", "--", "-7", "--add")
	if r.Options[0].Value != "-5" || r.Options[1].Value != "-x" {
		t.Fatalf("options %v", r.Options)
	}
	if !reflect.DeepEqual(r.Positionals, []string{"-7", "--add"}) {
		t.Fatalf("after --, everything is positional: %v", r.Positionals)
	}
	refused(t, "goes after its option, as in --name -5", "-5")
	refused(t, "goes after its option", "-.5")
}

func TestHostFlagValues(t *testing.T) {
	r := parse(t, "-sapgui", "-sapgui=127.0.0.1:3299", "-sapgui-no-launch")
	if r.Host[0].HasValue || r.Host[1].Value != "127.0.0.1:3299" || r.Host[2].Name != "sapgui-no-launch" {
		t.Fatalf("host %v", r.Host)
	}
	refused(t, "-db needs a value", "-db")
	refused(t, "-db needs a non-empty value", "-db=")
	refused(t, "-sapgui-no-launch takes no value", "-sapgui-no-launch=x")
	refused(t, "-sapgui needs a value after =", "-sapgui=")
}

func TestHelpAndUnknowns(t *testing.T) {
	if !parse(t, "-h").Help || !parse(t, "-help").Help {
		t.Fatal("-h and -help are the host's")
	}
	refused(t, "-help shows the usage", "--help")
	refused(t, "unknown flag -verbose; the host's flags are -help -allow-read -db -sapgui -sapgui-no-launch", "-verbose")
	refused(t, "unknown report option --verbose; the report's options are --add --db --loud --s-tag", "--verbose")
	refused(t, "--add needs a value", "--add")
}

// the old spelling of a host flag, for one release, while the report has no option of that name
func TestOldSpellingOfAHostFlag(t *testing.T) {
	r := parse(t, "--allow-read", "in", "--sapgui")
	if len(r.Host) != 2 || r.Host[0].Value != "in" || len(r.Options) != 0 || len(r.Warnings) != 2 {
		t.Fatalf("host %v options %v warnings %v", r.Host, r.Options, r.Warnings)
	}
	if !strings.Contains(r.Warnings[0], "--allow-read is -allow-read now") {
		t.Fatalf("warning %q", r.Warnings[0])
	}
	// P_DB exists, so --db is the report's, with no warning
	if r := parse(t, "--db", "x"); len(r.Host) != 0 || r.Options[0].Name != "P_DB" || len(r.Warnings) != 0 {
		t.Fatalf("host %v options %v", r.Host, r.Options)
	}
}

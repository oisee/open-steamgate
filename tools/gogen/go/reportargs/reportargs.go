// Package reportargs reads the command line of a report run as a command
// (osabap, osd run): two namespaces that never meet. A single dash is the
// host's (-db FILE, -allow-read DIR, -sapgui, -help); a double dash is the
// report's selection screen (--add VALUE, --s-tag V, or the full name
// --p-add). A report with PARAMETERS p_db has its own --db beside the host's
// -db, and the host can add a flag without taking a name from any report
// already built (Alice, 2026-09-30).
//
// Go's flag package cannot be used: it reads -x and --x as the same flag.
package reportargs

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// ValueKind says what a host flag takes.
type ValueKind int

const (
	// NoValue: -sapgui-no-launch
	NoValue ValueKind = iota
	// Required: -db FILE or -db=FILE
	Required
	// Optional: -sapgui or -sapgui=ADDR; a value only after '='
	Optional
)

// HostFlag is one flag of the host, named without its dash.
type HostFlag struct {
	Name  string
	Value ValueKind
}

// HostFlags is the one list of the host's flags: osabap reads it, and osd run
// passes its arguments through to the report binary untouched, so there is
// no second list to drift from this one.
var HostFlags = []HostFlag{
	{Name: "db", Value: Required},
	{Name: "allow-read", Value: Required},
	{Name: "no-default-reads", Value: NoValue},
	{Name: "allow-write", Value: Required},
	{Name: "dataset-home", Value: Required},
	{Name: "dataset-audit", Value: Required},
	{Name: "params", Value: Required},
	{Name: "sapgui", Value: Optional},
	{Name: "sapgui-no-launch", Value: NoValue},
}

// Report is the selection screen as the command line sees it.
type Report struct {
	// Names are the selection names, P_ADD, S_TAG, ...
	Names []string
	// Checkboxes take no value: --loud sets X.
	Checkboxes map[string]bool
}

// Arg is one flag or option as read: Name is the host flag's name, or the
// selection name (P_ADD) of a report option.
type Arg struct {
	Name     string
	Value    string
	HasValue bool
}

// Result is the command line, sorted into its two namespaces.
type Result struct {
	Host        []Arg
	Options     []Arg
	Positionals []string
	Help        bool
	// Warnings are lines for stderr: an old double-dash host flag accepted
	// for one release.
	Warnings []string
}

var negativeNumber = regexp.MustCompile(`^-[0-9.]`)

// Parse reads args. A value that follows a report option is a value even
// when it starts with '-' (--num -5); a bare "--" ends the options and
// everything after it is positional.
func Parse(args []string, host []HostFlag, report Report) (Result, error) {
	var r Result
	hostByName := map[string]HostFlag{}
	for _, f := range host {
		hostByName[f.Name] = f
	}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--":
			r.Positionals = append(r.Positionals, args[i+1:]...)
			return r, nil

		case strings.HasPrefix(arg, "--"):
			key, value, inline := strings.Cut(arg[2:], "=")
			name := report.selection(key)
			if name == "" {
				if flag, ok := hostByName[key]; ok {
					// the old spelling of a host flag, while no report option has the name
					consumed, a, err := hostValue(flag, "--"+key, value, inline, args, i)
					if err != nil {
						return r, err
					}
					i = consumed
					r.Host = append(r.Host, a)
					r.Warnings = append(r.Warnings, fmt.Sprintf("--%s is -%s now: the double-dash spelling is accepted for one release", key, key))
					continue
				}
				if key == "help" {
					return r, fmt.Errorf("--help is not a flag of this command: -help shows the usage")
				}
				return r, fmt.Errorf("unknown report option --%s; the report's options are %s", key, report.optionList())
			}
			a := Arg{Name: name, Value: value, HasValue: inline}
			if !inline && !report.Checkboxes[name] {
				if i+1 >= len(args) {
					return r, fmt.Errorf("--%s needs a value", key)
				}
				i++
				a.Value, a.HasValue = args[i], true
			}
			r.Options = append(r.Options, a)

		case arg == "-" || !strings.HasPrefix(arg, "-"):
			r.Positionals = append(r.Positionals, arg)

		case negativeNumber.MatchString(arg):
			return r, fmt.Errorf("%s: a value starting with '-' goes after its option, as in --name %s", arg, arg)

		default:
			key, value, inline := strings.Cut(arg[1:], "=")
			if key == "h" || key == "help" {
				r.Help = true
				continue
			}
			flag, ok := hostByName[key]
			if !ok {
				return r, fmt.Errorf("unknown flag -%s; the host's flags are %s (report options take two dashes)", key, hostList(host))
			}
			consumed, a, err := hostValue(flag, "-"+key, value, inline, args, i)
			if err != nil {
				return r, err
			}
			i = consumed
			r.Host = append(r.Host, a)
		}
	}
	return r, nil
}

func hostValue(flag HostFlag, spelled, value string, inline bool, args []string, i int) (int, Arg, error) {
	a := Arg{Name: flag.Name, Value: value, HasValue: inline}
	switch flag.Value {
	case NoValue:
		if inline {
			return i, a, fmt.Errorf("%s takes no value", spelled)
		}
	case Required:
		if !inline {
			if i+1 >= len(args) {
				return i, a, fmt.Errorf("%s needs a value", spelled)
			}
			i++
			a.Value, a.HasValue = args[i], true
		}
		if a.Value == "" {
			return i, a, fmt.Errorf("%s needs a non-empty value", spelled)
		}
	case Optional:
		if inline && value == "" {
			return i, a, fmt.Errorf("%s needs a value after =", spelled)
		}
	}
	return i, a, nil
}

// selection finds the selection name an option spells: the short name of a
// parameter (--add for P_ADD) or the full name of any field (--p-add, --s-tag)
func (r Report) selection(option string) string {
	want := strings.ToUpper(strings.ReplaceAll(option, "-", "_"))
	for _, name := range r.Names {
		if want == name || want == strings.TrimPrefix(name, "P_") {
			return name
		}
	}
	return ""
}

func (r Report) optionList() string {
	if len(r.Names) == 0 {
		return "none"
	}
	out := make([]string, 0, len(r.Names))
	for _, name := range r.Names {
		out = append(out, "--"+strings.ToLower(strings.ReplaceAll(strings.TrimPrefix(name, "P_"), "_", "-")))
	}
	return strings.Join(out, " ")
}

func hostList(host []HostFlag) string {
	out := []string{"-help"}
	for _, f := range host {
		out = append(out, "-"+f.Name)
	}
	sort.Strings(out[1:])
	return strings.Join(out, " ")
}

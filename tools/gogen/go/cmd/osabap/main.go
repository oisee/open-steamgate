// osabap runs one converted ABAP report as a native command. Arguments fill
// the report selection screen; with no arguments, a terminal form presents
// the same screen before the report lifecycle continues. --sapgui presents it
// to a real SAP GUI over DIAG instead.
package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"osg/gogen/abap"
	"osg/gogen/termgui"
)

func hostRun(s *abap.Session, report ZIF_GG_REPORT_V1, input []ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE, batch, present string) ZCL_GG_HOST__TY_RESULT {
	empty := []ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE(nil)
	return ZCL_GG_HOST_RUN(s, report, nil, appProgram, "1000", "", 0, batch,
		&input, &empty, &empty, "ONLI", "", "", "", "", 0, 1, "", "", "", 0,
		"", "", "", "", "", present, "", &ZIF_GG_HOST_HTML_V1__TY_NAVIGATION{}, &ZIF_GG_SESSION_TYPES_V1__TY_SUBMIT{})
}

func main() {
	var result ZCL_GG_HOST__TY_RESULT
	failed := false
	cancelled := false
	func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Fprintln(os.Stderr, "osabap:", withoutDB(r))
				failed = true
			}
		}()
		s := &abap.Session{}
		report := newReport(s)
		sapGUI, launchSAPGUI, listen, args := sapGUIOption(os.Args[1:])
		args = datasetOptions(args)
		args = dbOption(args)
		input, headless := commandInput(args)
		if sapGUI {
			var screen ZCL_GG_HOST__TY_RESULT
			abap.DialogStep(func() { screen = hostRun(s, report, input, "", "X") })
			if err := serveSAPGUI(listen, launchSAPGUI, screen, func(values []ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE) ZCL_GG_HOST__TY_RESULT {
				var out ZCL_GG_HOST__TY_RESULT
				abap.DialogStep(func() { out = hostRun(s, report, values, "", "") })
				return out
			}); err != nil {
				panic(err)
			}
			cancelled = true // the result lived in SAP GUI, not on stdout
			return
		}
		if headless {
			abap.DialogStep(func() { result = hostRun(s, report, input, "X", "") })
		} else {
			var screen ZCL_GG_HOST__TY_RESULT
			abap.DialogStep(func() { screen = hostRun(s, report, nil, "", "X") })
			if termgui.Available() {
				var err error
				input, err = graphicalInput(screen)
				if errors.Is(err, termgui.ErrCancelled) {
					cancelled = true
					return
				}
				if err != nil {
					panic(err)
				}
			} else {
				input = terminalInput(screen)
			}
			abap.DialogStep(func() { result = hostRun(s, report, input, "", "") })
		}
	}()
	// the --db file is whole only once it is closed: it is opened in WAL mode,
	// and until the last connection closes, the rows live in <file>-wal
	closeDB()
	if cancelled {
		return
	}
	if failed {
		os.Exit(1)
	}
	for _, m := range result.messages {
		fmt.Fprintln(os.Stderr, strings.TrimSpace(m.text))
	}
	for _, line := range result.lines {
		fmt.Println(strings.TrimRight(line, " "))
	}
	if result.unsupported != "" {
		fmt.Fprintln(os.Stderr, "unsupported:", result.unsupported)
		os.Exit(2)
	}
}

// datasetOptions consumes host flags before selection-screen flags are parsed.
// Install a fresh sandbox even when the parent process carries dataset env vars.
func datasetOptions(args []string) []string {
	var read, write []string
	var home, audit string
	var rest []string
	for i := 0; i < len(args); i++ {
		key, value, inline := strings.Cut(args[i], "=")
		switch key {
		case "--allow-read", "--allow-write", "--dataset-home", "--dataset-audit":
			if !inline {
				i++
				if i >= len(args) {
					panic(fmt.Errorf("%s needs a value", key))
				}
				value = args[i]
			}
			if value == "" {
				panic(fmt.Errorf("%s needs a non-empty value", key))
			}
			switch key {
			case "--allow-read":
				if strings.ContainsRune(value, filepath.ListSeparator) {
					panic(fmt.Errorf("%s accepts one directory per flag", key))
				}
				read = append(read, value)
			case "--allow-write":
				if strings.ContainsRune(value, filepath.ListSeparator) {
					panic(fmt.Errorf("%s accepts one directory per flag", key))
				}
				write = append(write, value)
			case "--dataset-home":
				home = value
			case "--dataset-audit":
				audit = value
			}
		default:
			rest = append(rest, args[i])
		}
	}
	// SandboxFromEnv owns audit creation and root normalization. These values
	// replace inherited grants, so an unflagged command remains denied.
	for key, value := range map[string]string{
		"OSD_DATASET_READ":  strings.Join(read, string(filepath.ListSeparator)),
		"OSD_DATASET_WRITE": strings.Join(write, string(filepath.ListSeparator)),
		"OSD_DATASET_HOME":  home,
		"OSD_DATASET_AUDIT": audit,
	} {
		if err := os.Setenv(key, value); err != nil {
			panic(err)
		}
	}
	abap.SetDatasetHost(abap.SandboxFromEnv())
	return rest
}

func graphicalInput(screen ZCL_GG_HOST__TY_RESULT) ([]ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE, error) {
	current := map[string]selectionInput{}
	for _, v := range screen.values {
		current[strings.TrimSpace(v.name)] = selectionInput{value: strings.TrimSpace(v.value), ranges: v.ranges}
	}
	form := termgui.Form{Title: appProgram + " — selection screen"}
	for _, e := range screen.elements {
		name := strings.TrimSpace(e.name)
		if name == "" || (e.kind != "PARAMETER" && e.kind != "CHECKBOX" && e.kind != "SELECT_OPTION") {
			continue
		}
		input := current[name]
		field := termgui.Field{Name: name, Label: strings.TrimSpace(e.text), Value: input.value, Width: int(e.visible_length)}
		switch e.kind {
		case "CHECKBOX":
			field.Kind = termgui.Checkbox
		case "SELECT_OPTION":
			field.Kind = termgui.Ranges
			parts := make([]string, 0, len(input.ranges))
			for _, r := range input.ranges {
				parts = append(parts, strings.TrimSpace(r.low))
			}
			field.Value = strings.Join(parts, ",")
		default:
			field.Kind = termgui.Text
		}
		form.Fields = append(form.Fields, field)
	}
	fields, err := termgui.Run(form)
	if err != nil {
		return nil, err
	}
	for _, field := range fields {
		if field.Kind == termgui.Ranges {
			input := current[field.Name]
			input.ranges = nil
			if strings.TrimSpace(field.Value) != "" {
				for _, value := range strings.Split(field.Value, ",") {
					input.ranges = append(input.ranges, ZIF_GG_SELECTION_SCREEN_TYPES__TY_RANGE{sign: "I", option: "EQ", low: strings.TrimSpace(value)})
				}
			}
			current[field.Name] = input
		} else {
			current[field.Name] = selectionInput{value: field.Value}
		}
	}
	return selectionValues(current), nil
}

func commandInput(args []string) ([]ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE, bool) {
	values := map[string]selectionInput{}
	positionals := []string{}
	params := ""
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--help" || arg == "-h" {
			usage()
			closeDB()
			os.Exit(0)
		}
		if arg == "--params" {
			if i+1 >= len(args) {
				panic(fmt.Errorf("--params needs JSON or @file"))
			}
			i++
			params = args[i]
			continue
		}
		if strings.HasPrefix(arg, "--params=") {
			params = strings.TrimPrefix(arg, "--params=")
			continue
		}
		if strings.HasPrefix(arg, "--") {
			key, value, hasValue := strings.Cut(strings.TrimPrefix(arg, "--"), "=")
			name, checkbox := selectionName(key)
			if name == "" {
				panic(fmt.Errorf("unknown option --%s", key))
			}
			if !hasValue && checkbox {
				value = "X"
			} else if !hasValue {
				if i+1 >= len(args) {
					panic(fmt.Errorf("--%s needs a value", key))
				}
				i++
				value = args[i]
			}
			setOption(values, name, value)
			continue
		}
		positionals = append(positionals, arg)
	}
	if params != "" {
		raw := []byte(params)
		if strings.HasPrefix(params, "@") {
			var err error
			raw, err = os.ReadFile(strings.TrimPrefix(params, "@"))
			if err != nil {
				panic(err)
			}
		}
		fromJSON := map[string]any{}
		if err := json.Unmarshal(raw, &fromJSON); err != nil {
			panic(fmt.Errorf("--params: %w", err))
		}
		for key, rawValue := range fromJSON {
			name, checkbox := selectionName(key)
			if name == "" {
				panic(fmt.Errorf("--params: unknown selection field %s", key))
			}
			if appRanges[name] {
				if _, setByFlag := values[name]; !setByFlag {
					values[name] = selectionInput{ranges: jsonRanges(name, rawValue)}
				}
				continue
			}
			value := fmt.Sprint(rawValue)
			if checkbox {
				if b, ok := rawValue.(bool); ok {
					if b {
						value = "X"
					} else {
						value = ""
					}
				}
			}
			if _, setByFlag := values[name]; !setByFlag {
				values[name] = selectionInput{value: value}
			}
		}
	}
	for i, arg := range positionals {
		if i >= len(appPositionals) {
			panic(fmt.Errorf("unexpected positional argument %q", arg))
		}
		values[appPositionals[i]] = selectionInput{value: arg}
	}
	return selectionValues(values), len(args) > 0
}

func selectionName(option string) (string, bool) {
	want := strings.ToUpper(strings.ReplaceAll(option, "-", "_"))
	for _, name := range appSelectionNames {
		short := strings.TrimPrefix(name, "P_")
		if want == name || want == short {
			return name, appCheckboxes[name]
		}
	}
	return "", false
}

type selectionInput struct {
	value  string
	ranges []ZIF_GG_SELECTION_SCREEN_TYPES__TY_RANGE
}

func setOption(values map[string]selectionInput, name, value string) {
	if appRanges[name] {
		input := values[name]
		input.ranges = append(input.ranges, ZIF_GG_SELECTION_SCREEN_TYPES__TY_RANGE{sign: "I", option: "EQ", low: value})
		values[name] = input
		return
	}
	values[name] = selectionInput{value: value}
}

func jsonRanges(name string, raw any) []ZIF_GG_SELECTION_SCREEN_TYPES__TY_RANGE {
	items, ok := raw.([]any)
	if !ok {
		items = []any{raw}
	}
	out := make([]ZIF_GG_SELECTION_SCREEN_TYPES__TY_RANGE, 0, len(items))
	for _, item := range items {
		r := ZIF_GG_SELECTION_SCREEN_TYPES__TY_RANGE{sign: "I", option: "EQ"}
		if object, ok := item.(map[string]any); ok {
			fields := map[string]string{}
			for key, value := range object {
				fields[strings.ToUpper(key)] = fmt.Sprint(value)
			}
			r.sign = strings.ToUpper(fields["SIGN"])
			if r.sign == "" {
				r.sign = "I"
			}
			r.option = strings.ToUpper(fields["OPTION"])
			r.low, r.high = fields["LOW"], fields["HIGH"]
			if r.option == "" {
				if r.high != "" {
					r.option = "BT"
				} else {
					r.option = "EQ"
				}
			}
		} else {
			r.low = fmt.Sprint(item)
		}
		if r.low == "" && r.option != "EQ" {
			panic(fmt.Errorf("--params: %s range needs low", name))
		}
		out = append(out, r)
	}
	return out
}

func usage() {
	fmt.Printf("usage: %s", strings.ToLower(appProgram))
	for _, name := range appPositionals {
		fmt.Printf(" <%s>", strings.ToLower(strings.TrimPrefix(name, "P_")))
	}
	fmt.Println(" [options]")
	fmt.Println("  --sapgui[=ADDR]   launch SAP GUI and serve it the selection screen (default 127.0.0.1:3232)")
	fmt.Println("  --sapgui-no-launch serve SAP GUI without launching a local client")
	fmt.Println("  --allow-read DIR  allow DATASET reads within DIR (repeatable)")
	fmt.Println("  --allow-write DIR allow DATASET writes within DIR (repeatable; also readable)")
	fmt.Println("  --dataset-home DIR base for relative DATASET names")
	fmt.Println("  --dataset-audit FILE append OPEN/DELETE decisions inside a write root")
	if len(appTables) > 0 {
		fmt.Printf("  --db FILE         keep the rows of %s in the SQLite FILE (created when missing)\n", strings.Join(appTables, ", "))
	}
	for _, name := range appSelectionNames {
		opt := strings.ToLower(strings.ReplaceAll(strings.TrimPrefix(name, "P_"), "_", "-"))
		if appRanges[name] {
			fmt.Printf("  --%-16s %s range (repeatable)\n", opt, name)
		} else if appCheckboxes[name] {
			fmt.Printf("  --%-16s %s checkbox\n", opt, name)
		} else {
			fmt.Printf("  --%-16s %s value\n", opt, name)
		}
	}
	fmt.Println("  --params JSON|@file")
}

func selectionValues(values map[string]selectionInput) []ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE {
	out := make([]ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE, 0, len(values))
	for _, name := range appSelectionNames {
		if input, ok := values[name]; ok {
			out = append(out, ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE{name: name, value: input.value, ranges: input.ranges})
		}
	}
	return out
}

func terminalInput(screen ZCL_GG_HOST__TY_RESULT) []ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE {
	current := map[string]selectionInput{}
	for _, v := range screen.values {
		current[strings.TrimSpace(v.name)] = selectionInput{value: strings.TrimSpace(v.value), ranges: v.ranges}
	}
	fmt.Printf("\n%s — selection screen\n\n", appProgram)
	in := bufio.NewReader(os.Stdin)
	for _, e := range screen.elements {
		name := strings.TrimSpace(e.name)
		if name == "" || (e.kind != "PARAMETER" && e.kind != "CHECKBOX" && e.kind != "SELECT_OPTION") {
			continue
		}
		input := current[name]
		def := input.value
		if appRanges[name] {
			parts := make([]string, 0, len(input.ranges))
			for _, r := range input.ranges {
				parts = append(parts, strings.TrimSpace(r.low))
			}
			def = strings.Join(parts, ",")
		}
		fmt.Printf("%-18s [%s]: ", strings.TrimSpace(e.text), def)
		line, _ := in.ReadString('\n')
		line = strings.TrimSpace(line)
		if line != "" {
			if appRanges[name] {
				input.ranges = nil
				for _, value := range strings.Split(line, ",") {
					input.ranges = append(input.ranges, ZIF_GG_SELECTION_SCREEN_TYPES__TY_RANGE{sign: "I", option: "EQ", low: strings.TrimSpace(value)})
				}
				current[name] = input
				continue
			}
			if e.kind == "CHECKBOX" {
				if strings.EqualFold(line, "y") || strings.EqualFold(line, "yes") || line == "1" || strings.EqualFold(line, "true") {
					line = "X"
				} else {
					line = ""
				}
			}
			current[name] = selectionInput{value: line}
		}
	}
	fmt.Println()
	return selectionValues(current)
}

// dbOption takes --db FILE: the SQLite file a report with tables of its own
// keeps its rows in, created with the report's tables when it is missing
// (abap.OpenDBFile, which refuses a file another build laid out). A report
// with no tables has no database and refuses the flag; one with tables and
// no --db has no database either, and its first statement says so.
func dbOption(args []string) []string {
	var rest []string
	path := ""
	for i := 0; i < len(args); i++ {
		key, value, inline := strings.Cut(args[i], "=")
		if key != "--db" {
			rest = append(rest, args[i])
			continue
		}
		if !inline {
			i++
			if i >= len(args) {
				panic(fmt.Errorf("--db needs a file"))
			}
			value = args[i]
		}
		if value == "" {
			panic(fmt.Errorf("--db needs a non-empty file name"))
		}
		path = value
	}
	if path == "" {
		return rest
	}
	if len(appTables) == 0 {
		panic(fmt.Errorf("--db: %s has no tables of its own", appProgram))
	}
	// the path goes into a file: URI, where these would be read as its syntax
	// (a '?' would cut the name short and create another file)
	if strings.ContainsAny(path, "?#%") {
		panic(fmt.Errorf("--db %s: a file name with ?, # or %% is not accepted", path))
	}
	if _, err := abap.OpenDBFile(path, appSchema); err != nil {
		panic(fmt.Errorf("--db %s: %w", path, err))
	}
	dbOpen = true
	return rest
}

var dbOpen bool

// closeDB checkpoints the --db file: the last connection closing folds the
// WAL back into it, so the file alone holds every row
func closeDB() {
	if dbOpen {
		dbOpen = false
		if err := abap.DB().Close(); err != nil {
			fmt.Fprintln(os.Stderr, "osabap: closing the --db file:", err)
		}
	}
}

// withoutDB names the way out when a report with tables ran without --db:
// the runtime only knows that no database was opened
func withoutDB(r any) any {
	if len(appTables) > 0 && strings.Contains(fmt.Sprint(r), "the host did not open a database") {
		return fmt.Sprintf("%s keeps its rows in tables (%s): run it with --db FILE", strings.ToLower(appProgram), strings.Join(appTables, ", "))
	}
	return r
}

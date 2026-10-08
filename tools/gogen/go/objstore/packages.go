package objstore

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type storePackage struct {
	Name        string
	Parent      string
	Description string
	Library     bool
	Objects     int
	Subpackages []string
	objects     []*storeEntry
	devc        *storeEntry
}

type storePackageJSON struct {
	Name        string   `json:"name"`
	Parent      *string  `json:"parent,omitempty"`
	Description string   `json:"description,omitempty"`
	Library     bool     `json:"library"`
	Subpackages []string `json:"subpackages"`
}

type storeSubpackageJSON struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type storeObjectJSON struct {
	Type    string `json:"type"`
	Name    string `json:"name"`
	Library bool   `json:"library"`
	Version string `json:"version"`
}

type storePackageAnswerJSON struct {
	Found       bool                  `json:"found"`
	Name        string                `json:"name"`
	Parent      *string               `json:"parent,omitempty"`
	Description string                `json:"description,omitempty"`
	Library     bool                  `json:"library"`
	Subpackages []storeSubpackageJSON `json:"subpackages"`
	Objects     []storeObjectJSON     `json:"objects"`
}

type storeObjectAnswerJSON struct {
	Found     bool      `json:"found"`
	Type      string    `json:"type,omitempty"`
	Name      string    `json:"name,omitempty"`
	Writable  *bool     `json:"writable,omitempty"`
	Package   string    `json:"package,omitempty"`
	Packages  []string  `json:"packages,omitempty"`
	ChangedAt string    `json:"changedAt,omitempty"`
	Version   string    `json:"version,omitempty"`
	ChangedBy string    `json:"changedBy,omitempty"`
	Includes  *[]string `json:"includes,omitempty"`
}

var storeCText = regexp.MustCompile(`<CTEXT>([^<]*)</CTEXT>`)

func storeLocalPackages() map[string]bool {
	out := map[string]bool{}
	for _, name := range strings.Split(os.Getenv("OSD_LOCAL_PACKAGES"), ",") {
		if name = strings.TrimSpace(strings.ToUpper(name)); name != "" {
			out[name] = true
		}
	}
	return out
}

func storePackages(ix *storeIndex) []*storePackage {
	by := map[string]*storePackage{}
	ensure := func(name, parent string) *storePackage {
		if p := by[name]; p != nil {
			return p
		}
		p := &storePackage{Name: name, Parent: parent, Subpackages: []string{}, Library: true}
		by[name] = p
		return p
	}
	for _, key := range ix.keys {
		e := ix.by[key]
		for i, name := range e.Packages {
			parent := ""
			if i > 0 {
				parent = e.Packages[i-1]
			}
			p := ensure(name, parent)
			if !e.Library {
				p.Library = false
			}
			if i > 0 {
				if pp := by[e.Packages[i-1]]; pp != nil && !contains(pp.Subpackages, name) {
					pp.Subpackages = append(pp.Subpackages, name)
				}
			}
		}
		if e.Type == "DEVC" && e.Name != e.Package {
			p := ensure(e.Name, e.Package)
			if !e.Library {
				p.Library = false
			}
			if pp := by[e.Package]; pp != nil && !contains(pp.Subpackages, e.Name) {
				pp.Subpackages = append(pp.Subpackages, e.Name)
			}
			p.devc = e
		}
		if e.Type == "DEVC" && e.Name == e.Package {
			if p := by[e.Name]; p != nil {
				p.devc = e
			}
			continue
		}
		if p := by[e.Package]; p != nil {
			p.Objects++
			p.objects = append(p.objects, e)
		}
	}
	out := make([]*storePackage, 0, len(by))
	for _, p := range by {
		sort.Slice(p.Subpackages, func(i, j int) bool { return collateLess(p.Subpackages[i], p.Subpackages[j]) })
		if p.devc != nil {
			p.Description = storePackageText(p.devc)
		} else if p.Name == "$TMP" {
			p.Description = "Temporary Objects (never transported!)"
		}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return collateLess(out[i].Name, out[j].Name) })
	return out
}

func storePackageText(e *storeEntry) string {
	b, err := os.ReadFile(filepath.Join(storeState.root, e.File))
	if err != nil {
		return ""
	}
	match := storeCText.FindStringSubmatch(string(b))
	if match == nil {
		return ""
	}
	return match[1]
}

func storePackageRows(ix *storeIndex, name, mode, user string) (string, error) {
	packages := storePackages(ix)
	if name == "" {
		p := &storePackage{Name: "", Description: "the packages of this system"}
		for _, child := range packages {
			if child.Parent == "" {
				p.Subpackages = append(p.Subpackages, child.Name)
			}
		}
		value := storePackageAnswerJSON{Found: true, Name: p.Name, Description: p.Description,
			Subpackages: storeSubanswers(packages, p.Subpackages), Objects: []storeObjectJSON{}}
		return storeJSON(value)
	}
	var p *storePackage
	for _, candidate := range packages {
		if candidate.Name == name {
			p = candidate
			break
		}
	}
	if p == nil {
		return "", storeNotFound("DEVC", name)
	}
	if mode == "local" {
		p = storeLocalView(ix, packages, p, user)
	}
	objects := make([]storeObjectJSON, 0, len(p.objects))
	for _, e := range p.objects {
		if e.Type == "DEVC" && e.Name == name {
			continue
		}
		version, _ := storeStateOf(e, e.File)
		objects = append(objects, storeObjectJSON{Type: e.Type, Name: e.Name, Library: e.Library, Version: version})
	}
	sort.Slice(objects, func(i, j int) bool {
		return collateLess(objects[i].Type+objects[i].Name, objects[j].Type+objects[j].Name)
	})
	var parent *string
	if p.Parent != "" {
		parent = &p.Parent
	}
	value := storePackageAnswerJSON{Found: true, Name: p.Name, Parent: parent, Description: p.Description,
		Library: p.Library, Subpackages: storeSubanswers(packages, p.Subpackages), Objects: objects}
	return storeJSON(value)
}

func storeSubanswers(packages []*storePackage, names []string) []storeSubpackageJSON {
	out := make([]storeSubpackageJSON, 0, len(names))
	for _, name := range names {
		description := ""
		for _, p := range packages {
			if p.Name == name {
				description = p.Description
				break
			}
		}
		out = append(out, storeSubpackageJSON{Name: name, Description: description})
	}
	return out
}

func storeLocalView(ix *storeIndex, packages []*storePackage, p *storePackage, user string) *storePackage {
	under := false
	for at := p; at != nil; {
		if at.Name == "$TMP" {
			under = true
			break
		}
		if at.Parent == "" {
			break
		}
		at = storeFindPackage(packages, at.Parent)
	}
	if !under {
		return p
	}
	out := *p
	out.objects = nil
	for _, e := range p.objects {
		if user != "" && e.ChangedBy == user {
			out.objects = append(out.objects, e)
		}
	}
	out.Subpackages = nil
	for _, child := range p.Subpackages {
		if e := ix.find("DEVC", child); e != nil && user != "" && e.ChangedBy == user {
			out.Subpackages = append(out.Subpackages, child)
		}
	}
	if p.Name == "$TMP" {
		allowed := storeLocalPackages()
		for _, root := range packages {
			if root.Parent == "" && root.Name != "$TMP" && (len(allowed) == 0 || allowed[root.Name]) && (len(allowed) > 0 || !root.Library) {
				if !contains(out.Subpackages, root.Name) {
					out.Subpackages = append(out.Subpackages, root.Name)
				}
			}
		}
		sort.Slice(out.Subpackages, func(i, j int) bool { return collateLess(out.Subpackages[i], out.Subpackages[j]) })
	}
	if out.Description == "" {
		out.Description = "Local objects"
	}
	return &out
}

func storeFindPackage(packages []*storePackage, name string) *storePackage {
	for _, p := range packages {
		if p.Name == name {
			return p
		}
	}
	return nil
}

func storeObject(ix *storeIndex, typ, name string) (string, error) {
	e := ix.find(typ, name)
	if e == nil {
		return storeJSON(storeObjectAnswerJSON{Found: false})
	}
	version, changed := storeStateOf(e, e.File)
	value := storeObjectAnswerJSON{Found: true, Type: e.Type, Name: e.Name, Writable: &e.Writable,
		Package: e.Package, Packages: e.Packages, Version: version, ChangedAt: changed, ChangedBy: e.ChangedBy}
	includes := []string{}
	value.Includes = &includes
	if e.Type == "CLAS" {
		includes := storeClassIncludes(e)
		value.Includes = &includes
	}
	return storeJSON(value)
}

func storeClassIncludes(e *storeEntry) []string {
	out := []string{}
	for _, inc := range storeIncludes {
		if inc.Name == "main" {
			continue
		}
		if _, err := os.Stat(filepath.Join(storeState.root, strings.TrimSuffix(e.File, ".clas.abap")+inc.Suffix)); err == nil {
			out = append(out, inc.Name)
		}
	}
	return out
}

func storeSearch(ix *storeIndex, seed, typ string, limit int) []*storeEntry {
	out := []*storeEntry{}
	needle := strings.ToUpper(seed)
	for _, key := range ix.keys {
		e := ix.by[key]
		if typ != "" && e.Type != typ {
			continue
		}
		if strings.Contains(e.Name, needle) {
			out = append(out, e)
			if limit >= 0 && len(out) >= limit {
				break
			}
		}
	}
	return out
}

func storeJSON(v any) (string, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func storeJSONRefusal(message, code string) string {
	value, _ := json.Marshal(map[string]any{"error": map[string]string{"code": code, "message": message}})
	return string(value)
}

func contains(values []string, wanted string) bool {
	for _, v := range values {
		if v == wanted {
			return true
		}
	}
	return false
}

type storePackagesJSONRow struct {
	Name        string   `json:"name"`
	Parent      *string  `json:"parent,omitempty"`
	Description string   `json:"description,omitempty"`
	Library     bool     `json:"library"`
	Subpackages []string `json:"subpackages"`
}

func storePackagesJSON(ix *storeIndex) string {
	all := storePackages(ix)
	rows := make([]storePackagesJSONRow, 0, len(all))
	for _, p := range all {
		var parent *string
		if p.Parent != "" {
			parent = &p.Parent
		}
		rows = append(rows, storePackagesJSONRow{Name: p.Name, Parent: parent,
			Description: p.Description, Library: p.Library, Subpackages: p.Subpackages})
	}
	value, _ := json.Marshal(rows)
	return string(value)
}

func storeLineField(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "\t", "\\t")
	return strings.ReplaceAll(value, "\n", "\\n")
}

func storePackagesLines(ix *storeIndex, format string) string {
	records := []string{}
	add := func(fields ...string) {
		values := make([]string, len(fields))
		for i, field := range fields {
			values[i] = storeLineField(field)
		}
		records = append(records, strings.Join(values, "\t"))
	}
	for _, p := range storePackages(ix) {
		root := ""
		if p.Parent == "" {
			root = "X"
		}
		library := ""
		if p.Library {
			library = "X"
		}
		add("P", p.Name, p.Parent, p.Description, library, root)
		if format == "vfs-lines" {
			for _, child := range p.Subpackages {
				add("C", p.Name, child)
			}
			for _, e := range p.objects {
				if e.Type == "DEVC" && e.Name == p.Name {
					continue
				}
				description := e.Name
				if e.Type == "DEVC" {
					description = e.Name
				}
				library := ""
				if e.Library {
					library = "X"
				}
				add("O", p.Name, e.Type, e.Name, description, library)
			}
		}
	}
	return strings.Join(records, "\n")
}

type storeSearchJSONRow struct {
	Type    string `json:"type"`
	Name    string `json:"name"`
	Library bool   `json:"library"`
}

func storeSearchJSON(rows []*storeEntry) string {
	value := make([]storeSearchJSONRow, 0, len(rows))
	for _, e := range rows {
		value = append(value, storeSearchJSONRow{Type: e.Type, Name: e.Name, Library: e.Library})
	}
	b, _ := json.Marshal(value)
	return string(b)
}

func storeSearchLines(rows []*storeEntry) string {
	records := make([]string, 0, len(rows))
	for _, e := range rows {
		library := ""
		if e.Library {
			library = "X"
		}
		records = append(records, storeLineField(e.Type)+"\t"+storeLineField(e.Name)+"\t"+library)
	}
	return strings.Join(records, "\n")
}

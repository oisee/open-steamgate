// Package filepick presents a small terminal file and directory browser.
package filepick

import (
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strings"

	"github.com/gdamore/tcell/v2"
	"osg/gogen/abap"
)

var ErrCancel = errors.New("file dialog cancelled")

type Mode uint8

const (
	Open Mode = iota
	Save
	Directory
)

type Browser struct {
	Sandbox          *abap.Sandbox
	Mode             Mode
	Initial          string
	DefaultName      string
	Title            string
	Patterns         []string
	Extension        string
	ConfirmOverwrite bool
	Multi            bool
	afterList        func()
}

type entry struct {
	name string
	dir  bool
}

// SAPPatterns reads alternating description and wildcard fields. Several
// patterns in one field are separated by semicolons.
func SAPPatterns(filter string) []string {
	parts := strings.Split(filter, "|")
	patterns := []string{}
	for i := 1; i < len(parts); i += 2 {
		for _, pattern := range strings.Split(parts[i], ";") {
			pattern = strings.TrimSpace(pattern)
			if pattern == "*.*" || pattern == "*" {
				return nil
			}
			if pattern != "" {
				patterns = append(patterns, pattern)
			}
		}
	}
	return patterns
}

func (b Browser) roots() []string { return b.Sandbox.BrowseRoots(b.Mode == Save) }

func (b Browser) entries(dir, filter string) ([]entry, error) {
	_, f, err := b.Sandbox.BrowsePath(dir, b.Mode == Save)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	infos, err := f.Readdir(-1)
	if err != nil && err != io.EOF {
		return nil, err
	}
	out := []entry{}
	for _, info := range infos {
		if !info.IsDir() && len(b.Patterns) > 0 {
			matched := false
			for _, pattern := range b.Patterns {
				if ok, _ := filepath.Match(strings.ToLower(pattern), strings.ToLower(info.Name())); ok {
					matched = true
					break
				}
			}
			if !matched {
				continue
			}
		}
		if filter != "" && !strings.Contains(strings.ToLower(info.Name()), strings.ToLower(filter)) {
			continue
		}
		path := filepath.Join(dir, info.Name())
		_, candidate, err := b.Sandbox.BrowsePath(path, b.Mode == Save)
		if err != nil {
			continue
		} // includes symlinks escaping the sandbox
		stat, err := candidate.Stat()
		candidate.Close()
		if err != nil {
			continue
		}
		if b.Mode == Directory && !stat.IsDir() {
			continue
		}
		out = append(out, entry{info.Name(), stat.IsDir()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].name < out[j].name })
	return out, nil
}

// selected reopens the entry through os.Root after the user has chosen it.
// Listing alone cannot authorize a path because the directory may change.
func (b Browser) selected(dir string, item entry) (string, bool) {
	path := filepath.Join(dir, item.name)
	checked, file, err := b.Sandbox.BrowsePath(path, b.Mode == Save)
	if err != nil {
		return "", false
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.IsDir() != item.dir {
		return "", false
	}
	return checked, true
}

func (b Browser) saveName(dir, name string) (string, bool) {
	if name == "" || name != filepath.Base(name) {
		return "", false
	}
	if b.Extension != "" && filepath.Ext(name) == "" {
		name += "." + strings.TrimPrefix(b.Extension, ".")
	}
	path, err := b.Sandbox.BrowseSaveName(filepath.Join(dir, name))
	return path, err == nil
}

func (b Browser) openName(dir, name string) (string, bool) {
	if name == "" || name != filepath.Base(name) {
		return "", false
	}
	if b.Extension != "" && filepath.Ext(name) == "" {
		name += "." + strings.TrimPrefix(b.Extension, ".")
	}
	path, file, err := b.Sandbox.BrowsePath(filepath.Join(dir, name), false)
	if err != nil {
		return "", false
	}
	defer file.Close()
	info, err := file.Stat()
	return path, err == nil && !info.IsDir()
}

func (b Browser) confirmSave(screen tcell.Screen, path string) (bool, error) {
	if !b.ConfirmOverwrite {
		return true, nil
	}
	exists, err := b.Sandbox.BrowseSaveExists(path)
	if err != nil {
		return false, nil
	}
	if !exists {
		return true, nil
	}
	_, h := screen.Size()
	for x, r := range []rune("Overwrite existing file? y/n") {
		screen.SetContent(x, h-1, r, nil, tcell.StyleDefault.Reverse(true))
	}
	screen.Show()
	for {
		key, ok := screen.PollEvent().(*tcell.EventKey)
		if !ok {
			continue
		}
		if key.Rune() == 'y' || key.Rune() == 'Y' {
			return true, nil
		}
		if key.Key() == tcell.KeyEscape {
			return false, ErrCancel
		}
		if key.Rune() == 'n' || key.Rune() == 'N' {
			return false, nil
		}
	}
}

func (b Browser) initial() (string, error) {
	roots := b.roots()
	if len(roots) == 0 {
		if b.Mode == Save {
			return "", errors.New("no -allow-write root")
		}
		return "", errors.New("no -allow-read root")
	}
	if b.Initial != "" {
		if _, f, err := b.Sandbox.BrowsePath(b.Initial, b.Mode == Save); err == nil {
			defer f.Close()
			if stat, err := f.Stat(); err == nil && stat.IsDir() {
				return b.Initial, nil
			}
		}
	}
	return roots[0], nil
}

func (b Browser) Run(screen tcell.Screen) (string, error) {
	dir, err := b.initial()
	if err != nil {
		return "", err
	}
	filter, name := "", b.DefaultName
	selected, scroll, editing, editingFilter := 0, 0, false, false
	atRoots := false
	marked := map[string]entry{}
	for {
		var entries []entry
		if atRoots {
			for _, root := range b.roots() {
				entries = append(entries, entry{name: root, dir: true})
			}
		} else {
			entries, err = b.entries(dir, filter)
			if err != nil {
				return "", err
			}
		}
		if b.afterList != nil {
			b.afterList()
		}
		if selected >= len(entries) {
			selected = max(0, len(entries)-1)
		}
		_, height := screen.Size()
		scroll = visibleStart(selected, scroll, len(entries), height)
		caption := dir
		if atRoots {
			caption = "Granted roots"
		}
		b.draw(screen, caption, entries, selected, scroll, filter, name, editing, editingFilter)
		ev, ok := screen.PollEvent().(*tcell.EventKey)
		if !ok {
			continue
		}
		if editing {
			switch ev.Key() {
			case tcell.KeyEscape:
				editing = false
			case tcell.KeyBackspace, tcell.KeyBackspace2:
				if editingFilter {
					if len([]rune(filter)) > 0 {
						filter = string([]rune(filter)[:len([]rune(filter))-1])
					}
				} else if len([]rune(name)) > 0 {
					name = string([]rune(name)[:len([]rune(name))-1])
				}
			case tcell.KeyEnter:
				if !editingFilter {
					if b.Mode == Open {
						if path, ok := b.openName(dir, name); ok {
							return path, nil
						}
					} else if b.Mode == Save {
						if path, ok := b.saveName(dir, name); ok {
							confirmed, err := b.confirmSave(screen, path)
							if err != nil {
								return "", err
							}
							if confirmed {
								if checked, valid := b.saveName(dir, name); valid {
									return checked, nil
								}
							}
						}
					}
				}
				editing = false
			case tcell.KeyRune:
				if editingFilter {
					filter += string(ev.Rune())
				} else {
					name += string(ev.Rune())
				}
			}
			continue
		}
		switch ev.Key() {
		case tcell.KeyEscape, tcell.KeyCtrlC:
			return "", ErrCancel
		case tcell.KeyUp:
			selected = max(0, selected-1)
		case tcell.KeyDown:
			selected = min(max(0, len(entries)-1), selected+1)
		case tcell.KeyPgUp:
			selected = max(0, selected-max(1, height-4))
		case tcell.KeyPgDn:
			selected = min(max(0, len(entries)-1), selected+max(1, height-4))
		case tcell.KeyHome:
			selected = 0
		case tcell.KeyEnd:
			selected = max(0, len(entries)-1)
		case tcell.KeyBackspace, tcell.KeyBackspace2:
			if !atRoots {
				parent := filepath.Dir(dir)
				if _, f, err := b.Sandbox.BrowsePath(parent, b.Mode == Save); err == nil {
					f.Close()
					dir = parent
				} else if len(b.roots()) > 1 {
					atRoots = true
					filter = ""
					marked = map[string]entry{}
				}
				selected = 0
			}
		case tcell.KeyEnter:
			if atRoots {
				if len(entries) > 0 {
					candidate := entries[selected].name
					if _, f, err := b.Sandbox.BrowsePath(candidate, b.Mode == Save); err == nil {
						if info, err := f.Stat(); err == nil && info.IsDir() {
							dir, atRoots, selected = candidate, false, 0
						}
						f.Close()
					}
				}
				continue
			}
			if b.Multi && len(marked) > 0 {
				paths := []string{}
				for _, item := range entries {
					if _, ok := marked[item.name]; !ok {
						continue
					}
					if path, valid := b.selected(dir, item); valid && !item.dir {
						paths = append(paths, path)
					}
				}
				if len(paths) > 0 {
					return strings.Join(paths, "\x00"), nil
				}
				marked = map[string]entry{}
				continue
			}
			if len(entries) > 0 {
				item := entries[selected]
				path, valid := b.selected(dir, item)
				if !valid {
					continue
				}
				if item.dir {
					dir = path
					marked = map[string]entry{}
					selected = 0
					filter = ""
				} else if b.Mode != Directory {
					if b.Mode != Save {
						return path, nil
					} else {
						confirmed, err := b.confirmSave(screen, path)
						if err != nil {
							return "", err
						}
						if confirmed {
							if checked, valid := b.saveName(dir, item.name); valid {
								return checked, nil
							}
						}
					}
				}
			} else if b.Mode == Save && name != "" {
				if path, ok := b.saveName(dir, name); ok {
					confirmed, err := b.confirmSave(screen, path)
					if err != nil {
						return "", err
					}
					if confirmed {
						if checked, valid := b.saveName(dir, name); valid {
							return checked, nil
						}
					}
				}
			}
		case tcell.KeyRune:
			if atRoots {
				continue
			}
			switch ev.Rune() {
			case '/':
				filter = ""
				editing = true
				editingFilter = true
			case 'n':
				if b.Mode == Save || b.Mode == Open {
					editing = true
					editingFilter = false
					name = b.DefaultName
				}
			case ' ':
				if b.Mode == Directory {
					checked, file, err := b.Sandbox.BrowsePath(dir, false)
					if err != nil {
						continue
					}
					info, err := file.Stat()
					file.Close()
					if err != nil || !info.IsDir() {
						continue
					}
					return checked, nil
				} else if b.Multi && len(entries) > 0 && !entries[selected].dir {
					item := entries[selected]
					if _, ok := marked[item.name]; ok {
						delete(marked, item.name)
					} else {
						marked[item.name] = item
					}
				}
			default:
				if filter != "" {
					filter += string(ev.Rune())
				}
			}
		}
	}
}

// Rows 0 and 1 are the title and directory, row 2 is a spacer, and the
// final row is the footer. Keep the selection inside the remaining viewport.
func visibleStart(selected, scroll, count, height int) int {
	page := max(1, height-4)
	scroll = min(max(0, scroll), max(0, count-page))
	if selected < scroll {
		return selected
	}
	if selected >= scroll+page {
		return selected - page + 1
	}
	return scroll
}

func (b Browser) draw(screen tcell.Screen, dir string, entries []entry, selected, scroll int, filter, name string, editing, editingFilter bool) {
	w, h := screen.Size()
	screen.Clear()
	put := func(y int, s string, style tcell.Style) {
		if y < 0 || y >= h {
			return
		}
		for x, r := range []rune(s) {
			if x >= w {
				break
			}
			screen.SetContent(x, y, r, nil, style)
		}
	}
	title := b.Title
	if title == "" {
		title = "Choose a file"
	}
	put(0, title, tcell.StyleDefault.Reverse(true))
	put(1, dir, tcell.StyleDefault)
	for i := scroll; i < len(entries) && i < scroll+max(0, h-4); i++ {
		e := entries[i]
		marker := "  "
		if e.dir {
			marker = "/ "
		}
		style := tcell.StyleDefault
		if i == selected {
			style = style.Reverse(true)
		}
		put(i-scroll+3, marker+e.name, style)
	}
	footer := "↑/↓ select  PgUp/PgDn Home/End  Enter open  Backspace up  / filter  Esc cancel"
	if b.Mode == Directory {
		footer += "  Space choose folder"
	}
	if b.Mode == Save || b.Mode == Open {
		footer += "  n name"
		if name != "" {
			footer += fmt.Sprintf(" [%s]", name)
		}
	}
	if editing {
		if editingFilter {
			footer = "Filter: " + filter + "  Enter done  Esc dismiss"
		} else {
			footer = "Name: " + name + "  Enter save  Esc dismiss"
		}
	}
	put(h-1, footer, tcell.StyleDefault.Reverse(true))
	screen.Show()
}

func Run(b Browser) (string, error) {
	screen, err := tcell.NewScreen()
	if err != nil {
		return "", err
	}
	if err := screen.Init(); err != nil {
		return "", err
	}
	defer screen.Fini()
	return b.Run(screen)
}

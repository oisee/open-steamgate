// Package filepick presents a small terminal file and directory browser.
package filepick

import (
	"errors"
	"fmt"
	"io"
	"path/filepath"
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
	Sandbox     *abap.Sandbox
	Mode        Mode
	Initial     string
	DefaultName string
	Title       string
}

type entry struct {
	name string
	dir  bool
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
	return out, nil
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
	selected, editing, editingFilter := 0, false, false
	for {
		entries, err := b.entries(dir, filter)
		if err != nil {
			return "", err
		}
		if selected >= len(entries) {
			selected = max(0, len(entries)-1)
		}
		b.draw(screen, dir, entries, selected, filter, name, editing, editingFilter)
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
				if !editingFilter && b.Mode == Save && name != "" && name == filepath.Base(name) {
					path, err := b.Sandbox.BrowseSaveName(filepath.Join(dir, name))
					if err == nil {
						return path, nil
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
		case tcell.KeyBackspace, tcell.KeyBackspace2:
			parent := filepath.Dir(dir)
			if _, f, err := b.Sandbox.BrowsePath(parent, b.Mode == Save); err == nil {
				f.Close()
				dir = parent
				selected = 0
			}
		case tcell.KeyEnter:
			if len(entries) > 0 {
				item := entries[selected]
				path := filepath.Join(dir, item.name)
				if item.dir {
					dir = path
					selected = 0
					filter = ""
				} else if b.Mode != Directory {
					return path, nil
				}
			} else if b.Mode == Save && name != "" {
				if path, err := b.Sandbox.BrowseSaveName(filepath.Join(dir, name)); err == nil {
					return path, nil
				}
			}
		case tcell.KeyRune:
			switch ev.Rune() {
			case '/':
				filter = ""
				editing = true
				editingFilter = true
			case 'n':
				if b.Mode == Save {
					editing = true
					editingFilter = false
					name = b.DefaultName
				}
			case ' ':
				if b.Mode == Directory {
					return dir, nil
				}
			default:
				if filter != "" {
					filter += string(ev.Rune())
				}
			}
		}
	}
}

func (b Browser) draw(screen tcell.Screen, dir string, entries []entry, selected int, filter, name string, editing, editingFilter bool) {
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
	for i, e := range entries {
		marker := "  "
		if e.dir {
			marker = "/ "
		}
		style := tcell.StyleDefault
		if i == selected {
			style = style.Reverse(true)
		}
		put(i+3, marker+e.name, style)
	}
	footer := "↑/↓ select  Enter open  Backspace up  / filter  Esc cancel"
	if b.Mode == Directory {
		footer += "  Space choose folder"
	}
	if b.Mode == Save {
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

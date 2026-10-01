// Package termgui is the terminal front end shared by native ABAP commands.
// Its interaction model follows sap-tui: values are edited locally, Tab moves
// the focus, Space toggles a checkbox, and Enter sends the whole screen.
package termgui

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"unicode/utf8"

	"github.com/gdamore/tcell/v2"
	"golang.org/x/term"
)

type Kind uint8

const (
	Text Kind = iota
	Checkbox
	Ranges
)

type Field struct {
	Name     string
	Label    string
	Kind     Kind
	Value    string
	Width    int
	Required bool
	Secret   bool
	// Locked: shown but not ready for input, as SAP GUI shows the other
	// fields after an error in AT SELECTION-SCREEN ON <field>
	Locked bool
}

type Form struct {
	Title  string
	Fields []Field
	OnF4   func(screen tcell.Screen, field string, fields []Field) (string, error)
	// Message: the status line the form opens with (a selection-screen
	// error or warning); Focus: the field the cursor starts in
	Message string
	Focus   string
}

var ErrCancelled = errors.New("terminal form cancelled")

// Available reports whether stdin and stdout are a real terminal. Piped input
// deliberately stays on the line-oriented fallback, which also makes scripts
// and tests deterministic.
func Available() bool {
	return term.IsTerminal(int(os.Stdin.Fd())) && term.IsTerminal(int(os.Stdout.Fd()))
}

func Run(form Form) ([]Field, error) {
	screen, err := tcell.NewScreen()
	if err != nil {
		return nil, err
	}
	if err := screen.Init(); err != nil {
		return nil, err
	}
	defer screen.Fini()
	screen.EnableMouse()
	return run(screen, form)
}

// RunOnScreen drives a form on a caller-owned screen (used by terminal hosts
// and deterministic keyboard tests).
func RunOnScreen(screen tcell.Screen, form Form) ([]Field, error) { return run(screen, form) }

type model struct {
	form  Form
	focus int
	caret int
	left  int
	done  bool
	err   error
}

func newModel(form Form) *model {
	for i := range form.Fields {
		if form.Fields[i].Width <= 0 {
			form.Fields[i].Width = 30
		}
	}
	m := &model{form: form}
	for i, f := range form.Fields {
		if form.Focus != "" && f.Name == form.Focus {
			m.focus = i
		}
	}
	if f := m.current(); f != nil && f.Locked {
		m.move(1)
	}
	m.end()
	return m
}

func (m *model) current() *Field {
	if len(m.form.Fields) == 0 {
		return nil
	}
	return &m.form.Fields[m.focus]
}

func (m *model) move(delta int) {
	if len(m.form.Fields) == 0 {
		return
	}
	for range m.form.Fields {
		m.focus = (m.focus + delta + len(m.form.Fields)) % len(m.form.Fields)
		if !m.form.Fields[m.focus].Locked {
			break
		}
	}
	m.end()
}

func (m *model) end() {
	f := m.current()
	if f == nil || f.Kind == Checkbox {
		m.caret, m.left = 0, 0
		return
	}
	m.caret = utf8.RuneCountInString(f.Value)
	m.keepCaretVisible()
}

func (m *model) keepCaretVisible() {
	f := m.current()
	if f == nil {
		return
	}
	w := max(1, f.Width)
	if m.caret < m.left {
		m.left = m.caret
	}
	if m.caret >= m.left+w {
		m.left = m.caret - w + 1
	}
}

func (m *model) handle(ev *tcell.EventKey) {
	if ev.Key() == tcell.KeyCtrlC || ev.Key() == tcell.KeyEscape {
		m.done, m.err = true, ErrCancelled
		return
	}
	switch ev.Key() {
	case tcell.KeyEnter:
		for _, f := range m.form.Fields {
			if f.Required && strings.TrimSpace(f.Value) == "" {
				m.err = fmt.Errorf("%s is required", f.Name)
				return
			}
		}
		m.done, m.err = true, nil
		return
	case tcell.KeyTab, tcell.KeyDown:
		m.move(1)
		return
	case tcell.KeyBacktab, tcell.KeyUp:
		m.move(-1)
		return
	}
	f := m.current()
	if f == nil || f.Locked {
		return
	}
	if f.Kind == Checkbox {
		if ev.Key() == tcell.KeyRune && ev.Rune() == ' ' {
			if f.Value == "X" {
				f.Value = ""
			} else {
				f.Value = "X"
			}
		}
		return
	}
	runes := []rune(f.Value)
	switch ev.Key() {
	case tcell.KeyLeft:
		m.caret = max(0, m.caret-1)
	case tcell.KeyRight:
		m.caret = min(len(runes), m.caret+1)
	case tcell.KeyHome:
		m.caret = 0
	case tcell.KeyEnd:
		m.caret = len(runes)
	case tcell.KeyBackspace, tcell.KeyBackspace2:
		if m.caret > 0 {
			runes = append(runes[:m.caret-1], runes[m.caret:]...)
			m.caret--
			f.Value = string(runes)
		}
	case tcell.KeyDelete:
		if m.caret < len(runes) {
			runes = append(runes[:m.caret], runes[m.caret+1:]...)
			f.Value = string(runes)
		}
	case tcell.KeyRune:
		r := ev.Rune()
		runes = append(runes, 0)
		copy(runes[m.caret+1:], runes[m.caret:])
		runes[m.caret] = r
		m.caret++
		f.Value = string(runes)
	}
	m.keepCaretVisible()
}

func run(screen tcell.Screen, form Form) ([]Field, error) {
	m := newModel(form)
	for !m.done {
		draw(screen, m)
		switch ev := screen.PollEvent().(type) {
		case *tcell.EventKey:
			if ev.Key() == tcell.KeyF4 && m.current() != nil && !m.current().Locked {
				f := m.current()
				if form.OnF4 == nil {
					m.err = fmt.Errorf("no F4 value request for %s", f.Name)
					continue
				}
				value, err := form.OnF4(screen, f.Name, m.form.Fields)
				if err != nil {
					m.err = err
				} else {
					f.Value = value
					m.err = nil
					m.end()
				}
			} else {
				m.handle(ev)
			}
		case *tcell.EventResize:
			screen.Sync()
		case *tcell.EventMouse:
			_, y := ev.Position()
			if ev.Buttons()&tcell.Button1 != 0 && y >= 3 && y < 3+len(m.form.Fields) && !m.form.Fields[y-3].Locked {
				m.focus = y - 3
				m.end()
			}
		}
	}
	return m.form.Fields, m.err
}

func put(screen tcell.Screen, x, y int, style tcell.Style, value string) {
	for _, r := range value {
		screen.SetContent(x, y, r, nil, style)
		x++
	}
}

func draw(screen tcell.Screen, m *model) {
	w, h := screen.Size()
	screen.Clear()
	title := " " + m.form.Title + " "
	put(screen, 0, 0, tcell.StyleDefault.Reverse(true).Bold(true), title+strings.Repeat(" ", max(0, w-len([]rune(title)))))
	labelWidth := 0
	for _, f := range m.form.Fields {
		labelWidth = max(labelWidth, len([]rune(f.Label)))
	}
	labelWidth = min(labelWidth, max(10, w/3))
	valueX := min(w-1, labelWidth+3)
	for i, f := range m.form.Fields {
		y := i + 3
		if y >= h-2 {
			break
		}
		label := f.Label
		if f.Required {
			label += " *"
		}
		put(screen, 1, y, tcell.StyleDefault, label)
		style := tcell.StyleDefault
		if i == m.focus {
			style = style.Reverse(true)
		} else if f.Locked {
			style = style.Dim(true)
		}
		if f.Kind == Checkbox {
			mark := " "
			if f.Value == "X" {
				mark = "X"
			}
			put(screen, valueX, y, style, "["+mark+"]")
			continue
		}
		width := min(f.Width, max(1, w-valueX-2))
		runes := []rune(f.Value)
		left := 0
		if i == m.focus {
			left = m.left
		}
		visible := runes[min(left, len(runes)):]
		if len(visible) > width {
			visible = visible[:width]
		}
		value := string(visible)
		if f.Secret {
			value = strings.Repeat("*", len(visible))
		}
		put(screen, valueX, y, style, value+strings.Repeat(" ", width-len([]rune(value))))
		if f.Kind == Ranges && valueX+width+1 < w {
			put(screen, valueX+width+1, y, tcell.StyleDefault.Dim(true), "comma-separated")
		}
	}
	footer := " Tab/↑/↓ focus   F4 value help   Space toggle   Enter execute   Esc cancel "
	if m.err != nil && !errors.Is(m.err, ErrCancelled) {
		footer = " " + m.err.Error() + " "
	} else if m.form.Message != "" {
		footer = " " + m.form.Message + " "
	}
	if h > 0 {
		put(screen, 0, h-1, tcell.StyleDefault.Reverse(true), footer+strings.Repeat(" ", max(0, w-len([]rune(footer)))))
	}
	f := m.current()
	if f != nil && f.Kind != Checkbox {
		x := valueX + m.caret - m.left
		y := m.focus + 3
		if x >= 0 && x < w && y >= 0 && y < h {
			screen.ShowCursor(x, y)
		}
	} else {
		screen.HideCursor()
	}
	screen.Show()
}

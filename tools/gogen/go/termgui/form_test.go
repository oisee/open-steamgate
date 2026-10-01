package termgui

import (
	"errors"
	"testing"

	"github.com/gdamore/tcell/v2"
)

func key(k tcell.Key) *tcell.EventKey { return tcell.NewEventKey(k, 0, tcell.ModNone) }
func runeKey(r rune) *tcell.EventKey  { return tcell.NewEventKey(tcell.KeyRune, r, tcell.ModNone) }

func TestModelEditsAndSubmitsTheWholeForm(t *testing.T) {
	m := newModel(Form{Fields: []Field{
		{Name: "P_NAME", Kind: Text, Value: "Al"},
		{Name: "P_LOUD", Kind: Checkbox},
		{Name: "S_TAG", Kind: Ranges},
	}})
	m.handle(runeKey('i'))
	m.handle(key(tcell.KeyTab))
	m.handle(runeKey(' '))
	m.handle(key(tcell.KeyTab))
	for _, r := range "one,two" {
		m.handle(runeKey(r))
	}
	m.handle(key(tcell.KeyEnter))

	if !m.done || m.err != nil {
		t.Fatalf("done=%v err=%v", m.done, m.err)
	}
	if got := m.form.Fields; got[0].Value != "Ali" || got[1].Value != "X" || got[2].Value != "one,two" {
		t.Fatalf("fields = %#v", got)
	}
}

func TestModelCancel(t *testing.T) {
	m := newModel(Form{Fields: []Field{{Name: "P", Kind: Text}}})
	m.handle(key(tcell.KeyEscape))
	if !m.done || !errors.Is(m.err, ErrCancelled) {
		t.Fatalf("done=%v err=%v", m.done, m.err)
	}
}

func TestDrawOnSimulationScreen(t *testing.T) {
	screen := tcell.NewSimulationScreen("UTF-8")
	if err := screen.Init(); err != nil {
		t.Fatal(err)
	}
	defer screen.Fini()
	screen.SetSize(80, 12)
	draw(screen, newModel(Form{Title: "ZHELLO — selection screen", Fields: []Field{
		{Label: "Name", Kind: Text, Value: "world", Width: 20},
		{Label: "Loud", Kind: Checkbox, Value: "X"},
	}}))
	cells, width, _ := screen.GetContents()
	at := func(x, y int) rune { return cells[y*width+x].Runes[0] }
	if at(1, 3) != 'N' || at(7, 3) != 'w' || at(7, 4) != '[' {
		t.Fatalf("form was not placed at expected cells")
	}
}

// After an error in AT SELECTION-SCREEN ON P_B the form opens on P_B with the
// message in the status line, and the other fields take no input.
func TestModelLockedFieldsAndMessage(t *testing.T) {
	m := newModel(Form{Message: "E: B is wrong", Focus: "P_B", Fields: []Field{
		{Name: "P_A", Kind: Text, Value: "a", Locked: true},
		{Name: "P_B", Kind: Text, Value: "b"},
		{Name: "P_C", Kind: Checkbox, Locked: true},
	}})
	if m.current().Name != "P_B" {
		t.Fatalf("focus %s", m.current().Name)
	}
	m.handle(key(tcell.KeyTab))
	if m.current().Name != "P_B" {
		t.Fatalf("tab left the only open field for %s", m.current().Name)
	}
	m.handle(runeKey('x'))
	m.handle(key(tcell.KeyEnter))
	if got := m.form.Fields; got[0].Value != "a" || got[1].Value != "bx" || got[2].Value != "" {
		t.Fatalf("fields = %#v", got)
	}

	screen := tcell.NewSimulationScreen("UTF-8")
	if err := screen.Init(); err != nil {
		t.Fatal(err)
	}
	defer screen.Fini()
	screen.SetSize(40, 8)
	draw(screen, newModel(Form{Message: "E: B is wrong", Fields: []Field{{Name: "P", Kind: Text}}}))
	cells, width, _ := screen.GetContents()
	line := ""
	for x := 0; x < width; x++ {
		line += string(cells[7*width+x].Runes[0])
	}
	if line[1:14] != "E: B is wrong" {
		t.Fatalf("status line %q", line)
	}
}

// A locked field the focus would open on is skipped.
func TestModelFocusSkipsLocked(t *testing.T) {
	m := newModel(Form{Fields: []Field{{Name: "P_A", Locked: true}, {Name: "P_B"}}})
	if m.current().Name != "P_B" {
		t.Fatalf("focus %s", m.current().Name)
	}
}

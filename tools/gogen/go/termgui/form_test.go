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

package main

import (
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"time"

	"github.com/oisee/open-diag-go/pkg/diag"
	"github.com/oisee/open-diag-go/pkg/frame"

	"osg/gogen/reportargs"
)

const defaultSAPGUIListen = "127.0.0.1:3232"

const (
	maxSAPGUIFrames  = 64
	maxSAPGUISession = 5 * time.Minute
)

type sapGUIField struct {
	name     string
	kind     string
	row, col int
	initial  selectionInput
}

// sapGUIOption reads the frontend switch from the host flags. -sapgui=ADDR is useful when
// instance 32 is already occupied; the port's low two digits are the SAP
// instance number.
func sapGUIOption(host []reportargs.Arg) (bool, bool, string) {
	enabled, launch, listen := false, true, defaultSAPGUIListen
	for _, flag := range host {
		switch flag.Name {
		case "sapgui":
			enabled = true
			if flag.HasValue {
				listen = flag.Value
			}
		case "sapgui-no-launch":
			enabled = true
			launch = false
		}
	}
	return enabled, launch, listen
}

func serveSAPGUI(listen string, launch bool, selection ZCL_GG_HOST__TY_RESULT, execute func([]ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE) ZCL_GG_HOST__TY_RESULT) error {
	ln, err := net.Listen("tcp", listen)
	if err != nil {
		return fmt.Errorf("SAP GUI listen %s: %w", listen, err)
	}
	defer ln.Close()
	host, port, _ := net.SplitHostPort(ln.Addr().String())
	if host == "" {
		host = "127.0.0.1"
	}
	instance := 0
	if len(port) >= 2 {
		fmt.Sscanf(port[len(port)-2:], "%d", &instance)
	}
	fmt.Printf("OS/ABAP %s waiting for SAP GUI\n", appProgram)
	fmt.Printf("Application Server: %s\nInstance Number:    %02d\nSystem ID:          OSG\n", host, instance)
	if launch {
		clientHost := host
		if clientHost == "0.0.0.0" || clientHost == "::" {
			clientHost = "127.0.0.1"
		}
		if err := startSAPGUI(clientHost, port, instance); err != nil {
			return fmt.Errorf("launching SAP GUI: %w (use -sapgui-no-launch for a remote or manual client)", err)
		}
		fmt.Println("SAP GUI launched")
	}

	conn, err := ln.Accept()
	if err != nil {
		return fmt.Errorf("SAP GUI accept: %w", err)
	}
	defer conn.Close()
	fmt.Fprintf(os.Stderr, "SAP GUI connected from %s\n", conn.RemoteAddr())
	return runSAPGUISession(conn, selection, execute)
}

func runSAPGUISession(conn net.Conn, selection ZCL_GG_HOST__TY_RESULT, execute func([]ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE) ZCL_GG_HOST__TY_RESULT) error {
	if err := conn.SetDeadline(time.Now().Add(maxSAPGUISession)); err != nil {
		return err
	}
	screen, fields := sapGUISelectionScreen(selection)
	shown, resultShown := false, false
	for frames := 0; frames < maxSAPGUIFrames; frames++ {
		payload, err := readNIFrame(conn)
		if err != nil {
			if err == io.EOF || err == io.ErrUnexpectedEOF {
				return nil
			}
			if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
				return endSAPGUISession(conn)
			}
			return err
		}
		if name, ok := diag.NIControl(payload); ok {
			if name == "NI_PING" {
				if err := writeNIFrame(conn, []byte("NI_PONG\x00")); err != nil {
					return err
				}
			}
			continue
		}
		if !shown {
			shown = true
			if message, parseErr := diag.ParseMessage(payload, len(payload) > diag.DPHeaderLen); parseErr != nil {
				fmt.Fprintf(os.Stderr, "SAP GUI initial frame: %d bytes, parse warning: %v\n", len(payload), parseErr)
			} else {
				fmt.Fprintf(os.Stderr, "SAP GUI initial frame: %d bytes, %d DIAG items\n", len(payload), len(diag.ParseItems(message.Body)))
			}
			if err := sendSAPGUIScreen(conn, screen, nil); err != nil {
				return err
			}
			fmt.Fprintln(os.Stderr, "SAP GUI selection screen sent")
			continue
		}

		message, err := diag.ParseMessage(payload, false)
		if err != nil {
			return fmt.Errorf("SAP GUI PAI: %w", err)
		}
		items := diag.ParseItems(message.Body)
		if sapGUIExit(items) || resultShown {
			return endSAPGUISession(conn)
		}
		values := sapGUISelectionValues(items, fields)
		result := execute(values)
		resultShown = true
		if err := sendSAPGUIScreen(conn, sapGUIResultScreen(result), result.messages); err != nil {
			return err
		}
		fmt.Fprintln(os.Stderr, "SAP GUI report result sent")
	}
	return endSAPGUISession(conn)
}

func sapGUISelectionScreen(result ZCL_GG_HOST__TY_RESULT) (*frame.Screen, []sapGUIField) {
	current := map[string]selectionInput{}
	for _, value := range result.values {
		current[strings.TrimSpace(value.name)] = selectionInput{value: strings.TrimSpace(value.value), ranges: value.ranges}
	}
	screen := frame.New(27, 120).
		Text(0, 2, appProgram+" - selection screen").
		Text(24, 2, "F8 or Execute runs the report; Back closes the program")
	fields := []sapGUIField{}
	row := 2
	for _, element := range result.elements {
		name := strings.TrimSpace(element.name)
		if name == "" || row >= 23 {
			continue
		}
		kind := strings.TrimSpace(element.kind)
		if kind != "PARAMETER" && kind != "CHECKBOX" && kind != "SELECT_OPTION" {
			continue
		}
		input := current[name]
		label := strings.TrimSpace(element.text)
		if label == "" {
			label = name
		}
		field := sapGUIField{name: name, kind: kind, row: row, col: 34, initial: input}
		switch kind {
		case "CHECKBOX":
			field.col = 2
			screen.Checkbox(row, field.col, name, label, strings.EqualFold(strings.TrimSpace(input.value), "X"))
		case "SELECT_OPTION":
			parts := make([]string, 0, len(input.ranges))
			for _, r := range input.ranges {
				parts = append(parts, strings.TrimSpace(r.low))
			}
			screen.Text(row, 2, label).Input(row, field.col, 50, name, strings.Join(parts, ",")).Text(row, 86, "comma-separated")
		default:
			width := int(element.visible_length)
			if width < 1 {
				width = 30
			}
			if width > 50 {
				width = 50
			}
			screen.Text(row, 2, label).Input(row, field.col, width, name, input.value)
		}
		fields = append(fields, field)
		row++
	}
	screen.Button(22, 2, 16, "Execute (F8)", "ONLI")
	return screen, fields
}

func sapGUISelectionValues(items []diag.Item, fields []sapGUIField) []ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE {
	byCell := map[[2]int]string{}
	checks := map[[2]int]bool{}
	for _, item := range items {
		if (item.Type != diag.ItemAPPL && item.Type != diag.ItemAPPL4) || item.ID != 0x09 || item.SID != 0x02 {
			continue
		}
		atoms, _ := diag.ParseDyntAtoms(item.Value)
		for _, atom := range atoms {
			cell := [2]int{atom.Row, atom.Col}
			switch atom.EType {
			case diag.AtomInputField, diag.AtomOutputField:
				byCell[cell] = atom.Value()
			case diag.AtomCheckbox:
				checks[cell] = atom.State == 'X'
			}
		}
	}
	values := map[string]selectionInput{}
	for _, field := range fields {
		cell := [2]int{field.row, field.col}
		input := field.initial
		switch field.kind {
		case "CHECKBOX":
			if on, ok := checks[cell]; ok {
				if on {
					input.value = "X"
				} else {
					input.value = ""
				}
			}
		case "SELECT_OPTION":
			if value, ok := byCell[cell]; ok {
				input.ranges = nil
				for _, low := range strings.Split(value, ",") {
					if low = strings.TrimSpace(low); low != "" {
						input.ranges = append(input.ranges, ZIF_GG_SELECTION_SCREEN_TYPES__TY_RANGE{sign: "I", option: "EQ", low: low})
					}
				}
			}
		default:
			if value, ok := byCell[cell]; ok {
				input.value = value
			}
		}
		values[field.name] = input
	}
	return selectionValues(values)
}

func sapGUIResultScreen(result ZCL_GG_HOST__TY_RESULT) *frame.Screen {
	lines := []string{appProgram + " - result", strings.Repeat("-", 80)}
	for _, message := range result.messages {
		if text := strings.TrimSpace(message.text); text != "" {
			lines = append(lines, text)
		}
	}
	for _, line := range result.lines {
		lines = append(lines, strings.TrimRight(line, " "))
	}
	if result.unsupported != "" {
		lines = append(lines, "Unsupported: "+strings.TrimSpace(result.unsupported))
	}
	if len(lines) > 24 {
		lines = append(lines[:23], fmt.Sprintf("... %d more lines", len(lines)-23))
	}
	return frame.New(27, 120).Lines(0, lines).Text(25, 2, "Back or close the window to exit")
}

func sendSAPGUIScreen(conn net.Conn, screen *frame.Screen, messages []ZIF_GG_SESSION_TYPES_V1__TY_MESSAGE) error {
	server, err := sapGUIWrapper()
	if err != nil {
		return err
	}
	for i := range server.Items {
		item := &server.Items[i]
		if item.Type == diag.ItemAPPL4 && item.ID == 0x09 && item.SID == 0x02 {
			item.Value = screen.Encode()
		}
	}
	if len(messages) > 0 {
		text := strings.TrimSpace(messages[len(messages)-1].text)
		if text != "" {
			server.Items = append(server.Items[:len(server.Items)-1], diag.StatusMessage(diag.MsgInfo, text), server.Items[len(server.Items)-1])
		}
	}
	payload, err := diag.EncodeMessage(server.Header, server.Items, false)
	if err != nil {
		return err
	}
	return writeNIFrame(conn, payload)
}

func sapGUIExit(items []diag.Item) bool {
	for _, item := range items {
		if item.Type != diag.ItemAPPL || item.ID != 0x0c || item.SID != 0x04 {
			continue
		}
		code := strings.ToLower(strings.TrimSpace(string(item.Value)))
		return code == "/i" || code == "/n" || code == "/nend" || code == "/nex" || code == "/bend" || code == "back" || code == "=back" || code == "exit"
	}
	return false
}

func endSAPGUISession(conn net.Conn) error {
	_ = conn.SetWriteDeadline(time.Now().Add(time.Second))
	header := diag.Header{ComFlag: diag.FlagTermEOC | diag.FlagTermEOP, MsgInfo: 0x01}
	if err := writeNIFrame(conn, header.Bytes()); err != nil {
		return err
	}
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	_, _ = readNIFrame(conn)
	return nil
}

func writeNIFrame(w io.Writer, payload []byte) error {
	if len(payload) > 64<<20 {
		return fmt.Errorf("NI payload too large: %d", len(payload))
	}
	header := [4]byte{}
	binary.BigEndian.PutUint32(header[:], uint32(len(payload)))
	if err := writeAll(w, header[:]); err != nil {
		return err
	}
	return writeAll(w, payload)
}

func writeAll(w io.Writer, data []byte) error {
	for len(data) > 0 {
		n, err := w.Write(data)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		data = data[n:]
	}
	return nil
}

func readNIFrame(r io.Reader) ([]byte, error) {
	header := [4]byte{}
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return nil, err
	}
	n := binary.BigEndian.Uint32(header[:])
	if n > 64<<20 {
		return nil, fmt.Errorf("NI payload too large: %d", n)
	}
	payload := make([]byte, int(n))
	_, err := io.ReadFull(r, payload)
	return payload, err
}

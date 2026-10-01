package abap

import (
	"io"
	"net"
	"testing"
	"time"

	"osg/gogen/amc"
	"osg/gogen/session"
)

func TestEndTestClassClosesHTTPClients(t *testing.T) {
	session.BeginTestClass()
	s := &Session{}
	var peers []net.Conn
	for range 2 {
		clientConn, peer := net.Pipe()
		peers = append(peers, peer)
		client := httpcOf(s, new(int))
		client.conn = clientConn
		client.connKey = "example"
	}
	defer func() {
		for _, peer := range peers {
			peer.Close()
		}
	}()
	if len(s.httpc) != 2 {
		t.Fatalf("expected two HTTP clients, got %d", len(s.httpc))
	}
	EndTestClass(s)
	if s.httpc != nil {
		t.Fatal("ending session still retains HTTP clients")
	}
	for _, peer := range peers {
		peer.SetReadDeadline(time.Now().Add(time.Second))
		var b [1]byte
		if _, err := peer.Read(b[:]); err != io.EOF {
			t.Fatalf("HTTP client connection remains open: %v", err)
		}
	}
}

type unitDatasetHandle struct{ closed bool }

func (h *unitDatasetHandle) ReadAt(int64, int) ([]byte, error) { return nil, nil }
func (h *unitDatasetHandle) WriteAt(int64, []byte) error       { return nil }
func (h *unitDatasetHandle) Size() (int64, error)              { return 0, nil }
func (h *unitDatasetHandle) Close() error                      { h.closed = true; return nil }

type unitDatasetHost struct{ handles []*unitDatasetHandle }

func (h *unitDatasetHost) Open(string, DatasetMode) (DatasetHandle, string) {
	f := &unitDatasetHandle{}
	h.handles = append(h.handles, f)
	return f, ""
}
func (h *unitDatasetHost) Delete(string) bool { return false }

func TestEndTestClassForgetsAMCAndClosesDatasets(t *testing.T) {
	program := amc.ProgramOf("ZCL_UNIT_BOUNDARY")
	broker := amc.New(amc.Channel{App: "UNIT", Path: "/text", Type: "TEXT", Scope: "C", Auth: []amc.Authority{
		{Path: "/text", Program: program, Activity: "S"},
		{Path: "/text", Program: program, Activity: "R"},
	}})
	previous := amc.Use(broker)
	t.Cleanup(func() { amc.Use(previous); SetDatasetHost(nil) })
	host := &unitDatasetHost{}
	SetDatasetHost(host)
	endpoint := func(s *Session) amc.Endpoint {
		return amc.Endpoint{Session: s, Program: program, Client: "001"}
	}
	publish := func(s *Session, payload string) {
		t.Helper()
		if err := broker.Publish("UNIT", "/text", "", endpoint(s), false, amc.Message{Type: "TEXT", Payload: payload}); err != nil {
			t.Fatal(err)
		}
	}

	session.BeginTestClass()
	first := &Session{}
	if _, err := broker.Subscribe("UNIT", "/text", "", endpoint(first), "first"); err != nil {
		t.Fatal(err)
	}
	OpenDataset(first, "first", DatasetOpen{Mode: DatasetOutput, Binary: true})
	publish(first, "first class")
	var firstMessages []string
	if !broker.Pump(first, func(_ any, m amc.Message) { firstMessages = append(firstMessages, m.Payload.(string)) }) {
		t.Fatal("first class subscription did not receive its own message")
	}
	EndTestClass(first)
	if !host.handles[0].closed {
		t.Fatal("first class left its DATASET handle open")
	}
	if _, ok := datasetFiles.Load(first); ok {
		t.Fatal("first class DATASET map remains reachable")
	}

	session.BeginTestClass()
	second := &Session{}
	if _, err := broker.Subscribe("UNIT", "/text", "", endpoint(second), "second"); err != nil {
		t.Fatal(err)
	}
	OpenDataset(second, "second", DatasetOpen{Mode: DatasetOutput, Binary: true})
	publish(second, "second class")
	if broker.Pump(first, func(_ any, m amc.Message) { firstMessages = append(firstMessages, m.Payload.(string)) }) || len(firstMessages) != 1 {
		t.Fatalf("first class received a later message: %v", firstMessages)
	}
	if host.handles[1].closed {
		t.Fatal("second class handle closed before its boundary")
	}
	var secondMessages []string
	if !broker.Pump(second, func(_ any, m amc.Message) { secondMessages = append(secondMessages, m.Payload.(string)) }) || len(secondMessages) != 1 || secondMessages[0] != "second class" {
		t.Fatalf("second class messages: %v", secondMessages)
	}
	EndTestClass(second)
	if !host.handles[1].closed {
		t.Fatal("second class left its DATASET handle open")
	}
}

func TestEndTestClassDropsInflateHandles(t *testing.T) {
	session.BeginTestClass()
	s := &Session{}
	h := InflateHostOpen(s)
	var raw, unused, reason string
	var state int32
	InflateHostFeed(s, h, "\x00", 0, &raw, &state, &unused, &reason)
	if s.inflate == nil {
		t.Fatal("inflater did not retain a pending stream")
	}
	registry := s.inflate
	EndTestClass(s)
	if s.inflate != nil {
		t.Fatal("session retained inflate registry")
	}
	_, _, _, reason = registry.Feed(h, "", 0)
	if reason != "inflate handle is gone" {
		t.Fatalf("handle survived EndTestClass: %q", reason)
	}
}

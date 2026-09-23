// A WebSocket client for an APC channel: connects, prints what the handler
// sends from ON_START, then sends each command given and prints what comes
// back, one line per message (its length, its sha256 and its head), so two
// stands can be compared by diff.
//
//	go run ./cmd/apcprobe -url ws://127.0.0.1:3092/sap/bc/apc/sap/zo4d_demo -frames 5
package main

import (
	"context"
	"crypto/sha256"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/coder/websocket"
)

func main() {
	url := flag.String("url", "ws://127.0.0.1:3092/sap/bc/apc/sap/zo4d_demo", "channel")
	frames := flag.Int("frames", 5, "how many 'frame' commands to send after the commands")
	cmds := flag.String("cmds", "", "commands to send first, separated by |")
	full := flag.Bool("full", false, "print whole messages")
	wait := flag.Duration("wait", 300*time.Millisecond, "quiet time that ends a reply")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, *url, nil)
	if err != nil {
		fmt.Println("DIAL", err)
		os.Exit(1)
	}
	c.SetReadLimit(1 << 24)
	defer c.CloseNow()
	msgs := make(chan string, 1024)
	go func() {
		for {
			_, b, err := c.Read(ctx)
			if err != nil {
				close(msgs)
				return
			}
			msgs <- string(b)
		}
	}()
	n := 0
	drain := func(label string) {
		for {
			select {
			case m, ok := <-msgs:
				if !ok {
					return
				}
				n++
				head := m
				if !*full && len(head) > 72 {
					head = head[:72]
				}
				fmt.Printf("%s #%d len=%d sha=%x %s\n", label, n, len(m), sha256.Sum256([]byte(m)), head)
			case <-time.After(*wait):
				return
			}
		}
	}
	drain("start")
	var send []string
	if *cmds != "" {
		send = strings.Split(*cmds, "|")
	}
	for i := 0; i < *frames; i++ {
		send = append(send, "frame")
	}
	for _, cmd := range send {
		if err := c.Write(ctx, websocket.MessageText, []byte(cmd)); err != nil {
			fmt.Println("WRITE", err)
			os.Exit(1)
		}
		drain(cmd)
	}
	c.Close(websocket.StatusNormalClosure, "")
}

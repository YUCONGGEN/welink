package protocol

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"sync/atomic"
	"testing"
	"time"
)

func lanePair(t *testing.T) (*Conn, *Conn, net.Conn) {
	t.Helper()
	a, b := net.Pipe()
	ai, bi := net.Pipe()
	aa, ba := net.Pipe()
	left, right := NewConn(a), NewConn(b)
	if err := left.EnableLanes(ai, aa); err != nil {
		t.Fatal(err)
	}
	if err := right.EnableLanes(bi, ba); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { left.Close(); right.Close() })
	return left, right, a
}

func TestDirectAudioEventsBypassBackedUpApplicationAndPreserveControl(t *testing.T) {
	left, right, _ := lanePair(t)
	got := make(chan Message, 16)
	right.SetAudioEventHandler(func(m Message) bool {
		if m.Method == "audio_stop" {
			return false
		}
		got <- m
		return true
	})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	// No application reader: fill its frame queue and block the frame pump.
	for i := 0; i < 2; i++ {
		if err := left.WriteMessageContext(ctx, Message{Kind: "event", Method: "frame", Data: []byte{1}}); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 12; i++ {
		if err := left.WriteMessageContext(ctx, Message{Kind: "event", Method: "audio_opus", Data: []byte{byte(i)}}); err != nil {
			t.Fatal("audio waited for main reader", err)
		}
	}
	for i := 0; i < 12; i++ {
		select {
		case m := <-got:
			if m.Kind != "event" || m.Method != "audio_opus" || len(m.Data) != 1 || m.Data[0] != byte(i) {
				t.Fatal("audio ordering changed", m)
			}
		case <-ctx.Done():
			t.Fatal("direct audio blocked")
		}
	}
	if err := left.WriteMessageContext(ctx, Message{Kind: "event", Method: "audio_stop"}); err != nil {
		t.Fatal(err)
	}
	for {
		m := readLane(t, right)
		if m.Method == "audio_stop" {
			break
		}
		if m.Method != "frame" {
			t.Fatal("unexpected routed message", m)
		}
	}
	if err := left.WriteMessageContext(ctx, Message{Kind: "request", Method: "audio_start", ID: "start"}); err != nil {
		t.Fatal(err)
	}
	var request Message
	for {
		request = readLane(t, right)
		if request.Kind == "request" {
			break
		}
	}
	if request.ID != "start" {
		t.Fatal("request was consumed as audio", request)
	}
	if err := right.WriteMessageContext(ctx, Response(request.ID, nil, nil)); err != nil {
		t.Fatal(err)
	}
	if response := readLane(t, left); response.ID != "start" || !response.OK {
		t.Fatal("response path changed", response)
	}
	select {
	case m := <-got:
		t.Fatal("handler consumed control", m)
	default:
	}
	right.SetAudioEventHandler(nil)
}

func TestDirectAudioHandlerCannotBypassLaneValidation(t *testing.T) {
	left, right, _ := lanePair(t)
	var calls atomic.Int32
	right.SetAudioEventHandler(func(Message) bool { calls.Add(1); return true })
	done := make(chan error, 1)
	go func() {
		done <- left.lanes.Load().audio.WriteMessage(Message{Kind: "event", Method: "frame", Data: []byte{1}})
	}()
	if _, err := right.ReadMessage(); err == nil {
		t.Fatal("invalid audio lane message accepted")
	}
	<-done
	if calls.Load() != 0 {
		t.Fatal("handler ran before lane validation")
	}
}

func readLane(t *testing.T, c *Conn) Message {
	t.Helper()
	type result struct {
		m   Message
		err error
	}
	done := make(chan result, 1)
	go func() { m, e := c.ReadMessage(); done <- result{m, e} }()
	select {
	case r := <-done:
		if r.err != nil {
			t.Fatal(r.err)
		}
		return r.m
	case <-time.After(time.Second):
		t.Fatal("realtime lane waited on an unfinished frame")
		return Message{}
	}
}

func TestIndependentLanesBypassIncompleteFrame(t *testing.T) {
	for _, bulkMethod := range []string{"frame", "file_upload_chunk", "file_download_chunk"} {
		t.Run(bulkMethod, func(t *testing.T) {
			left, right, raw := lanePair(t)
			header, _ := json.Marshal(Message{Kind: "event", Method: bulkMethod})
			prefix := make([]byte, 8)
			binary.BigEndian.PutUint32(prefix, uint32(len(header)))
			binary.BigEndian.PutUint32(prefix[4:], 1024)
			if _, err := raw.Write(append(prefix, header...)); err != nil {
				t.Fatal(err)
			}
			for _, method := range []string{"input", "audio_opus", "input_release", "frame_ack"} {
				if err := left.WriteMessage(Message{Kind: "event", Method: method, Data: []byte{1, 2}}); err != nil {
					t.Fatal(err)
				}
				if m := readLane(t, right); m.Method != method {
					t.Fatal(m.Method)
				}
			}
			done := make(chan error, 1)
			go func() { _, err := raw.Write(bytes.Repeat([]byte{42}, 1024)); done <- err }()
			m := readLane(t, right)
			if m.Method != bulkMethod || len(m.Data) != 1024 {
				t.Fatal("bulk payload lost")
			}
			if err := <-done; err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestLaneResponsesReturnOnTheirRequestTransport(t *testing.T) {
	left, right, raw := lanePair(t)
	header, _ := json.Marshal(Message{Kind: "event", Method: "frame"})
	prefix := make([]byte, 8)
	binary.BigEndian.PutUint32(prefix, uint32(len(header)))
	binary.BigEndian.PutUint32(prefix[4:], 1024)
	if _, err := raw.Write(append(prefix, header...)); err != nil {
		t.Fatal(err)
	}
	if err := left.WriteMessage(Message{Kind: "request", ID: "sound", Method: "audio_start"}); err != nil {
		t.Fatal(err)
	}
	m := readLane(t, right)
	if m.ID != "sound" {
		t.Fatal(m)
	}
	if err := right.WriteMessage(Response(m.ID, nil, map[string]any{"codec": "opus"})); err != nil {
		t.Fatal(err)
	}
	if m = readLane(t, left); m.ID != "sound" || !m.OK {
		t.Fatal(m)
	}
}

func TestLaneCloseJoinsReadersAndRejectsBulkOnInput(t *testing.T) {
	a, b := net.Pipe()
	ai, bi := net.Pipe()
	aa, ba := net.Pipe()
	defer a.Close()
	defer ai.Close()
	defer aa.Close()
	right := NewConn(b)
	if err := right.EnableLanes(bi, ba); err != nil {
		t.Fatal(err)
	}
	defer right.Close()
	done := make(chan error, 1)
	go func() { done <- NewConn(ai).WriteMessage(Message{Kind: "event", Method: "frame", Data: []byte{1}}) }()
	if _, err := right.ReadMessage(); err == nil {
		t.Fatal("bulk accepted on input lane")
	}
	if err := <-done; err != nil && err != io.ErrClosedPipe {
		t.Fatal(err)
	}
	joined := make(chan struct{})
	go func() { right.Close(); close(joined) }()
	select {
	case <-joined:
	case <-time.After(time.Second):
		t.Fatal("lane readers leaked")
	}
}

func TestLaneRejectsOversizedDeclarationBeforeReadingPayload(t *testing.T) {
	left, right, _ := lanePair(t)
	prefix := make([]byte, 8)
	binary.BigEndian.PutUint32(prefix, 20)
	binary.BigEndian.PutUint32(prefix[4:], 32<<20)
	done := make(chan error, 1)
	go func() { _, err := left.lanes.Load().input.Conn.Write(prefix); done <- err }()
	result := make(chan error, 1)
	go func() { _, err := right.ReadMessage(); result <- err }()
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("oversized declaration accepted")
		}
	case <-time.After(time.Second):
		t.Fatal("lane waited for oversized payload before rejection")
	}
	<-done
}

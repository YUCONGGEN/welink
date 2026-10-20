package protocol

import (
	"context"
	"errors"
	"net"
	"sync"
	"testing"
	"time"
)

type blockedBulkConn struct {
	net.Conn
	entered chan struct{}
	once    sync.Once
}

func (c *blockedBulkConn) BulkPayload() int { return 512 }
func (c *blockedBulkConn) WaitBulk(ctx context.Context, _ int) error {
	c.once.Do(func() { close(c.entered) })
	<-ctx.Done()
	return ctx.Err()
}

func TestBulkAdmissionWaitDoesNotBlockInputOrCloseHealthyConnection(t *testing.T) {
	a, b := net.Pipe()
	defer a.Close()
	defer b.Close()
	_ = a.SetDeadline(time.Now().Add(3 * time.Second))
	_ = b.SetDeadline(time.Now().Add(3 * time.Second))
	transport := &blockedBulkConn{Conn: a, entered: make(chan struct{})}
	sender, receiver := NewConn(transport), NewConn(b)
	sender.EnableInterleaving()
	receiver.EnableInterleaving()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bulkDone := make(chan error, 1)
	go func() {
		bulkDone <- sender.WriteMessageContext(ctx, Message{Kind: "event", Method: "tiles", Data: make([]byte, 32<<10)})
	}()
	select {
	case <-transport.entered:
	case <-time.After(time.Second):
		t.Fatal("bulk admission did not start")
	}
	sendControl := func(method string) {
		t.Helper()
		done := make(chan error, 1)
		go func() { done <- sender.WriteMessage(Message{Kind: "event", Method: method}) }()
		message, err := receiver.ReadMessage()
		if err != nil || message.Method != method {
			t.Fatalf("priority message blocked behind bulk: %+v / %v", message, err)
		}
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	sendControl("input")
	cancel()
	if err := <-bulkDone; !errors.Is(err, context.Canceled) {
		t.Fatal("queued bulk did not cancel:", err)
	}
	sendControl("input_release") // cancellation happened before any bulk bytes
}

package peerpath

import (
	"bytes"
	"context"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pion/logging"
	"github.com/pion/stun/v4"
	"github.com/pion/transport/v4/vnet"
	"github.com/pion/webrtc/v4"
	"welink/internal/yudesk/protocol"
)

// A stalled picture must not prevent bounded audio/input enqueue on their
// independent streams. All application packets are deliberately withheld;
// this checks admission, not impossible delivery through a disconnected WAN.
func TestRealtimeWritersBypassPendingPicture(t *testing.T) {
	wan, err := vnet.NewRouter(&vnet.RouterConfig{CIDR: "192.0.2.0/24", LoggerFactory: logging.NewDefaultLoggerFactory()})
	if err != nil {
		t.Fatal(err)
	}
	var armed atomic.Bool
	dropped := make(chan struct{}, 1)
	wan.AddChunkFilter(func(packet vnet.Chunk) bool {
		if armed.Load() && strings.HasPrefix(packet.SourceAddr().String(), "192.0.2.10:") && !stun.IsMessage(packet.UserData()) {
			select {
			case dropped <- struct{}{}:
			default:
			}
			return false
		}
		return true
	})
	var options [2]Options
	for i, address := range []string{"192.0.2.10", "192.0.2.20"} {
		network, err := vnet.NewNet(&vnet.NetConfig{StaticIPs: []string{address}})
		if err != nil {
			t.Fatal(err)
		}
		if err = wan.AddNet(network); err != nil {
			t.Fatal(err)
		}
		options[i] = Options{STUNURLs: []string{}, Timeout: 2 * time.Second, configure: func(s *webrtc.SettingEngine) {
			s.SetNet(network)
			s.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
		}}.WithSessionLanes(bytes.Repeat([]byte{7}, 32))
	}
	if err = wan.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = wan.Stop() })
	a, b := encryptedPair(t)
	results := runPair(t, context.Background(), [2]*protocol.Conn{protocol.NewConn(a), protocol.NewConn(b)}, options, [2]func() (protocol.Message, error){})
	for _, result := range results {
		if result.err != nil || !result.c.HasLanes() || result.info.Mode != "p2p" {
			t.Fatalf("lane fixture negotiation: %v %s", result.err, result.info.Mode)
		}
	}
	left := results[0].c
	session := left.Conn.(*sessionConn)
	bulk := session.Conn.(*dataConn)
	armed.Store(true)
	if err = left.SetWriteDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if n, err := bulk.Write(bytes.Repeat([]byte{91}, chunkSize)); err != nil || n != chunkSize {
		t.Fatalf("initial picture enqueue: %d %v", n, err)
	}
	select {
	case <-dropped:
	case <-time.After(time.Second):
		t.Fatal("fixture never held a picture packet")
	}
	if bulk.dc.BufferedAmount() == 0 {
		t.Fatal("fixture did not leave a pending picture")
	}
	for _, method := range []string{"audio_opus", "input"} {
		ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
		err := left.WriteMessageContext(ctx, protocol.Message{Kind: "event", Method: method, Data: []byte{1, 2, 3}})
		cancel()
		if err != nil {
			t.Fatalf("%s enqueue waited for pending picture: %v", method, err)
		}
	}
	for _, stream := range []*dataConn{bulk, session.a.extra[0], session.a.extra[1]} {
		if stream.dc.BufferedAmount() > bufferLimit {
			t.Fatal("per-stream memory bound was exceeded")
		}
	}
}

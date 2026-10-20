package peerpath

import (
	"context"
	"fmt"
	"os"
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

// Measure the authenticated production setup, rather than just ICE's selected
// pair. The relay signaling is an encrypted in-memory pipe; only the actual
// UDP path has controlled delay/loss. This is not an Internet success rate.
func setupLatencyPair(t *testing.T, rtt time.Duration, snap [2]bool, dropBindingSuccess bool) (time.Duration, uint64) {
	t.Helper()
	wan, err := vnet.NewRouter(&vnet.RouterConfig{CIDR: "192.0.2.0/24", MinDelay: rtt / 2, LoggerFactory: logging.NewDefaultLoggerFactory()})
	if err != nil {
		t.Fatal(err)
	}
	var packets atomic.Uint64
	var dropped atomic.Bool
	wan.AddChunkFilter(func(packet vnet.Chunk) bool {
		packets.Add(1)
		if dropBindingSuccess && stun.IsMessage(packet.UserData()) {
			m := &stun.Message{Raw: packet.UserData()}
			if m.Decode() == nil && m.Type == stun.BindingSuccess && dropped.CompareAndSwap(false, true) {
				return false
			}
		}
		return true
	})
	var options [2]Options
	for side, address := range []string{"192.0.2.10", "192.0.2.20"} {
		network, err := vnet.NewNet(&vnet.NetConfig{StaticIPs: []string{address}})
		if err != nil {
			t.Fatal(err)
		}
		if err := wan.AddNet(network); err != nil {
			t.Fatal(err)
		}
		options[side] = Options{STUNURLs: []string{}, Timeout: 3 * time.Second, TrickleICE: true, configure: func(s *webrtc.SettingEngine) {
			s.SetNet(network)
			s.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
			s.EnableSctpSnap(snap[side])
		}}
	}
	if err := wan.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = wan.Stop() })
	left, right := encryptedPair(t)
	started := time.Now()
	results := runPair(t, context.Background(), [2]*protocol.Conn{protocol.NewConn(left), protocol.NewConn(right)}, options, [2]func() (protocol.Message, error){})
	elapsed, count := time.Since(started), packets.Load()
	for side, result := range results {
		if result.err != nil || result.info.Mode != "p2p" {
			t.Fatalf("setup side %d: %+v", side, result)
		}
		pc := result.c.Conn.(*sessionConn).a.pc
		advertised := strings.Contains(pc.LocalDescription().SDP, "a=sctp-init:")
		want := snap[0] && (side == 0 || snap[1])
		if advertised != want {
			t.Fatalf("SNAP advertisement side %d: got %t want %t", side, advertised, want)
		}
	}
	if dropBindingSuccess && !dropped.Load() {
		t.Fatal("loss fixture did not drop the selected ICE packet")
	}
	// Preserve reliable delivery, both directions, after every negotiated mode.
	roundTrip(t, results[0].c, results[1].c, 65539)
	roundTrip(t, results[1].c, results[0].c, 17003)
	return elapsed, count
}

func TestSCTPSetupMixedVersionInteroperability(t *testing.T) {
	for _, mode := range []struct {
		name string
		snap [2]bool
	}{{"legacy", [2]bool{}}, {"viewer-only", [2]bool{true, false}}, {"agent-only", [2]bool{false, true}}, {"both", [2]bool{true, true}}} {
		t.Run(mode.name, func(t *testing.T) {
			elapsed, packets := setupLatencyPair(t, 0, mode.snap, false)
			t.Logf("setup_ms=%.2f udp_packets=%d", float64(elapsed)/float64(time.Millisecond), packets)
		})
	}
}

func TestP2PSetupLatency(t *testing.T) {
	if os.Getenv("YUDESK_P2P_SETUP_PROBE") != "1" {
		t.Skip("set YUDESK_P2P_SETUP_PROBE=1 for controlled setup latency measurements")
	}
	for _, rtt := range []int{40, 120} {
		for _, loss := range []bool{false, true} {
			for _, snap := range []bool{false, true} {
				t.Run(fmt.Sprintf("RTT%d_loss%t_snap%t", rtt, loss, snap), func(t *testing.T) {
					elapsed, packets := setupLatencyPair(t, time.Duration(rtt)*time.Millisecond, [2]bool{snap, snap}, loss)
					t.Logf("setup_ms=%.2f udp_packets=%d", float64(elapsed)/float64(time.Millisecond), packets)
				})
			}
		}
	}
}

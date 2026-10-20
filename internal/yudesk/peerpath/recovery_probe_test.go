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

// Test-only observation of the pinned Pion SCTP implementation. Count recovery
// trace calls without formatting or retaining any
// arguments: other SCTP trace calls can contain packet data or identifiers.
// This is not a public dependency API and must be reviewed on Pion upgrades.
type queueRecoveryFactory struct {
	logging.LoggerFactory
	counts *queueRecoveryCounts
}

type queueRecoveryCounts struct{ t3, pto, rack, fast atomic.Uint64 }

func (f queueRecoveryFactory) NewLogger(scope string) logging.LeveledLogger {
	logger := f.LoggerFactory.NewLogger(scope)
	if scope == "sctp" {
		return queueRecoveryLogger{logger, f.counts}
	}
	return logger
}

type queueRecoveryLogger struct {
	logging.LeveledLogger
	counts *queueRecoveryCounts
}

func (l queueRecoveryLogger) Tracef(format string, _ ...any) {
	switch format {
	case "[%s] updated cwnd=%d ssthresh=%d inflight=%d (RTO)":
		l.counts.t3.Add(1)
	case "[%s] PTO fired: probe tsn=%d":
		l.counts.pto.Add(1)
	case "[%s] RACK: mark lost tsn=%d (sent=%v, delivered=%v, reoWnd=%v)", "[%s] RACK timer: mark lost tsn=%d":
		l.counts.rack.Add(1)
	case "[%s] fast-retransmit: tsn=%d sent=%d htna=%d":
		l.counts.fast.Add(1)
	}
}

type unformattableProbeArgument struct{}

func (unformattableProbeArgument) String() string { panic("probe formatted a private argument") }

func TestQueueRecoveryProbeCountsOnlyRecoveryEventsWithoutFormatting(t *testing.T) {
	var count queueRecoveryCounts
	factory := queueRecoveryFactory{&logging.DefaultLoggerFactory{DefaultLogLevel: logging.LogLevelError}, &count}
	private := unformattableProbeArgument{}
	logger := factory.NewLogger("sctp")
	logger.Tracef("[%s] packet=%s", private, private)
	logger.Tracef("[%s] updated cwnd=%d ssthresh=%d inflight=%d (RTO)", private, private, private, private)
	logger.Tracef("[%s] PTO fired: probe tsn=%d", private, private)
	logger.Tracef("[%s] RACK timer: mark lost tsn=%d", private, private)
	logger.Tracef("[%s] RACK: mark lost tsn=%d (sent=%v, delivered=%v, reoWnd=%v)", private, private, private, private, private)
	logger.Tracef("[%s] fast-retransmit: tsn=%d sent=%d htna=%d", private, private, private, private)
	factory.NewLogger("ice").Tracef("[%s] updated cwnd=%d ssthresh=%d inflight=%d (RTO)", private, private, private, private)
	if count.t3.Load() != 1 || count.pto.Load() != 1 || count.rack.Load() != 2 || count.fast.Load() != 1 {
		t.Fatal("unexpected SCTP recovery counts")
	}
}

func TestQueueRecoveryProbeObservesRealTailRetransmission(t *testing.T) {
	wan, err := vnet.NewRouter(&vnet.RouterConfig{CIDR: "192.0.2.0/24", LoggerFactory: logging.NewDefaultLoggerFactory()})
	if err != nil {
		t.Fatal(err)
	}
	var armed, dropped atomic.Bool
	var recovery queueRecoveryCounts
	wan.AddChunkFilter(func(chunk vnet.Chunk) bool {
		// Drop exactly one outgoing DTLS packet after negotiation, leaving
		// ICE/STUN and the encrypted authorization tether untouched. No
		// following application packet can generate fast-retransmit reports.
		if armed.Load() && strings.HasPrefix(chunk.SourceAddr().String(), "192.0.2.10:") && !stun.IsMessage(chunk.UserData()) && dropped.CompareAndSwap(false, true) {
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
		if err := wan.AddNet(network); err != nil {
			t.Fatal(err)
		}
		options[i] = Options{STUNURLs: []string{}, Timeout: 2 * time.Second, configure: func(s *webrtc.SettingEngine) {
			s.SetNet(network)
			s.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
			s.LoggerFactory = queueRecoveryFactory{&logging.DefaultLoggerFactory{DefaultLogLevel: logging.LogLevelError}, &recovery}
		}}.WithSessionLanes(bytes.Repeat([]byte{7}, 32))
	}
	if err := wan.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = wan.Stop() })
	a, b := encryptedPair(t)
	r := runPair(t, context.Background(), [2]*protocol.Conn{protocol.NewConn(a), protocol.NewConn(b)}, options, [2]func() (protocol.Message, error){})
	for _, result := range r {
		if result.err != nil || result.info.Mode != "p2p" || !result.c.HasLanes() {
			t.Fatalf("tail-loss fixture negotiation: %v %s", result.err, result.info.Mode)
		}
		if err := result.c.SetDeadline(time.Now().Add(4 * time.Second)); err != nil {
			t.Fatal(err)
		}
	}
	armed.Store(true)
	want := []byte("owned synthetic audio bytes, not sent to an audio decoder")
	if err := r[0].c.WriteMessage(protocol.Message{Kind: "event", Method: "audio_opus", Data: want}); err != nil {
		t.Fatal(err)
	}
	m, err := r[1].c.ReadMessage()
	if err != nil || m.Method != "audio_opus" || !bytes.Equal(m.Data, want) {
		t.Fatalf("tail retransmission lost/changed the payload: %v", err)
	}
	if !dropped.Load() || recovery.t3.Load()+recovery.pto.Load() == 0 {
		t.Fatalf("probe did not observe actual SCTP timer recovery: dropped=%t t3=%d pto=%d", dropped.Load(), recovery.t3.Load(), recovery.pto.Load())
	}
	t.Logf("observed_real_tail_recovery=true t3=%d pto=%d exact_payload=true", recovery.t3.Load(), recovery.pto.Load())
}

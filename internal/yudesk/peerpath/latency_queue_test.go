package peerpath

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"os"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pion/logging"
	"github.com/pion/transport/v4/vnet"
	"github.com/pion/webrtc/v4"
	"welink/internal/yudesk/protocol"
)

// Exercise the real authenticated DTLS/SCTP transport at unlimited application
// bitrate. Each direction has its own token bucket; ACKs are not serialized
// behind the opposite direction. This is a virtual network, not OS input/audio
// or a live Internet latency measurement. Opt in because it deliberately takes
// several seconds per constrained-link scenario.
func TestUnlimitedP2PLoadedLatency(t *testing.T) {
	if os.Getenv("YUDESK_P2P_QUEUE_PROBE") != "1" {
		t.Skip("set YUDESK_P2P_QUEUE_PROBE=1 for the virtual-network latency experiment")
	}
	sessionLanes := os.Getenv("YUDESK_P2P_SESSION_LANES") == "1"
	if sessionLanes && (os.Getenv("YUDESK_P2P_SEPARATE_PROBE") == "1" || os.Getenv("YUDESK_P2P_ACK_PACER") == "1") {
		t.Fatal("production session lanes must be measured without test-only stream/pacer overlays")
	}
	for _, scenario := range []struct{ mbps, rttMS int }{{2, 40}, {8, 40}, {100, 40}, {100, 120}} {
		t.Run(fmt.Sprintf("Mbps%d_RTT%d", scenario.mbps, scenario.rttMS), func(t *testing.T) {
			wan, err := vnet.NewRouter(&vnet.RouterConfig{CIDR: "192.0.2.0/24", MinDelay: time.Duration(scenario.rttMS) * time.Millisecond / 2, LoggerFactory: logging.NewDefaultLoggerFactory()})
			if err != nil {
				t.Fatal(err)
			}
			var options [2]Options
			var recovery [2]queueRecoveryCounts
			var delays []*vnet.DelayFilter
			var capacities []*vnet.TBFQueue
			for i, address := range []string{"192.0.2.10", "192.0.2.20"} {
				network, err := vnet.NewNet(&vnet.NetConfig{StaticIPs: []string{address}})
				if err != nil {
					t.Fatal(err)
				}
				capacity := vnet.NewTBFQueue(scenario.mbps*1_000_000, 3000, 512<<10)
				capacities = append(capacities, capacity)
				queue, err := vnet.NewQueue(network, capacity)
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = queue.Close() })
				var nic vnet.NIC = queue
				if os.Getenv("YUDESK_P2P_RTT_STEP") == "1" {
					delay, err := vnet.NewDelayFilter(queue)
					if err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() { _ = delay.Close() })
					delays = append(delays, delay)
					nic = delay
				}
				if err := wan.AddNet(nic); err != nil {
					t.Fatal(err)
				}
				options[i] = Options{STUNURLs: []string{}, Timeout: 3 * time.Second, configure: func(s *webrtc.SettingEngine) {
					s.SetNet(network)
					s.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
					if os.Getenv("YUDESK_P2P_RECOVERY_PROBE") == "1" {
						s.LoggerFactory = queueRecoveryFactory{&logging.DefaultLoggerFactory{DefaultLogLevel: logging.LogLevelError}, &recovery[i]}
					}
				}}
				if sessionLanes {
					options[i] = options[i].WithSessionLanes(bytes.Repeat([]byte{7}, 32))
				}
			}
			if err := wan.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = wan.Stop() })
			var lossActive atomic.Bool
			var lossPackets, lostPackets atomic.Uint64
			if os.Getenv("YUDESK_P2P_PROBE_LOSS") == "1" {
				wan.AddChunkFilter(func(packet vnet.Chunk) bool {
					if lossActive.Load() && len(packet.UserData()) >= 1000 {
						if lossPackets.Add(1)%257 == 0 {
							lostPackets.Add(1)
							return false
						}
					}
					return true
				})
			}
			left, right := encryptedPair(t)
			bases := [2]*protocol.Conn{protocol.NewConn(left), protocol.NewConn(right)}
			results := runPair(t, context.Background(), bases, options, [2]func() (protocol.Message, error){})
			lifetime := 25 * time.Second
			if os.Getenv("YUDESK_P2P_LONG_STEADY") == "1" {
				lifetime = 45 * time.Second
			}
			for _, r := range results {
				if r.err != nil || r.info.Mode != "p2p" {
					t.Fatalf("P2P negotiation: %+v", r)
				}
				if r.c.HasLanes() != sessionLanes {
					t.Fatal("negotiated transports do not match the requested measurement")
				}
				r.c.EnableInterleaving()
				_ = r.c.SetDeadline(time.Now().Add(lifetime))
			}
			viewer, agent := results[0].c, results[1].c
			t.Logf("production_session_lanes=%t", sessionLanes)
			if os.Getenv("YUDESK_P2P_ACK_PACER") == "1" {
				for _, conn := range []*protocol.Conn{viewer, agent} {
					session := conn.Conn.(*sessionConn)
					raw := session.Conn.(*dataConn)
					conn.Conn = &queueProbeACKPacer{Conn: session, raw: raw, pc: session.a.pc, started: time.Now(), limit: bufferLimit}
				}
				t.Log("TEST ONLY: measured ACK delivery rate and base-RTT send window")
			}
			// Experimental, test-only second stream: preserve the authenticated
			// production connection for bulk, and isolate short messages on the
			// same DTLS/SCTP association. This is deliberately not a negotiated
			// production capability or a promise that the shared WAN queue disappears.
			viewerInteractive, agentInteractive := viewer, agent
			if os.Getenv("YUDESK_P2P_SEPARATE_PROBE") == "1" {
				viewerInteractive, agentInteractive = queueProbeInteractivePair(t, viewer, agent)
				t.Log("TEST ONLY: independent reliable ordered interactive stream")
			}
			ctx, cancel := context.WithCancel(context.Background())
			t.Cleanup(cancel)
			var workers sync.WaitGroup
			defer func() {
				cancel()
				_ = viewerInteractive.Close()
				_ = agentInteractive.Close()
				_ = viewer.Close()
				_ = agent.Close()
				workers.Wait()
			}()
			errors := make(chan error, 8)
			startWorker := func(f func() error) <-chan struct{} {
				finished := make(chan struct{})
				workers.Add(1)
				go func() {
					defer workers.Done()
					defer close(finished)
					if err := f(); err != nil {
						select {
						case errors <- err:
						default:
						}
					}
				}()
				return finished
			}
			var mu sync.Mutex
			var applied, responded, audio []float64
			sentInput, sentAudio := 0, 0
			age := func(id string) float64 {
				stamp, err := strconv.ParseInt(id, 10, 64)
				if err != nil {
					return -1
				}
				return float64(time.Now().UnixNano()-stamp) / 1e6
			}
			responses := make(chan protocol.Message, 1024)
			startWorker(func() error {
				for m := range responses {
					if err := agentInteractive.WriteMessage(m); err != nil {
						return err
					}
				}
				return nil
			})
			startWorker(func() error {
				defer close(responses)
				for {
					m, err := agentInteractive.ReadMessage()
					if err != nil {
						return err
					}
					if m.Method != "input" {
						return fmt.Errorf("unexpected agent message %q", m.Method)
					}
					mu.Lock()
					applied = append(applied, age(m.ID))
					mu.Unlock()
					select {
					case responses <- protocol.Message{Kind: "response", ID: m.ID, OK: true}:
					default:
						return fmt.Errorf("input response fixture queue overflow")
					}
				}
			})
			payload := bytes.Repeat([]byte{0x19, 0xa4, 0x57, 0xed}, (256<<10)/4)
			audioPayload := bytes.Repeat([]byte{0x35, 0x86, 0xca, 0x10}, 40)
			frames := make(chan time.Time, 8)
			readViewer := func(c *protocol.Conn, bulkOnly bool) func() error {
				return func() error {
					for {
						m, err := c.ReadMessage()
						if err != nil {
							return err
						}
						switch {
						case m.Method == "frame":
							if c != viewer {
								return fmt.Errorf("bulk frame on interactive stream")
							}
							if !bytes.Equal(m.Data, payload) {
								return fmt.Errorf("frame corrupted")
							}
							frames <- time.Now()
						case m.Method == "audio":
							if bulkOnly {
								return fmt.Errorf("audio on bulk-only stream")
							}
							if !bytes.Equal(m.Data, audioPayload) {
								return fmt.Errorf("audio packet corrupted")
							}
							mu.Lock()
							audio = append(audio, age(m.ID))
							mu.Unlock()
						case m.Kind == "response":
							if bulkOnly {
								return fmt.Errorf("response on bulk-only stream")
							}
							mu.Lock()
							responded = append(responded, age(m.ID))
							mu.Unlock()
						default:
							return fmt.Errorf("unexpected viewer message %q", m.Method)
						}
					}
				}
			}
			startWorker(readViewer(viewer, viewerInteractive != viewer))
			if viewerInteractive != viewer {
				startWorker(readViewer(viewerInteractive, false))
			}
			periodic := func(c *protocol.Conn, kind, method string, interval time.Duration, data []byte) func() error {
				return func() error {
					return queueProbeContinuousSource(ctx, c, kind, method, interval, data, func() {
						mu.Lock()
						if method == "input" {
							sentInput++
						} else {
							sentAudio++
						}
						mu.Unlock()
					}, nil)
				}
			}
			// Include startup separately: high-bandwidth/long-RTT paths need
			// several windows to distinguish startup from sustained throughput.
			warmCount, frameCount := 1, 4
			if scenario.mbps >= 100 {
				warmCount, frameCount = 3, 12
			}
			if os.Getenv("YUDESK_P2P_LONG_STEADY") == "1" {
				frameCount = 12
			}
			warmStart := time.Now()
			for range warmCount {
				if err := agent.WriteMessage(protocol.Message{Kind: "event", Method: "frame", Data: payload}); err != nil {
					t.Fatal(err)
				}
				select {
				case <-frames:
				case err := <-errors:
					t.Fatal(err)
				case <-time.After(10 * time.Second):
					t.Fatal("warm frame timeout")
				}
			}
			warmDuration := time.Since(warmStart)
			for _, delay := range delays {
				delay.SetDelay(40 * time.Millisecond)
			}
			if len(delays) > 0 {
				t.Log("After warmup, add 80 ms RTT without renegotiating the connection")
			}
			capacityStep := os.Getenv("YUDESK_P2P_CAPACITY_STEP") == "1"
			if capacityStep {
				for _, capacity := range capacities {
					capacity.SetRate(2_000_000)
				}
				t.Log("After warmup, set 2 Mbps; restore original ceiling halfway through loaded frames")
			}
			lossActive.Store(true)
			inputFinished := startWorker(periodic(viewerInteractive, "request", "input", 20*time.Millisecond, nil))
			audioFinished := startWorker(periodic(agentInteractive, "event", "audio", 10*time.Millisecond, audioPayload))
			begin := time.Now()
			for frame := range frameCount {
				if capacityStep && frame == frameCount/2 {
					for _, capacity := range capacities {
						capacity.SetRate(scenario.mbps * 1_000_000)
					}
				}
				if err := agent.WriteMessage(protocol.Message{Kind: "event", Method: "frame", Data: payload}); err != nil {
					t.Fatal(err)
				}
				select {
				case <-frames:
				case err := <-errors:
					t.Fatal(err)
				case <-time.After(10 * time.Second):
					t.Fatal("loaded frame timeout")
				}
			}
			duration := time.Since(begin)
			cancel()
			// Count every successful send, including the delayed tail. A fixed
			// short sleep can silently omit the worst responses from percentiles.
			drainTimeout := time.NewTimer(3 * time.Second)
			defer drainTimeout.Stop()
			for _, finished := range []<-chan struct{}{inputFinished, audioFinished} {
				select {
				case <-finished:
				case err := <-errors:
					t.Fatal(err)
				case <-drainTimeout.C:
					t.Fatal("senders did not stop")
				}
			}
			for {
				mu.Lock()
				complete := len(applied) == sentInput && len(responded) == sentInput && len(audio) == sentAudio
				mu.Unlock()
				if complete {
					break
				}
				select {
				case err := <-errors:
					t.Fatal(err)
				case <-drainTimeout.C:
					t.Fatal("tail samples missing")
				case <-time.After(10 * time.Millisecond):
				}
			}
			select {
			case err := <-errors:
				t.Fatal(err)
			default:
			}
			mu.Lock()
			defer mu.Unlock()
			percentile := func(samples []float64, p int) float64 {
				if len(samples) == 0 {
					t.Fatal("missing samples")
				}
				sort.Float64s(samples)
				if samples[0] < 0 {
					t.Fatal("invalid timestamp")
				}
				return samples[(p*len(samples)+99)/100-1]
			}
			session := queueProbeSession(agent.Conn)
			stats := session.a.pc.SCTP().Stats()
			if os.Getenv("YUDESK_P2P_RECOVERY_PROBE") == "1" {
				for side := range recovery {
					counts := &recovery[side]
					t.Logf("diagnostic_sctp_side=%d t3_timeouts=%d tail_probes=%d rack_losses=%d fast_retransmits=%d", side, counts.t3.Load(), counts.pto.Load(), counts.rack.Load(), counts.fast.Load())
				}
			}

			if stats.Metadata == nil || !stats.Metadata.MessageInterleavingEnabled {
				t.Fatal("RFC 8260 interleaving must be negotiated for this probe")
			}
			if os.Getenv("YUDESK_P2P_PROBE_LOSS") == "1" {
				t.Logf("loss_packets=%d eligible_packets=%d", lostPackets.Load(), lossPackets.Load())
				if lostPackets.Load() == 0 {
					t.Fatal("loss fixture did not drop a packet")
				}
			}
			t.Logf("warm_ms=%.2f frames=%d bytes=%d duration_ms=%.2f payload_mbps=%.3f input_n=%d request_receive_p50_ms=%.2f request_receive_p95_ms=%.2f response_n=%d response_p50_ms=%.2f response_p95_ms=%.2f audio_n=%d audio_p50_ms=%.2f audio_p95_ms=%.2f cwnd=%d srtt_ms=%.2f", float64(warmDuration)/float64(time.Millisecond), frameCount, frameCount*len(payload), float64(duration)/float64(time.Millisecond), float64(frameCount*len(payload)*8)/duration.Seconds()/1e6, len(applied), percentile(applied, 50), percentile(applied, 95), len(responded), percentile(responded, 50), percentile(responded, 95), len(audio), percentile(audio, 50), percentile(audio, 95), stats.CongestionWindow, stats.SmoothedRoundTripTime*1000)
		})
	}
}

func queueProbeSession(conn net.Conn) *sessionConn {
	switch c := conn.(type) {
	case *sessionConn:
		return c
	case *queueProbeACKPacer:
		return queueProbeSession(c.Conn)
	default:
		panic("unexpected probe connection")
	}
}

// Test-only ACK-rate experiment. All frame bytes still traverse the production
// reliable ordered transport. No payload is dropped, recompressed or resized.
type queueProbeACKPacer struct {
	net.Conn
	raw            *dataConn
	pc             *webrtc.PeerConnection
	started        time.Time
	written, acked uint64
	baseRTT, rate  float64
	limit          uint64
}

func (p *queueProbeACKPacer) Write(data []byte) (int, error) {
	for {
		now := time.Now()
		pending := p.raw.dc.BufferedAmount()
		ack := p.written - min(p.written, pending)
		rtt := p.pc.SCTP().Stats().SmoothedRoundTripTime
		if rtt > 0 && (p.baseRTT == 0 || rtt < p.baseRTT) {
			p.baseRTT = rtt
		}
		if dt := now.Sub(p.started).Seconds(); dt >= .02 {
			if delivered := ack - p.acked; delivered > 0 {
				rate := float64(delivered) / dt
				if p.rate == 0 {
					p.rate = rate
				} else {
					p.rate = .75*p.rate + .25*rate
				}
				p.limit = uint64(max(float64(chunkSize), min(float64(bufferLimit), p.rate*(p.baseRTT+.02))))
			}
			p.started = now
			p.acked = ack
		}
		if pending+uint64(len(data)) <= max(p.limit, uint64(len(data))) {
			break
		}
		when, _ := p.raw.wd.snapshot()
		if !when.IsZero() && !now.Before(when) {
			return 0, os.ErrDeadlineExceeded
		}
		select {
		case <-p.raw.done:
			return 0, net.ErrClosed
		case <-time.After(2 * time.Millisecond):
		}
	}
	n, err := p.Conn.Write(data)
	p.written += uint64(n)
	return n, err
}

// Capture keeps its own fixed sample clock while writes block. Every scheduled
// packet must be sent and received, including the tail; a coalescing ticker in
// the writer would silently skip the hardest source intervals under load.
func queueProbeContinuousSource(ctx context.Context, c *protocol.Conn, kind, method string, interval time.Duration, data []byte, sent, captured func()) error {
	ctx, cancel := context.WithCancel(ctx)
	samples := make(chan time.Time, 2048)
	result := make(chan error, 1)
	producerDone := make(chan struct{})
	defer func() {
		cancel()
		<-producerDone
	}()
	go func() {
		defer close(producerDone)
		defer close(samples)
		next := time.Now().Add(interval)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				result <- nil
				return
			case tick := <-ticker.C:
				for !next.After(tick) {
					select {
					case samples <- next:
						if captured != nil {
							captured()
						}
					default:
						result <- fmt.Errorf("continuous %s source overflow", method)
						return
					}
					next = next.Add(interval)
				}
			}
		}
	}()
	for stamp := range samples {
		if err := c.WriteMessage(protocol.Message{Kind: kind, Method: method, ID: strconv.FormatInt(stamp.UnixNano(), 10), Data: data}); err != nil {
			return err
		}
		sent()
	}
	return <-result
}

type queueProbeNotifyWrite struct {
	net.Conn
	entered chan struct{}
	once    sync.Once
}

func (c *queueProbeNotifyWrite) Write(data []byte) (int, error) {
	c.once.Do(func() { close(c.entered) })
	return c.Conn.Write(data)
}

// A blocked transport must not stop the source clock or coalesce away its
// captured packets. Cancel capture while the first write is still blocked,
// then release the wire and require every queued packet and exact clock step.
func TestContinuousSourceProbeRetainsBlockedCapture(t *testing.T) {
	for _, source := range []struct{ kind, method string }{{"event", "audio"}, {"request", "input"}} {
		t.Run(source.method, func(t *testing.T) {
			assertContinuousProbeRetainsBlockedCapture(t, source.kind, source.method)
		})
	}
}

func assertContinuousProbeRetainsBlockedCapture(t *testing.T, kind, method string) {
	t.Helper()
	a, b := net.Pipe()
	t.Cleanup(func() { _ = a.Close(); _ = b.Close() })
	_ = a.SetDeadline(time.Now().Add(3 * time.Second))
	_ = b.SetDeadline(time.Now().Add(3 * time.Second))
	wire := &queueProbeNotifyWrite{Conn: a, entered: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	payload := []byte{0x38, 0x76, 0x19, 0xaf}
	finished := make(chan error, 1)
	sent := 0
	captureReady := make(chan struct{})
	captured := 0
	go func() {
		finished <- queueProbeContinuousSource(ctx, protocol.NewConn(wire), kind, method, 10*time.Millisecond, payload, func() { sent++ }, func() {
			captured++
			if captured == 8 {
				close(captureReady)
			}
		})
		_ = a.Close()
	}()
	select {
	case <-wire.entered:
	case <-time.After(time.Second):
		t.Fatal("continuous source did not start")
	}
	select {
	case <-captureReady:
	case <-time.After(2 * time.Second):
		t.Fatal("blocked writer stopped the independent source clock")
	}
	cancel()
	reader := protocol.NewConn(b)
	var stamps []int64
	for {
		message, err := reader.ReadMessage()
		if err != nil {
			break
		}
		stamp, err := strconv.ParseInt(message.ID, 10, 64)
		if err != nil || !bytes.Equal(message.Data, payload) || message.Kind != kind || message.Method != method {
			t.Fatal("invalid captured source packet")
		}
		if len(stamps) > 0 && stamp-stamps[len(stamps)-1] != int64(10*time.Millisecond) {
			t.Fatal("source clock skipped or duplicated a captured interval")
		}
		stamps = append(stamps, stamp)
	}
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	if len(stamps) < 8 || len(stamps) != sent {
		t.Fatalf("blocked source lost packets: sent=%d received=%d", sent, len(stamps))
	}
}

// queueProbeInteractivePair adds channels only between the fixture's two
// already authenticated peers. Production still rejects unsolicited channels;
// a shipping design would need explicit capability agreement and message-class
// ordering/security checks instead of this test-only wiring.
func queueProbeInteractivePair(t *testing.T, viewer, agent *protocol.Conn) (*protocol.Conn, *protocol.Conn) {
	t.Helper()
	type opened struct {
		index int
		conn  *dataConn
		err   error
	}
	ready := make(chan opened, 2)
	for index, conn := range []*protocol.Conn{viewer, agent} {
		pc := queueProbeSession(conn.Conn).a.pc
		id, negotiated, ordered := uint16(2), true, true
		dc, err := pc.CreateDataChannel("queue-probe-interactive", &webrtc.DataChannelInit{ID: &id, Negotiated: &negotiated, Ordered: &ordered})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = dc.Close() })
		dc.OnOpen(func() {
			raw, err := dc.DetachWithDeadline()
			var stream *dataConn
			if err == nil {
				stream = newDataConn(raw, dc)
				err = stream.SetDeadline(time.Now().Add(25 * time.Second))
			}
			ready <- opened{index: index, conn: stream, err: err}
		})
	}
	var pair [2]*protocol.Conn
	timer := time.NewTimer(3 * time.Second)
	defer timer.Stop()
	for range pair {
		select {
		case result := <-ready:
			if result.err != nil {
				t.Fatal(result.err)
			}
			pair[result.index] = protocol.NewConn(result.conn)
			t.Cleanup(func() { _ = result.conn.Close() })
		case <-timer.C:
			t.Fatal("test interactive channel did not open")
		}
	}
	return pair[0], pair[1]
}

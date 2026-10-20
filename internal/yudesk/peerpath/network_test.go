package peerpath

import (
	"context"
	"net"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pion/logging"
	"github.com/pion/transport/v4"
	"github.com/pion/transport/v4/vnet"
	"github.com/pion/webrtc/v4"
	"golang.org/x/net/dns/dnsmessage"
	"welink/internal/yudesk/protocol"
)

// DNS always stays on a test-owned loopback socket. A silent fixture receives
// real resolver queries but never replies, so cancellation is not simulated by
// a function that simply returns ctx.Err(). No system resolver is replaced.
type attemptDNSFixture struct {
	resolver *net.Resolver
	query    chan struct{}
	a, aaaa  atomic.Int32
}

func newAttemptDNSFixture(t *testing.T, reply bool) *attemptDNSFixture {
	t.Helper()
	socket, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f := &attemptDNSFixture{query: make(chan struct{}, 8)}
	f.resolver = &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "udp4", socket.LocalAddr().String())
	}}
	done := make(chan struct{})
	go func() {
		defer close(done)
		buffer := make([]byte, 4096)
		for {
			n, source, err := socket.ReadFrom(buffer)
			if err != nil {
				return
			}
			var parser dnsmessage.Parser
			header, err := parser.Start(buffer[:n])
			if err != nil {
				t.Error(err)
				return
			}
			question, err := parser.Question()
			if err != nil {
				t.Error(err)
				return
			}
			if question.Type == dnsmessage.TypeA {
				f.a.Add(1)
			} else if question.Type == dnsmessage.TypeAAAA {
				f.aaaa.Add(1)
			}
			select {
			case f.query <- struct{}{}:
			default:
			}
			if !reply {
				continue
			}
			builder := dnsmessage.NewBuilder(nil, dnsmessage.Header{ID: header.ID, Response: true, RecursionDesired: true, RecursionAvailable: true})
			if err := builder.StartQuestions(); err != nil {
				t.Error(err)
				return
			}
			if err := builder.Question(question); err != nil {
				t.Error(err)
				return
			}
			if err := builder.StartAnswers(); err != nil {
				t.Error(err)
				return
			}
			resource := dnsmessage.ResourceHeader{Name: question.Name, Class: dnsmessage.ClassINET, TTL: 1}
			if question.Type == dnsmessage.TypeA {
				err = builder.AResource(resource, dnsmessage.AResource{A: [4]byte{192, 0, 2, 1}})
			} else if question.Type == dnsmessage.TypeAAAA {
				err = builder.AAAAResource(resource, dnsmessage.AAAAResource{AAAA: [16]byte{0x20, 0x01, 0x0d, 0xb8, 15: 1}})
			}
			if err != nil {
				t.Error(err)
				return
			}
			response, err := builder.Finish()
			if err != nil {
				t.Error(err)
				return
			}
			if _, err := socket.WriteTo(response, source); err != nil {
				t.Error(err)
				return
			}
		}
	}()
	t.Cleanup(func() { _ = socket.Close(); <-done })
	return f
}

func TestAttemptNetworkPreservesLiteralUDPAddresses(t *testing.T) {
	resolver := &net.Resolver{PreferGo: true, Dial: func(context.Context, string, string) (net.Conn, error) {
		t.Error("literal endpoint attempted DNS")
		return nil, net.ErrClosed
	}}
	n := &cancellableNetwork{ctx: context.Background(), resolver: resolver}
	for _, network := range []string{"", "udp", "udp4", "udp6", "tcp"} {
		for _, address := range []string{"", ":3478", "127.0.0.1:3478", "[2001:db8::1]:3478", "[fe80::1%fixture]:3478", "[::ffff:192.0.2.1]:3478", "[::]:3478", "127.0.0.1:", "127.0.0.1:65536", "127.0.0.1:-1", "bad-address"} {
			got, err := n.ResolveUDPAddr(network, address)
			want, wantErr := net.ResolveUDPAddr(network, address)
			if (err == nil) != (wantErr == nil) || !reflect.DeepEqual(got, want) {
				t.Fatalf("%s %q: got=%v err=%v want=%v err=%v", network, address, got, err, want, wantErr)
			}
		}
	}
}

func TestAttemptNetworkDNSRespectsAddressFamily(t *testing.T) {
	for _, family := range []struct {
		network, want string
		a, aaaa       int32
	}{{"udp4", "192.0.2.1", 1, 0}, {"udp6", "2001:db8::1", 0, 1}, {"udp", "192.0.2.1", 1, 1}} {
		t.Run(family.network, func(t *testing.T) {
			fixture := newAttemptDNSFixture(t, true)
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			n := &cancellableNetwork{ctx: ctx, resolver: fixture.resolver}
			got, err := n.ResolveUDPAddr(family.network, "stun.fixture.test.:3478")
			if err != nil || got.IP.String() != family.want || got.Port != 3478 || fixture.a.Load() != family.a || fixture.aaaa.Load() != family.aaaa {
				t.Fatalf("DNS family=%s got=%v err=%v A=%d AAAA=%d", family.network, got, err, fixture.a.Load(), fixture.aaaa.Load())
			}
		})
	}
}

func TestAttemptCloseCancelsBlockedDNS(t *testing.T) {
	for _, mode := range []string{"close", "parent-cancel"} {
		t.Run(mode, func(t *testing.T) {
			fixture := newAttemptDNSFixture(t, false)
			network, err := vnet.NewNet(&vnet.NetConfig{StaticIPs: []string{"192.0.2.10"}})
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			options := Options{STUNURLs: []string{"stun:stun.fixture.test.:3478"}, TrickleICE: true,
				newNet: func(ctx context.Context) (transport.Net, error) {
					return &cancellableNetwork{Net: network, ctx: ctx, resolver: fixture.resolver}, nil
				}, configure: func(s *webrtc.SettingEngine) {
					s.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
					s.LoggerFactory = &logging.DefaultLoggerFactory{DefaultLogLevel: logging.LogLevelError}
				}}
			a, err := newAttempt(ctx, options, 15*time.Second)
			if err != nil {
				t.Fatal(err)
			}
			defer a.close()
			if value, _ := a.trickleDescription(true); value.SDP == "" {
				t.Fatal("failed to start real ICE gathering")
			}
			select {
			case <-fixture.query:
			case <-time.After(2 * time.Second):
				t.Fatal("ICE did not issue a real DNS request")
			}
			started := time.Now()
			if mode == "parent-cancel" {
				cancel()
			}
			done := make(chan struct{})
			go func() { a.close(); close(done) }()
			select {
			case <-done:
				t.Logf("pending_dns=true close_ms=%.2f mode=%s", float64(time.Since(started))/float64(time.Millisecond), mode)
			case <-time.After(time.Second):
				cancel()
				<-done
				t.Fatal("attempt cleanup waited for the silent DNS server")
			}
			if mode == "close" && ctx.Err() != nil {
				t.Fatal("early cleanup canceled the caller's session context")
			}
		})
	}
}

func TestTrickleSilentDNSFallsBackWithinAttemptBudget(t *testing.T) {
	fixture := newAttemptDNSFixture(t, false)
	wan, err := vnet.NewRouter(&vnet.RouterConfig{CIDR: "192.0.2.0/24", LoggerFactory: logging.NewDefaultLoggerFactory()})
	if err != nil {
		t.Fatal(err)
	}
	wan.AddChunkFilter(func(vnet.Chunk) bool { return false })
	var options [2]Options
	for side, address := range []string{"192.0.2.10", "192.0.2.20"} {
		network, err := vnet.NewNet(&vnet.NetConfig{StaticIPs: []string{address}})
		if err != nil {
			t.Fatal(err)
		}
		if err := wan.AddNet(network); err != nil {
			t.Fatal(err)
		}
		options[side] = Options{STUNURLs: []string{"stun:stun.fixture.test.:3478"}, TrickleICE: true, Timeout: 300 * time.Millisecond,
			newNet: func(ctx context.Context) (transport.Net, error) {
				return &cancellableNetwork{Net: network, ctx: ctx, resolver: fixture.resolver}, nil
			}, configure: func(s *webrtc.SettingEngine) {
				s.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
				s.LoggerFactory = &logging.DefaultLoggerFactory{DefaultLogLevel: logging.LogLevelError}
			}}
	}
	if err := wan.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = wan.Stop() })
	left, right := encryptedPair(t)
	bases := [2]*protocol.Conn{protocol.NewConn(left), protocol.NewConn(right)}
	started := time.Now()
	results := runPair(t, context.Background(), bases, options, [2]func() (protocol.Message, error){})
	elapsed := time.Since(started)
	for side, result := range results {
		if result.err != nil || result.info.Mode != "relay" || result.c != bases[side] {
			t.Fatalf("silent DNS fallback side %d: %v %+v", side, result.err, result.info)
		}
	}
	if fixture.a.Load() == 0 || elapsed > 2*time.Second {
		t.Fatalf("fallback did not bound active DNS: queries=%d elapsed=%s", fixture.a.Load(), elapsed)
	}
	roundTrip(t, results[0].c, results[1].c, 17003)
	roundTrip(t, results[1].c, results[0].c, 17003)
	t.Logf("attempt_budget_ms=300 fallback_ms=%.2f pending_dns=true relay_bytes_exact=true", float64(elapsed)/float64(time.Millisecond))
}

// Package peerpath upgrades an authenticated, end-to-end encrypted relay to a
// reliable UDP WebRTC data channel. The relay remains the authorization tether.
package peerpath

import (
	"context"
	"errors"
	"net"
	"time"

	"github.com/pion/ice/v4"
	"github.com/pion/transport/v4"
	"github.com/pion/webrtc/v4"
	"welink/internal/yudesk/natmap"
)

const (
	defaultTimeout = 15 * time.Second
	signalGrace    = 2 * time.Second
	heartbeatEvery = 2 * time.Second
	tetherTimeout  = 7 * time.Second
	maxSDP         = 32 << 10
	maxCandidates  = 32
	chunkSize      = 16 << 10
	bufferLimit    = 256 << 10
)

var (
	ErrSignaling  = errors.New("peerpath: signaling failed; session terminated")
	ErrDirectLost = errors.New("peerpath: direct connection lost; reconnect to negotiate a new session")
	ErrRelayLost  = errors.New("peerpath: relay authorization tether lost; session terminated")
)

type Options struct {
	// Nil uses DefaultOptions. An explicitly empty slice gathers LAN hosts only.
	// Only stun: URLs using UDP are allowed; TURN and TCP are never used.
	STUNURLs []string
	// ICEServers contains authenticated TURN/UDP servers supplied by the
	// verified YuDesk relay for this one session. Callers must not populate it
	// from untrusted UI input.
	ICEServers []webrtc.ICEServer
	// PortMapping asks PCP/NAT-PMP/UPnP-capable routers to map the single ICE UDP
	// socket. It is enabled by DefaultOptions and remains false for explicit
	// test/custom Options unless requested.
	PortMapping bool
	// TrickleICE is enabled only after both authorized peers advertise
	// p2pTrickleV1. Mixed-version sessions retain the original full-SDP exchange.
	TrickleICE bool
	// pathV2 is set only by an authenticated relay policy. It enables extended
	// ready-state path labels while mixed-version peers keep the V1 wire shape.
	pathV2 bool
	// Timeout bounds the ICE attempt, including gathering. Zero means 15 seconds.
	// Values above 15 seconds are capped.
	// Signaling has an additional 2-second allowance to agree on the result.
	Timeout time.Duration
	// Wrap instruments transports before protocol.NewConn. Authenticate wraps
	// the initial relay, and Negotiate wraps a successful direct connection.
	// Negotiate preserves the supplied base (and its buffered reader) on fallback:
	// callers using Negotiate alone should instrument base at its construction.
	// The wrapper must preserve Close and deadline semantics.
	Wrap func(net.Conn) net.Conn
	// WrapLane instruments each committed realtime transport without replacing
	// the primary wrapper. Nil keeps the transports unchanged.
	WrapLane func(net.Conn) net.Conn
	// OnProgress receives local ICE/mapping phases, never addresses or secrets.
	// It may be called concurrently and must return without blocking network IO.
	OnProgress func(Progress)
	// RelayLane opens an additional socket on the already verified relay only.
	// A nil callback preserves compatibility with older relay installations.
	RelayLane func(context.Context, string) (net.Conn, error)
	laneSeed  []byte // accepted only inside the authorized E2E auth bootstrap
	laneRole  string

	// Per-call fault injection; never global, so concurrent tests stay isolated.
	configure func(*webrtc.SettingEngine)
	mapUDP    func(context.Context, *net.UDPConn, natmap.Options) (natmap.Mapping, error)
	newUDPMux func() (ice.UDPMux, *net.UDPConn, error)
	newNet    func(context.Context) (transport.Net, error)
}

func (o Options) WithSessionLanes(seed []byte) Options {
	if len(seed) == 32 {
		o.laneSeed = append([]byte(nil), seed...)
	} else {
		o.laneSeed = nil
	}
	return o
}

func DefaultOptions() Options {
	return Options{STUNURLs: []string{"stun:www.yucg.cn:8233", "stun:www.yucg.cn:8254", "stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"}, Timeout: defaultTimeout, PortMapping: true}
}

// WithProbe15 requires mutual application support as well as the relay flag.
// A relay without RTC policy still needs the old peer's 4.5-second budget.
func (o Options) WithProbe15(supported bool) Options {
	if !supported && (o.Timeout == 0 || o.Timeout > 10*time.Second) {
		o.Timeout = 4500 * time.Millisecond
	}
	return o
}

// WithRTCPolicy merges a relay-authenticated, session-bound ICE policy. Direct
// host/srflx candidates retain higher ICE priority than TURN relay candidates,
// so direct and low-latency UDP fallback race without a serial timeout.
func (o Options) WithRTCPolicy(policy *RTCPolicy) Options {
	if policy == nil {
		return o
	}
	o.STUNURLs = append([]string(nil), o.STUNURLs...)
	o.ICEServers = append([]webrtc.ICEServer(nil), o.ICEServers...)
	o.pathV2 = true
	if policy.DirectTimeoutMS >= 500 && policy.DirectTimeoutMS <= 15000 {
		o.Timeout = time.Duration(policy.DirectTimeoutMS) * time.Millisecond
	}
	for _, server := range policy.ICEServers {
		var turnURLs []string
		for _, raw := range server.URLs {
			if len(raw) >= 5 && raw[:5] == "stun:" {
				if !containsString(o.STUNURLs, raw) {
					o.STUNURLs = append(o.STUNURLs, raw)
				}
				continue
			}
			turnURLs = append(turnURLs, raw)
		}
		if len(turnURLs) != 0 && policy.RelayEnabled {
			o.ICEServers = append(o.ICEServers, webrtc.ICEServer{URLs: turnURLs, Username: server.Username, Credential: server.Credential, CredentialType: webrtc.ICECredentialTypePassword})
		}
	}
	return o
}

func containsString(values []string, value string) bool {
	for _, existing := range values {
		if existing == value {
			return true
		}
	}
	return false
}

func (o Options) normalized() Options {
	if o.STUNURLs == nil {
		o.STUNURLs = append([]string(nil), DefaultOptions().STUNURLs...)
	}
	if o.Timeout <= 0 {
		o.Timeout = defaultTimeout
	}
	o.Timeout = min(o.Timeout, 15*time.Second)
	return o
}

type Info struct {
	Mode   string `json:"mode"`
	Reason string `json:"reason"`
}

func (o Options) wrap(c net.Conn) net.Conn {
	if o.Wrap != nil {
		return o.Wrap(c)
	}
	return c
}

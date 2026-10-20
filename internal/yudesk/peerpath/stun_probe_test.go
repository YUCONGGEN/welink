package peerpath

import (
	"context"
	"net"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/pion/ice/v4"
	"github.com/pion/stun/v4"
)

// Opt-in diagnostic sends only STUN binding requests to configured endpoints.
// Reports reachability/timing/mapping behavior, never the
// client's public address, credentials, desktop contents or input.
func TestConfiguredSTUNReachability(t *testing.T) {
	if os.Getenv("YUDESK_P2P_PROBE") != "1" {
		t.Skip("opt-in own-server UDP probe")
	}
	socket, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero})
	if err != nil {
		t.Fatal(err)
	}
	defer socket.Close()
	var previous *stun.XORMappedAddress
	for _, raw := range DefaultOptions().STUNURLs {
		uri, err := stun.ParseURI(raw)
		if err != nil {
			t.Fatal(err)
		}
		remote, err := net.ResolveUDPAddr("udp4", net.JoinHostPort(uri.Host, strconv.Itoa(uri.Port)))
		if err != nil {
			t.Fatal(err)
		}
		request := stun.MustBuild(stun.TransactionID, stun.BindingRequest)
		start := time.Now()
		var mapped stun.XORMappedAddress
		ok := false
		for attempt := 0; attempt < 3 && !ok; attempt++ {
			_ = socket.SetDeadline(time.Now().Add(500 * time.Millisecond))
			_, _ = socket.WriteToUDP(request.Raw, remote)
			buffer := make([]byte, 1500)
			for {
				n, source, err := socket.ReadFromUDP(buffer)
				if err != nil {
					break
				}
				if !source.IP.Equal(remote.IP) || source.Port != remote.Port {
					continue
				}
				response := &stun.Message{Raw: buffer[:n]}
				if response.Decode() == nil && response.Type == stun.BindingSuccess && response.TransactionID == request.TransactionID && mapped.GetFrom(response) == nil {
					ok = true
					break
				}
			}
		}
		if !ok {
			t.Errorf("%s UDP/STUN unreachable after bounded retries", raw)
			continue
		}
		t.Logf("%s reachable in %s", raw, time.Since(start).Round(time.Millisecond))
		if previous != nil {
			t.Logf("same-socket mapping changed between server ports: %t", previous.Port != mapped.Port || !previous.IP.Equal(mapped.IP))
		}
		previous = &mapped
	}
	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()
	a, err := newAttempt(ctx, DefaultOptions(), 1125*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer a.close()
	raw, reason := a.description(ctx, true, 1125*time.Millisecond)
	if reason != "" {
		t.Fatal(reason)
	}
	host4, host6, srflx := 0, 0, 0
	for _, line := range strings.Split(raw, "\r\n") {
		if !strings.HasPrefix(line, "a=candidate:") {
			continue
		}
		candidate, err := ice.UnmarshalCandidate(strings.TrimPrefix(line, "a=candidate:"))
		if err != nil {
			t.Fatal(err)
		}
		ip := net.ParseIP(candidate.Address())
		if candidate.Type() == ice.CandidateTypeServerReflexive {
			srflx++
		}
		if candidate.Type() == ice.CandidateTypeHost {
			if ip.To4() != nil {
				host4++
			} else if ip.IsGlobalUnicast() && !ip.IsPrivate() {
				host6++
			}
		}
	}
	t.Logf("default ICE candidate counts: IPv4 host=%d, public IPv6 host=%d, STUN=%d; router mapping created=%t", host4, host6, srflx, a.mapped)
}

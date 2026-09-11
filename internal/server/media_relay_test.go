package server

import (
	"bytes"
	"github.com/pion/turn/v5"
	"net"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMediaRelayAuthenticationDataAndRevocation(t *testing.T) {
	settings := DefaultSettings()
	settings.DataDir = t.TempDir()
	settings.Registration.Enabled = true
	settings.Media.Enabled = true
	settings.Media.Listen = "127.0.0.1:0"
	settings.Media.PublicAddress = "127.0.0.1"
	settings.Media.AllowedPeerCIDRs = []string{"127.0.0.0/8"}
	settings.Media.RelayMinPort = 39000
	settings.Media.RelayMaxPort = 39063
	settings.Media.MaxAllocationsPerUser = 1
	settings.Media.SecretFile = filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(settings.Media.SecretFile, []byte(strings.Repeat("relay-secret-", 4)), 0600); err != nil {
		t.Fatal(err)
	}
	s, err := New(Config{Settings: &settings})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()
	defer s.Close()
	f := &fixture{t: t, s: s, server: ts, url: ts.URL}
	a := f.register("relay_client")
	f.request("GET", "/api/rtc-config", "", nil, 401, nil)
	var policy rtcPolicy
	f.request("GET", "/api/rtc-config", a.Token, nil, 200, &policy)
	if !policy.RelayEnabled || len(policy.ICEServers) != 2 || policy.DirectTimeoutMS != 8000 {
		t.Fatal("missing relay policy")
	}
	credential := policy.ICEServers[1]
	if bytes.Contains([]byte(credential.Credential), s.media.secret) {
		t.Fatal("server secret exposed")
	}
	udp, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer udp.Close()
	client, err := turn.NewClient(&turn.ClientConfig{TURNServerAddr: s.media.address, STUNServerAddr: s.media.address, Conn: udp, Username: credential.Username, Password: credential.Credential, Realm: settings.Media.Realm, RTO: 100 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if err = client.Listen(); err != nil {
		t.Fatal(err)
	}
	connection, err := client.Allocate()
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	relayAddress := connection.LocalAddr().(*net.UDPAddr)
	if relayAddress.Port < settings.Media.RelayMinPort || relayAddress.Port > settings.Media.RelayMaxPort {
		t.Fatal("relay port outside configured range")
	}
	peer, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	payload := []byte("media relay payload")
	if _, err = connection.WriteTo(payload, peer.LocalAddr()); err != nil {
		t.Fatal(err)
	}
	peer.SetReadDeadline(time.Now().Add(3 * time.Second))
	buffer := make([]byte, 1024)
	n, source, err := peer.ReadFrom(buffer)
	if err != nil || !bytes.Equal(payload, buffer[:n]) || source.String() != relayAddress.String() {
		t.Fatal("relay outbound packet", err)
	}
	if _, err = peer.WriteTo([]byte("reply through relay"), source); err != nil {
		t.Fatal(err)
	}
	connection.SetReadDeadline(time.Now().Add(3 * time.Second))
	n, _, err = connection.ReadFrom(buffer)
	if err != nil || string(buffer[:n]) != "reply through relay" {
		t.Fatal("relay inbound packet", err)
	}
	if _, _, err = s.media.AllocatePacketConn(turn.AllocateListenerConfig{UserID: credential.Username, Network: "udp4"}); err == nil {
		t.Fatal("per-user allocation quota bypassed")
	}
	if _, _, err = s.media.AllocatePacketConn(turn.AllocateListenerConfig{UserID: credential.Username, Network: "udp4", RequestedPort: 80}); err == nil {
		t.Fatal("requested port escaped range")
	}
	f.request("POST", "/api/auth/logout", a.Token, map[string]any{}, 200, nil)
	if s.media.alive(credential.Username) || len(s.media.snapshot()) != 0 {
		t.Fatal("logout kept relay allocation")
	}
	if _, _, ok := s.media.authenticate(&turn.RequestAttributes{Username: credential.Username, Realm: settings.Media.Realm}); ok {
		t.Fatal("logged out credential authorized")
	}
}

func TestMediaRelayPeerPolicyAndCredentialBounds(t *testing.T) {
	m := &mediaRelay{settings: defaultMediaSettings()}
	for _, ip := range []string{"0.0.0.0", "127.0.0.1", "10.1.2.3", "192.168.1.1", "169.254.169.254", "100.64.1.2", "224.0.0.1", "::1", "fc00::1"} {
		if m.permission(nil, net.ParseIP(ip)) {
			t.Fatalf("private peer allowed: %s", ip)
		}
	}
	if !m.permission(nil, net.ParseIP("223.166.147.252")) {
		t.Fatal("public peer denied")
	}
	for _, username := range []string{"bad", "0:" + strings.Repeat("a", 32) + ":" + strings.Repeat("b", 32), "9999999999:" + strings.Repeat("a", 32) + ":" + strings.Repeat("b", 32)} {
		if _, _, ok := m.identity(username); ok {
			t.Fatal("invalid credential lifetime allowed")
		}
	}
	config := defaultMediaSettings()
	config.Enabled = true
	config.SecretFile = "secret"
	config.RelayMinPort = 8252
	if config.validate() == nil {
		t.Fatal("listener overlaps relay range")
	}
}

func TestMediaRelayUDPAndTCPWithoutRouterHairpin(t *testing.T) {
	settings := DefaultSettings()
	settings.DataDir = t.TempDir()
	settings.Registration.Enabled = true
	settings.Media.Enabled = true
	settings.Media.Listen = "127.0.0.1:0"
	settings.Media.PublicAddress = "203.0.113.20"
	settings.Media.RelayMinPort = 39100
	settings.Media.RelayMaxPort = 39163
	settings.Media.SecretFile = filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(settings.Media.SecretFile, []byte(strings.Repeat("private-relay-key-", 3)), 0600); err != nil {
		t.Fatal(err)
	}
	s, err := New(Config{Settings: &settings})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()
	defer s.Close()
	f := &fixture{t: t, s: s, server: ts, url: ts.URL}
	a := f.register("relay_hairpin")
	var policy rtcPolicy
	f.request("GET", "/api/rtc-config", a.Token, nil, 200, &policy)
	credential := policy.ICEServers[1]
	var clients []*turn.Client
	var allocations []net.PacketConn
	for _, protocol := range []string{"udp", "tcp"} {
		var transport net.PacketConn
		if protocol == "udp" {
			transport, err = net.ListenPacket("udp4", "127.0.0.1:0")
		} else {
			var conn net.Conn
			conn, err = net.DialTimeout("tcp4", s.media.address, 3*time.Second)
			if err == nil {
				transport = turn.NewSTUNConn(conn)
			}
		}
		if err != nil {
			t.Fatal(err)
		}
		defer transport.Close()
		client, e := turn.NewClient(&turn.ClientConfig{TURNServerAddr: s.media.address, STUNServerAddr: s.media.address, Conn: transport, Username: credential.Username, Password: credential.Credential, Realm: settings.Media.Realm, RTO: 100 * time.Millisecond})
		if e != nil {
			t.Fatal(e)
		}
		defer client.Close()
		if err = client.Listen(); err != nil {
			t.Fatal(err)
		}
		conn, e := client.Allocate()
		if e != nil {
			t.Fatal(e)
		}
		defer conn.Close()
		clients = append(clients, client)
		allocations = append(allocations, conn)
	}
	for i, client := range clients {
		if err = client.CreatePermission(allocations[1-i].LocalAddr()); err != nil {
			t.Fatal(err)
		}
	}
	for i, source := range allocations {
		if _, err = source.WriteTo([]byte("encrypted-media-packet"), allocations[1-i].LocalAddr()); err != nil {
			t.Fatal(err)
		}
		other := allocations[1-i]
		other.SetReadDeadline(time.Now().Add(3 * time.Second))
		buffer := make([]byte, 128)
		n, from, e := other.ReadFrom(buffer)
		if e != nil || string(buffer[:n]) != "encrypted-media-packet" || from.String() != source.LocalAddr().String() {
			t.Fatalf("relay-to-relay path %d failed: %v", i, e)
		}
	}
}

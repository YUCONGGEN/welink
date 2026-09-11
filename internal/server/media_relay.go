package server

// ICE follows YuDesk's direct-first approach. TURN carries encrypted WebRTC
// packets only after direct candidates cannot connect; it never terminates SRTP.
import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/pion/turn/v5"
	"golang.org/x/time/rate"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type MediaSettings struct {
	Enabled               bool     `json:"enabled"`
	Listen                string   `json:"listen"`
	PublicAddress         string   `json:"public_address"`
	URLs                  []string `json:"urls"`
	SecretFile            string   `json:"secret_file"`
	Realm                 string   `json:"realm"`
	CredentialSeconds     int      `json:"credential_seconds"`
	DirectTimeoutMS       int      `json:"direct_timeout_ms"`
	RelayMinPort          int      `json:"relay_min_port"`
	RelayMaxPort          int      `json:"relay_max_port"`
	MaxAllocationsPerUser int      `json:"max_allocations_per_user"`
	BytesPerSecond        int      `json:"bytes_per_second"`
	AllowedPeerCIDRs      []string `json:"allowed_peer_cidrs"`
}

func defaultMediaSettings() MediaSettings {
	return MediaSettings{Listen: ":8252", PublicAddress: "www.yucg.cn", URLs: []string{"turn:www.yucg.cn:8252?transport=udp", "turn:www.yucg.cn:8252?transport=tcp"}, Realm: "welink", CredentialSeconds: 21600, DirectTimeoutMS: 8000, RelayMinPort: 8260, RelayMaxPort: 8359, MaxAllocationsPerUser: 32, BytesPerSecond: 4 << 20}
}
func (m MediaSettings) validate() error {
	if m.DirectTimeoutMS < 1000 || m.DirectTimeoutMS > 30000 {
		return errors.New("media.direct_timeout_ms must be 1000–30000")
	}
	if !m.Enabled {
		return nil
	}
	if m.Listen == "" || m.PublicAddress == "" || m.SecretFile == "" || m.Realm == "" || len(m.URLs) == 0 || len(m.URLs) > 8 || m.CredentialSeconds < 900 || m.CredentialSeconds > 86400 || m.RelayMinPort < 1024 || m.RelayMaxPort > 65534 || m.RelayMinPort > m.RelayMaxPort || m.MaxAllocationsPerUser < 1 || m.MaxAllocationsPerUser > 256 || m.BytesPerSecond < 65536 || m.BytesPerSecond > 1<<30 {
		return errors.New("invalid media relay settings")
	}
	_, p, err := net.SplitHostPort(m.Listen)
	if err != nil {
		return errors.New("invalid media.listen")
	}
	port, err := strconv.Atoi(p)
	if err != nil || port < 0 || port > 65535 || (port >= m.RelayMinPort && port <= m.RelayMaxPort) {
		return errors.New("TURN listener must be outside relay port range")
	}
	for _, u := range m.URLs {
		if !strings.HasPrefix(u, "turn:") || strings.ContainsAny(u, "\r\n\t ") || len(u) > 256 {
			return errors.New("media.urls must contain TURN URLs")
		}
	}
	for _, cidr := range m.AllowedPeerCIDRs {
		if _, _, err := net.ParseCIDR(cidr); err != nil {
			return errors.New("invalid media.allowed_peer_cidrs")
		}
	}
	return nil
}

type iceServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}
type rtcPolicy struct {
	ICEServers      []iceServer `json:"iceServers"`
	DirectTimeoutMS int         `json:"directTimeoutMs"`
	Expires         int64       `json:"expires"`
	RelayEnabled    bool        `json:"relayEnabled"`
}

func (s *Server) rtcConfig(w http.ResponseWriter, r *http.Request) {
	out := rtcPolicy{ICEServers: []iceServer{}, DirectTimeoutMS: s.settings.Media.DirectTimeoutMS}
	if len(s.settings.Meetings.STUNURLs) > 0 {
		out.ICEServers = append(out.ICEServers, iceServer{URLs: s.settings.Meetings.STUNURLs})
	}
	if s.media != nil {
		var session string
		if err := s.db.QueryRow("SELECT id FROM session_info WHERE token=?", sessionHash(r)).Scan(&session); err != nil {
			fail(w, 401, "登录已过期")
			return
		}
		expires := time.Now().Add(time.Duration(s.settings.Media.CredentialSeconds) * time.Second).Unix()
		username := fmt.Sprintf("%d:%s:%s", expires, uid(r), session)
		out.ICEServers = append(out.ICEServers, iceServer{URLs: s.settings.Media.URLs, Username: username, Credential: s.media.password(username)})
		out.Expires = expires * 1000
		out.RelayEnabled = true
	}
	ok(w, out)
}

type mediaRelay struct {
	server      *turn.Server
	address     string
	owner       *Server
	settings    MediaSettings
	secret      []byte
	generator   *turn.RelayAddressGeneratorPortRange
	allowed     []*net.IPNet
	mu          sync.Mutex
	closing     bool
	connections map[*mediaPacketConn]bool
	users       map[string]*mediaUser
	done        chan struct{}
	once        sync.Once
}
type mediaUser struct {
	count   int
	limiter *rate.Limiter
}
type mediaPacketConn struct {
	net.PacketConn
	relay          *mediaRelay
	username, user string
	limiter        *rate.Limiter
	once           sync.Once
}

func (s *Server) startMediaRelay() error {
	m := s.settings.Media
	if !m.Enabled {
		return nil
	}
	secret, err := os.ReadFile(m.SecretFile)
	if err != nil {
		return fmt.Errorf("read TURN secret: %w", err)
	}
	secret = []byte(strings.TrimSpace(string(secret)))
	if len(secret) < 32 || len(secret) > 4096 {
		return errors.New("TURN secret must be 32–4096 bytes")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip4", m.PublicAddress)
	if err != nil || len(ips) == 0 {
		return errors.New("media.public_address has no IPv4 address")
	}
	udp, err := net.ListenPacket("udp4", m.Listen)
	if err != nil {
		return fmt.Errorf("TURN UDP listener: %w", err)
	}
	tcp, err := net.Listen("tcp4", udp.LocalAddr().String())
	if err != nil {
		udp.Close()
		return fmt.Errorf("TURN TCP listener: %w", err)
	}
	relay := &mediaRelay{owner: s, settings: m, secret: secret, generator: &turn.RelayAddressGeneratorPortRange{RelayAddress: ips[0], Address: "0.0.0.0", MinPort: uint16(m.RelayMinPort), MaxPort: uint16(m.RelayMaxPort), MaxRetries: 128}, connections: map[*mediaPacketConn]bool{}, users: map[string]*mediaUser{}, done: make(chan struct{})}
	for _, cidr := range m.AllowedPeerCIDRs {
		_, network, _ := net.ParseCIDR(cidr)
		relay.allowed = append(relay.allowed, network)
	}
	relay.server, err = turn.NewServer(turn.ServerConfig{Realm: m.Realm, AuthHandler: relay.authenticate, AllocationLifetime: 10 * time.Minute, PacketConnConfigs: []turn.PacketConnConfig{{PacketConn: udp, RelayAddressGenerator: relay, PermissionHandler: relay.permission}}, ListenerConfigs: []turn.ListenerConfig{{Listener: tcp, RelayAddressGenerator: relay, PermissionHandler: relay.permission}}})
	if err != nil {
		udp.Close()
		tcp.Close()
		return fmt.Errorf("TURN startup: %w", err)
	}
	relay.address = udp.LocalAddr().String()
	s.media = relay
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				relay.prune()
			case <-relay.done:
				return
			}
		}
	}()
	s.logger.Printf("media relay listening on %s (UDP/TCP), relay ports %d–%d", udp.LocalAddr(), m.RelayMinPort, m.RelayMaxPort)
	return nil
}
func (m *mediaRelay) password(username string) string {
	h := hmac.New(sha256.New, m.secret)
	h.Write([]byte(username))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}
func (m *mediaRelay) identity(username string) (user, session string, ok bool) {
	parts := strings.Split(username, ":")
	if len(parts) != 3 || !validID(parts[1]) || !validID(parts[2]) {
		return "", "", false
	}
	expires, err := strconv.ParseInt(parts[0], 10, 64)
	now := time.Now().Unix()
	if err != nil || expires <= now || expires > now+int64(m.settings.CredentialSeconds)+60 {
		return "", "", false
	}
	return parts[1], parts[2], true
}
func validID(value string) bool {
	if len(value) != 32 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
func (m *mediaRelay) alive(username string) bool {
	user, session, valid := m.identity(username)
	if !valid {
		return false
	}
	var found int
	return m.owner.db.QueryRow("SELECT 1 FROM session_info i JOIN sessions s ON s.token=i.token WHERE i.id=? AND s.user_id=? AND s.expires>? AND NOT EXISTS(SELECT 1 FROM deleted_accounts d WHERE d.user_id=s.user_id)", session, user, now()).Scan(&found) == nil
}
func (m *mediaRelay) authenticate(request *turn.RequestAttributes) (string, []byte, bool) {
	if request.Realm != m.settings.Realm || !m.alive(request.Username) {
		return "", nil, false
	}
	return request.Username, turn.GenerateAuthKey(request.Username, m.settings.Realm, m.password(request.Username)), true
}
func (m *mediaRelay) permission(_ net.Addr, ip net.IP) bool {
	if ip == nil || ip.IsUnspecified() || ip.IsMulticast() {
		return false
	}
	for _, network := range m.allowed {
		if network.Contains(ip) {
			return true
		}
	}
	v4 := ip.To4()
	cgnat := v4 != nil && v4[0] == 100 && (v4[1]&192) == 64
	return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.Equal(net.IPv4bcast) && !cgnat
}
func (m *mediaRelay) Validate() error { return m.generator.Validate() }
func (m *mediaRelay) AllocatePacketConn(conf turn.AllocateListenerConfig) (net.PacketConn, net.Addr, error) {
	user, _, valid := m.identity(conf.UserID)
	if !valid {
		return nil, nil, errors.New("invalid relay identity")
	}
	if conf.RequestedPort != 0 && (conf.RequestedPort < m.settings.RelayMinPort || conf.RequestedPort > m.settings.RelayMaxPort) {
		return nil, nil, errors.New("requested relay port outside configured range")
	}
	m.mu.Lock()
	state := m.users[user]
	if state == nil {
		state = &mediaUser{limiter: rate.NewLimiter(rate.Limit(m.settings.BytesPerSecond), m.settings.BytesPerSecond)}
		m.users[user] = state
	}
	if m.closing || state.count >= m.settings.MaxAllocationsPerUser {
		m.mu.Unlock()
		return nil, nil, errors.New("relay allocation quota reached")
	}
	state.count++
	m.mu.Unlock()
	conn, address, err := m.generator.AllocatePacketConn(conf)
	if err != nil {
		m.mu.Lock()
		state.count--
		if state.count == 0 {
			delete(m.users, user)
		}
		m.mu.Unlock()
		return nil, nil, err
	}
	wrapped := &mediaPacketConn{PacketConn: conn, relay: m, username: conf.UserID, user: user, limiter: state.limiter}
	m.mu.Lock()
	m.connections[wrapped] = true
	closing := m.closing
	m.mu.Unlock()
	if closing {
		wrapped.Close()
		return nil, nil, errors.New("relay is stopping")
	}
	return wrapped, address, nil
}

// WebRTC TURN-over-TCP still relays UDP media. Do not expose generic TCP proxies.
func (m *mediaRelay) AllocateListener(turn.AllocateListenerConfig) (net.Listener, net.Addr, error) {
	return nil, nil, errors.New("TCP peer allocations are disabled")
}
func (m *mediaRelay) AllocateConn(turn.AllocateConnConfig) (net.Conn, error) {
	return nil, errors.New("TCP peer allocations are disabled")
}
func (c *mediaPacketConn) Close() error {
	var err error
	c.once.Do(func() {
		m := c.relay
		m.mu.Lock()
		delete(m.connections, c)
		if u := m.users[c.user]; u != nil {
			u.count--
			if u.count == 0 {
				delete(m.users, c.user)
			}
		}
		m.mu.Unlock()
		err = c.PacketConn.Close()
	})
	return err
}
func (c *mediaPacketConn) ReadFrom(p []byte) (int, net.Addr, error) {
	for {
		n, address, err := c.PacketConn.ReadFrom(p)
		if err != nil || c.limiter.AllowN(time.Now(), n) {
			if udp, ok := address.(*net.UDPAddr); ok && udp.IP.IsLoopback() && c.relay.hasPort(udp.Port) {
				address = &net.UDPAddr{IP: c.relay.generator.RelayAddress, Port: udp.Port}
			}
			return n, address, err
		}
	}
}
func (c *mediaPacketConn) WriteTo(p []byte, address net.Addr) (int, error) {
	if !c.limiter.AllowN(time.Now(), len(p)) {
		return len(p), nil
	}
	// Relay-to-relay traffic on this server must not depend on router hairpin NAT.
	if udp, ok := address.(*net.UDPAddr); ok && udp.IP.Equal(c.relay.generator.RelayAddress) && c.relay.hasPort(udp.Port) {
		address = &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: udp.Port}
	}
	return c.PacketConn.WriteTo(p, address)
}
func (m *mediaRelay) hasPort(port int) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for c := range m.connections {
		if address, ok := c.PacketConn.LocalAddr().(*net.UDPAddr); ok && address.Port == port {
			return true
		}
	}
	return false
}
func (m *mediaRelay) snapshot() []*mediaPacketConn {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*mediaPacketConn, 0, len(m.connections))
	for c := range m.connections {
		out = append(out, c)
	}
	return out
}
func (m *mediaRelay) prune() {
	for _, conn := range m.snapshot() {
		if !m.alive(conn.username) {
			conn.Close()
		}
	}
}
func (m *mediaRelay) close() {
	m.once.Do(func() {
		m.mu.Lock()
		m.closing = true
		m.mu.Unlock()
		close(m.done)
		for _, c := range m.snapshot() {
			c.Close()
		}
		m.server.Close()
	})
}

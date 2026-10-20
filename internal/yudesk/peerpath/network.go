package peerpath

import (
	"context"
	"net"
	"net/netip"
	"sync"
	"time"

	"github.com/pion/transport/v4"
	"github.com/pion/transport/v4/stdnet"
)

type networkSnapshot struct {
	done    chan struct{}
	network transport.Net
	err     error
}

// Network interface enumeration can block inside Windows even though ICE's
// caller has expired. Share one immutable, short-lived snapshot, and allow
// each waiter to cancel independently. Never mutate a snapshot used by ICE.
type interfaceSnapshots struct {
	mu      sync.Mutex
	cached  transport.Net
	expires time.Time
	pending *networkSnapshot
	create  func() (transport.Net, error)
	ttl     time.Duration
}

var systemInterfaces = interfaceSnapshots{
	create: func() (transport.Net, error) { return stdnet.NewNet() },
	ttl:    time.Second,
}

func (s *interfaceSnapshots) get(ctx context.Context) (transport.Net, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	if s.cached != nil && time.Now().Before(s.expires) {
		network := s.cached
		s.mu.Unlock()
		return network, nil
	}
	job := s.pending
	if job == nil {
		job = &networkSnapshot{done: make(chan struct{})}
		s.pending = job
		go func() {
			network, err := s.create()
			s.mu.Lock()
			job.network, job.err = network, err
			if err == nil {
				s.cached, s.expires = network, time.Now().Add(s.ttl)
			}
			s.pending = nil
			close(job.done)
			s.mu.Unlock()
		}()
	}
	s.mu.Unlock()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-job.done:
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return job.network, job.err
	}
}

// Pion's standard network uses net.ResolveUDPAddr, whose DNS lookup has no
// attempt context. Its gathering shutdown waits for that lookup even after
// ICE's deadline. Keep Pion's normal sockets/interfaces, but cancel DNS with
// this attempt so an unavailable resolver cannot hold up relay handoff.
func newAttemptNetwork(ctx context.Context) (transport.Net, error) {
	network, err := systemInterfaces.get(ctx)
	if err != nil {
		return nil, err
	}
	return &cancellableNetwork{Net: network, ctx: ctx, resolver: net.DefaultResolver}, nil
}

type cancellableNetwork struct {
	transport.Net
	ctx      context.Context
	resolver *net.Resolver
}

func (n *cancellableNetwork) ResolveUDPAddr(network, address string) (*net.UDPAddr, error) {
	if network == "" {
		network = "udp"
	}
	if network != "udp" && network != "udp4" && network != "udp6" {
		return nil, net.UnknownNetworkError(network)
	}
	if address == "" {
		return &net.UDPAddr{}, nil
	}
	host, service, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	port, err := n.resolver.LookupPort(n.ctx, network, service)
	if err != nil {
		return nil, err
	}
	if host == "" {
		return &net.UDPAddr{Port: port}, nil
	}
	// Literal endpoints (including scoped IPv6) never depend on DNS. Preserve
	// standard-library parsing and family validation for those addresses.
	if _, err := netip.ParseAddr(host); err == nil {
		return net.ResolveUDPAddr(network, address)
	}
	family := "ip"
	if network == "udp4" {
		family = "ip4"
	} else if network == "udp6" {
		family = "ip6"
	}
	addresses, err := n.resolver.LookupNetIP(n.ctx, family, host)
	if err != nil {
		return nil, err
	}
	// Like net.ResolveUDPAddr, prefer IPv4 for the unspecified UDP family.
	if network != "udp6" {
		for _, candidate := range addresses {
			if candidate.Unmap().Is4() {
				return &net.UDPAddr{IP: net.IP(candidate.Unmap().AsSlice()), Port: port}, nil
			}
		}
	}
	if network != "udp4" {
		for _, candidate := range addresses {
			if candidate.Is6() && !candidate.Is4In6() {
				return &net.UDPAddr{IP: net.IP(candidate.AsSlice()), Port: port, Zone: candidate.Zone()}, nil
			}
		}
	}
	return nil, &net.AddrError{Err: "no suitable address found", Addr: host}
}

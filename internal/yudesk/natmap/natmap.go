// Package natmap creates short-lived UDP port mappings on the local Internet
// gateway. It is deliberately independent from YuDesk's peer and relay paths.
package natmap

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strings"
	"time"
)

const (
	defaultTimeout  = 2200 * time.Millisecond
	defaultLifetime = time.Hour
	defaultPCPSlice = 650 * time.Millisecond
)

var (
	// ErrNoGateway means no usable default gateway could be discovered.
	ErrNoGateway = errors.New("natmap: no default gateway")
	// ErrNoMapping means PCP, NAT-PMP and UPnP IGD could not create a mapping.
	ErrNoMapping = errors.New("natmap: no UDP mapping available")
)

// Method identifies the gateway protocol which owns a mapping.
type Method string

const (
	MethodPCP    Method = "pcp"
	MethodNATPMP Method = "nat-pmp"
	MethodUPnP   Method = "upnp"
)

// Lease keeps a gateway mapping renewed until Close stops renewal and releases
// it. Close is idempotent and safe to call from more than one goroutine.
type Lease interface {
	Close() error
}

// Mapping is the public endpoint assigned to a bound local UDP port.
type Mapping struct {
	ExternalIP   netip.Addr
	ExternalPort uint16
	Method       Method
	Lease        Lease
}

// Options controls mapping duration and discovery latency. Zero values select
// conservative defaults suitable for an interactive connection attempt.
type Options struct {
	Timeout      time.Duration
	Lifetime     time.Duration
	ExternalPort uint16
	Description  string
	// OnProgress reports an attempted protocol, never gateway addresses.
	// Discovery can call it concurrently; callbacks must return promptly.
	OnProgress func(string)
}

type mapConfig struct {
	localPort    uint16
	externalPort uint16
	lifetime     time.Duration
	description  string
}

type dependencies struct {
	gateway     func(context.Context) (netip.Addr, error)
	pcp         func(context.Context, *net.UDPConn, netip.Addr, mapConfig) (Mapping, error)
	pmp         func(context.Context, *net.UDPConn, netip.Addr, mapConfig) (Mapping, error)
	upnp        func(context.Context, *net.UDPConn, mapConfig) (Mapping, error)
	prepareUPnP func(context.Context, *net.UDPConn) (func(context.Context, mapConfig) (Mapping, error), error)
}

var systemDependencies = dependencies{
	gateway:     defaultGateway,
	pcp:         mapPCP,
	pmp:         mapNATPMP,
	upnp:        mapUPnP,
	prepareUPnP: prepareUPnP,
}

// OpenUDP maps the local port of an already-bound UDP socket. PCP is attempted
// first, then NAT-PMP, then UPnP IGD. UPnP discovery overlaps the first two
// attempts. The application socket is never read,
// connected, or closed by this package. ctx bounds discovery only; callers
// must Close the returned Lease when the mapping is no longer needed.
func OpenUDP(ctx context.Context, socket *net.UDPConn, options Options) (Mapping, error) {
	return openUDP(ctx, socket, options, systemDependencies)
}

func openUDP(ctx context.Context, socket *net.UDPConn, options Options, deps dependencies) (Mapping, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	port, err := boundUDPPort(socket)
	if err != nil {
		return Mapping{}, err
	}
	timeout := options.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	type discoveryResult struct {
		mapUDP func(context.Context, mapConfig) (Mapping, error)
		err    error
	}
	var prepared discoveryResult
	var discovered chan struct{}
	if deps.prepareUPnP != nil {
		if options.OnProgress != nil {
			options.OnProgress("upnp_discovery")
		}
		discovered = make(chan struct{})
		go func() {
			mapUDP, err := deps.prepareUPnP(ctx, socket)
			prepared = discoveryResult{mapUDP, err}
			close(discovered)
		}()
		defer func() { cancel(); <-discovered }()
	}

	lifetime := options.Lifetime
	if lifetime <= 0 {
		lifetime = defaultLifetime
	}
	if lifetime < 2*time.Minute {
		lifetime = 2 * time.Minute
	}
	if lifetime > 24*time.Hour {
		lifetime = 24 * time.Hour
	}
	config := mapConfig{
		localPort:    port,
		externalPort: options.ExternalPort,
		lifetime:     lifetime,
		description:  cleanDescription(options.Description),
	}

	pcpTimeout := defaultPCPSlice
	if timeout/3 < pcpTimeout {
		pcpTimeout = timeout / 3
	}
	if pcpTimeout < 80*time.Millisecond {
		pcpTimeout = 80 * time.Millisecond
	}
	pcpCtx, cancelPCP := context.WithTimeout(ctx, pcpTimeout)
	gateway, gatewayErr := deps.gateway(pcpCtx)
	var pcpErr error
	if gatewayErr == nil && gateway.IsValid() {
		if options.OnProgress != nil {
			options.OnProgress("pcp")
		}
		mapping, err := deps.pcp(pcpCtx, socket, gateway, config)
		if err == nil {
			cancelPCP()
			return validateMapping(mapping)
		}
		pcpErr = err
	} else {
		pcpErr = gatewayErr
		if pcpErr == nil {
			pcpErr = ErrNoGateway
		}
	}
	cancelPCP()
	// NAT-PMP-only gateways are still common. Discovery above continues
	// while this bounded compatibility attempt uses the default gateway.
	if deps.pmp != nil && gateway.IsValid() && ctx.Err() == nil {
		if options.OnProgress != nil {
			options.OnProgress("natpmp")
		}
		pmpCtx, cancelPMP := context.WithTimeout(ctx, min(250*time.Millisecond, timeout/4))
		mapping, err := deps.pmp(pmpCtx, socket, gateway, config)
		cancelPMP()
		if err == nil {
			return validateMapping(mapping)
		}
		pcpErr = errors.Join(pcpErr, fmt.Errorf("NAT-PMP: %w", err))
	}

	if err := ctx.Err(); err != nil {
		return Mapping{}, errors.Join(ErrNoMapping, err, pcpErr)
	}
	var mapping Mapping
	var upnpErr error
	if discovered != nil {
		<-discovered
		if prepared.err != nil {
			upnpErr = prepared.err
		} else {
			if options.OnProgress != nil {
				options.OnProgress("upnp")
			}
			mapping, upnpErr = prepared.mapUDP(ctx, config)
		}
	} else {
		if options.OnProgress != nil {
			options.OnProgress("upnp")
		}
		mapping, upnpErr = deps.upnp(ctx, socket, config)
	}
	if upnpErr == nil {
		return validateMapping(mapping)
	}
	return Mapping{}, errors.Join(ErrNoMapping, fmt.Errorf("PCP: %w", pcpErr), fmt.Errorf("UPnP: %w", upnpErr))
}

func validateMapping(mapping Mapping) (Mapping, error) {
	if !mapping.ExternalIP.IsValid() || mapping.ExternalIP.IsUnspecified() || mapping.ExternalPort == 0 || mapping.Lease == nil {
		if mapping.Lease != nil {
			_ = mapping.Lease.Close()
		}
		return Mapping{}, fmt.Errorf("%w: gateway returned an incomplete endpoint", ErrNoMapping)
	}
	return mapping, nil
}

func boundUDPPort(socket *net.UDPConn) (uint16, error) {
	if socket == nil {
		return 0, errors.New("natmap: nil UDP socket")
	}
	address, ok := socket.LocalAddr().(*net.UDPAddr)
	if !ok || address.Port < 1 || address.Port > 65535 {
		return 0, errors.New("natmap: UDP socket must already be bound to a local port")
	}
	if ip, ok := netip.AddrFromSlice(address.IP); ok && !ip.IsUnspecified() && ip.IsLoopback() {
		return 0, errors.New("natmap: loopback-only UDP socket cannot receive a gateway mapping")
	}
	return uint16(address.Port), nil
}

func cleanDescription(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "YuDesk UDP"
	}
	value = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, value)
	if runes := []rune(value); len(runes) > 64 {
		value = string(runes[:64])
	}
	return value
}

func localIPv4(socket *net.UDPConn, remote netip.Addr) (netip.Addr, error) {
	if address, ok := socket.LocalAddr().(*net.UDPAddr); ok {
		if ip, ok := netip.AddrFromSlice(address.IP); ok {
			ip = ip.Unmap()
			if ip.Is4() && !ip.IsUnspecified() && !ip.IsLoopback() {
				return ip, nil
			}
		}
	}
	if !remote.IsValid() || !remote.Is4() {
		remote = netip.MustParseAddr("192.0.2.1")
	}
	connection, err := net.DialUDP("udp4", nil, net.UDPAddrFromAddrPort(netip.AddrPortFrom(remote, 9)))
	if err == nil {
		defer connection.Close()
		if address, ok := connection.LocalAddr().(*net.UDPAddr); ok {
			if ip, ok := netip.AddrFromSlice(address.IP); ok && ip.Unmap().Is4() && !ip.Unmap().IsLoopback() {
				return ip.Unmap(), nil
			}
		}
	}
	interfaces, listErr := net.Interfaces()
	if listErr != nil {
		return netip.Addr{}, errors.Join(errors.New("natmap: cannot determine local IPv4 address"), err, listErr)
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, _ := iface.Addrs()
		for _, address := range addresses {
			prefix, parseErr := netip.ParsePrefix(address.String())
			if parseErr == nil && prefix.Addr().Unmap().Is4() && !prefix.Addr().IsLoopback() {
				return prefix.Addr().Unmap(), nil
			}
		}
	}
	return netip.Addr{}, errors.New("natmap: no usable local IPv4 address")
}

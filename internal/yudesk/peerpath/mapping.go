package peerpath

import (
	"context"
	"net"
	"net/netip"
	"time"

	"welink/internal/yudesk/natmap"
)

// Trickle peers can check LAN, IPv6 and STUN paths without waiting for an
// unresponsive gateway. The mapper never reads the application UDP socket.
// Its result only advertises an alternate endpoint of that same socket.
func (a *attempt) startMapping(ctx context.Context, o Options, socket *net.UDPConn, budget time.Duration) {
	ctx, cancel := context.WithTimeout(ctx, budget)
	a.mapDone, a.mapCancel = make(chan struct{}), cancel
	go func() {
		defer close(a.mapDone)
		defer cancel()
		open := natmap.OpenUDP
		if o.mapUDP != nil {
			open = o.mapUDP
		}
		o.progress("mapping_started")
		mapping, err := open(ctx, socket, natmap.Options{Timeout: budget, Lifetime: 2 * time.Hour, Description: "YuDesk P2P", OnProgress: func(method string) { o.progress("mapping_" + method) }})
		var release natmap.Lease
		a.mu.Lock()
		if err == nil && ctx.Err() == nil && !a.closed && mapping.Lease != nil && mapping.ExternalPort != 0 && usableMappedAddress(mapping.ExternalIP) {
			a.mapping, a.mapped = mapping.Lease, true
			a.mappedIP, a.mappedPort = mapping.ExternalIP.Unmap(), mapping.ExternalPort
		} else {
			release = mapping.Lease
		}
		a.mapFinished = true
		ready, ip, port := a.mapReady, a.mappedIP, a.mappedPort
		a.mu.Unlock()
		if release != nil {
			_ = release.Close()
		}
		if ready != nil {
			ready(ip, port)
		}
		if ip.IsValid() {
			o.progress("mapping_ready")
		} else {
			o.progress("mapping_unavailable")
		}
	}()
}

func (a *attempt) mappingState() (netip.Addr, uint16, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.mappedIP, a.mappedPort, a.mapDone != nil && !a.mapFinished
}

// Registration and publication share a mutex, so even an immediate mapper
// result is delivered exactly once. Callbacks never run under the attempt lock.
func (a *attempt) watchMapping(ready func(netip.Addr, uint16)) {
	a.mu.Lock()
	finished := a.mapFinished
	if !finished {
		a.mapReady = ready
	}
	ip, port := a.mappedIP, a.mappedPort
	a.mu.Unlock()
	if finished {
		ready(ip, port)
	}
}

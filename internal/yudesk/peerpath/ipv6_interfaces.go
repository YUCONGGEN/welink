package peerpath

import (
	"net"
	"net/netip"
)

// A host can have many temporary addresses or ULA-only virtual adapters. The
// mux has eight IPv6 sockets and trickle signaling reserves four global IPv6
// slots. Visit distinct public /64 networks before a second address on one
// network, then retain private IPv6 for LAN/VPN connectivity. This changes
// local preference only: every selected pair still needs authenticated ICE.
// Return all eligible addresses so a failed bind does not consume a slot.
func orderedIPv6Interfaces(addresses []net.Addr) []netip.Addr {
	var networks [2][]netip.Prefix
	var groups [2]map[netip.Prefix][]netip.Addr
	groups[0], groups[1] = make(map[netip.Prefix][]netip.Addr), make(map[netip.Prefix][]netip.Addr)
	seen := make(map[netip.Addr]bool)
	for _, value := range addresses {
		prefix, err := netip.ParsePrefix(value.String())
		if err != nil {
			continue
		}
		ip := prefix.Addr().Unmap()
		if !ip.Is6() || !ip.IsGlobalUnicast() || ip.IsLinkLocalUnicast() || seen[ip] {
			continue
		}
		seen[ip] = true
		class := 0
		if ip.IsPrivate() {
			class = 1
		}
		network := netip.PrefixFrom(ip, 64).Masked()
		if groups[class][network] == nil {
			networks[class] = append(networks[class], network)
		}
		groups[class][network] = append(groups[class][network], ip)
	}
	ordered := make([]netip.Addr, 0, len(seen))
	for class := range networks {
		for round := 0; ; round++ {
			added := false
			for _, network := range networks[class] {
				if members := groups[class][network]; round < len(members) {
					ordered = append(ordered, members[round])
					added = true
				}
			}
			if !added {
				break
			}
		}
	}
	return ordered
}

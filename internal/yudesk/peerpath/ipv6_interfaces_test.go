package peerpath

import (
	"fmt"
	"net"
	"net/netip"
	"testing"
)

func ipv6FixtureAddr(value string) net.Addr {
	ip, network, err := net.ParseCIDR(value)
	if err != nil {
		panic(err)
	}
	network.IP = ip
	return network
}

func TestIPv6InterfaceBudgetPreservesPublicNetworkDiversity(t *testing.T) {
	var addresses []net.Addr
	// Nine early virtual-adapter ULAs previously exhausted the socket budget
	// before the first public address. Temporary addresses on the first public
	// network must also not exhaust the four global trickle slots.
	for i := range 9 {
		addresses = append(addresses, ipv6FixtureAddr(fmt.Sprintf("fd00:%x::1/64", i)))
	}
	for i := range 12 {
		addresses = append(addresses, ipv6FixtureAddr(fmt.Sprintf("2001:db8:1::%x/64", i+1)))
	}
	for i := 2; i <= 4; i++ {
		addresses = append(addresses, ipv6FixtureAddr(fmt.Sprintf("2001:db8:%x::1/64", i)))
	}
	ordered := orderedIPv6Interfaces(addresses)
	if len(ordered) != len(addresses) {
		t.Fatal("eligible LAN/VPN or temporary fallback addresses were discarded")
	}
	networks := map[netip.Prefix]bool{}
	for _, ip := range ordered[:4] {
		if ip.IsPrivate() {
			t.Fatal("private IPv6 crowded out a usable public network")
		}
		networks[netip.PrefixFrom(ip, 64).Masked()] = true
	}
	if len(networks) != 4 {
		t.Fatal("temporary addresses crowded out independent public networks")
	}
	for _, ip := range ordered[:8] {
		if ip.IsPrivate() {
			t.Fatal("eight-socket budget excluded a public IPv6 address")
		}
	}
}

func TestIPv6InterfaceSelectionRetainsPrivateFallbackAndFiltersInvalidScopes(t *testing.T) {
	addresses := []net.Addr{
		ipv6FixtureAddr("fd00:1::1/64"), ipv6FixtureAddr("fd00:1::1/64"),
		ipv6FixtureAddr("fd00:1::2/64"), ipv6FixtureAddr("fd00:2::1/64"),
		ipv6FixtureAddr("::1/128"), ipv6FixtureAddr("fe80::1/64"),
		ipv6FixtureAddr("ff02::1/128"), ipv6FixtureAddr("::/128"),
		ipv6FixtureAddr("192.168.0.1/24"), ipv6FixtureAddr("::ffff:192.0.2.1/128"),
	}
	ordered := orderedIPv6Interfaces(addresses)
	want := []netip.Addr{netip.MustParseAddr("fd00:1::1"), netip.MustParseAddr("fd00:2::1"), netip.MustParseAddr("fd00:1::2")}
	if len(ordered) != len(want) {
		t.Fatalf("invalid scopes or duplicate addresses survived: %v", ordered)
	}
	for i := range want {
		if ordered[i] != want[i] {
			t.Fatalf("private LAN/VPN fallback order: got %v want %v", ordered, want)
		}
	}
}

package peerpath

import (
	"fmt"
	"net/netip"
	"sort"
	"strconv"
	"strings"

	"github.com/pion/ice/v4"
)

type signalingCandidate struct {
	line     string
	priority uint32
}

// Bound signaling without allowing many NICs or temporary IPv6 addresses to
// crowd out the only usable mapped/srflx/relay endpoint. Keep each candidate
// category represented, then fill fairly in ICE priority order within it.
func (a *attempt) signaledSDP(raw string) (string, int) {
	mappedIP, mappedPort, _ := a.mappingState()
	var groups [9][]signalingCandidate
	lines := strings.Split(raw, "\r\n")
	seen := make(map[string]bool)
	for _, line := range lines {
		if !strings.HasPrefix(line, "a=candidate:") {
			continue
		}
		candidate, err := ice.UnmarshalCandidate(strings.TrimPrefix(line, "a=candidate:"))
		if err != nil || candidate.Component() != 1 {
			continue
		}
		address, err := netip.ParseAddr(candidate.Address())
		if err != nil {
			continue
		}
		address = address.Unmap()
		group := 0
		if candidate.Type() == ice.CandidateTypeHost && mappedPort != 0 && address == mappedIP {
			// Pion owns the socket at the internal port. Only the authenticated
			// wire advertisement uses the external port assigned by the router.
			fields := strings.Fields(line)
			fields[5] = strconv.Itoa(int(mappedPort))
			line = strings.Join(fields, " ")
		} else {
			switch candidate.Type() {
			case ice.CandidateTypeHost:
				if address.Is6() && !address.IsPrivate() && !address.IsLoopback() {
					group = 1
				} else if address.Is4() && !address.IsPrivate() && !address.IsLoopback() {
					group = 2
				} else if address.Is4() {
					group = 3
				} else {
					group = 4
				}
			case ice.CandidateTypeServerReflexive:
				group = 5
				if address.Is6() {
					group = 6
				}
			case ice.CandidateTypeRelay:
				group = 7
				if address.Is6() {
					group = 8
				}
			default:
				continue
			}
		}
		fields := strings.Fields(line)
		key := fmt.Sprintf("%s/%s/%s/%s", fields[2], fields[4], fields[5], candidate.Type())
		if seen[key] {
			continue
		}
		seen[key] = true
		groups[group] = append(groups[group], signalingCandidate{line, candidate.Priority()})
	}
	for i := range groups {
		sort.SliceStable(groups[i], func(j, k int) bool { return groups[i][j].priority > groups[i][k].priority })
	}
	var selected []string
	for round := 0; len(selected) < maxCandidates; round++ {
		added := false
		for _, group := range groups {
			if round < len(group) && len(selected) < maxCandidates {
				selected = append(selected, group[round].line)
				added = true
			}
		}
		if !added {
			break
		}
	}
	var kept []string
	inserted := false
	for _, line := range lines {
		if strings.HasPrefix(line, "a=candidate:") {
			if !inserted {
				kept = append(kept, selected...)
				inserted = true
			}
			continue
		}
		kept = append(kept, line)
	}
	return strings.Join(kept, "\r\n"), len(selected)
}

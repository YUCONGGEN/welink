package peerpath

import (
	"fmt"
	"net/netip"
	"strconv"
	"strings"
	"sync"

	"github.com/pion/ice/v4"
	"github.com/pion/webrtc/v4"
)

// Pion's callback never writes the relay or waits for its reader. Nine bounded
// categories reserve space for late STUN/TURN/mapped endpoints when many NICs
// produce host candidates first. At most maxCandidates are retained/emitted.
type trickleCandidates struct {
	mu             sync.Mutex
	queue          []webrtc.ICECandidateInit
	seen           map[string]bool
	counts         [9]int
	ended          bool
	stopped        bool
	gathered       bool
	mappingPending bool
	asyncMapping   bool
	mappedIP       netip.Addr
	mappedPort     uint16
	hostTemplate   string
	notify         chan struct{}
	scope          iceScope
	a              *attempt
}

func newTrickleCandidates(a *attempt, scope iceScope) *trickleCandidates {
	ip, port, pending := a.mappingState()
	q := &trickleCandidates{seen: make(map[string]bool), notify: make(chan struct{}, 1), scope: scope, a: a,
		mappedIP: ip, mappedPort: port, mappingPending: pending, asyncMapping: a.mapDone != nil}
	if q.asyncMapping {
		a.watchMapping(q.mappingReady)
	}
	return q
}

func (q *trickleCandidates) mappingReady(ip netip.Addr, port uint16) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.stopped || q.ended {
		return
	}
	q.mappingPending = false
	q.mappedIP, q.mappedPort = ip, port
	q.addMappedLocked()
	q.ended = q.gathered
	q.wake()
}

// The gateway forwards to the existing authenticated UDPMux socket. Keep its
// internal candidate intact and advertise the additional endpoint separately.
func (q *trickleCandidates) addMappedLocked() {
	if q.hostTemplate == "" || !q.mappedIP.IsValid() || q.mappedPort == 0 {
		return
	}
	fields := strings.Fields(q.hostTemplate)
	fields[0], fields[4], fields[5] = "candidate:mapped", q.mappedIP.String(), strconv.Itoa(int(q.mappedPort))
	q.enqueueLocked(strings.Join(fields, " "), true)
}

func (q *trickleCandidates) wake() {
	select {
	case q.notify <- struct{}{}:
	default:
	}
}

func (q *trickleCandidates) add(value *webrtc.ICECandidate) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.stopped || q.ended {
		return
	}
	if value == nil {
		q.gathered = true
		q.ended = !q.mappingPending
		q.wake()
		return
	}
	line := value.ToJSON().Candidate
	if q.a.progress != nil {
		stage := "candidate_ipv4"
		if value.Typ == webrtc.ICECandidateTypeSrflx {
			stage = "candidate_stun"
		} else if value.Typ == webrtc.ICECandidateTypeRelay {
			stage = "candidate_turn"
		} else if ip, err := netip.ParseAddr(value.Address); err == nil && ip.Is6() {
			stage = "candidate_ipv6"
		}
		q.a.progress(stage)
	}
	if q.asyncMapping && q.hostTemplate == "" && value.Typ == webrtc.ICECandidateTypeHost {
		if ip, err := netip.ParseAddr(value.Address); err == nil && ip.Unmap().Is4() && ip.IsGlobalUnicast() && value.Protocol == webrtc.ICEProtocolUDP {
			q.hostTemplate = line
		}
	}
	q.enqueueLocked(line, false)
	if q.asyncMapping {
		q.addMappedLocked()
	}
}

func (q *trickleCandidates) enqueueLocked(line string, mapped bool) {
	candidate, err := ice.UnmarshalCandidate(strings.TrimPrefix(line, "candidate:"))
	if err != nil {
		return
	}
	address, err := netip.ParseAddr(candidate.Address())
	if err != nil {
		return
	}
	address = address.Unmap()
	group := 0
	if mapped || (!q.asyncMapping && candidate.Type() == ice.CandidateTypeHost && q.mappedPort != 0 && address == q.mappedIP) {
		// Advertise the gateway's external port without changing the Pion
		// UDPMux socket which owns the corresponding internal mapped port.
		fields := strings.Fields(line)
		fields[5] = strconv.Itoa(int(q.mappedPort))
		line = strings.Join(fields, " ")
	} else {
		switch candidate.Type() {
		case ice.CandidateTypeHost:
			switch {
			case address.Is6() && !address.IsPrivate() && !address.IsLoopback():
				group = 1
			case address.Is4() && !address.IsPrivate() && !address.IsLoopback():
				group = 2
			case address.Is4():
				group = 3
			default:
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
			return
		}
	}
	// Sum is 32. Reserve eight LAN endpoints so several virtual adapters do
	// not crowd out a physical NIC, and eight IPv4 STUN endpoints for the
	// independent destinations. IPv6 and authorized TURN retain their slots.
	quotas := [9]int{1, 4, 2, 8, 1, 8, 4, 2, 2}
	key := fmt.Sprintf("%s/%s/%d/%s", candidate.NetworkType(), address, candidate.Port(), candidate.Type())
	if group == 0 {
		key = fmt.Sprintf("mapped/%s/%d", address, q.mappedPort)
	}
	if q.seen[key] || q.counts[group] >= quotas[group] {
		return
	}
	init := scopedCandidate(line, q.scope)
	if validateTrickleCandidate(init, q.scope, q.a.allowRelay, false) != nil {
		return
	}
	q.seen[key] = true
	q.counts[group]++
	q.queue = append(q.queue, init)
	q.wake()
}

func (q *trickleCandidates) drain(stop bool) ([]webrtc.ICECandidateInit, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if stop {
		q.stopped, q.ended = true, true
	}
	values := q.queue
	q.queue = nil
	return values, q.ended
}

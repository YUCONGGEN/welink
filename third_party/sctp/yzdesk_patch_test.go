// SPDX-License-Identifier: MIT

// Tests of the YzDesk changes (YZDESK_PATCH.md). Upstream's own tests are not
// vendored.

package sctp

import (
	"testing"
	"time"

	"github.com/pion/logging"
)

func newPatchTestAssociation(t *testing.T, minCwnd uint32) *Association {
	t.Helper()
	a := createAssociationFromConfigWithTsn(&Config{LoggerFactory: logging.NewDefaultLoggerFactory(), MinCwnd: minCwnd}, 1000)
	a.setState(established)
	a.setRWND(1 << 20)
	t.Cleanup(a.closeAllTimers)

	return a
}

func queueChunks(a *Association, sizes ...int) {
	for i, size := range sizes {
		a.pendingQueue.push(&chunkPayloadData{
			streamIdentifier: 1, beginningFragment: i == 0, endingFragment: i == len(sizes)-1,
			unordered: false, userData: make([]byte, size), payloadType: PayloadTypeWebRTCBinary,
		})
	}
}

func popPending(a *Association) []*chunkPayloadData {
	budget := a.tlrCurrentBurstBudgetScaledLocked()
	consumed := false
	chunks, _ := a.popPendingDataChunksToSend(&budget, &consumed)

	return chunks
}

func immediateFlags(chunks []*chunkPayloadData) []bool {
	flags := make([]bool, len(chunks))
	for i, c := range chunks {
		flags[i] = c.immediateSack
	}

	return flags
}

func TestImmediateSackOnlyOnBurstTail(t *testing.T) {
	a := newPatchTestAssociation(t, 64<<10)
	queueChunks(a, 1000, 1000, 1000)
	chunks := popPending(a)
	if got := immediateFlags(chunks); len(got) != 3 || got[0] || got[1] || !got[2] {
		t.Fatalf("immediate-SACK flags %v, want only the burst's last chunk", got)
	}
	raw, err := chunks[2].marshal()
	if err != nil || raw[1]&payloadDataImmediateSACK == 0 {
		t.Fatalf("the wire chunk does not carry the I bit: flags %#x err %v", raw[1], err)
	}
}

func TestImmediateSackWhenAWindowOrTheBurstBudgetStopsTheBatch(t *testing.T) {
	// The peer's window holds the third chunk back.
	a := newPatchTestAssociation(t, 64<<10)
	a.setRWND(2500)
	queueChunks(a, 1000, 1000, 1000)
	if got := immediateFlags(popPending(a)); len(got) != 2 || got[0] || !got[1] {
		t.Fatalf("receiver-window-limited batch flags %v, want the last admitted chunk", got)
	}
	// Tail-loss recovery's burst budget (4 MTU in its first round trip)
	// holds the rest back.
	b := newPatchTestAssociation(t, 64<<10)
	b.tlrBeginLocked()
	queueChunks(b, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000)
	got := immediateFlags(popPending(b))
	if len(got) == 0 || len(got) == 8 || !got[len(got)-1] {
		t.Fatalf("burst-budget-limited batch flags %v, want a partial batch ending with the I bit", got)
	}
	for _, flag := range got[:len(got)-1] {
		if flag {
			t.Fatalf("burst-budget-limited batch flags %v: only the last chunk asks", got)
		}
	}
}

func TestTailLossProbeHasAFloor(t *testing.T) {
	a := newPatchTestAssociation(t, 64<<10)
	a.srtt.Store(float64(1)) // a LAN: 1 ms
	queueChunks(a, 100)
	popPending(a)
	a.schedulePTOAfterSendLocked()
	a.timerMu.Lock()
	deadline := a.ptoDeadline
	a.timerMu.Unlock()
	if wait := time.Until(deadline); wait < ptoFloor-time.Millisecond {
		t.Fatalf("probe after %v on a 1 ms path, want at least %v", wait, ptoFloor)
	}
}

func TestSlowStartStopsJustAboveSSThresh(t *testing.T) {
	a := newPatchTestAssociation(t, 64<<10)
	a.setCWND(100 << 10)
	a.ssthresh = 128 << 10
	queueChunks(a, 1000) // cwnd-limited: data is pending
	a.onCumulativeTSNAckPointAdvanced(64 << 10)
	if want := uint32(128<<10) + a.MTU(); a.CWND() != want {
		t.Fatalf("cwnd %d after a 64 KB acknowledgement in slow start, want ssthresh + MTU = %d", a.CWND(), want)
	}
}

func TestImmediateSackWhenCongestionWindowStopsTheBurst(t *testing.T) {
	a := newPatchTestAssociation(t, 0)
	a.setCWND(2500)
	queueChunks(a, 1000, 1000, 1000)
	chunks := popPending(a)
	if got := immediateFlags(chunks); len(got) != 2 || got[0] || !got[1] {
		t.Fatalf("immediate-SACK flags %v, want the last chunk the window admitted", got)
	}
	if a.pendingQueue.size() != 1 {
		t.Fatalf("pending %d, want the chunk the window held back", a.pendingQueue.size())
	}
}

func TestRetransmissionAsksForImmediateSack(t *testing.T) {
	a := newPatchTestAssociation(t, 64<<10)
	queueChunks(a, 1000, 1000, 1000)
	chunks := popPending(a)
	for _, c := range chunks {
		c.immediateSack = false
		c.retransmit = true
	}
	budget := a.tlrCurrentBurstBudgetScaledLocked()
	consumed := false
	packets := a.getDataPacketsToRetransmit(&budget, &consumed)
	if len(packets) == 0 {
		t.Fatal("nothing retransmitted")
	}
	if got := immediateFlags(chunks); got[0] || got[1] || !got[2] {
		t.Fatalf("immediate-SACK flags %v after retransmission, want only the last", got)
	}
}

func TestSoleInflightChunkWithImmediateSackNeedsNoDelayedAckAllowance(t *testing.T) {
	a := newPatchTestAssociation(t, 64<<10)
	queueChunks(a, 100)
	popPending(a)
	if !a.soleInflightAsksImmediateSack() {
		t.Fatal("a lone tail chunk should not wait for the peer's delayed-ACK timer")
	}
	queueChunks(a, 100)
	popPending(a)
	if a.soleInflightAsksImmediateSack() {
		t.Fatal("two chunks in flight are not a sole chunk")
	}
}

func TestLossKeepsSlowStartAboveTheWindowFloor(t *testing.T) {
	const floor = 64 << 10
	a := newPatchTestAssociation(t, floor)
	a.setCWND(floor)
	a.onRetransmissionTimeout(timerT3RTX, 1)
	if a.CWND() != floor || a.ssthresh != 2*floor {
		t.Fatalf("after a timeout cwnd=%d ssthresh=%d, want the floor %d and ssthresh %d", a.CWND(), a.ssthresh, floor, 2*floor)
	}
	// A cwnd-limited burst's acknowledgement grows the window in slow start
	// (by the bytes acknowledged), not by one MTU per window.
	queueChunks(a, 1000)
	a.onCumulativeTSNAckPointAdvanced(32 << 10)
	if a.CWND() != floor+32<<10 {
		t.Fatalf("cwnd %d after acknowledging 32 KB, want slow start to %d", a.CWND(), floor+32<<10)
	}
	// Without a floor the RFC 4960 threshold applies unchanged.
	b := newPatchTestAssociation(t, 0)
	b.setCWND(40000)
	if got := b.lossSSThresh(); got != 20000 {
		t.Fatalf("unfloored ssthresh %d, want cwnd/2", got)
	}
}

// An association whose RTO.Max is below RFC 4960's one-second RTO.Min times
// out after three smoothed round trips, at least 100 ms; one without such a
// cap keeps the RFC's minimum.
func TestRTOMinFollowsThePathUnderASubSecondCap(t *testing.T) {
	for _, tc := range []struct {
		rtoMax, rtt, want float64
	}{
		{400, 20, 100},
		{400, 40, 120},
		{400, 80, 240},
		{400, 200, 400},
		{0, 20, 1000},
		{3000, 20, 1000},
	} {
		m := newRTOManager(tc.rtoMax)
		for range 20 {
			m.setNewRTT(tc.rtt)
		}
		if got := m.getRTO(); got != tc.want {
			t.Errorf("RTO.Max %v, RTT %v ms: RTO %v ms, want %v", tc.rtoMax, tc.rtt, got, tc.want)
		}
	}
	// Jitter still counts: SRTT + 4 x RTTVAR above the floor wins.
	m := newRTOManager(400)
	for i := range 40 {
		m.setNewRTT(float64(20 + 60*(i%2)))
	}
	if got := m.getRTO(); got <= 3*m.srtt {
		t.Errorf("jittery path: RTO %v ms not above 3 x SRTT (%v ms)", got, m.srtt)
	}
}

// Under a sub-second cap the T3 timer does not back off, and a timeout
// resends one packet until a SACK arrives, whatever the window floor.
func TestT3UnderASubSecondCapProbesWithOnePacket(t *testing.T) {
	a := createAssociationFromConfigWithTsn(&Config{LoggerFactory: logging.NewDefaultLoggerFactory(), MinCwnd: 64 << 10, RTOMax: 400}, 1000)
	a.setState(established)
	a.setRWND(1 << 20)
	t.Cleanup(a.closeAllTimers)
	if !a.t3RTX.flat {
		t.Fatal("T3 backs off under a 400 ms cap")
	}
	a.t3RTX.mutex.Lock()
	a.t3RTX.rto, a.t3RTX.nRtos = 120, 3
	timeout := a.t3RTX.calculateNextTimeout()
	a.t3RTX.mutex.Unlock()
	if timeout != 120*time.Millisecond {
		t.Fatalf("third timeout after %v, want 120 ms", timeout)
	}
	if b := newPatchTestAssociation(t, 0); b.t3RTX.flat {
		t.Fatal("T3 without a cap does not back off")
	}

	queueChunks(a, 1000, 1000, 1000, 1000, 1000)
	if sent := popPending(a); len(sent) != 5 {
		t.Fatalf("sent %d chunks, want 5", len(sent))
	}
	a.onRetransmissionTimeout(timerT3RTX, 1)
	budget := a.tlrCurrentBurstBudgetScaledLocked()
	consumed := false
	a.lock.Lock()
	packets := a.getDataPacketsToRetransmit(&budget, &consumed)
	a.lock.Unlock()
	if len(packets) != 1 || len(packets[0].chunks) != 1 {
		t.Fatalf("timeout resent %d packets, want one packet of one chunk", len(packets))
	}
	a.lock.Lock()
	_ = a.handleSack(&chunkSelectiveAck{cumulativeTSNAck: a.cumulativeTSNAckPoint, advertisedReceiverWindowCredit: 1 << 20})
	packets = a.getDataPacketsToRetransmit(&budget, &consumed)
	a.lock.Unlock()
	if len(packets) == 0 || a.rtoProbeOnly {
		t.Fatalf("after a SACK: %d packets, probe only %v", len(packets), a.rtoProbeOnly)
	}
}

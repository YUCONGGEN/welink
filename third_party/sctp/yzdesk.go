// SPDX-License-Identifier: MIT

// YZDESK: everything in this file is YzDesk's change to Pion SCTP v1.11.1
// (see YZDESK_PATCH.md); association.go calls it from lines marked YZDESK.

package sctp

import (
	"time"

	"github.com/pion/logging"
)

// bundleRetransmissions packs retransmitted chunks (YZDESK). The last one
// asks for an immediate SACK: once it fills the receiver's gap the receiver
// no longer sees loss and would otherwise delay the acknowledgement that
// ends recovery by up to 200 ms.
func (a *Association) bundleRetransmissions(chunks []*chunkPayloadData) []*packet {
	markImmediateSack(chunks)

	return a.bundleDataChunksIntoPackets(chunks)
}

// markImmediateSack sets the RFC 7053 I bit on the last chunk of a batch
// (YZDESK). Pion acknowledges every second packet at once and a lone packet
// only when its 200 ms delayed-ACK timer fires, so the tail of a burst (the
// last fragment of a frame, an input event, a frame acknowledgement) held
// its sender's queue and window for 200 ms and inflated the smoothed RTT.
// The bit is a hint in the DATA chunk flags; every Pion receiver honours
// it and older peers need no change.
func markImmediateSack(chunks []*chunkPayloadData) {
	if len(chunks) > 0 {
		chunks[len(chunks)-1].immediateSack = true
	}
}

// soleInflightAsksImmediateSack reports whether the only outstanding chunk
// carries the I bit, so its acknowledgement is not delayed (YZDESK).
func (a *Association) soleInflightAsksImmediateSack() bool {
	if a.inflightQueue.size() != 1 {
		return false
	}
	c, ok := a.inflightQueue.get(a.cumulativeTSNAckPoint + 1)

	return ok && c.immediateSack
}

// ptoFloor bounds the tail-loss probe timeout below (YZDESK), as Linux's
// TLP does with 10 ms; probeTimeout also keeps it above SRTT + 4 x RTTVAR.
// On a LAN 2 x SRTT + 2 ms is a few milliseconds, shorter than a Wi-Fi
// power-save wake-up or a garbage-collection pause at the receiver, so
// probes fired spuriously, entered tail-loss recovery's burst limit and
// inflated RACK's reordering window.
const ptoFloor = 10 * time.Millisecond

// probeTimeout is the tail-loss probe timeout for RACK's pto (YZDESK).
func (a *Association) probeTimeout(pto time.Duration) time.Duration {
	a.rtoMgr.mutex.RLock()
	variance := time.Duration((a.rtoMgr.srtt + 4*a.rtoMgr.rttvar) * float64(time.Millisecond))
	a.rtoMgr.mutex.RUnlock()

	return max(pto, variance, ptoFloor)
}

// lossSSThresh is the slow-start threshold after a loss (YZDESK): RFC
// 4960's max(cwnd/2, 4*MTU), but never below twice the configured minimum
// congestion window. With a floor above cwnd/2, upstream left cwnd (held at
// the floor) above ssthresh for good, so every later burst grew it by one
// MTU per window in congestion avoidance and a page change took a round
// trip per floor-sized window. With this bound the window may slow-start
// from the floor again, as upstream does from ssthresh.
func (a *Association) lossSSThresh() uint32 {
	ssthresh := max32(a.CWND()/2, 4*a.MTU())
	if a.minCwnd > 0 {
		ssthresh = max32(ssthresh, 2*a.minCwnd)
	}

	return ssthresh
}

// rtoFloor bounds the RTT-derived minimum retransmission timeout below
// (YZDESK, see minRTO), in ms.
const rtoFloor = 100.0

// minRTO is RTO.Min (YZDESK). RFC 4960's one second applies unless the
// association's RTO.Max is below it: a caller that caps the timeout under
// one second (internal/peerpath: 400 ms) asked for sub-second recovery,
// and every timeout was then the cap however short the path. Such an
// association's minimum follows the path instead: three smoothed round trips
// and at least rtoFloor. A retransmission timeout acts when a lost packet's
// retransmission or tail-loss probe was lost too (a burst, a path that broke
// for a moment); on a 40 ms path it now waits 120 ms instead of 400 ms. The
// immediate-SACK bit (markImmediateSack) keeps acknowledgements within a
// round trip, so three of them leave room for jitter; a spurious timeout
// resends what is in flight and keeps the congestion window's floor.
// The caller holds m.mutex.
func (m *rtoManager) minRTO() float64 {
	if m.rtoMax >= rtoMin {
		return rtoMin
	}

	return max(rtoFloor, 3*m.srtt)
}

// subSecondRTO reports whether an association's RTO.Max is below RFC 4960's
// RTO.Min (YZDESK): see minRTO, flatBackoff and rtoProbeWindow.
func subSecondRTO(rtoMax float64) bool { return rtoMax > 0 && rtoMax < rtoMin }

// flatBackoff is the number of timeouts that doubles the T3 timer (YZDESK):
// none when the association's timeout is capped below one second. A path
// that broke for a moment (a Wi-Fi roam, a switch between paths, an outage
// of 150 ms) is found again within one timeout of its return, not after a
// doubled one: at 120 ms the doubling put the retransmission 360 ms after
// the loss instead of 240. Each timeout resends a single packet
// (rtoProbeWindow), so a dead path sees one packet a timeout (at most ten a
// second), as upstream's doubled timer capped at RTO.Max sends one each.
func (t *rtxTimer) flatBackoff() uint {
	if t.flat {
		return 0
	}

	return t.nRtos
}

// rtoProbeWindow is the window for retransmissions (YZDESK). RFC 4960 sets
// cwnd to one MTU on a T3 timeout so that one packet probes the path;
// with a congestion window floor (WithMinCwnd, 64 KB in YzDesk) upstream
// instead resent the whole floor's worth of what was in flight on every
// timeout: into a dead path, or, when the timeout was spurious (a Wi-Fi
// stall that held the acknowledgements), as duplicates ahead of new data
// (26 ms at 20 Mbit/s, 130 ms at 4 Mbit/s). Until the next SACK one packet
// is resent; the SACK then shows what is missing and the floor applies.
func (a *Association) rtoProbeWindow(awnd uint32) uint32 {
	if a.rtoProbeOnly {
		return min32(awnd, a.MTU())
	}

	return awnd
}

// ThinStreamsConfig names an association's thin streams (YZDESK). A thin
// stream carries short interactive messages with pauses between them (the
// input lane of a remote desktop session: pointer moves, clicks, keys,
// frame acknowledgements), far below what the congestion window allows. Its
// losses are the ones a user sees: a lost message that nothing follows
// waits for a timer, and a lost message in a run of them holds every later
// one back (the stream is ordered) until a retransmission a round trip
// later.
//
// For the named streams the sender therefore repeats unacknowledged
// messages before any loss is known:
//
//   - redundant bundling: the packet of a new message also carries copies of
//     earlier unacknowledged messages of the stream. Every message rides
//     along twice: with the next message, which repairs a lost packet 8-16
//     ms later while the pointer moves instead of after a round trip and
//     the reordering window, and with the first message sent thinSecondAge
//     or more after it, which repairs what a short burst (a Wi-Fi collision,
//     a queue overflow) took together with the first copy. A stream faster
//     than thinFastGap sends the first copy only, and a copy never makes a
//     packet larger than the path allows;
//   - eager tail copies: when no new message follows, the last messages are
//     sent again thinTailFirst after the last one and then at the offsets of
//     thinTailLater, each time only if they are still unacknowledged. On a
//     path shorter than the first delay nothing is ever repeated.
//
// A copy is the same DATA chunk with the same TSN: the receiver drops what
// it already has, delivers exactly once and in order as for any
// retransmission, and needs no change (any SCTP peer, any version). Copies
// do not count as transmissions for the retransmission machinery: the chunk
// stays an original for RACK and the timers, which act as before if every
// copy is lost too. Only single-chunk messages of at most thinMaxData bytes
// on ordered, reliable streams are repeated, within thinBudgetRate, and
// only while the association is thin (thinQuiet) and, for the copies that
// ride along, the path shows no queue (thinDelayed).
//
// Round-trip samples: a chunk that was copied still gives its sample,
// counted from the original transmission. Karn's rule (no sample from a
// chunk sent more than once) would leave the sender of a thin stream, where
// nearly every chunk is copied before its acknowledgement can arrive,
// without any sample, and its timers with a round trip that never follows
// the path. When the original was lost and a copy was acknowledged the
// sample is too long by the copy's delay: never too short, so no timer
// fires early for it, and as rare as the loss itself.
//
// The association takes this from its LoggerFactory, the one per-association
// value an unforked pion/webrtc passes through to it: a factory that also
// implements ThinStreamsConfig turns the redundancy on for the streams it
// returns. Without one nothing changes.
type ThinStreamsConfig interface {
	// SCTPThinStreams returns the identifiers of the association's thin
	// streams; it is called once, when the association is created.
	SCTPThinStreams() []uint16
}

const (
	// thinMaxData is the largest message (bytes of user data, one chunk)
	// that is repeated.
	thinMaxData = 1024
	// thinRing is how many of the most recent messages are remembered:
	// thinSecondAge of a stream at thinFastGap, and as many again.
	thinRing = 16
	// thinBundle is the number of times a message rides along with later
	// ones: with the next message, and with the first one sent thinSecondAge
	// or more after it. A steady run so carries two copies a packet; when
	// several messages come due together (a click between two pointer
	// moves) a packet takes one more, thinPacketCopies in all, and a message
	// that still found no room thinSecondMax after it was sent goes without
	// its second copy. A stream with less than thinFastGap between messages
	// (above 250 a second) sends the first copy only, which bounds the added
	// bytes to the stream's own at any rate.
	thinBundle       = 2
	thinPacketCopies = thinBundle + 1
	thinFastGap      = 4 * time.Millisecond
	thinSecondAge    = 30 * time.Millisecond
	thinSecondMax    = 3 * thinSecondAge
	// thinBudgetRate bounds the bytes of copies a second (chunk headers
	// included), after a burst of thinBudgetBurst: whatever the application
	// writes, the redundancy costs at most 512 kbit/s, and less on a path
	// that shows a queue (thinScaleStart and what follows). A 125 Hz
	// pointer with 200-byte messages uses 55 KB/s of it, a 60 Hz one 26.
	// First copies are served before second ones. Tail copies may overdraw
	// the budget by thinBudgetBurst, which the copies of the next run pay
	// back: a click's tail is never starved by the run before it.
	thinBudgetRate  = 64 << 10
	thinBudgetBurst = 8 << 10
	// thinBulkLimit: with more than this many bytes of other data in flight
	// (a picture frame, a file) the association is not thin at the moment
	// and nothing is repeated; see thinQuiet.
	thinBulkLimit = 4 << 10
	// The copies that ride along are bytes the congestion window does not
	// see, and its floor is far above what a slow uplink carries, so the
	// round trips of the thin messages themselves pace them (thinDelayed).
	// The path shows a queue when the last thinDelaySamples
	// acknowledgements of thin messages, all within thinDelayFresh, took
	// more than max(a quarter of the minimum round trip, thinDelayFloor)
	// longer than that minimum; a few late acknowledgements (messages that
	// copies repaired after a loss or a short burst) do not count. While it
	// does, nothing rides along, and each time it starts to, the rate and
	// the burst of the copies halve (down to thinScaleMin of
	// thinBudgetRate and thinBudgetBurst). While copies go out without a
	// queue they grow: doubling every second from thinScaleStart until the
	// path first shows a queue, by thinScaleGain a second after that.
	thinDelaySamples = 8
	thinDelayFresh   = time.Second
	thinDelayFloor   = 10 * time.Millisecond
	thinScaleStart   = 0.25
	thinScaleMin     = 1.0 / 16
	thinScaleGain    = 0.1
	// thinTailChunks is the number of messages a tail packet repeats at
	// most.
	thinTailChunks = 3
	// thinTailFirst is the delay of the first tail copy after an isolated
	// message. In a run of messages less than thinIsolated apart the next
	// one normally comes first and carries the copy itself, so the tail
	// copy waits one and a half spacings, at most thinTailFirstMax: a
	// 60 Hz run then sends no tail copies at all, and its last message is
	// still repeated within thinTailFirstMax.
	thinTailFirst    = 12 * time.Millisecond
	thinTailFirstMax = 36 * time.Millisecond
	thinIsolated     = 40 * time.Millisecond
	// thinTailStep is the least time between the first and the second tail
	// copy.
	thinTailStep = 24 * time.Millisecond

	// Trace formats; internal/peerpath counts them for its diagnostics as
	// it counts the recovery traces.
	thinTraceBundle = "[%s] thin: %d copies bundled with tsn=%d"
	thinTraceTail   = "[%s] thin: tail packet %d repeats %d chunks up to tsn=%d"
)

// thinTailLater are the offsets of the second and later tail copies after
// the last new message. Together with the first they cover a burst of up to
// 220 ms without waiting for the retransmission timer (400 ms on a long
// path); on a 40 ms path the acknowledgement normally arrives before the
// second.
var thinTailLater = [...]time.Duration{40 * time.Millisecond, 100 * time.Millisecond, 220 * time.Millisecond}

// thinStreams is an association's thin-stream state, guarded by the
// association's lock except timer, which is fixed.
type thinStreams struct {
	ids []uint16
	// recent holds the most recently sent messages of the thin streams,
	// the newest at head-1; an entry is cleared once acknowledged.
	recent [thinRing]thinMessage
	head   int
	// lastSend is when the newest message was sent, gap its distance from
	// the one before (0: none), step the tail copies sent since.
	lastSend time.Time
	gap      time.Duration
	step     int
	timer    *time.Timer
	// tail: the write loop owes a tail packet.
	tail bool
	// budget is what copies may still spend (bytes), as of budgetAt; see
	// thinBudgetRate. scale is the share of thinBudgetRate the path allows
	// at the moment, delayed whether it showed a queue when a message last
	// went out, and samples the last round trips of thin messages
	// (thinDelayed).
	budget   float64
	budgetAt time.Time
	scale    float64
	delayed  bool
	// used: copies rode along since the budget was last refilled; queued:
	// the path has shown a queue before.
	used, queued bool
	samples      [thinDelaySamples]thinSample
	sample       int
	// bundled and tailed count the copies sent (tests).
	bundled, tailed uint64
}

// thinSample is the round trip of a thin message, from its original
// transmission to its acknowledgement at at.
type thinSample struct {
	at  time.Time
	rtt time.Duration
}

// thinMessage is a message of a thin stream that may be repeated: its chunk
// and how often it rode along with a later message.
type thinMessage struct {
	chunk   *chunkPayloadData
	bundled int
}

// newThinStreams returns the thin-stream state for an association whose
// logger factory names thin streams, nil otherwise.
func newThinStreams(factory logging.LoggerFactory, onTimer func()) *thinStreams {
	config, ok := factory.(ThinStreamsConfig)
	if !ok {
		return nil
	}
	ids := config.SCTPThinStreams()
	if len(ids) == 0 {
		return nil
	}
	t := &thinStreams{ids: append([]uint16(nil), ids...), timer: time.AfterFunc(time.Hour, onTimer), budget: thinBudgetBurst * thinScaleStart, scale: thinScaleStart}
	t.timer.Stop()

	return t
}

func (t *thinStreams) stop() {
	if t != nil {
		t.timer.Stop()
	}
}

// eligible reports whether c is a message the thin-stream redundancy
// repeats.
func (t *thinStreams) eligible(c *chunkPayloadData) bool {
	if !c.beginningFragment || !c.endingFragment || c.unordered || len(c.userData) == 0 ||
		len(c.userData) > thinMaxData || c.payloadType == PayloadTypeWebRTCDCEP {
		return false
	}

	return t.has(c.streamIdentifier)
}

// tailOffset is when tail copy step is due after the last new message.
func (t *thinStreams) tailOffset(step int) time.Duration {
	first := thinTailFirst
	if t.gap > 0 && t.gap < thinIsolated {
		first = min(max(first, t.gap+t.gap/2), thinTailFirstMax)
	}
	if step == 0 {
		return first
	}

	return max(thinTailLater[step-1], first+thinTailStep)
}

// refill adds what the budget earned since it was last used, at the share
// of thinBudgetRate the path allows, and lets that share grow while the
// path shows no queue.
func (t *thinStreams) refill(now time.Time) {
	if !t.budgetAt.IsZero() {
		elapsed := now.Sub(t.budgetAt).Seconds()
		if t.used && !t.delayed {
			// The copies went out and the path took them.
			gain := thinScaleGain
			if !t.queued {
				gain = t.scale
			}
			t.scale = min(t.scale+elapsed*gain, 1)
		}
		t.budget = min(t.budget+elapsed*thinBudgetRate*t.scale, thinBudgetBurst*t.scale)
	}
	t.budgetAt, t.used = now, false
}

// has reports whether a stream is one of the thin streams.
func (t *thinStreams) has(stream uint16) bool {
	for _, id := range t.ids {
		if id == stream {
			return true
		}
	}

	return false
}

// thinAcked takes the round trip of an acknowledged thin message that was
// transmitted once (YZDESK): the samples thinDelayed reads. The caller holds
// the lock.
func (a *Association) thinAcked(c *chunkPayloadData, now time.Time) {
	t := a.thin
	if t == nil || c.nSent != 1 || c.unordered || !t.has(c.streamIdentifier) {
		return
	}
	t.samples[t.sample] = thinSample{at: now, rtt: now.Sub(c.since)}
	t.sample = (t.sample + 1) % thinDelaySamples
}

// thinDelayed reports whether the path shows a queue: every one of the last
// thinDelaySamples round trips of thin messages is recent and longer than
// the minimum round trip by more than max(a quarter of it, thinDelayFloor).
// The caller holds the lock.
func (a *Association) thinDelayed(now time.Time) bool {
	if a.rackMinRTT <= 0 {
		return false
	}
	limit := a.rackMinRTT + max(a.rackMinRTT/4, thinDelayFloor)
	for _, s := range a.thin.samples {
		if s.at.IsZero() || now.Sub(s.at) > thinDelayFresh || s.rtt <= limit {
			return false
		}
	}

	return true
}

// sent records that new thin messages went out at now and starts the tail
// schedule again.
func (t *thinStreams) sent(now time.Time) {
	t.gap = 0
	if !t.lastSend.IsZero() {
		t.gap = max(now.Sub(t.lastSend), time.Nanosecond)
	}
	// A tail packet that was due but not yet sent is dropped: the message
	// that just went out carried the copies.
	t.lastSend, t.step, t.tail = now, 0, false
	t.timer.Reset(t.tailOffset(0))
}

// thinUnacked reports whether c is still outstanding. The caller holds the
// lock.
func (a *Association) thinUnacked(c *chunkPayloadData) bool {
	return !c.acked && !c.abandoned() && sna32GT(c.tsn, a.cumulativeTSNAckPoint)
}

// thinSlot is the ring slot of the back-th most recent message (1: the
// newest), nil when it is empty or acknowledged. The caller holds the lock.
func (a *Association) thinSlot(back int) *thinMessage {
	t := a.thin
	m := &t.recent[(t.head-back+thinRing)%thinRing]
	if m.chunk == nil {
		return nil
	}
	if !a.thinUnacked(m.chunk) {
		*m = thinMessage{}

		return nil
	}

	return m
}

// thinBundleCopies returns the copies a new thin message's packet carries
// in room bytes, oldest first: first copies of the newest messages that
// have not ridden along yet, and, unless the stream is in a fast run,
// second copies of the messages that were sent between thinSecondAge and
// thinSecondMax ago, the oldest first. The caller holds the lock.
func (a *Association) thinBundleCopies(room int, fast bool, now time.Time) []chunk {
	t := a.thin
	t.refill(now)
	if delayed := a.thinDelayed(now); delayed != t.delayed {
		if t.delayed = delayed; delayed {
			t.scale, t.queued = max(t.scale/2, thinScaleMin), true
		}
	}
	if t.delayed || !a.thinQuiet() {
		return nil
	}
	spare := a.thinSpareWindow()
	var picked [thinRing + 1]bool // by distance from the newest
	count := 0
	pick := func(back int, m *thinMessage) {
		if size := m.chunk.chunkSizeInPacket(); size <= room && float64(size) <= t.budget && size <= spare {
			room -= size
			spare -= size
			t.budget -= float64(size)
			t.used = true
			m.bundled++
			picked[back] = true
			count++
		}
	}
	first := thinBundle
	if fast {
		first = 1
	}
	for back := 1; back <= thinRing && count < first; back++ {
		if m := a.thinSlot(back); m != nil && m.bundled == 0 {
			pick(back, m)
		}
	}
	for back := thinRing; back >= 1 && count < thinPacketCopies && !fast; back-- {
		m := a.thinSlot(back)
		if m == nil || picked[back] || m.bundled != 1 {
			continue
		}
		if age := now.Sub(m.chunk.since); age >= thinSecondAge && age <= thinSecondMax {
			pick(back, m)
		}
	}
	copies := make([]chunk, 0, count)
	for back := thinRing; back >= 1; back-- {
		if picked[back] {
			copies = append(copies, t.recent[(t.head-back+thinRing)%thinRing].chunk)
		}
	}

	return copies
}

// thinSpareWindow is the room the congestion window has left for copies,
// which are not counted as in flight but are bytes on the path. The caller
// holds the lock.
func (a *Association) thinSpareWindow() int {
	return int(a.CWND()) - a.inflightQueue.getNumBytes()
}

// thinQuiet reports whether the association is thin at the moment: no more
// than thinBulkLimit bytes of anything but thin messages are in flight.
// While a picture frame or a file crosses the path the copies would add to
// a load that may already fill it (measured on a 2 Mbit/s link under a
// saturating picture: 6 % less throughput and 6 ms more for the sound), and
// they are not needed: the thin stream's packets are followed by others,
// whose acknowledgements show a loss within a round trip. The caller holds
// the lock.
func (a *Association) thinQuiet() bool {
	bulk := 0
	for i := range a.inflightQueue.chunks.Len() {
		c := a.inflightQueue.chunks.At(i)
		if c.acked || a.thin.eligible(c) {
			continue
		}
		if bulk += len(c.userData); bulk > thinBulkLimit {
			return false
		}
	}

	return true
}

// thinTailCopies returns the most recent unacknowledged thin messages that
// fit one packet, the congestion window's spare room and the budget with
// its overdraft, at most thinTailChunks, oldest first. The caller holds the
// lock.
func (a *Association) thinTailCopies(now time.Time) []chunk {
	t := a.thin
	t.refill(now)
	if !a.thinQuiet() {
		return nil
	}
	room := min(int(a.MTU())-int(commonHeaderSize), a.thinSpareWindow())
	var newestFirst []*chunkPayloadData
	for back := 1; back <= thinRing && len(newestFirst) < thinTailChunks; back++ {
		m := a.thinSlot(back)
		if m == nil {
			continue
		}
		size := m.chunk.chunkSizeInPacket()
		if size > room || t.budget-float64(size) < -thinBudgetBurst {
			break
		}
		room -= size
		t.budget -= float64(size)
		newestFirst = append(newestFirst, m.chunk)
	}
	copies := make([]chunk, 0, len(newestFirst))
	for i := len(newestFirst) - 1; i >= 0; i-- {
		copies = append(copies, newestFirst[i])
	}

	return copies
}

// bundleNewData packs new DATA chunks into packets as
// bundleDataChunksIntoPackets does and, on an association with thin streams,
// lets the packet of a new thin message also carry copies of the most
// recent unacknowledged ones (YZDESK, see ThinStreamsConfig). The caller
// holds the lock.
func (a *Association) bundleNewData(chunks []*chunkPayloadData) []*packet {
	t := a.thin
	if t == nil {
		return a.bundleDataChunksIntoPackets(chunks)
	}
	now := time.Now()
	fast := !t.lastSend.IsZero() && now.Sub(t.lastSend) < thinFastGap
	packets := []*packet{}
	chunksToSend := []chunk{}
	var thin []*chunkPayloadData
	bytesInPacket := int(commonHeaderSize)
	flush := func() {
		if len(chunksToSend) == 0 {
			return
		}
		if len(thin) > 0 {
			// The copies come first: the receiver fills its gap before the
			// new message and delivers both at once.
			if copies := a.thinBundleCopies(int(a.MTU())-bytesInPacket, fast, now); len(copies) > 0 {
				t.bundled += uint64(len(copies))
				a.log.Tracef(thinTraceBundle, a.name, len(copies), thin[0].tsn)
				chunksToSend = append(copies, chunksToSend...)
			}
			for _, c := range thin {
				t.recent[t.head] = thinMessage{chunk: c}
				t.head = (t.head + 1) % thinRing
			}
		}
		packets = append(packets, a.createPacket(chunksToSend))
		chunksToSend, thin, bytesInPacket = []chunk{}, nil, int(commonHeaderSize)
	}
	sentThin := false
	for _, c := range chunks {
		size := c.chunkSizeInPacket()
		if bytesInPacket+size > int(a.MTU()) {
			flush()
		}
		chunksToSend = append(chunksToSend, c)
		bytesInPacket += size
		if t.eligible(c) {
			thin = append(thin, c)
			sentThin = true
		}
	}
	flush()
	if sentThin {
		t.sent(now)
	}

	return packets
}

// onThinTimer is the tail schedule's timer: if the last thin messages are
// still unacknowledged it asks the write loop for a tail packet and arms
// the next step.
func (a *Association) onThinTimer() {
	a.lock.Lock()
	defer a.lock.Unlock()

	t := a.thin
	if t == nil || t.lastSend.IsZero() || a.getState() != established {
		return
	}
	if t.step > len(thinTailLater) {
		return
	}
	now := time.Now()
	if wait := t.lastSend.Add(t.tailOffset(t.step)).Sub(now); wait > time.Millisecond {
		// A newer message restarted the schedule while this call waited.
		t.timer.Reset(wait)

		return
	}
	unacked := false
	for back := 1; back <= thinRing && !unacked; back++ {
		unacked = a.thinSlot(back) != nil
	}
	if !unacked {
		return // the tail arrived: nothing is repeated
	}
	t.tail = true
	a.awakeWriteLoop()
	if t.step++; t.step <= len(thinTailLater) {
		t.timer.Reset(max(t.lastSend.Add(t.tailOffset(t.step)).Sub(now), time.Millisecond))
	}
}

// gatherThinTail adds the tail packet the timer asked for: the most recent
// unacknowledged thin messages again, in one packet whose last chunk asks
// for an immediate SACK (YZDESK). The caller holds the lock.
func (a *Association) gatherThinTail(rawPackets [][]byte) [][]byte {
	t := a.thin
	if t == nil || !t.tail {
		return rawPackets
	}
	t.tail = false
	copies := a.thinTailCopies(time.Now())
	if len(copies) == 0 {
		return rawPackets
	}
	last, _ := copies[len(copies)-1].(*chunkPayloadData)
	last.immediateSack = true
	raw, err := a.marshalPacket(a.createPacket(copies))
	if err != nil {
		a.log.Warnf("[%s] failed to serialize a thin-stream tail packet", a.name)

		return rawPackets
	}
	t.tailed += uint64(len(copies))
	a.log.Tracef(thinTraceTail, a.name, t.step, len(copies), last.tsn)

	return append(rawPackets, raw)
}

// rackSendTimeCounts reports whether an acknowledged chunk's send time may
// become RACK's "most recently sent chunk that was delivered" (YZDESK). RFC
// 8985 section 7.2 step 2 leaves out a retransmitted segment whose
// acknowledgement arrived sooner after the retransmission than the path's
// minimum round trip: it answers an earlier transmission. Upstream takes
// such a chunk, RACK then believes that something sent just now was
// delivered and declares every chunk sent before it lost; those are
// retransmitted, acknowledged at once by their originals, and the next
// flight is declared lost in turn. On a thin stream a copy regularly
// arrives just after RACK retransmitted the chunk (a burst took the
// original and the first copy, the second copy fills the gap): in a
// measurement every 30 ms outage of a 125 Hz pointer was followed by about
// 170 spurious retransmissions. The rule applies to associations with thin
// streams; the others keep upstream's behaviour.
func (a *Association) rackSendTimeCounts(c *chunkPayloadData, now time.Time) bool {
	if a.thin == nil || c.nSent == 1 {
		return true
	}

	return a.rackMinRTT > 0 && now.Sub(c.since) >= a.rackMinRTT*7/8
}

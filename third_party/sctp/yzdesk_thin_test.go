// SPDX-License-Identifier: MIT

// Tests of YzDesk's thin-stream redundancy (ThinStreamsConfig in yzdesk.go,
// YZDESK_PATCH.md). The end-to-end tests run two associations over an
// in-memory link in testing/synctest's virtual time: delays, timers and
// therefore the delivery times they report are exact and repeatable.

package sctp

import (
	"encoding/binary"
	"fmt"
	"io"
	"math/rand/v2"
	"net"
	"os"
	"slices"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/pion/logging"
)

// thinFactory is a logger factory that names thin streams.
type thinFactory struct {
	logging.LoggerFactory
	ids []uint16
}

func (f thinFactory) SCTPThinStreams() []uint16 { return f.ids }

func newThinTestAssociation(t *testing.T, ids ...uint16) *Association {
	t.Helper()
	a := createAssociationFromConfigWithTsn(&Config{
		LoggerFactory: thinFactory{logging.NewDefaultLoggerFactory(), ids}, MinCwnd: 64 << 10, RTOMax: 400,
	}, 1000)
	a.setState(established)
	a.setRWND(1 << 20)
	t.Cleanup(a.closeAllTimers)
	if a.thin != nil {
		// As on a path that has taken the copies for a while.
		a.thin.scale, a.thin.budget = 1, thinBudgetBurst
	}

	return a
}

// sendMessage queues one unfragmented message on a stream and returns the
// packets the write loop would send for it.
func sendMessage(a *Association, stream uint16, size int) (*chunkPayloadData, []*packet) {
	c := &chunkPayloadData{
		streamIdentifier: stream, beginningFragment: true, endingFragment: true,
		userData: make([]byte, size), payloadType: PayloadTypeWebRTCBinary,
	}
	a.pendingQueue.push(c)
	budget := a.tlrCurrentBurstBudgetScaledLocked()
	consumed := false
	chunks, _ := a.popPendingDataChunksToSend(&budget, &consumed)

	return c, a.bundleNewData(chunks)
}

func packetTSNs(p *packet) []uint32 {
	var tsns []uint32
	for _, c := range p.chunks {
		if data, ok := c.(*chunkPayloadData); ok {
			tsns = append(tsns, data.tsn)
		}
	}

	return tsns
}

// run sends count messages of a thin stream spacing apart (the clock does
// not move: everything sent before is aged instead) and returns the TSNs of
// each packet relative to the first message's.
func thinRunPackets(t *testing.T, a *Association, spacing time.Duration, count int, acked func(sent int) (through int)) [][]uint32 {
	t.Helper()
	var sent []*chunkPayloadData
	var packets [][]uint32
	for i := range count {
		for _, c := range sent {
			c.since = c.since.Add(-spacing)
		}
		if i > 0 {
			a.thin.lastSend = a.thin.lastSend.Add(-spacing)
		}
		if acked != nil {
			if through := acked(i); through > 0 && sna32GT(sent[through-1].tsn, a.cumulativeTSNAckPoint) {
				if err := a.handleSack(&chunkSelectiveAck{cumulativeTSNAck: sent[through-1].tsn, advertisedReceiverWindowCredit: 1 << 20}); err != nil {
					t.Fatal(err)
				}
			}
		}
		c, out := sendMessage(a, 1, 100)
		if len(out) != 1 {
			t.Fatalf("message %d went out as %d packets", i+1, len(out))
		}
		sent = append(sent, c)
		var tsns []uint32
		for _, tsn := range packetTSNs(out[0]) {
			tsns = append(tsns, tsn-sent[0].tsn+1)
		}
		packets = append(packets, tsns)
		if c.nSent != 1 || c.retransmit {
			t.Fatalf("message %d counts as retransmitted: nSent=%d retransmit=%v", i+1, c.nSent, c.retransmit)
		}
	}

	return packets
}

// Every message of a thin stream rides along twice while it is
// unacknowledged: with the next message, and with the first message sent
// 30 ms or more after it. A copy is the chunk itself (same TSN), and it
// does not count as a transmission.
func TestThinMessageRidesAlongWithLaterOnes(t *testing.T) {
	for _, tc := range []struct {
		name    string
		spacing time.Duration
		acked   func(int) int
		want    [][]uint32
	}{
		// 125 messages a second, nothing acknowledged yet (a long path).
		{"125Hz", 8 * time.Millisecond, nil, [][]uint32{{1}, {1, 2}, {2, 3}, {3, 4}, {1, 4, 5}, {2, 5, 6}, {3, 6, 7}, {4, 7, 8}}},
		// 60 a second: the second message after it is 33 ms later.
		{"60Hz", 16700 * time.Microsecond, nil, [][]uint32{{1}, {1, 2}, {1, 2, 3}, {2, 3, 4}, {3, 4, 5}}},
		// 30 a second: the next message is already 33 ms later, the copies
		// still go out with two different messages.
		{"30Hz", 33 * time.Millisecond, nil, [][]uint32{{1}, {1, 2}, {1, 2, 3}, {2, 3, 4}}},
		// A 40 ms path at 125 Hz: a message is acknowledged before the
		// sixth after it goes out, so the copy 32 ms later still does.
		{"125Hz acknowledged after 40 ms", 8 * time.Millisecond, func(sent int) int { return sent - 4 }, [][]uint32{{1}, {1, 2}, {2, 3}, {3, 4}, {1, 4, 5}, {2, 5, 6}, {3, 6, 7}}},
		// A 20 ms path: acknowledged before the second copy is due.
		{"125Hz acknowledged after 20 ms", 8 * time.Millisecond, func(sent int) int { return sent - 2 }, [][]uint32{{1}, {1, 2}, {2, 3}, {3, 4}, {4, 5}, {5, 6}}},
		// A 4 ms path: acknowledged before the next message.
		{"125Hz acknowledged at once", 8 * time.Millisecond, func(sent int) int { return sent }, [][]uint32{{1}, {2}, {3}, {4}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := newThinTestAssociation(t, 1)
			a.lock.Lock()
			defer a.lock.Unlock()
			got := thinRunPackets(t, a, tc.spacing, len(tc.want), tc.acked)
			for i := range tc.want {
				if !slices.Equal(got[i], tc.want[i]) {
					t.Fatalf("packets carry %v, want %v", got, tc.want)
				}
			}
		})
	}
}

// Above 250 messages a second one copy rides along, so the added bytes
// never exceed the stream's own.
func TestThinFastRunCarriesOneCopy(t *testing.T) {
	a := newThinTestAssociation(t, 1)
	a.lock.Lock()
	defer a.lock.Unlock()
	sendMessage(a, 1, 100)
	sendMessage(a, 1, 100)
	_, packets := sendMessage(a, 1, 100) // right behind the second
	if got := len(packets[0].chunks); got != 2 {
		t.Fatalf("a message %v after the previous carries %d chunks, want itself and one copy", thinFastGap, got)
	}
}

// The copies that ride along are bounded in bytes a second, whatever the
// application writes: once the budget is spent a message goes out alone.
func TestThinBundledCopiesAreBounded(t *testing.T) {
	a := newThinTestAssociation(t, 1)
	a.lock.Lock()
	defer a.lock.Unlock()
	copies := 0
	for range 100 { // 100 messages of 400 bytes in no time
		a.thin.lastSend = time.Now().Add(-8 * time.Millisecond)
		_, packets := sendMessage(a, 1, 400)
		copies += len(packets[0].chunks) - 1
	}
	if size := (&chunkPayloadData{userData: make([]byte, 400)}).chunkSizeInPacket(); copies == 0 || copies*size > thinBudgetBurst+size {
		t.Fatalf("%d copies of %d bytes went out at once, the budget is %d bytes", copies, size, thinBudgetBurst)
	}
	// A tail packet still goes out, on the budget's overdraft, which is
	// bounded too.
	tails := 0
	for range 100 {
		tails += len(a.thinTailCopies(time.Now()))
	}
	if size := (&chunkPayloadData{userData: make([]byte, 400)}).chunkSizeInPacket(); tails == 0 || tails*size > thinBudgetBurst+2*size {
		t.Fatalf("%d tail copies of %d bytes on an overdraft of %d bytes", tails, size, thinBudgetBurst)
	}
	a.thin.lastSend = time.Now().Add(-8 * time.Millisecond)
	if _, packets := sendMessage(a, 1, 400); len(packets[0].chunks) != 1 {
		t.Fatal("a copy rode along while the budget was overdrawn")
	}
	// Two seconds later the budget is back, never above its burst.
	a.thin.budgetAt = a.thin.budgetAt.Add(-2 * time.Second)
	a.thin.lastSend = time.Now().Add(-8 * time.Millisecond)
	if _, packets := sendMessage(a, 1, 400); len(packets[0].chunks) < 2 {
		t.Fatal("no copy after the budget had two seconds to refill")
	}
	if a.thin.budget > thinBudgetBurst {
		t.Fatalf("budget %v above its burst", a.thin.budget)
	}
}

// Nothing is repeated while other data is in flight: a picture frame or a
// file makes the association not thin for the moment.
func TestThinCopiesOnlyWhileTheAssociationIsThin(t *testing.T) {
	a := newThinTestAssociation(t, 1)
	a.lock.Lock()
	defer a.lock.Unlock()
	sendMessage(a, 1, 100)
	var frame *chunkPayloadData
	for range 5 { // 5 KB of a picture on another stream
		frame, _ = sendMessage(a, 0, 1000)
	}
	a.thin.lastSend = time.Now().Add(-8 * time.Millisecond)
	second, packets := sendMessage(a, 1, 100)
	if len(packets) != 1 || len(packets[0].chunks) != 1 {
		t.Fatalf("a thin message carried %d copies with a picture frame in flight", len(packets[0].chunks)-1)
	}
	if copies := a.thinTailCopies(time.Now()); len(copies) != 0 {
		t.Fatalf("a tail packet of %d copies with a picture frame in flight", len(copies))
	}
	// The frame is acknowledged: the association is thin again.
	if err := a.handleSack(&chunkSelectiveAck{cumulativeTSNAck: frame.tsn, advertisedReceiverWindowCredit: 1 << 20}); err != nil {
		t.Fatal(err)
	}
	if copies := a.thinTailCopies(time.Now()); len(copies) != 1 || copies[0] != chunk(second) {
		t.Fatalf("a tail packet of %d copies on a thin association, want the unacknowledged message", len(copies))
	}
	a.thin.lastSend = time.Now().Add(-8 * time.Millisecond)
	if _, packets := sendMessage(a, 1, 100); len(packets[0].chunks) != 2 {
		t.Fatalf("a thin message carried %d copies on a thin association, want one", len(packets[0].chunks)-1)
	}
	// A little other data (a sound packet) does not count.
	sendMessage(a, 2, 300)
	a.thin.lastSend = time.Now().Add(-8 * time.Millisecond)
	if _, packets := sendMessage(a, 1, 100); len(packets[0].chunks) < 2 {
		t.Fatal("a sound packet in flight stopped the copies")
	}
}

// Copies ride along only while the path shows no queue (bytes the
// congestion window does not count must not fill a slow uplink): eight
// acknowledgements in a row that took a quarter of the minimum round trip
// longer stop them and halve their rate. Tail copies do not wait for that,
// and no copy goes beyond the congestion window.
func TestThinCopiesStopWhenTheRoundTripGrows(t *testing.T) {
	a := newThinTestAssociation(t, 1)
	a.lock.Lock()
	defer a.lock.Unlock()
	a.rackMinRTT = 40 * time.Millisecond
	acked := func(count int, rtt time.Duration) {
		for range count {
			a.thinAcked(&chunkPayloadData{streamIdentifier: 1, nSent: 1, since: time.Now().Add(-rtt)}, time.Now())
		}
	}
	sendMessage(a, 1, 100)
	// Seven late acknowledgements are a burst that copies repaired.
	acked(1, 40*time.Millisecond)
	acked(thinDelaySamples-1, 70*time.Millisecond)
	a.thin.lastSend = time.Now().Add(-8 * time.Millisecond)
	if _, packets := sendMessage(a, 1, 100); len(packets[0].chunks) != 2 || a.thin.scale != 1 {
		t.Fatalf("%d copies, rate %v after seven late acknowledgements, want the copy and the whole rate", len(packets[0].chunks)-1, a.thin.scale)
	}
	// Eight are a queue.
	acked(1, 70*time.Millisecond)
	a.thin.lastSend = time.Now().Add(-8 * time.Millisecond)
	if _, packets := sendMessage(a, 1, 100); len(packets[0].chunks) != 1 || a.thin.scale != .5 {
		t.Fatalf("%d copies, rate %v with a queue on the path, want none and half the rate", len(packets[0].chunks)-1, a.thin.scale)
	}
	if copies := a.thinTailCopies(time.Now()); len(copies) != 3 {
		t.Fatalf("a tail packet of %d copies, want the three messages whatever the round trip", len(copies))
	}
	// It stays halved, once, while the queue lasts...
	acked(3, 70*time.Millisecond)
	a.thin.lastSend = time.Now().Add(-8 * time.Millisecond)
	if _, packets := sendMessage(a, 1, 100); len(packets[0].chunks) != 1 || a.thin.scale != .5 {
		t.Fatalf("%d copies, rate %v while the queue lasts", len(packets[0].chunks)-1, a.thin.scale)
	}
	// ...and the copies return with the first acknowledgement on time.
	acked(1, 45*time.Millisecond)
	a.thin.lastSend = time.Now().Add(-8 * time.Millisecond)
	if _, packets := sendMessage(a, 1, 100); len(packets[0].chunks) < 2 {
		t.Fatal("no copies after the queue was gone")
	}
	// A session starts at a quarter of the rate and of the burst.
	b := createAssociationFromConfigWithTsn(&Config{LoggerFactory: thinFactory{logging.NewDefaultLoggerFactory(), []uint16{1}}}, 1000)
	b.setState(established)
	b.setRWND(1 << 20)
	t.Cleanup(b.closeAllTimers)
	b.lock.Lock()
	defer b.lock.Unlock()
	if b.thin.scale != thinScaleStart || b.thin.budget != thinBudgetBurst*thinScaleStart {
		t.Fatalf("a new association starts at rate %v with %v bytes", b.thin.scale, b.thin.budget)
	}
	// A window with no room left (a path that stopped acknowledging).
	sendMessage(b, 1, 100)
	b.setCWND(uint32(b.inflightQueue.getNumBytes()) + 50)
	if copies := b.thinTailCopies(time.Now()); len(copies) != 0 {
		t.Fatalf("a tail packet of %d copies beyond the congestion window", len(copies))
	}
	b.setCWND(4380)
	if copies := b.thinTailCopies(time.Now()); len(copies) != 1 {
		t.Fatalf("a tail packet of %d copies with room in the window", len(copies))
	}
}

// Other streams, fragments of large messages and messages above
// thinMaxData are never repeated, and a packet is never exceeded.
func TestThinRedundancyOnlyForSmallMessagesOfThinStreams(t *testing.T) {
	a := newThinTestAssociation(t, 1)
	a.lock.Lock()
	defer a.lock.Unlock()
	sendMessage(a, 2, 100) // not a thin stream
	a.thin.lastSend = time.Now().Add(-8 * time.Millisecond)
	if _, packets := sendMessage(a, 2, 100); len(packets[0].chunks) != 1 {
		t.Fatal("a message of another stream carries copies")
	}
	sendMessage(a, 1, thinMaxData+1)
	if _, packets := sendMessage(a, 1, 100); len(packets[0].chunks) != 1 {
		t.Fatal("a message above thinMaxData was repeated")
	}
	// A 1000-byte message leaves no room for the 100-byte one before it...
	_, packets := sendMessage(a, 1, 1000)
	if len(packets) != 1 || len(packets[0].chunks) != 2 {
		t.Fatalf("1000-byte message: %d packets, %d chunks, want it and the small copy", len(packets), len(packets[0].chunks))
	}
	// ...and the next 1000-byte one has no room for either.
	_, packets = sendMessage(a, 1, 1000)
	if len(packets) != 1 || len(packets[0].chunks) != 1 {
		t.Fatalf("second 1000-byte message: %d packets, %d chunks, want it alone", len(packets), len(packets[0].chunks))
	}
	raw, err := packets[0].marshal(true)
	if err != nil || len(raw) > int(a.MTU()) {
		t.Fatalf("packet of %d bytes (MTU %d), err %v", len(raw), a.MTU(), err)
	}
	// Without thin streams the association is upstream's.
	b := newPatchTestAssociation(t, 64<<10)
	b.lock.Lock()
	defer b.lock.Unlock()
	if b.thin != nil {
		t.Fatal("thin streams without a configuration")
	}
	sendMessage(b, 1, 100)
	if _, packets := sendMessage(b, 1, 100); len(packets[0].chunks) != 1 {
		t.Fatal("an association without thin streams repeats messages")
	}
}

// The tail schedule: 12 ms after an isolated message, one and a half
// spacings (at most 36 ms) inside a run, then 40, 100 and 220 ms.
func TestThinTailSchedule(t *testing.T) {
	ms := time.Millisecond
	for _, tc := range []struct {
		gap  time.Duration
		want [4]time.Duration
	}{
		{0, [4]time.Duration{12 * ms, 40 * ms, 100 * ms, 220 * ms}},         // the first message
		{500 * ms, [4]time.Duration{12 * ms, 40 * ms, 100 * ms, 220 * ms}},  // isolated
		{2 * ms, [4]time.Duration{12 * ms, 40 * ms, 100 * ms, 220 * ms}},    // 500 Hz
		{8 * ms, [4]time.Duration{12 * ms, 40 * ms, 100 * ms, 220 * ms}},    // 125 Hz
		{16 * ms, [4]time.Duration{24 * ms, 48 * ms, 100 * ms, 220 * ms}},   // 60 Hz
		{33 * ms, [4]time.Duration{36 * ms, 60 * ms, 100 * ms, 220 * ms}},   // 30 Hz
		{40 * ms, [4]time.Duration{12 * ms, 40 * ms, 100 * ms, 220 * ms}},   // isolated again
		{39 * ms, [4]time.Duration{36 * ms, 60 * ms, 100 * ms, 220 * ms}},   // just inside a run
		{10 * ms, [4]time.Duration{15 * ms, 40 * ms, 100 * ms, 220 * ms}},   // 100 Hz
		{7 * ms, [4]time.Duration{12 * ms, 40 * ms, 100 * ms, 220 * ms}},    // 144 Hz
		{24 * ms, [4]time.Duration{36 * ms, 60 * ms, 100 * ms, 220 * ms}},   // 42 Hz
		{20 * ms, [4]time.Duration{30 * ms, 54 * ms, 100 * ms, 220 * ms}},   // 50 Hz
		{100 * ms, [4]time.Duration{12 * ms, 40 * ms, 100 * ms, 220 * ms}},  // typing
		{1000 * ms, [4]time.Duration{12 * ms, 40 * ms, 100 * ms, 220 * ms}}, // a heartbeat
	} {
		s := &thinStreams{gap: tc.gap}
		for step, want := range tc.want {
			if got := s.tailOffset(step); got != want {
				t.Errorf("gap %v, tail copy %d after %v, want %v", tc.gap, step+1, got, want)
			}
		}
	}
}

// An acknowledged chunk that was retransmitted advances RACK's "most
// recently sent chunk that was delivered" only when the acknowledgement can
// answer the retransmission (RFC 8985 section 7.2 step 2).
func TestThinRACKIgnoresAcknowledgementsOfEarlierTransmissions(t *testing.T) {
	a := newThinTestAssociation(t, 1)
	a.lock.Lock()
	defer a.lock.Unlock()
	a.rackMinRTT = 40 * time.Millisecond
	now := time.Now()
	if !a.rackSendTimeCounts(&chunkPayloadData{nSent: 1, since: now.Add(-time.Millisecond)}, now) {
		t.Fatal("an original transmission does not count")
	}
	if a.rackSendTimeCounts(&chunkPayloadData{nSent: 2, since: now.Add(-8 * time.Millisecond)}, now) {
		t.Fatal("an acknowledgement 8 ms after the retransmission on a 40 ms path counts for it")
	}
	if !a.rackSendTimeCounts(&chunkPayloadData{nSent: 2, since: now.Add(-40 * time.Millisecond)}, now) {
		t.Fatal("an acknowledgement a round trip after the retransmission does not count")
	}
	b := newPatchTestAssociation(t, 64<<10)
	b.rackMinRTT = 40 * time.Millisecond
	if !b.rackSendTimeCounts(&chunkPayloadData{nSent: 2, since: now.Add(-8 * time.Millisecond)}, now) {
		t.Fatal("an association without thin streams no longer behaves as upstream")
	}
}

// A 30 ms outage of a moving pointer: the second copies fill the gap just
// after RACK retransmitted the lost messages. That must not make RACK
// declare the following flights lost (about 170 spurious retransmissions an
// outage before rackSendTimeCounts): the thin stream sends no more packets
// than a plain one.
func TestThinBurstCausesNoSpuriousRetransmissions(t *testing.T) {
	var packets [2]float64
	var delays [2][]time.Duration
	for i, thin := range []bool{false, true} {
		synctest.Test(t, func(t *testing.T) {
			delays[i], packets[i], _ = pointer(t, thin, 40*time.Millisecond, 125, 0, 30*time.Millisecond, 20*time.Second)
		})
	}
	t.Logf("125 Hz pointer, 30 ms outage every 2 s: plain %s, %.0f packets/s | thin %s, %.0f packets/s", durationsSummary(delays[0]), packets[0], durationsSummary(delays[1]), packets[1])
	if packets[1] > packets[0]*1.03 {
		t.Errorf("the thin stream sent %.0f packets a second, the plain one %.0f", packets[1], packets[0])
	}
	if thin, plain := quantileOf(delays[1], .99), quantileOf(delays[0], .99); thin >= plain {
		t.Errorf("p99 after outages %v on the thin stream, %v on the plain one", thin, plain)
	}
}

// wire is one direction of an in-memory link: every packet arrives delay
// later, unless it is dropped; with rate, packets also queue for a link of
// that many bytes a second.
type wire struct {
	mu      sync.Mutex
	delay   time.Duration
	rate    int
	busy    time.Time // when the link has sent what is queued
	random  *rand.Rand
	loss    float64       // every packet is lost with this probability
	dup     float64       // and delivered twice with this one
	jitter  time.Duration // extra delay up to this, which reorders packets
	armed   bool          // loss, dup and jitter apply
	dropFor time.Duration // drop data packets until dropEnd
	dropEnd time.Time
	queue   chan wirePacket
	out     chan []byte
	closed  chan struct{}
	// packets and bytes count what the sender wrote while armed or counting.
	counting       bool
	packets, bytes int
	dropped        int
}

type wirePacket struct {
	raw []byte
	due time.Time
}

func newWire(delay time.Duration, seed uint64, closed chan struct{}) *wire {
	w := &wire{delay: delay, random: rand.New(rand.NewPCG(seed, 99)), queue: make(chan wirePacket, 1<<14), out: make(chan []byte, 1<<14), closed: closed}
	go func() {
		// In order: a link without jitter never reorders.
		for {
			select {
			case p := <-w.queue:
				if wait := time.Until(p.due); wait > 0 {
					select {
					case <-time.After(wait):
					case <-closed:
						return
					}
				}
				w.out <- p.raw
			case <-closed:
				return
			}
		}
	}()

	return w
}

// isData reports whether an SCTP packet's first chunk is DATA or I-DATA.
func isData(raw []byte) bool {
	return len(raw) > int(commonHeaderSize) && (raw[commonHeaderSize] == byte(ctPayloadData) || raw[commonHeaderSize] == byte(ctIData))
}

func (w *wire) send(raw []byte) {
	w.mu.Lock()
	defer w.mu.Unlock()
	now := time.Now()
	if w.armed || w.counting {
		w.packets++
		w.bytes += len(raw)
	}
	if isData(raw) && now.Before(w.dropEnd) {
		w.dropped++

		return
	}
	copies, extra := 1, time.Duration(0)
	if w.armed {
		if w.random.Float64() < w.loss {
			w.dropped++

			return
		}
		if w.random.Float64() < w.dup {
			copies = 2
		}
	}
	for range copies {
		p := append([]byte(nil), raw...)
		if w.armed && w.jitter > 0 {
			extra = time.Duration(w.random.Int64N(int64(w.jitter)))
			time.AfterFunc(w.delay+extra, func() {
				select {
				case w.out <- p:
				case <-w.closed:
				}
			})

			continue
		}
		due := now
		if w.rate > 0 {
			if w.busy.After(due) {
				due = w.busy
			}
			due = due.Add(time.Duration(len(p)) * time.Second / time.Duration(w.rate))
			w.busy = due
		}
		w.queue <- wirePacket{p, due.Add(w.delay)}
	}
}

// lost is the number of packets the wire dropped.
func (w *wire) lost() int {
	w.mu.Lock()
	defer w.mu.Unlock()

	return w.dropped
}

// dropNextData drops the data packets of the next span.
func (w *wire) dropNextData(span time.Duration) {
	w.mu.Lock()
	w.dropEnd = time.Now().Add(span)
	w.mu.Unlock()
}

type wireConn struct {
	tx, rx *wire
	closed chan struct{}
	once   *sync.Once
}

func (c wireConn) Read(b []byte) (int, error) {
	select {
	case p := <-c.rx.out:
		return copy(b, p), nil
	case <-c.closed:
		return 0, io.EOF
	}
}

func (c wireConn) Write(b []byte) (int, error) {
	select {
	case <-c.closed:
		return 0, io.ErrClosedPipe
	default:
	}
	c.tx.send(b)

	return len(b), nil
}

func (c wireConn) Close() error                     { c.once.Do(func() { close(c.closed) }); return nil }
func (c wireConn) LocalAddr() net.Addr              { return nil }
func (c wireConn) RemoteAddr() net.Addr             { return nil }
func (c wireConn) SetDeadline(time.Time) error      { return nil }
func (c wireConn) SetReadDeadline(time.Time) error  { return nil }
func (c wireConn) SetWriteDeadline(time.Time) error { return nil }

// thinLink is two associations as YzDesk configures them (400 ms RTO cap,
// 64 KB window floor) on a link with the given round trip, the client's
// stream 1 thin or not, and everything the server's stream delivered.
type thinLink struct {
	t              *testing.T
	client, server *Association
	up, down       *wire // client to server, server to client
	stream         *Stream
	mu             sync.Mutex
	sent           map[uint64]time.Time
	delays         map[uint64]time.Duration
	order          []uint64
	next           uint64
	received       chan struct{}
}

func newThinLink(t *testing.T, rtt time.Duration, thin bool) *thinLink {
	t.Helper()
	closed := make(chan struct{})
	once := &sync.Once{}
	l := &thinLink{t: t, up: newWire(rtt/2, 1, closed), down: newWire(rtt/2, 2, closed), sent: map[uint64]time.Time{}, delays: map[uint64]time.Duration{}, received: make(chan struct{}, 1<<14)}
	factory := func() logging.LoggerFactory {
		var f logging.LoggerFactory = &logging.DefaultLoggerFactory{DefaultLogLevel: logging.LogLevelError, ScopeLevels: map[string]logging.LogLevel{}, Writer: os.Stderr}
		if thin {
			f = thinFactory{f, []uint16{1}}
		}

		return f
	}
	type result struct {
		a   *Association
		err error
	}
	serverDone := make(chan result, 1)
	go func() {
		a, err := Server(Config{NetConn: wireConn{l.down, l.up, closed, once}, LoggerFactory: factory(), RTOMax: 400, MinCwnd: 64 << 10})
		serverDone <- result{a, err}
	}()
	client, err := Client(Config{NetConn: wireConn{l.up, l.down, closed, once}, LoggerFactory: factory(), RTOMax: 400, MinCwnd: 64 << 10})
	if err != nil {
		t.Fatal(err)
	}
	server := <-serverDone
	if server.err != nil {
		t.Fatal(server.err)
	}
	l.client, l.server = client, server.a
	if thin != (client.thin != nil) {
		t.Fatalf("thin streams configured: %v, want %v", client.thin != nil, thin)
	}
	if l.stream, err = client.OpenStream(1, PayloadTypeWebRTCBinary); err != nil {
		t.Fatal(err)
	}
	go func() {
		stream, err := l.server.AcceptStream()
		if err != nil {
			return
		}
		buf := make([]byte, 64<<10)
		for {
			n, _, err := stream.ReadSCTP(buf)
			if err != nil {
				return
			}
			if n < 16 || int(binary.BigEndian.Uint64(buf[8:])) != n {
				t.Errorf("a message of %d bytes arrived damaged", n)

				return
			}
			id := binary.BigEndian.Uint64(buf)
			l.mu.Lock()
			l.delays[id] = time.Since(l.sent[id])
			l.order = append(l.order, id)
			l.mu.Unlock()
			l.received <- struct{}{}
		}
	}()

	return l
}

// send writes the next message (size bytes, at least 16) and returns its
// number.
func (l *thinLink) send(size int) uint64 {
	l.t.Helper()
	b := make([]byte, max(size, 16))
	l.mu.Lock()
	id := l.next
	l.next++
	l.sent[id] = time.Now()
	l.mu.Unlock()
	binary.BigEndian.PutUint64(b, id)
	binary.BigEndian.PutUint64(b[8:], uint64(len(b)))
	if _, err := l.stream.Write(b); err != nil {
		l.t.Fatal(err)
	}

	return id
}

// settle waits until every message sent so far arrived, at most limit.
func (l *thinLink) settle(limit time.Duration) {
	l.t.Helper()
	deadline := time.After(limit)
	for {
		l.mu.Lock()
		done := uint64(len(l.order)) == l.next
		l.mu.Unlock()
		if done {
			return
		}
		select {
		case <-l.received:
		case <-deadline:
			l.mu.Lock()
			defer l.mu.Unlock()
			l.t.Fatalf("%d of %d messages arrived", len(l.order), l.next)
		}
	}
}

// warm sends a few spaced messages so that both sides know the round trip.
func (l *thinLink) warm() {
	for range 8 {
		l.send(100)
		time.Sleep(200 * time.Millisecond)
	}
	l.settle(5 * time.Second)
}

func (l *thinLink) delay(id uint64) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()

	return l.delays[id]
}

// inOrder fails unless every message arrived exactly once and in order.
func (l *thinLink) inOrder() {
	l.t.Helper()
	l.mu.Lock()
	defer l.mu.Unlock()
	for i, id := range l.order {
		if id != uint64(i) {
			l.t.Fatalf("delivery %d is message %d: not exactly once and in order (%v...)", i, id, l.order[:min(len(l.order), i+3)])
		}
	}
	if uint64(len(l.order)) != l.next {
		l.t.Fatalf("%d of %d messages arrived", len(l.order), l.next)
	}
}

// copies is the number of copies the client sent with later messages and
// in tail packets.
func (l *thinLink) copies() (bundled, tailed uint64) {
	l.client.lock.Lock()
	defer l.client.lock.Unlock()
	if l.client.thin == nil {
		return 0, 0
	}

	return l.client.thin.bundled, l.client.thin.tailed
}

func (l *thinLink) close() {
	_ = l.client.Close()
	_ = l.server.Close()
}

func durationsSummary(v []time.Duration) string {
	if len(v) == 0 {
		return "n=0"
	}
	s := slices.Clone(v)
	slices.Sort(s)
	at := func(p float64) time.Duration {
		return s[min(len(s)-1, int(float64(len(s))*p))].Round(100 * time.Microsecond)
	}

	return fmt.Sprintf("n=%d p50=%v p95=%v p99=%v max=%v", len(s), at(.5), at(.95), at(.99), s[len(s)-1].Round(100*time.Microsecond))
}

// lostTail sends clicks (parts messages 5 ms apart, then 600 ms of silence)
// and loses the packet of each click's last message; it returns how long
// those messages took.
func lostTail(t *testing.T, rtt time.Duration, thin bool, parts int) []time.Duration {
	t.Helper()
	l := newThinLink(t, rtt, thin)
	defer l.close()
	l.warm()
	var tails []uint64
	for range 12 {
		for part := range parts {
			if part == parts-1 {
				l.up.dropNextData(3 * time.Millisecond)
				tails = append(tails, l.next)
			}
			l.send(120)
			time.Sleep(5 * time.Millisecond)
		}
		time.Sleep(600 * time.Millisecond)
	}
	l.settle(5 * time.Second)
	l.inOrder()
	if dropped := l.up.lost(); dropped != len(tails) {
		t.Fatalf("%d packets dropped, want one per click (%d)", dropped, len(tails))
	}
	delays := make([]time.Duration, len(tails))
	for i, id := range tails {
		delays[i] = l.delay(id)
	}

	return delays
}

// A lost message that nothing follows (a click, the last pointer position,
// a key) arrives a one-way delay after the first tail copy, 12 ms after it
// was sent, instead of after SCTP's tail-loss probe (two round trips) or
// retransmission timeout (400 ms on a long path).
func TestThinLostTailArrivesWithTheFirstCopy(t *testing.T) {
	for _, tc := range []struct {
		rtt, limit, without time.Duration
	}{
		{40 * time.Millisecond, 20*time.Millisecond + 15*time.Millisecond, 90 * time.Millisecond},
		{300 * time.Millisecond, 150*time.Millisecond + 15*time.Millisecond, 400 * time.Millisecond},
	} {
		for _, parts := range []int{1, 2} {
			t.Run(fmt.Sprintf("RTT%d_parts%d", tc.rtt.Milliseconds(), parts), func(t *testing.T) {
				var with, without []time.Duration
				synctest.Test(t, func(t *testing.T) { with = lostTail(t, tc.rtt, true, parts) })
				synctest.Test(t, func(t *testing.T) { without = lostTail(t, tc.rtt, false, parts) })
				t.Logf("lost tail, RTT %v, %d-message clicks: thin %s | plain %s", tc.rtt, parts, durationsSummary(with), durationsSummary(without))
				if worst := slices.Max(with); worst > tc.limit {
					t.Errorf("a lost tail took %v on a thin stream, want at most %v", worst, tc.limit)
				}
				if median := quantileOf(without, .5); median < tc.without {
					t.Errorf("a lost tail took %v (median) without thin streams, expected at least %v: the test measures nothing", median, tc.without)
				}
			})
		}
	}
}

// On a path shorter than the first tail delay every message is acknowledged
// before a copy is due: a thin stream repeats nothing and sends exactly the
// packets a plain one sends.
func TestThinNothingRepeatedOnAShortPath(t *testing.T) {
	run := func(t *testing.T, thin bool) (packets, bytes int) {
		l := newThinLink(t, 4*time.Millisecond, thin)
		defer l.close()
		l.warm()
		l.up.mu.Lock()
		l.up.counting = true
		l.up.mu.Unlock()
		for range 40 {
			l.send(120) // clicks
			time.Sleep(250 * time.Millisecond)
		}
		for range 250 {
			l.send(200) // a 125 Hz pointer
			time.Sleep(8 * time.Millisecond)
		}
		l.settle(time.Second)
		l.inOrder()
		if bundled, tailed := l.copies(); bundled != 0 || tailed != 0 {
			t.Errorf("a 4 ms path repeated %d bundled and %d tail copies", bundled, tailed)
		}
		l.up.mu.Lock()
		defer l.up.mu.Unlock()

		return l.up.packets, l.up.bytes
	}
	var with, without [2]int
	synctest.Test(t, func(t *testing.T) { with[0], with[1] = run(t, true) })
	synctest.Test(t, func(t *testing.T) { without[0], without[1] = run(t, false) })
	if with != without {
		t.Fatalf("thin stream sent %d packets / %d bytes, plain %d / %d", with[0], with[1], without[0], without[1])
	}
}

// A sender that only has thin streams still learns the path's round trip,
// and follows it when it grows: every chunk is copied before its
// acknowledgement can arrive, and Karn's rule would leave such a sender
// without a single sample.
func TestThinSenderKeepsMeasuringTheRoundTrip(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		l := newThinLink(t, 120*time.Millisecond, true)
		defer l.close()
		run := func() {
			for range 40 { // isolated messages: tail copies after 12, 40, 100 ms
				l.send(120)
				time.Sleep(250 * time.Millisecond)
			}
			for range 250 { // a 125 Hz run: two copies with later messages
				l.send(200)
				time.Sleep(8 * time.Millisecond)
			}
			l.settle(5 * time.Second)
		}
		run()
		if bundled, tailed := l.copies(); bundled == 0 || tailed == 0 {
			t.Fatalf("copies sent: %d bundled, %d in tail packets", bundled, tailed)
		}
		if srtt := l.client.SRTT(); srtt < 119 || srtt > 130 {
			t.Fatalf("smoothed round trip %.1f ms on a 120 ms path", srtt)
		}
		// The path becomes 200 ms long.
		for _, w := range []*wire{l.up, l.down} {
			w.mu.Lock()
			w.delay = 100 * time.Millisecond
			w.mu.Unlock()
		}
		run()
		if srtt := l.client.SRTT(); srtt < 195 || srtt > 215 {
			t.Fatalf("smoothed round trip %.1f ms after the path grew to 200 ms", srtt)
		}
		l.inOrder()
	})
}

// A pointer on an uplink that carries its messages but not their copies
// (384 kbit/s for a 125 Hz pointer: 240 kbit/s of messages, 700 with the
// copies). The congestion window does not see the copies and its floor is
// far above such a link, so the round trip stops them: the queue stays a few
// tens of milliseconds instead of growing to the window (two seconds here).
func TestThinCopiesDoNotFillASlowUplink(t *testing.T) {
	run := func(t *testing.T, thin bool) (delays []time.Duration, bundled uint64) {
		l := newThinLink(t, 40*time.Millisecond, thin)
		defer l.close()
		l.warm()
		l.up.mu.Lock()
		l.up.rate = 48_000
		l.up.mu.Unlock()
		first := l.next
		for range 20 * 125 {
			l.send(200)
			time.Sleep(8 * time.Millisecond)
		}
		l.settle(30 * time.Second)
		l.inOrder()
		for id := first; id < l.next; id++ {
			delays = append(delays, l.delay(id))
		}
		bundled, _ = l.copies()

		return delays, bundled
	}
	var with, without []time.Duration
	var copies uint64
	synctest.Test(t, func(t *testing.T) { with, copies = run(t, true) })
	synctest.Test(t, func(t *testing.T) { without, _ = run(t, false) })
	t.Logf("125 Hz pointer on a 384 kbit/s uplink: thin %s (%d copies) | plain %s", durationsSummary(with), copies, durationsSummary(without))
	if copies == 0 {
		t.Error("no copy went out: the test exercised nothing")
	}
	if thin, plain := quantileOf(with, .99), quantileOf(without, .99); thin > plain+40*time.Millisecond {
		t.Errorf("p99 %v on the thin stream, %v on the plain one: the copies filled the link", thin, plain)
	}
	if worst := slices.Max(with); worst > 150*time.Millisecond {
		t.Errorf("a message took %v on the thin stream", worst)
	}
}

// thinRun is one randomized session: messages of mixed sizes and spacings
// over a link that loses, duplicates and reorders packets in both
// directions.
func thinRun(t *testing.T, seed uint64, thin bool, loss, dup float64, jitter time.Duration, messages int) *thinLink {
	t.Helper()
	l := newThinLink(t, 40*time.Millisecond, thin)
	l.warm()
	random := rand.New(rand.NewPCG(seed, 7))
	for i, w := range []*wire{l.up, l.down} {
		w.mu.Lock()
		w.random = rand.New(rand.NewPCG(seed, uint64(3+2*i)))
		w.loss, w.dup, w.jitter, w.armed = loss, dup, jitter, true
		w.mu.Unlock()
	}
	for range messages {
		size := 16 + random.IntN(300)
		switch random.IntN(20) {
		case 0:
			size = thinMaxData + 1 + random.IntN(200) // one chunk, not repeated
		case 1:
			size = 2000 + random.IntN(6000) // several chunks
		}
		l.send(size)
		switch random.IntN(10) {
		case 0:
			time.Sleep(time.Duration(50+random.IntN(400)) * time.Millisecond) // a pause: a tail
		case 1, 2:
			// back to back
		default:
			time.Sleep(time.Duration(1+random.IntN(16)) * time.Millisecond)
		}
	}
	for _, w := range []*wire{l.up, l.down} {
		w.mu.Lock()
		w.armed = false
		w.mu.Unlock()
	}
	l.settle(30 * time.Second)

	return l
}

// Exactly once and in order, whatever the link does to the copies: lost,
// duplicated and reordered packets in both directions, messages of every
// size (those above thinMaxData and the fragmented ones are never
// repeated), runs and pauses.
func TestThinDeliveryIsExactlyOnceAndInOrder(t *testing.T) {
	for seed := uint64(1); seed <= 6; seed++ {
		t.Run(fmt.Sprintf("seed%d", seed), func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				loss := []float64{.02, .1, .3}[seed%3]
				l := thinRun(t, seed, true, loss, .1, 30*time.Millisecond, 600)
				defer l.close()
				l.inOrder()
				if bundled, tailed := l.copies(); bundled == 0 || tailed == 0 {
					t.Errorf("copies sent: %d bundled, %d in tail packets; the run exercised nothing", bundled, tailed)
				}
				if l.up.lost() == 0 {
					t.Error("the link lost nothing")
				}
			})
		})
	}
}

// pointer is a pointer moving at rate messages a second for the given time
// with a click (two messages) every 400 ms, over a link that loses packets
// in both directions; it returns every message's delivery time, and the
// packets and bytes the client sent a second.
func pointer(t *testing.T, thin bool, rtt time.Duration, rate int, loss float64, burst, length time.Duration) (delays []time.Duration, packets, bytes float64) {
	t.Helper()
	l := newThinLink(t, rtt, thin)
	defer l.close()
	l.warm()
	for i, w := range []*wire{l.up, l.down} {
		w.mu.Lock()
		w.random = rand.New(rand.NewPCG(42, uint64(i)))
		w.loss, w.armed = loss, true
		w.mu.Unlock()
	}
	start := time.Now()
	first := l.next
	interval := time.Second / time.Duration(rate)
	for i := 0; time.Since(start) < length; i++ {
		l.send(200) // a pointer move as the desktop viewer sends it
		if at := time.Duration(i) * interval; burst > 0 && at%(2*time.Second) < interval && i > 0 {
			l.up.dropNextData(burst) // every two seconds the link is gone for a moment
		}
		if (time.Duration(i)*interval)%(400*time.Millisecond) < interval {
			l.send(180)
			time.Sleep(interval / 2)
			l.send(180)
			time.Sleep(interval - interval/2)

			continue
		}
		time.Sleep(interval)
	}
	elapsed := time.Since(start)
	for _, w := range []*wire{l.up, l.down} {
		w.mu.Lock()
		w.armed = false
		w.mu.Unlock()
	}
	l.settle(30 * time.Second)
	l.inOrder()
	l.mu.Lock()
	for id := first; id < l.next; id++ {
		delays = append(delays, l.delays[id])
	}
	l.mu.Unlock()
	l.up.mu.Lock()
	defer l.up.mu.Unlock()

	return delays, float64(l.up.packets) / elapsed.Seconds(), float64(l.up.bytes) / elapsed.Seconds()
}

func quantileOf(v []time.Duration, p float64) time.Duration {
	s := slices.Clone(v)
	slices.Sort(s)

	return s[min(len(s)-1, int(float64(len(s))*p))]
}

// A moving pointer on a path that loses 3 % of its packets: a lost move is
// repaired by the next packet, so the 99th percentile of the delivery time
// stays near the one-way delay instead of a round trip above it.
func TestThinPointerUnderLoss(t *testing.T) {
	const rtt = 40 * time.Millisecond
	var with, without []time.Duration
	synctest.Test(t, func(t *testing.T) { with, _, _ = pointer(t, true, rtt, 125, .03, 0, 20*time.Second) })
	synctest.Test(t, func(t *testing.T) { without, _, _ = pointer(t, false, rtt, 125, .03, 0, 20*time.Second) })
	t.Logf("125 Hz pointer, RTT %v, 3%% loss: thin %s | plain %s", rtt, durationsSummary(with), durationsSummary(without))
	thin, plain := quantileOf(with, .99), quantileOf(without, .99)
	if thin > rtt/2+20*time.Millisecond {
		t.Errorf("p99 %v on a thin stream, want at most the one-way delay and two moves (%v)", thin, rtt/2+20*time.Millisecond)
	}
	if plain < 2*thin {
		t.Errorf("p99 %v without thin streams against %v with: expected at least twice", plain, thin)
	}
}

// TestThinReport prints the measurements behind YZDESK_PATCH.md's section on
// thin streams (YZDESK_SCTP_THIN_REPORT=1): delivery times of a pointer with
// clicks under random and burst loss, and the packets and bytes it costs.
func TestThinReport(t *testing.T) {
	if os.Getenv("YZDESK_SCTP_THIN_REPORT") != "1" {
		t.Skip("set YZDESK_SCTP_THIN_REPORT=1")
	}
	for _, rtt := range []time.Duration{40 * time.Millisecond, 300 * time.Millisecond} {
		for _, parts := range []int{1, 2} {
			var with, without []time.Duration
			synctest.Test(t, func(t *testing.T) { with = lostTail(t, rtt, true, parts) })
			synctest.Test(t, func(t *testing.T) { without = lostTail(t, rtt, false, parts) })
			t.Logf("THIN lost tail RTT=%v parts=%d: thin %s | plain %s", rtt, parts, durationsSummary(with), durationsSummary(without))
		}
	}
	for _, rtt := range []time.Duration{40 * time.Millisecond, 120 * time.Millisecond} {
		for _, rate := range []int{60, 125} {
			for _, c := range []struct {
				name  string
				loss  float64
				burst time.Duration
			}{{"loss0", 0, 0}, {"loss1", .01, 0}, {"loss3", .03, 0}, {"loss5", .05, 0}, {"burst30ms", 0, 30 * time.Millisecond}, {"loss1+burst30ms", .01, 30 * time.Millisecond}} {
				var d [2][]time.Duration
				var packets, bytes [2]float64
				for i, thin := range []bool{false, true} {
					synctest.Test(t, func(t *testing.T) {
						d[i], packets[i], bytes[i] = pointer(t, thin, rtt, rate, c.loss, c.burst, 60*time.Second)
					})
				}
				t.Logf("THIN pointer RTT=%v %dHz %s: plain %s %.0f pkt/s %.1f KB/s | thin %s %.0f pkt/s %.1f KB/s",
					rtt, rate, c.name, durationsSummary(d[0]), packets[0], bytes[0]/1000, durationsSummary(d[1]), packets[1], bytes[1]/1000)
			}
		}
	}
	// Idle: one 40-byte heartbeat a second, as the session's liveness sends.
	for _, rtt := range []time.Duration{4 * time.Millisecond, 40 * time.Millisecond, 300 * time.Millisecond} {
		var packets, bytes [2]float64
		for i, thin := range []bool{false, true} {
			synctest.Test(t, func(t *testing.T) {
				l := newThinLink(t, rtt, thin)
				defer l.close()
				l.warm()
				l.up.mu.Lock()
				l.up.counting = true
				l.up.mu.Unlock()
				for range 30 {
					l.send(40)
					time.Sleep(time.Second)
				}
				l.inOrder()
				l.up.mu.Lock()
				packets[i], bytes[i] = float64(l.up.packets)/30, float64(l.up.bytes)/30
				l.up.mu.Unlock()
			})
		}
		t.Logf("THIN idle heartbeat RTT=%v: plain %.1f pkt/s %.0f B/s | thin %.1f pkt/s %.0f B/s", rtt, packets[0], bytes[0], packets[1], bytes[1])
	}
}

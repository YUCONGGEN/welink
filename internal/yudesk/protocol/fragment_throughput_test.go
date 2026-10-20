package protocol

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net"
	"sort"
	"testing"
	"time"
)

func TestBulkClockDoesNotAccumulateWakeRoundingOrIdleCredit(t *testing.T) {
	start := time.Unix(1, 0)
	deadline := nextBulkDeadline(time.Time{}, start, 2500, 250000)
	for i := 1; i < 100; i++ {
		// Every wake occurs 1 ms late. A relative timer would accumulate 99 ms
		// of extra frame delay; the byte clock must retain its one-second span.
		deadline = nextBulkDeadline(deadline, deadline.Add(time.Millisecond), 2500, 250000)
	}
	if deadline.Sub(start) != time.Second {
		t.Fatal("pacing accumulated scheduler lateness", deadline.Sub(start))
	}
	resumed := start.Add(time.Minute)
	deadline = nextBulkDeadline(deadline, resumed, 2500, 250000)
	if deadline.Sub(resumed) != 10*time.Millisecond {
		t.Fatal("long idle banked a catch-up burst", deadline.Sub(resumed))
	}
}

func TestRateSizedFragmentsPreserveBytesAndLegacyReceiveLimit(t *testing.T) {
	for _, rate := range []int{0, 32 << 10, 125000, 250000, 1000000} {
		t.Run(fmt.Sprint(rate), func(t *testing.T) {
			wire := &bufferedTestConn{}
			w := NewConn(wire)
			w.EnableInterleaving()
			w.SetBulkRate(rate)
			payload := bytes.Repeat([]byte{0x31, 0x42, 0x53}, 3100)
			if err := w.WriteMessage(Message{Kind: "event", Method: "frame", Data: payload}); err != nil {
				t.Fatal(err)
			}
			packets := wire.buf.Bytes()
			for len(packets) > 0 {
				header := binary.BigEndian.Uint32(packets[:4])
				length := int(binary.BigEndian.Uint32(packets[4:8]))
				if header&fragmentFlag == 0 || length <= 0 || length > 8192 {
					t.Fatal("invalid legacy-compatible fragment", header, length)
				}
				if rate == 250000 && length > 2500 || rate == 125000 && length > 1250 || rate == 32<<10 && length > 512 {
					t.Fatal("slow-link fragment monopolizes the writer", rate, length)
				}
				packets = packets[8+int(header&^fragmentFlag)+length:]
			}
			r := NewConn(wire)
			r.EnableInterleaving()
			message, err := r.ReadMessage()
			if err != nil || !bytes.Equal(message.Data, payload) {
				t.Fatal("rate-sized fragments changed payload", err)
			}
		})
	}
	// A new sender uses smaller slices, but reception must still accept an old
	// peer's full 8 KiB wire unit (not redefine the negotiated protocol limit).
	header, _ := json.Marshal(Message{Kind: "event", Method: "frame"})
	payload := bytes.Repeat([]byte{0x79}, 8192)
	wire := &bufferedTestConn{buf: *bytes.NewBuffer(rawFragment(3, 0, 8192, header, payload))}
	r := NewConn(wire)
	r.EnableInterleaving()
	message, err := r.ReadMessage()
	if err != nil || !bytes.Equal(message.Data, payload) {
		t.Fatal("legacy 8 KiB fragment rejected", err)
	}
}

func BenchmarkPacedLoadedProbe(b *testing.B) {
	for _, rate := range []int{250000, 1000000} {
		b.Run(fmt.Sprintf("Mbps%d", rate*8/1000000), func(b *testing.B) {
			var samples []time.Duration
			for i := 0; i < b.N; i++ {
				samples = append(samples, probeBehindFrame(b, true, 256<<10, rate, true))
			}
			sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
			b.ReportMetric(float64(samples[len(samples)/2].Microseconds())/1000, "probe-p50-ms")
			b.ReportMetric(float64(samples[(95*len(samples)+99)/100-1].Microseconds())/1000, "probe-p95-ms")
		})
	}
}

// A fast reader exposes the CPU/allocation price of shorter scheduling units.
// Together with BenchmarkLoadedProbe this prevents trading unseen throughput
// regressions for a better latency number on only the constrained-link fixture.
func BenchmarkInterleavedBulkThroughput(b *testing.B) {
	a, z := net.Pipe()
	defer a.Close()
	defer z.Close()
	w, r := NewConn(a), NewConn(z)
	w.EnableInterleaving()
	r.EnableInterleaving()
	payload := bytes.Repeat([]byte{0x6a}, 1<<20)
	done := make(chan error, 1)
	go func() {
		for i := 0; i < b.N; i++ {
			if err := w.WriteMessage(Message{Kind: "event", Method: "frame", Data: payload}); err != nil {
				done <- err
				return
			}
		}
		done <- nil
	}()
	b.SetBytes(int64(len(payload)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		message, err := r.ReadMessage()
		if err != nil {
			b.Fatal(err)
		}
		if !bytes.Equal(message.Data, payload) {
			b.Fatal("bulk payload changed")
		}
	}
	if err := <-done; err != nil {
		b.Fatal(err)
	}
}

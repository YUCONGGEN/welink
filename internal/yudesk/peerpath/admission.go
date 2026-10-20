package peerpath

import (
	"context"
	"github.com/pion/webrtc/v4"
	"net"
	"os"
	"sync"
	"time"
)

// bulkAdmission limits only new, negotiated bulk fragments. It leaves the
// reliable ordered transport, audio and input bytes unchanged. All controller
// state is owned by protocol's single bulk writer except the probe reservation.
// BufferedAmount includes flight as well as queued data; the adaptive limit
// must retain a bandwidth-delay window rather than merely a small fixed queue.
func newBulkAdmission(raw *dataConn, pc *webrtc.PeerConnection) *bulkAdmission {
	return &bulkAdmission{written: raw.written.Load, sample: func() (uint64, float64) {
		rtt := 0.0
		if transport := pc.SCTP(); transport != nil {
			rtt = transport.Stats().SmoothedRoundTripTime
		}
		return raw.dc.BufferedAmount(), rtt
	}, deadline: &raw.wd, done: raw.done, started: time.Now(), limit: 64 << 10}
}

type bulkAdmission struct {
	written       func() uint64
	sample        func() (pending uint64, rtt float64)
	deadline      *connDeadline
	done          <-chan struct{}
	probeMu       sync.Mutex
	probeNext     bool
	probeEnd      uint64
	probeAt       time.Time
	started       time.Time
	acked, limit  uint64
	rates         [16]float64
	rateTimes     [16]time.Time
	samples       int
	rate, baseRTT float64
	draining      bool
	drainAt       time.Time
	drainAck      uint64
	lastProbe     time.Time
}

// recordWrite observes only completed protocol writes. Never hold probeMu
// across transport I/O: short audio/input writes must not wait on a bulk waiter.
func (p *bulkAdmission) recordWrite(b []byte, n int, err error, begin time.Time) {
	if len(b) < 8 || b[0]&0x80 == 0 || n != len(b) || err != nil {
		return
	}
	p.probeMu.Lock()
	defer p.probeMu.Unlock()
	if p.probeNext {
		p.probeNext = false
		p.probeAt = begin
		p.probeEnd = p.written()
	}
}
func (p *bulkAdmission) BulkPayload() int {
	if p.draining {
		return 2048
	}
	if p.rate == 0 {
		return 8192
	}
	return min(8192, max(512, int(p.rate/64)))
}
func (p *bulkAdmission) WaitBulk(ctx context.Context, size int) error {
	for {
		now := time.Now()
		p.probeMu.Lock()
		pending, rtt := p.sample()
		written := p.written()
		probeEnd, probeAt := p.probeEnd, p.probeAt
		p.probeMu.Unlock()
		ack := written - min(written, pending)
		if rtt > 0 && (p.baseRTT == 0 || (now.Sub(p.lastProbe) >= time.Second && rtt < p.baseRTT)) {
			p.baseRTT = rtt
		}
		if dt := now.Sub(p.started).Seconds(); dt >= .05 {
			if delta := ack - min(ack, p.acked); delta > 0 {
				at := p.samples % len(p.rates)
				p.rates[at] = float64(delta) / dt
				p.rateTimes[at] = now
				p.samples++
				peak := 0.0
				for i, rate := range p.rates {
					if now.Sub(p.rateTimes[i]).Seconds() <= max(.2, 6*p.baseRTT) {
						peak = max(peak, rate)
					}
				}
				if peak > 0 {
					p.rate = peak
				}
			}
			p.started = now
			p.acked = ack
		}
		if probeEnd != 0 {
			if ack >= probeEnd {
				p.baseRTT = now.Sub(probeAt).Seconds()
				p.lastProbe = now
				p.draining = false
				p.probeMu.Lock()
				p.probeEnd = 0
				p.probeMu.Unlock()
			} else {
				goto waitMore
			}
		}
		if ack >= 64<<10 && p.baseRTT > 0 && rtt > max(p.baseRTT*1.5, p.baseRTT+.025) && now.Sub(p.lastProbe) >= 2*time.Second && !p.draining {
			p.draining = true
			p.drainAt = now
			p.drainAck = ack
		}
		if p.draining {
			if pending <= 4096 {
				if dt := now.Sub(p.drainAt).Seconds(); dt > .02 {
					if delivered := ack - min(ack, p.drainAck); delivered > 0 {
						p.rate = float64(delivered) / dt
						for i := range p.rates {
							p.rates[i] = p.rate
							p.rateTimes[i] = now
						}
					}
				}
				p.probeMu.Lock()
				p.probeNext = true
				p.probeMu.Unlock()
				return ctx.Err()
			}
			goto waitMore
		}
		if ack >= 64<<10 && p.rate > 0 && p.baseRTT > 0 {
			fragment := p.BulkPayload()
			// Retain a bandwidth-delay window, but avoid the former half-RTT
			// surplus plus two fragments. That surplus accumulates at the shared
			// bottleneck even when input/audio have separate SCTP streams.
			// Keep startup unchanged until enough delivery has been measured.
			p.limit = uint64(min(float64(bufferLimit-chunkSize), max(float64(2*fragment+512), 1.1*p.rate*(p.baseRTT+.01)+float64(fragment))))
		}
		if pending+uint64(size) <= max(p.limit, uint64(size)) {
			return ctx.Err()
		}
	waitMore:
		when, changed := p.deadline.snapshot()
		if !when.IsZero() && !now.Before(when) {
			return os.ErrDeadlineExceeded
		}
		timer := time.NewTimer(2 * time.Millisecond)
		select {
		case <-p.done:
			timer.Stop()
			return net.ErrClosed
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-changed:
			timer.Stop()
		case <-timer.C:
		}
	}
}

package stream

import "time"

// LatencyController is a conservative delay-based fallback for the TCP tile
// transport. It is not a reproduction of a learned congestion controller.
// Queue growth and capture/write costs take priority over visual quality;
// recovery is deliberately slower than backoff to avoid oscillating sizes.
type LatencyController struct {
	baseline, rtt        time.Duration
	lastChange           time.Time
	bad, good, congested int
	Quality, Width       int
	maxQuality, maxWidth int
}

func NewLatencyController(o Options) *LatencyController {
	return &LatencyController{Quality: o.Quality, Width: o.MaxWidth, maxQuality: o.Quality, maxWidth: o.MaxWidth}
}
func (c *LatencyController) Ack(rtt time.Duration) {
	if rtt <= 0 {
		return
	}
	if c.baseline == 0 || rtt < c.baseline {
		c.baseline = rtt
	}
	if c.rtt == 0 {
		c.rtt = rtt
	} else {
		c.rtt = (c.rtt*3 + rtt) / 4
	}
}
func (c *LatencyController) QueueDelay() time.Duration { return max(0, c.rtt-c.baseline) }
func (c *LatencyController) Update(now time.Time, cost, budget time.Duration, sourceWidth int) {
	network := c.QueueDelay() > 40*time.Millisecond
	if network || cost > budget*3/2 {
		c.bad++
		c.good = 0
	} else {
		c.good++
		c.bad = 0
	}
	if network {
		c.congested++
	} else {
		c.congested = 0
	}
	if !c.lastChange.IsZero() && now.Sub(c.lastChange) < time.Second {
		return
	}
	if c.bad >= 3 {
		limit := c.maxWidth
		if limit == 0 || limit > sourceWidth {
			limit = sourceWidth
		}
		// A growing network queue is the only reason to give up legibility.
		// Slow capture/encode on its own is a CPU limit: the capture ticker
		// already drops frames, so keep text readable (>= 60 quality and up to
		// 1280 px wide) instead of sliding all the way down to 640 px.
		qualityFloor, widthFloor := min(45, c.maxQuality), min(640, sourceWidth)
		if c.congested < 3 {
			qualityFloor, widthFloor = min(60, c.maxQuality), min(1280, limit)
		}
		c.Quality = max(qualityFloor, c.Quality-8)
		// Reducing the captured image also improves PNG/text traffic, which
		// does not respond to JPEG quality changes.
		if c.Quality <= 61 || c.QueueDelay() > 100*time.Millisecond || cost > budget*3 {
			width := c.Width
			if width == 0 || width > sourceWidth {
				width = sourceWidth
			}
			c.Width = max(widthFloor, width*4/5)
		}
		c.lastChange = now
		c.bad = 0
		c.good = 0
	} else if c.good >= 150 && c.QueueDelay() < 15*time.Millisecond && cost < budget {
		c.Quality = min(c.maxQuality, c.Quality+2)
		limit := c.maxWidth
		if limit == 0 || limit > sourceWidth {
			limit = sourceWidth
		}
		if c.Width > 0 {
			c.Width = min(limit, c.Width+160)
		}
		c.lastChange = now
		c.good = 0
	}
}

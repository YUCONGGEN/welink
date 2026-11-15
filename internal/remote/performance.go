package remote

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
	"welink/internal/yudesk/peerpath"
	"welink/internal/yudesk/stream"
)

type Performance struct {
	FPS             int      `json:"fps"`
	Quality         int      `json:"quality"`
	MaxWidth        int      `json:"max_width"`
	MaxMbps         int      `json:"max_mbps"`
	STUNURLs        []string `json:"stun_urls"`
	DirectTimeoutMS int      `json:"direct_timeout_ms"`
	PortMapping     bool     `json:"port_mapping"`
}

func loadPerformance(dir string) (Performance, error) {
	// MaxMbps >= unpacedMbps means "no fixed cap": like YuDesk, the bounded
	// picture channel and tile backpressure limit the queue instead of a
	// constant 12 Mbps pace that made a 100 KB frame take at least 67 ms.
	// 100 is also the largest value older LinkMe versions accept, so the
	// file stays valid if someone reinstalls an older client.
	p := Performance{FPS: 30, Quality: 80, MaxWidth: 1920, MaxMbps: unpacedMbps, STUNURLs: peerpath.DefaultOptions().STUNURLs, DirectTimeoutMS: 15000, PortMapping: true}
	path := filepath.Join(dir, "remote-performance.json")
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		raw, _ = json.MarshalIndent(p, "", "  ")
		err = os.WriteFile(path, raw, 0600)
	} else if err == nil {
		err = json.Unmarshal(raw, &p)
		// Files written by earlier versions hold the old defaults verbatim;
		// upgrade them rather than keeping a cap nobody chose.
		if err == nil && p.FPS == 30 && p.Quality == 78 && p.MaxWidth == 1920 && p.MaxMbps == 12 {
			p.Quality, p.MaxMbps = 80, unpacedMbps
			if upgraded, marshalErr := json.MarshalIndent(p, "", "  "); marshalErr == nil {
				_ = os.WriteFile(path, upgraded, 0600)
			}
		}
	}
	if err != nil {
		return p, err
	}
	if p.FPS < 1 || p.FPS > 60 || p.Quality < 30 || p.Quality > 90 || p.MaxWidth < 640 || p.MaxWidth > 3840 || p.MaxMbps < 1 || p.MaxMbps > 100 || p.DirectTimeoutMS < 500 || p.DirectTimeoutMS > 15000 {
		return p, fmt.Errorf("invalid remote-performance.json limits")
	}
	return p, nil
}
func (p Performance) controller() *stream.LatencyController {
	return stream.NewLatencyController(stream.Options{FPS: p.FPS, Quality: p.Quality, MaxWidth: p.MaxWidth, MaxMbps: p.MaxMbps})
}
func (p Performance) interval() time.Duration { return time.Second / time.Duration(p.FPS) }

const unpacedMbps = 100

// bulkRate is the sender pacing in bytes per second; 0 disables pacing.
func (p Performance) bulkRate() int {
	if p.MaxMbps >= unpacedMbps {
		return 0
	}
	return p.MaxMbps * 1000000 / 8
}

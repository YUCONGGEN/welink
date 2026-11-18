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
	// The picture is reconstructed pixel for pixel: the source resolution
	// (MaxWidth 3840 or more means "never scale"), lossless tiles, 30 frames per second and no bandwidth cap.
	// Quality only applies to whole-JPEG frames for LinkMe versions that
	// predate tiles.
	p := Performance{FPS: 30, Quality: 90, MaxWidth: nativeWidth, MaxMbps: unpacedMbps, STUNURLs: peerpath.DefaultOptions().STUNURLs, DirectTimeoutMS: 15000, PortMapping: true}
	path := filepath.Join(dir, "remote-performance.json")
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		raw, _ = json.MarshalIndent(p, "", "  ")
		err = os.WriteFile(path, raw, 0600)
	} else if err == nil {
		err = json.Unmarshal(raw, &p)
		// Files written by earlier versions hold the old defaults verbatim;
		// upgrade them rather than keeping a cap nobody chose.
		old := p.FPS == 30 && p.MaxWidth == 1920 && ((p.Quality == 78 && p.MaxMbps == 12) || (p.Quality == 80 && p.MaxMbps == unpacedMbps))
		if err == nil && old {
			p.FPS, p.Quality, p.MaxWidth, p.MaxMbps = 30, 90, nativeWidth, unpacedMbps
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

// nativeWidth is the largest width older LinkMe versions accept in the file;
// it means "capture at the source resolution, however wide".
const nativeWidth = 3840

// captureWidth is the capture width limit; 0 keeps every source pixel.
func (p Performance) captureWidth() int {
	if p.MaxWidth >= nativeWidth {
		return 0
	}
	return p.MaxWidth
}

// bulkRate is the sender pacing in bytes per second. Remote assistance is
// never bandwidth-capped: max_mbps is kept in the file only so older LinkMe
// versions still accept it.
func (p Performance) bulkRate() int { return 0 }

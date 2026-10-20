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
	p := Performance{FPS: 30, Quality: 78, MaxWidth: 1920, MaxMbps: 12, STUNURLs: peerpath.DefaultOptions().STUNURLs, DirectTimeoutMS: 15000, PortMapping: true}
	path := filepath.Join(dir, "remote-performance.json")
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		raw, _ = json.MarshalIndent(p, "", "  ")
		err = os.WriteFile(path, raw, 0600)
	} else if err == nil {
		err = json.Unmarshal(raw, &p)
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

package remote

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestPerformanceUpgradesLegacyDefaultsAndStaysValidForOlderClients(t *testing.T) {
	dir := t.TempDir()
	legacy := `{"fps":30,"quality":78,"max_width":1920,"max_mbps":12,"stun_urls":["stun:example.invalid:3478"],"direct_timeout_ms":15000,"port_mapping":true}`
	if err := os.WriteFile(filepath.Join(dir, "remote-performance.json"), []byte(legacy), 0600); err != nil {
		t.Fatal(err)
	}
	p, err := loadPerformance(dir)
	if err != nil {
		t.Fatal(err)
	}
	if p.Quality != 80 || p.bulkRate() != 0 {
		t.Fatalf("legacy defaults not upgraded: %+v rate=%d", p, p.bulkRate())
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "remote-performance.json"))
	var stored Performance
	if json.Unmarshal(raw, &stored) != nil || stored.MaxMbps < 1 || stored.MaxMbps > 100 {
		t.Fatalf("stored file must stay within the limits older clients accept: %s", raw)
	}
	// An explicit user cap keeps pacing.
	custom := `{"fps":30,"quality":70,"max_width":1280,"max_mbps":8,"stun_urls":[],"direct_timeout_ms":15000,"port_mapping":true}`
	_ = os.WriteFile(filepath.Join(dir, "remote-performance.json"), []byte(custom), 0600)
	if p, err = loadPerformance(dir); err != nil || p.bulkRate() != 1000000 {
		t.Fatalf("custom cap: %+v %v", p, err)
	}
}

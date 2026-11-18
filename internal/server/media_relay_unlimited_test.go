package server

import (
	"testing"
	"time"
)

func TestRelayBandwidthIsUnlimitedByDefault(t *testing.T) {
	if defaultMediaSettings().BytesPerSecond != 0 {
		t.Fatal("relay must not cap bandwidth by default")
	}
	l := relayLimiter(0)
	for i := 0; i < 1000; i++ {
		if !l.AllowN(time.Now(), 1<<20) {
			t.Fatal("unlimited relay dropped a packet")
		}
	}
	if relayLimiter(65536).AllowN(time.Now(), 1<<20) {
		t.Fatal("an explicit cap must still apply")
	}
}

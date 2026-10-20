// Package mediabudget leaves CPU scheduling capacity for live audio and input
// while screen compressors use bounded parallel workers.
package mediabudget

import "sync/atomic"

var audioCaptures atomic.Int32

func AudioActive() bool { return audioCaptures.Load() > 0 }

func BeginAudio() func() {
	audioCaptures.Add(1)
	return func() { audioCaptures.Add(-1) }
}

// CPUsForScreen supplies the existing screen worker budget, whose final worker
// calculation already leaves one CPU free. While any capture is alive, reserve
// two additional CPUs for application startup, input and the audio encoder.
// On a four-CPU Windows host, two screen compressors plus IDEA startup left
// Go/native audio handoffs waiting >250 ms even though the native producer
// drained WASAPI every 16 ms. Give live I/O and foreground application startup
// priority over additional screen compression workers on that class of host.
func CPUsForScreen(cpus int) int {
	if AudioActive() {
		return max(1, cpus-2)
	}
	return cpus
}

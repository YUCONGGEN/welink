//go:build windows

package mediabudget

import "time"

// AudioWorker keeps a small scheduling clock alive while Windows I/O waits
// outside Go. The receive worker has scoped AboveNormal/HighQoS; capture and
// playback use their own native multimedia threads.
func AudioWorker() func() {
	leave := InteractiveWorker()
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		clock := time.NewTicker(10 * time.Millisecond)
		defer clock.Stop()
		for {
			select {
			case <-stop:
				return
			case <-clock.C:
			}
		}
	}()
	return func() { close(stop); <-done; leave() }
}

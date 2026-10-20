package natmap

import (
	"context"
	"sync"
	"time"
)

const renewalTimeout = 2 * time.Second

// The discovery context is intentionally not retained: callers cancel it as
// soon as OpenUDP returns. The owner must Close the lease at session shutdown.
// A zero lifetime is a permanent UPnP mapping and needs only deletion.
func newRenewingLease(lifetime time.Duration, renew func(context.Context) (time.Duration, error), release func() error) Lease {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		if lifetime <= 0 {
			return
		}
		delay := lifetime / 2
		timer := time.NewTimer(delay)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}
			if ctx.Err() != nil {
				return
			}
			// Short server-granted leases must leave time for another attempt
			// before expiry. A failed gateway never causes an unbounded request
			// or a tight retry loop.
			requestCtx, stop := context.WithTimeout(ctx, min(renewalTimeout, lifetime/4))
			next, err := renew(requestCtx)
			stop()
			if err == nil {
				if next <= 0 {
					return
				}
				lifetime = next
				delay = lifetime / 2
			} else {
				delay = min(30*time.Second, lifetime/8)
			}
			timer.Reset(max(time.Millisecond, delay))
		}
	}()
	return &closeOnce{fn: func() error {
		cancel()
		<-done // Never let a late renewal recreate an already deleted mapping.
		return release()
	}}
}

type closeOnce struct {
	once sync.Once
	fn   func() error
	err  error
}

func (lease *closeOnce) Close() error {
	if lease == nil {
		return nil
	}
	lease.once.Do(func() {
		if lease.fn != nil {
			lease.err = lease.fn()
		}
	})
	return lease.err
}

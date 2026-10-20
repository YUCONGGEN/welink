package natmap

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"
)

func TestRenewingLeaseUsesGrantedLifetimeAndRetries(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		started := time.Now()
		var calls []time.Duration
		deleted := 0
		lease := newRenewingLease(8*time.Second, func(ctx context.Context) (time.Duration, error) {
			calls = append(calls, time.Since(started))
			if len(calls) == 2 {
				return 0, errors.New("temporary gateway failure")
			}
			return 4 * time.Second, nil
		}, func() error { deleted++; return nil })
		time.Sleep(7500 * time.Millisecond)
		synctest.Wait()
		want := []time.Duration{4 * time.Second, 6 * time.Second, 6500 * time.Millisecond}
		if len(calls) != len(want) {
			t.Fatalf("renewals = %v, want %v", calls, want)
		}
		for i := range want {
			if calls[i] != want[i] {
				t.Fatalf("renewals = %v, want %v", calls, want)
			}
		}
		_ = lease.Close()
		_ = lease.Close()
		time.Sleep(time.Hour)
		synctest.Wait()
		if len(calls) != 3 || deleted != 1 {
			t.Fatalf("renewals after close or repeated deletion: %v / %d", calls, deleted)
		}
	})
}

func TestRenewingLeaseBoundsRequestsAndJoinsBeforeDelete(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		var calls, deletes atomic.Int32
		var active atomic.Bool
		lease := newRenewingLease(8*time.Second, func(ctx context.Context) (time.Duration, error) {
			calls.Add(1)
			active.Store(true)
			defer active.Store(false)
			<-ctx.Done()
			return 0, ctx.Err()
		}, func() error {
			if active.Load() {
				t.Error("delete raced an active renewal")
			}
			deletes.Add(1)
			return nil
		})
		// First request starts at 4s, times out at 6s, and retries at 7s.
		time.Sleep(8 * time.Second)
		synctest.Wait()
		if calls.Load() != 2 || !active.Load() {
			t.Fatalf("request timeout/retry not bounded: calls=%d active=%v", calls.Load(), active.Load())
		}
		started := time.Now()
		var wg sync.WaitGroup
		for range 8 {
			wg.Go(func() { _ = lease.Close() })
		}
		wg.Wait()
		if time.Since(started) != 0 || active.Load() || deletes.Load() != 1 {
			t.Fatal("Close did not promptly cancel, join, and delete exactly once")
		}
	})
}

func TestRenewingLeasePermanentMapping(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		deleted := false
		lease := newRenewingLease(0, func(context.Context) (time.Duration, error) {
			t.Error("permanent mapping was renewed")
			return 0, nil
		}, func() error { deleted = true; return nil })
		time.Sleep(48 * time.Hour)
		_ = lease.Close()
		if !deleted {
			t.Fatal("permanent mapping not deleted")
		}
	})
}

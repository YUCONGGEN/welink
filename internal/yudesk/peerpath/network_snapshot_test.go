package peerpath

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pion/transport/v4"
	"github.com/pion/transport/v4/vnet"
)

func TestInterfaceSnapshotDeadlineAndConcurrentWaiters(t *testing.T) {
	var calls atomic.Int32
	started, release := make(chan struct{}), make(chan struct{})
	network, err := vnet.NewNet(&vnet.NetConfig{StaticIPs: []string{"192.0.2.10"}})
	if err != nil {
		t.Fatal(err)
	}
	cache := &interfaceSnapshots{ttl: time.Second, create: func() (transport.Net, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-release
		}
		return network, nil
	}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	first := make(chan error, 1)
	go func() { _, err := cache.get(ctx); first <- err }()
	<-started
	second := make(chan transport.Net, 1)
	go func() { n, _ := cache.get(context.Background()); second <- n }()
	cancel()
	select {
	case err := <-first:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		close(release)
		t.Fatal("interface scan blocked caller cancellation")
	}
	close(release)
	if got := <-second; got != network {
		t.Fatal("canceling one attempt canceled the other waiter")
	}
	if got, err := cache.get(context.Background()); err != nil || got != network || calls.Load() != 1 {
		t.Fatal("concurrent attempts did not share a snapshot")
	}
	cache.mu.Lock()
	cache.expires = time.Now().Add(-time.Second)
	cache.mu.Unlock()
	if _, err := cache.get(context.Background()); err != nil || calls.Load() != 2 {
		t.Fatal("expired interfaces were not refreshed")
	}
}

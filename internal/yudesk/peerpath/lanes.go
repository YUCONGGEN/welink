package peerpath

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"net"
	"sync"
	"time"

	"welink/internal/yudesk/protocol"
	"welink/internal/yudesk/secureconn"
)

// EnableRelayLanes is a two-sided commit, never unilateral live failover. Old
// relays skip it completely. A setup failure keeps the primary ordered path;
// a failure after commit terminates the session instead of replaying input.
func EnableRelayLanes(ctx context.Context, base *protocol.Conn, role string, read func() (protocol.Message, error), o Options) error {
	if len(o.laneSeed) != 32 || o.RelayLane == nil {
		return nil
	}
	if role != "agent" && role != "viewer" {
		return errors.New("invalid session lane role")
	}
	attempt, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	var sides [2]net.Conn
	var wg sync.WaitGroup
	for index, name := range []string{"input", "audio"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			raw, err := o.RelayLane(attempt, name)
			if err != nil {
				return
			}
			stop := context.AfterFunc(attempt, func() { _ = raw.Close() })
			defer stop()
			// Fresh per-lane ECDH and keys, bound to the secret exchanged only after
			// primary E2E authentication. Relay tickets never decrypt these streams.
			seed := sha256.Sum256(append(append([]byte("yudesk-session-lane-v1:"+name+":"), o.laneSeed...), byte(1)))
			key := ed25519.NewKeyFromSeed(seed[:])
			var encrypted net.Conn
			if role == "agent" {
				encrypted, err = secureconn.Accept(raw, key)
			} else {
				encrypted, err = secureconn.Connect(raw, secureconn.DeviceID(key.Public().(ed25519.PublicKey)))
			}
			stopped := stop()
			if err != nil || !stopped || attempt.Err() != nil {
				_ = raw.Close()
				return
			}
			sides[index] = encrypted
		}()
	}
	wg.Wait()
	cleanup := func() {
		for _, side := range sides {
			if side != nil {
				_ = side.SetDeadline(time.Now())
				_ = side.Close()
			}
		}
	}
	ready := sides[0] != nil && sides[1] != nil
	deadline := time.Now().Add(2 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	s := signaling{base: base, read: read, ctx: ctx, deadline: deadline}
	remote, err := s.exchange(role, "session-lanes", signal{Ready: ready})
	if err != nil {
		cleanup()
		_ = base.Close()
		return err
	}
	if remote.SDP != "" || remote.Info != (Info{}) {
		cleanup()
		_ = base.Close()
		return errors.New("invalid session lane commit")
	}
	if err = base.SetDeadline(time.Time{}); err != nil {
		cleanup()
		return err
	}
	if !ready || !remote.Ready {
		cleanup()
		return nil
	}
	if o.WrapLane != nil {
		for index := range sides {
			sides[index] = o.WrapLane(sides[index])
		}
	}
	if err = base.EnableLanes(sides[0], sides[1]); err != nil {
		cleanup()
		return err
	}
	return nil
}

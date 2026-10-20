package natmap

import (
	"context"
	"encoding/binary"
	"net"
	"net/netip"
	"sync/atomic"
	"testing"
	"time"
)

func TestNATPMPAssignedPortRenewalAndDelete(t *testing.T) {
	server, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	var creates, deletes atomic.Int32
	done := make(chan struct{})
	go func() {
		defer close(done)
		buffer := make([]byte, 64)
		for {
			n, address, err := server.ReadFromUDP(buffer)
			if err != nil {
				return
			}
			if n < 2 {
				continue
			}
			opcode := buffer[1]
			size := 12
			if opcode == 1 {
				size = 16
			}
			response := make([]byte, size)
			response[1] = 128 | opcode
			if opcode == 0 {
				copy(response[8:12], []byte{203, 0, 113, 9})
			} else if n == 12 {
				copy(response[8:10], buffer[4:6])
				binary.BigEndian.PutUint16(response[10:12], 45001)
				if binary.BigEndian.Uint32(buffer[8:12]) == 0 {
					deletes.Add(1)
				} else {
					creates.Add(1)
					binary.BigEndian.PutUint32(response[12:16], 2)
				}
				// A stale reply for another socket and a short reply must not
				// be mistaken for this mapping's successful response.
				stale := append([]byte(nil), response...)
				stale[8] ^= 1
				_, _ = server.WriteToUDP(stale, address)
				_, _ = server.WriteToUDP(response[:8], address)
			}
			_, _ = server.WriteToUDP(response, address)
		}
	}()
	t.Cleanup(func() { _ = server.Close(); <-done })
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	mapping, err := openNATPMP(ctx, server.LocalAddr().(*net.UDPAddr), netip.MustParseAddr("127.0.0.1"), mapConfig{localPort: 31001, lifetime: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = mapping.Lease.Close() })
	if mapping.ExternalPort != 45001 || mapping.ExternalIP.String() != "203.0.113.9" {
		t.Fatalf("bad endpoint: %+v", mapping)
	}
	until := time.Now().Add(3 * time.Second)
	for creates.Load() < 2 && time.Now().Before(until) {
		time.Sleep(20 * time.Millisecond)
	}
	if creates.Load() < 2 {
		t.Fatal("server-granted 2-second lease was not renewed")
	}
	_ = mapping.Lease.Close()
	_ = mapping.Lease.Close()
	if deletes.Load() != 1 {
		t.Fatalf("delete count = %d", deletes.Load())
	}
}

func TestNATPMPSilentGatewayHonorsCancellation(t *testing.T) {
	server, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := natPMPExternalIP(ctx, server.LocalAddr().(*net.UDPAddr), netip.MustParseAddr("127.0.0.1"))
		done <- err
	}()
	buffer := make([]byte, 32)
	_ = server.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := server.ReadFromUDP(buffer); err != nil {
		t.Fatal(err)
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("canceled request succeeded")
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("cancel waited for the gateway timeout")
	}
}

package natmap

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"time"
)

// RFC 6886: version 0, external-address opcode 0, UDP mapping opcode 1.
// Queries use a separate connected socket, preserving the application's ICE
// socket and checking the gateway source address in the UDP stack.
func mapNATPMP(ctx context.Context, socket *net.UDPConn, gateway netip.Addr, config mapConfig) (Mapping, error) {
	localIP, err := localIPv4(socket, gateway)
	if err != nil {
		return Mapping{}, err
	}
	server := net.UDPAddrFromAddrPort(netip.AddrPortFrom(gateway, pcpPort))
	return openNATPMP(ctx, server, localIP, config)
}

func openNATPMP(ctx context.Context, server *net.UDPAddr, localIP netip.Addr, config mapConfig) (Mapping, error) {
	externalIP, err := natPMPExternalIP(ctx, server, localIP)
	if err != nil {
		return Mapping{}, err
	}
	port := config.externalPort
	if port == 0 {
		port = config.localPort
	}
	assigned, lifetime, err := natPMPMap(ctx, server, localIP, config.localPort, port, durationSeconds(config.lifetime))
	if err != nil {
		return Mapping{}, err
	}
	lastPort := assigned
	lease := newRenewingLease(time.Duration(lifetime)*time.Second, func(ctx context.Context) (time.Duration, error) {
		ip, err := natPMPExternalIP(ctx, server, localIP)
		if err != nil {
			return 0, err
		}
		port, lifetime, err := natPMPMap(ctx, server, localIP, config.localPort, assigned, durationSeconds(config.lifetime))
		if err != nil {
			return 0, err
		}
		lastPort = port
		if ip != externalIP || port != assigned {
			return 0, errors.New("natmap: NAT-PMP renewal changed the advertised endpoint")
		}
		return time.Duration(lifetime) * time.Second, nil
	}, func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 600*time.Millisecond)
		defer cancel()
		_, _, err := natPMPMap(ctx, server, localIP, config.localPort, lastPort, 0)
		return err
	})
	return Mapping{ExternalIP: externalIP, ExternalPort: assigned, Method: MethodNATPMP, Lease: lease}, nil
}

func natPMPExternalIP(ctx context.Context, server *net.UDPAddr, localIP netip.Addr) (netip.Addr, error) {
	response, err := exchangeNATPMP(ctx, server, localIP, []byte{0, 0}, 0, 12, 0)
	if err != nil {
		return netip.Addr{}, err
	}
	ip := netip.AddrFrom4([4]byte(response[8:12]))
	if ip.IsUnspecified() || ip.IsLoopback() || ip.IsMulticast() || ip == netip.MustParseAddr("255.255.255.255") {
		return netip.Addr{}, errors.New("natmap: invalid NAT-PMP external address")
	}
	return ip, nil
}

func natPMPMap(ctx context.Context, server *net.UDPAddr, localIP netip.Addr, internal, external uint16, lifetime uint32) (uint16, uint32, error) {
	request := make([]byte, 12)
	request[1] = 1
	binary.BigEndian.PutUint16(request[4:6], internal)
	binary.BigEndian.PutUint16(request[6:8], external)
	binary.BigEndian.PutUint32(request[8:12], lifetime)
	response, err := exchangeNATPMP(ctx, server, localIP, request, 1, 16, internal)
	if err != nil {
		return 0, 0, err
	}
	port, granted := binary.BigEndian.Uint16(response[10:12]), binary.BigEndian.Uint32(response[12:16])
	if lifetime != 0 && (port == 0 || granted == 0) {
		return 0, 0, errors.New("natmap: empty NAT-PMP mapping")
	}
	return port, granted, nil
}

func exchangeNATPMP(ctx context.Context, server *net.UDPAddr, localIP netip.Addr, request []byte, opcode byte, size int, internal uint16) ([]byte, error) {
	connection, err := net.DialUDP("udp4", net.UDPAddrFromAddrPort(netip.AddrPortFrom(localIP, 0)), server)
	if err != nil {
		return nil, err
	}
	defer connection.Close()
	stop := context.AfterFunc(ctx, func() { _ = connection.Close() })
	defer stop()
	deadline := time.Now().Add(renewalTimeout)
	if value, ok := ctx.Deadline(); ok && value.Before(deadline) {
		deadline = value
	}
	buffer := make([]byte, 64)
	var last error
	for attempt := 0; attempt < 3; attempt++ {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		_ = connection.SetWriteDeadline(deadline)
		if _, err := connection.Write(request); err != nil {
			return nil, err
		}
		readDeadline := minTime(deadline, time.Now().Add((250*time.Millisecond)<<attempt))
		_ = connection.SetReadDeadline(readDeadline)
		for {
			n, err := connection.Read(buffer)
			if err != nil {
				last = err
				break
			}
			if n < 8 || buffer[0] != 0 || buffer[1] != 128|opcode {
				continue
			}
			if result := binary.BigEndian.Uint16(buffer[2:4]); result != 0 {
				return nil, fmt.Errorf("natmap: NAT-PMP result %d", result)
			}
			if n != size || opcode == 1 && binary.BigEndian.Uint16(buffer[8:10]) != internal {
				continue
			}
			return append([]byte(nil), buffer[:n]...), nil
		}
		if !time.Now().Before(deadline) {
			break
		}
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	return nil, fmt.Errorf("natmap: NAT-PMP timeout: %w", last)
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

package peerpath

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/pion/sctp"
	"welink/internal/yudesk/protocol"
)

func TestSCTPInitValidation(t *testing.T) {
	token, err := sctp.GenerateOutOfBandToken(sctp.WithMaxReceiveBufferSize(bufferLimit))
	if err != nil {
		t.Fatal(err)
	}
	encode := base64.StdEncoding.EncodeToString
	if err := validateSCTPInit(encode(token)); err != nil {
		t.Fatalf("current SCTP token rejected: %v", err)
	}
	for _, tc := range []struct {
		name string
		edit func([]byte) []byte
	}{
		{"not-init", func(b []byte) []byte { b[0] = 2; return b }},
		{"reserved-flags", func(b []byte) []byte { b[1] = 1; return b }},
		{"zero-tag", func(b []byte) []byte { clear(b[4:8]); return b }},
		{"tiny-window", func(b []byte) []byte { binary.BigEndian.PutUint32(b[8:12], 1499); return b }},
		{"no-outbound-stream", func(b []byte) []byte { clear(b[12:14]); return b }},
		{"no-inbound-stream", func(b []byte) []byte { clear(b[14:16]); return b }},
		{"truncated", func(b []byte) []byte { return b[:19] }},
		{"bundled-chunk", func(b []byte) []byte { return append(b, b...) }},
		{"parameter-overrun", func(b []byte) []byte { binary.BigEndian.PutUint16(b[22:24], 65535); return b }},
		{"parameter-zero-length", func(b []byte) []byte { clear(b[22:24]); return b }},
		{"unknown-required-parameter", func(b []byte) []byte { binary.BigEndian.PutUint16(b[20:22], 0x1234); return b }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateSCTPInit(encode(tc.edit(append([]byte(nil), token...)))); err == nil {
				t.Fatal("invalid INIT accepted")
			}
		})
	}
	for _, text := range []string{"", "*", strings.Repeat("A", 2049)} {
		if validateSCTPInit(text) == nil {
			t.Fatal("invalid base64 or size accepted")
		}
	}
	a, err := newAttempt(context.Background(), hostOptions(), 100*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer a.close()
	raw, reason := a.description(context.Background(), true, 100*time.Millisecond)
	if reason != "" {
		t.Fatal(reason)
	}
	if !strings.Contains(raw, "a=sctp-init:") {
		t.Fatal("production settings did not advertise SNAP")
	}
	if err := validateSDP(raw+"a=sctp-init:"+encode(token)+"\r\n", false); err == nil {
		t.Fatal("duplicate INIT accepted")
	}
	if err := validateSDP(strings.Replace(raw, "m=application", "a=sctp-init:"+encode(token)+"\r\nm=application", 1), false); err == nil {
		t.Fatal("session-scoped INIT accepted")
	}
}

func TestMalformedSCTPInitTerminatesAuthenticatedNegotiation(t *testing.T) {
	for _, bad := range []string{"*", base64.StdEncoding.EncodeToString(make([]byte, 20))} {
		t.Run(bad, func(t *testing.T) {
			left, right := encryptedPair(t)
			bases := [2]*protocol.Conn{protocol.NewConn(left), protocol.NewConn(right)}
			mutated := false
			read := func() (protocol.Message, error) {
				m, err := bases[1].ReadMessage()
				if err == nil && m.Method == "offer" {
					var v signal
					if err = json.Unmarshal(m.Params, &v); err != nil {
						return m, err
					}
					lines := strings.Split(v.SDP, "\r\n")
					for i, line := range lines {
						if strings.HasPrefix(line, "a=sctp-init:") {
							lines[i] = "a=sctp-init:" + bad
							mutated = true
						}
					}
					v.SDP = strings.Join(lines, "\r\n")
					m.Params, err = json.Marshal(v)
				}
				return m, err
			}
			results := runPair(t, context.Background(), bases, [2]Options{trickleOptions(), trickleOptions()}, [2]func() (protocol.Message, error){nil, read})
			if !mutated {
				t.Fatal("fault did not reach the SDP INIT")
			}
			for _, r := range results {
				if r.c != nil || !errors.Is(r.err, ErrSignaling) {
					t.Fatalf("invalid INIT left a usable connection: %+v", r)
				}
			}
		})
	}
}

func FuzzSCTPInitBounds(f *testing.F) {
	token, err := sctp.GenerateOutOfBandToken(sctp.WithMaxReceiveBufferSize(bufferLimit))
	if err != nil {
		f.Fatal(err)
	}
	f.Add(base64.StdEncoding.EncodeToString(token))
	f.Add("")
	f.Add("*")
	f.Fuzz(func(t *testing.T, encoded string) { _ = validateSCTPInit(encoded) })
}

package peerpath

import (
	"encoding/base64"
	"encoding/binary"
	"errors"
	"strings"

	"github.com/pion/sdp/v3"
)

// SNAP moves INIT from DTLS packets to authenticated signaling. Validate its
// envelope and mandatory INIT constraints before giving it to Pion: its SNAP
// path unmarshals the chunk but does not invoke chunkInit.check(). The SCTP
// library remains responsible for negotiating its supported extensions.
func validateSCTPInitAttributes(desc sdp.SessionDescription) error {
	for _, attr := range desc.Attributes {
		if strings.TrimSpace(attr.Key) == "sctp-init" {
			return errors.New("SCTP INIT must belong to the data media section")
		}
	}
	seen := false
	for _, attr := range desc.MediaDescriptions[0].Attributes {
		if strings.TrimSpace(attr.Key) != "sctp-init" {
			continue
		}
		if seen {
			return errors.New("duplicate SCTP INIT")
		}
		seen = true
		if err := validateSCTPInit(attr.Value); err != nil {
			return err
		}
	}
	return nil
}

func validateSCTPInit(encoded string) error {
	invalid := errors.New("invalid SCTP INIT")
	// Current INIT is only a few dozen bytes. Bound future optional extensions
	// independently of the larger SDP limit, and reject a second bundled chunk.
	if len(encoded) == 0 || len(encoded) > 2048 {
		return invalid
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(raw) < 20 || raw[0] != 1 || raw[1] != 0 {
		return invalid
	}
	if int(binary.BigEndian.Uint16(raw[2:4])) != len(raw) ||
		binary.BigEndian.Uint32(raw[4:8]) == 0 ||
		binary.BigEndian.Uint32(raw[8:12]) < 1500 ||
		binary.BigEndian.Uint16(raw[12:14]) == 0 || binary.BigEndian.Uint16(raw[14:16]) == 0 {
		return invalid
	}
	for offset := 20; offset < len(raw); {
		if len(raw)-offset < 4 {
			return invalid
		}
		kind := binary.BigEndian.Uint16(raw[offset : offset+2])
		length := int(binary.BigEndian.Uint16(raw[offset+2 : offset+4]))
		if length < 4 || length > len(raw)-offset {
			return invalid
		}
		switch kind {
		case 0xc000, 0x8000: // Forward-TSN support / ECN capability.
			if length != 4 {
				return invalid
			}
		case 0x8008: // Supported chunk extensions: one byte per chunk type.
			if length == 4 {
				return invalid
			}
		case 0x8001: // Zero-checksum acceptable (RFC 9653).
			if length != 8 {
				return invalid
			}
		default:
			// Unknown mandatory parameters must abort, not silently negotiate a
			// different association. Optional parameters can be skipped by SCTP.
			if kind&0x8000 == 0 {
				return invalid
			}
		}
		offset += length
		if offset < len(raw) {
			offset += (4 - length%4) % 4
			if offset > len(raw) {
				return invalid
			}
		}
	}
	return nil
}

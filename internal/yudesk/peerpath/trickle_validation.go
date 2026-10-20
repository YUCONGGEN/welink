package peerpath

import (
	"errors"
	"net/netip"
	"strings"

	"github.com/pion/ice/v4"
	"github.com/pion/sdp/v3"
	"github.com/pion/webrtc/v4"
)

type iceScope struct{ mid, ufrag string }

func validateTrickleSDP(raw string, allowRelay bool) (iceScope, error) {
	var scope iceScope
	if err := validateSDPShape(raw, allowRelay, false); err != nil {
		return scope, err
	}
	var desc sdp.SessionDescription
	if err := desc.Unmarshal([]byte(raw)); err != nil {
		return scope, err
	}
	attrs := append(append([]sdp.Attribute(nil), desc.Attributes...), desc.MediaDescriptions[0].Attributes...)
	values := map[string]string{}
	for _, attr := range attrs {
		switch attr.Key {
		case "candidate", "end-of-candidates":
			return scope, errors.New("trickle SDP must not embed candidates")
		case "mid", "ice-ufrag", "ice-pwd":
			if _, duplicate := values[attr.Key]; duplicate {
				return scope, errors.New("ambiguous ICE scope")
			}
			values[attr.Key] = attr.Value
		}
	}
	validToken := func(value string, minimum, maximum int, extra string) bool {
		if len(value) < minimum || len(value) > maximum {
			return false
		}
		for _, c := range value {
			if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune(extra, c)) {
				return false
			}
		}
		return true
	}
	if !validToken(values["mid"], 1, 64, "-_") || !validToken(values["ice-ufrag"], 4, 256, "+/") || !validToken(values["ice-pwd"], 22, 256, "+/") {
		return scope, errors.New("invalid ICE credentials or media ID")
	}
	return iceScope{mid: values["mid"], ufrag: values["ice-ufrag"]}, nil
}

func validateTrickleCandidate(value webrtc.ICECandidateInit, scope iceScope, allowRelay, end bool) error {
	if value.SDPMid == nil || value.SDPMLineIndex == nil || value.UsernameFragment == nil || *value.SDPMid != scope.mid || *value.SDPMLineIndex != 0 || *value.UsernameFragment != scope.ufrag {
		return errors.New("ICE candidate does not belong to the authenticated description")
	}
	if end {
		if value.Candidate != "" {
			return errors.New("end-of-candidates contains a candidate")
		}
		return nil
	}
	if len(value.Candidate) == 0 || len(value.Candidate) > 1024 || strings.ContainsAny(value.Candidate, "\r\n\x00") {
		return errors.New("invalid trickle candidate size")
	}
	candidate, err := ice.UnmarshalCandidate(strings.TrimPrefix(value.Candidate, "candidate:"))
	if err != nil {
		return err
	}
	address, err := netip.ParseAddr(candidate.Address())
	allowed := candidate.Type() == ice.CandidateTypeHost || candidate.Type() == ice.CandidateTypeServerReflexive || allowRelay && candidate.Type() == ice.CandidateTypeRelay
	if err != nil || address.Zone() != "" || address.IsUnspecified() || address.IsMulticast() || address.Is6() && address.IsLinkLocalUnicast() || !candidate.NetworkType().IsUDP() || !allowed || candidate.Component() != 1 || candidate.Port() <= 0 || candidate.Port() > 65535 {
		return errors.New("only scoped numeric authorized UDP candidates are allowed")
	}
	if related := candidate.RelatedAddress(); related != nil {
		ip, parseErr := netip.ParseAddr(related.Address)
		if parseErr != nil || ip.Zone() != "" || ip.IsMulticast() || related.Port < 0 || related.Port > 65535 {
			return errors.New("invalid related ICE address")
		}
	}
	if ufrag, present := candidate.GetExtension("ufrag"); present && ufrag.Value != scope.ufrag {
		return errors.New("candidate extension contains stale ICE credentials")
	}
	return nil
}

func scopedCandidate(candidate string, scope iceScope) webrtc.ICECandidateInit {
	index := uint16(0)
	return webrtc.ICECandidateInit{Candidate: candidate, SDPMid: &scope.mid, SDPMLineIndex: &index, UsernameFragment: &scope.ufrag}
}

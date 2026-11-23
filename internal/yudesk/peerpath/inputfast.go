package peerpath

import (
	"github.com/pion/logging"
	"github.com/pion/sctp"
)

// Ported from YuDesk internal/peerpath/inputfast.go (input fast lane, 191).
//
// The input lane (pointer, keys, frame acknowledgements: lane 1) is an
// ordered, reliable SCTP stream of short messages with pauses between them.
// A click is a tail: nothing follows it, so when its packet is lost only a
// timer brings it back, and a lost pointer move holds every later move back
// for a round trip because the stream is ordered.
//
// When both peers agree, each side makes its own sending half of the input
// lane a thin stream of the vendored SCTP (third_party/sctp, yzdesk.go): it
// repeats what is not yet acknowledged before any loss is known (with the
// next messages, then 12-36, 40, 100 and 220 ms after the last one, only
// while unacknowledged). A copy is the same chunk with the same TSN, so the
// lane stays one ordered, reliable stream applied exactly once. Copies cost
// at most 64 KB a second, nothing on a path acknowledging within 12 ms, and
// stop while a picture frame is in flight on the same side.

// inputLaneStream is the SCTP stream (data channel id) of the input lane,
// the second negotiated channel of newAttempt.
const inputLaneStream = 1

// WithInputFast sets whether both peers agreed on the input fast lane. It
// has an effect only with the session lanes (WithSessionLanes).
func (o Options) WithInputFast(negotiated bool) Options {
	o.inputFast = negotiated
	return o
}

// thinStreamsFactory tells the vendored SCTP which of an association's
// streams are thin (sctp.ThinStreamsConfig). The logger factory is the one
// per-association value pion/webrtc hands to SCTP, so it carries the answer;
// logging itself passes through unchanged.
type thinStreamsFactory struct {
	logging.LoggerFactory
	streams []uint16
}

func (f thinStreamsFactory) SCTPThinStreams() []uint16 { return f.streams }

var _ sctp.ThinStreamsConfig = thinStreamsFactory{}

func withThinStreams(factory logging.LoggerFactory, o Options) logging.LoggerFactory {
	if !o.inputFast || len(o.laneSeed) != 32 || factory == nil {
		return factory
	}
	return thinStreamsFactory{factory, []uint16{inputLaneStream}}
}

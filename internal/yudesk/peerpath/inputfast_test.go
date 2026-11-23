package peerpath

import (
	"testing"

	"github.com/pion/logging"
	"github.com/pion/sctp"
)

// The input lane becomes a thin stream only when both peers agreed and the
// session has lanes; otherwise SCTP gets Pion's factory unchanged.
func TestInputFastMarksOnlyTheInputLane(t *testing.T) {
	base := logging.NewDefaultLoggerFactory()
	seed := make([]byte, 32)
	for _, c := range []struct {
		name string
		o    Options
		thin bool
	}{
		{"agreed with lanes", Options{}.WithSessionLanes(seed).WithInputFast(true), true},
		{"not agreed", Options{}.WithSessionLanes(seed), false},
		{"no lanes", Options{}.WithInputFast(true), false},
	} {
		got := withThinStreams(base, c.o)
		thin, ok := got.(sctp.ThinStreamsConfig)
		if ok != c.thin {
			t.Fatalf("%s: thin=%v", c.name, ok)
		}
		if ok && (len(thin.SCTPThinStreams()) != 1 || thin.SCTPThinStreams()[0] != inputLaneStream) {
			t.Fatalf("%s: streams %v", c.name, thin.SCTPThinStreams())
		}
		if !ok && got != logging.LoggerFactory(base) {
			t.Fatalf("%s: factory replaced", c.name)
		}
	}
}

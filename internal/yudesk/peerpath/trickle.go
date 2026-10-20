package peerpath

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"time"

	"github.com/pion/webrtc/v4"
	"welink/internal/yudesk/protocol"
)

type trickleFrame struct {
	message protocol.Message
	err     error
}

func decodeTrickle(m protocol.Message, value any, limit int) error {
	if len(m.Params) == 0 || len(m.Params) > limit {
		return errors.New("invalid trickle signal size")
	}
	trimmed := bytes.TrimSpace(m.Params)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return errors.New("trickle signals must be JSON objects")
	}
	d := json.NewDecoder(bytes.NewReader(m.Params))
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return errors.New("trailing trickle signal data")
	}
	return nil
}

func (s signaling) sendTrickle(method string, value any) error {
	if err := s.base.SetWriteDeadline(s.deadline); err != nil {
		return err
	}
	p, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return s.base.WriteMessageContext(s.ctx, protocol.Message{Kind: "peerpath", Method: method, Params: p})
}

// Each side can synchronously flush its entire candidate batch. Its reader
// must be able to receive the other side's complete bounded handshake while
// that write is in progress, otherwise both readers can fill up and deadlock
// both writers (even over TCP when its send buffers fill).
func newTrickleInbox() chan trickleFrame { return make(chan trickleFrame, maxCandidates+5) }

// Exactly one reader runs during negotiation. Count and per-method byte limits
// bound read-ahead. The ordered retire marker stops it BEFORE application data.
func (s signaling) trickleReader(ctx context.Context, frames chan<- trickleFrame, done chan<- struct{}) {
	defer close(done)
	deliver := func(f trickleFrame) {
		select {
		case frames <- f:
		case <-ctx.Done():
		}
	}
	fail := func(err error) {
		_ = s.base.SetDeadline(time.Now())
		_ = s.base.Close()
		deliver(trickleFrame{err: err})
	}
	if err := s.base.SetReadDeadline(s.deadline); err != nil {
		fail(err)
		return
	}
	for count := 0; count < maxCandidates+5; count++ {
		m, err := s.read()
		if err != nil {
			fail(err)
			return
		}
		if m.Kind != "peerpath" || m.ID != "" || m.OK || m.Error != "" || len(m.Data) != 0 || len(m.Meta) != 0 || len(m.Params) > 2*maxSDP {
			fail(errors.New("unexpected trickle signaling envelope"))
			return
		}
		switch m.Method {
		case "offer", "answer", "candidate", "end-of-candidates", "ready", "commit", "retire":
		default:
			fail(errors.New("unexpected trickle signaling method"))
			return
		}
		limit := 2 * maxSDP
		switch m.Method {
		case "candidate", "end-of-candidates":
			limit = 2048
		case "ready", "commit":
			limit = 1024
		case "retire":
			limit = 128
		}
		if len(m.Params) > limit {
			fail(errors.New("oversized trickle signaling method"))
			return
		}
		deliver(trickleFrame{message: m})
		if m.Method == "retire" {
			return
		}
		select {
		case <-ctx.Done():
			return
		default:
		}
	}
	fail(errors.New("trickle signaling flood"))
}

func (a *attempt) trickleDescription(offer bool) (signal, *trickleCandidates) {
	var desc webrtc.SessionDescription
	var err error
	if offer {
		desc, err = a.pc.CreateOffer(nil)
	} else {
		desc, err = a.pc.CreateAnswer(nil)
	}
	if err != nil {
		return signal{Info: Info{Reason: "rtc_unavailable"}}, nil
	}
	scope, err := validateTrickleSDP(desc.SDP, a.allowRelay)
	if err != nil {
		return signal{Info: Info{Reason: "rtc_unavailable"}}, nil
	}
	q := newTrickleCandidates(a, scope)
	a.pc.OnICECandidate(q.add)
	if err = a.pc.SetLocalDescription(desc); err != nil {
		q.drain(true)
		return signal{Info: Info{Reason: "rtc_unavailable"}}, nil
	}
	// The original offer/answer is deliberately candidate-less. Candidates
	// gathered concurrently live only in the bounded scoped queue above.
	return signal{SDP: desc.SDP}, q
}

func pathDecision(role string, own, remote signal) Info {
	viewer, agent := own, remote
	if role == "agent" {
		viewer, agent = remote, own
	}
	info := Info{Mode: "p2p", Reason: "udp_direct"}
	if !viewer.Ready || !agent.Ready {
		info = Info{Mode: "relay", Reason: viewer.Reason}
		if info.Reason == "" || info.Reason == "peer_unavailable" {
			info.Reason = agent.Reason
		}
		if info.Reason == "" {
			info.Reason = "peer_unavailable"
		}
	} else if viewer.Mode == "udp-relay" || agent.Mode == "udp-relay" {
		info = Info{Mode: "udp-relay", Reason: "turn_udp"}
	} else if viewer.Reason == "ipv6_direct" && agent.Reason == "ipv6_direct" {
		info.Reason = "ipv6_direct"
	}
	return info
}

// Trickle v1 has the same mutual ready/commit decision as full SDP, followed
// by an ordered retire barrier. Main is its ONLY writer; callbacks only enqueue.
// No ICE candidate may follow local end/ready, and neither side hands base to
// application/tether code until its signaling reader has completely retired.
func negotiateTrickle(attemptCtx context.Context, s signaling, role string, a *attempt, initialReason string, pathV2, allowRelay bool) (stream *dataConn, info Info, err error) {
	readerCtx, stopReader := context.WithCancel(s.ctx)
	frames, readerDone := newTrickleInbox(), make(chan struct{})
	go s.trickleReader(readerCtx, frames, readerDone)
	var q *trickleCandidates
	defer func() {
		if q != nil {
			q.drain(true)
		}
		stopReader()
		if err != nil {
			_ = s.base.SetDeadline(time.Now())
			_ = s.base.Close()
		}
		<-readerDone
	}()
	local := signal{Info: Info{Reason: initialReason}}
	if role == "viewer" {
		if initialReason == "" {
			local, q = a.trickleDescription(true)
		}
		if err = s.send("offer", local); err != nil {
			return nil, Info{}, err
		}
	}
	var remote signal
	var scope iceScope
	haveRemote, localEnd, remoteEnd, commitSent, commitSeen, retireSent := false, false, false, false, false, false
	var early []webrtc.ICECandidateInit
	var earlyEnd *webrtc.ICECandidateInit
	var ownReady, peerReady *signal
	localCount, remoteCount := 0, 0
	flush := func(stop bool) error {
		if q == nil {
			return nil
		}
		values, ended := q.drain(stop)
		for _, candidate := range values {
			if err := s.sendTrickle("candidate", candidate); err != nil {
				return err
			}
			localCount++
		}
		if ended && !localEnd {
			if err := s.sendTrickle("end-of-candidates", scopedCandidate("", q.scope)); err != nil {
				return err
			}
			localEnd = true
		}
		return nil
	}
	apply := func(candidate webrtc.ICECandidateInit, end bool) error {
		if remote.SDP == "" {
			return errors.New("candidate without an ICE description")
		}
		if err := validateTrickleCandidate(candidate, scope, allowRelay, end); err != nil {
			return err
		}
		if a != nil && local.SDP != "" {
			return a.pc.AddICECandidate(candidate)
		}
		return nil
	}
	for {
		if haveRemote && ownReady == nil {
			selected := Info{}
			finished := false
			switch {
			case local.SDP == "":
				selected.Reason, finished = local.Reason, true
			case remote.SDP == "":
				selected.Reason, finished = "peer_unavailable", true
			case localEnd && localCount == 0:
				selected.Reason, finished = "udp_unavailable", true
			default:
				select {
				case <-a.opened:
					stream, selected = a.ready(attemptCtx, a.allowRelay)
					finished = true
				case <-a.failed:
					selected.Reason, finished = "ice_failed", true
				case <-attemptCtx.Done():
					selected.Reason, finished = "ice_timeout", true
				default:
				}
			}
			if finished {
				if stream == nil && a != nil && a.progress != nil {
					a.progress("fallback")
				}
				// Freeze callbacks under their mutex, drain every earlier candidate,
				// then end before ready. EOC cannot overtake a queued candidate.
				if err = flush(true); err != nil {
					return nil, Info{}, err
				}
				value := signal{Ready: stream != nil, Info: selected}
				if value.Ready && !pathV2 {
					value.Info = Info{}
				}
				if err = s.send("ready", value); err != nil {
					return nil, Info{}, err
				}
				ownReady = &value
			}
		}
		if ownReady != nil && peerReady != nil && !commitSent {
			info = pathDecision(role, *ownReady, *peerReady)
			if err = s.send("commit", signal{Info: info}); err != nil {
				return nil, Info{}, err
			}
			commitSent = true
		}
		if commitSeen && !retireSent {
			if err = s.sendTrickle("retire", struct{}{}); err != nil {
				return nil, Info{}, err
			}
			retireSent = true
		}
		var notify, opened, failed, attemptDone <-chan struct{}
		if q != nil && ownReady == nil {
			notify = q.notify
		}
		if a != nil && haveRemote && ownReady == nil {
			opened, failed = a.opened, a.failed
		}
		if haveRemote && ownReady == nil {
			attemptDone = attemptCtx.Done()
		}
		select {
		case <-s.ctx.Done():
			return nil, Info{}, s.ctx.Err()
		case <-notify:
			if err = flush(false); err != nil {
				return nil, Info{}, err
			}
		case <-opened:
		case <-failed:
		case <-attemptDone:
		case f := <-frames:
			if f.err != nil {
				return nil, Info{}, f.err
			}
			m := f.message
			switch m.Method {
			case "offer", "answer":
				want := "answer"
				if role == "agent" {
					want = "offer"
				}
				if m.Method != want || haveRemote {
					return nil, Info{}, errors.New("unexpected trickle description")
				}
				if err = decodeTrickle(m, &remote, 2*maxSDP); err != nil {
					return nil, Info{}, err
				}
				if remote.Ready || remote.Mode != "" || len(remote.Reason) > 64 {
					return nil, Info{}, errors.New("invalid trickle description state")
				}
				if remote.SDP == "" {
					if !validReason(remote.Reason) || len(early) != 0 || earlyEnd != nil {
						return nil, Info{}, errors.New("invalid unavailable trickle description")
					}
				} else {
					if remote.Reason != "" {
						return nil, Info{}, errors.New("trickle description with failure reason")
					}
					scope, err = validateTrickleSDP(remote.SDP, allowRelay)
					if err != nil {
						return nil, Info{}, err
					}
					if a != nil {
						kind := webrtc.SDPTypeAnswer
						if role == "agent" {
							kind = webrtc.SDPTypeOffer
						}
						if role == "viewer" && local.SDP == "" {
							return nil, Info{}, errors.New("answer without a trickle offer")
						}
						if err = a.pc.SetRemoteDescription(webrtc.SessionDescription{Type: kind, SDP: remote.SDP}); err != nil {
							return nil, Info{}, err
						}
					}
				}
				haveRemote = true
				if role == "agent" {
					if remote.SDP == "" {
						local = signal{Info: Info{Reason: "peer_unavailable"}}
					} else if initialReason == "" {
						local, q = a.trickleDescription(false)
					}
					if err = s.send("answer", local); err != nil {
						return nil, Info{}, err
					}
				}
				for _, candidate := range early {
					if err = apply(candidate, false); err != nil {
						return nil, Info{}, err
					}
				}
				early = nil
				if earlyEnd != nil {
					if err = apply(*earlyEnd, true); err != nil {
						return nil, Info{}, err
					}
					earlyEnd = nil
				}
			case "candidate", "end-of-candidates":
				end := m.Method == "end-of-candidates"
				if remoteEnd || peerReady != nil {
					return nil, Info{}, errors.New("candidate after end/ready")
				}
				var candidate webrtc.ICECandidateInit
				if err = decodeTrickle(m, &candidate, 2048); err != nil {
					return nil, Info{}, err
				}
				if end {
					remoteEnd = true
				} else {
					remoteCount++
					if remoteCount > maxCandidates {
						return nil, Info{}, errors.New("trickle candidate flood")
					}
				}
				if haveRemote {
					if err = apply(candidate, end); err != nil {
						return nil, Info{}, err
					}
				} else if end {
					earlyEnd = &candidate
				} else {
					early = append(early, candidate)
				}
			case "ready":
				var value signal
				if err = decodeTrickle(m, &value, 1024); err != nil {
					return nil, Info{}, err
				}
				if !haveRemote || peerReady != nil || remote.SDP != "" && !remoteEnd || value.Ready && remote.SDP == "" || value.SDP != "" || !validReady(value, pathV2) {
					return nil, Info{}, errors.New("invalid trickle ready state")
				}
				peerReady = &value
			case "commit":
				var value signal
				if err = decodeTrickle(m, &value, 1024); err != nil {
					return nil, Info{}, err
				}
				if !commitSent || commitSeen || value.Info != info || value.Ready || value.SDP != "" {
					return nil, Info{}, errors.New("inconsistent trickle commit")
				}
				commitSeen = true
			case "retire":
				if !commitSeen || !retireSent {
					return nil, Info{}, errors.New("premature signaling retirement")
				}
				if err = decodeTrickle(m, &struct{}{}, 128); err != nil {
					return nil, Info{}, err
				}
				return stream, info, nil
			}
		}
	}
}

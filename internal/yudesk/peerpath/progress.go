package peerpath

import "time"

// Progress describes an observed local phase, without candidate addresses,
// credentials, SDP or remote-controlled free-form text.
type Progress struct {
	Stage     string `json:"stage"`
	ElapsedMS int64  `json:"elapsedMs"`
	TimeoutMS int64  `json:"timeoutMs"`
}

func (o Options) progress(stage string) {
	if o.OnProgress != nil {
		o.OnProgress(Progress{Stage: stage})
	}
}

func relayAcceptanceWait(timeout time.Duration) time.Duration {
	// The final second permits UDP relay DTLS/SCTP to finish inside the same
	// bounded attempt. Direct candidates always retain higher ICE priority.
	return min(14*time.Second, max(0, timeout-time.Second))
}

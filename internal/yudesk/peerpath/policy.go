package peerpath

// RTCPolicy is supplied by the authenticated LinkMe media configuration.
type RTCPolicy struct {
	ICEServers      []ICEServer `json:"iceServers"`
	DirectTimeoutMS int         `json:"directTimeoutMs"`
	RelayEnabled    bool        `json:"relayEnabled,omitempty"`
}
type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

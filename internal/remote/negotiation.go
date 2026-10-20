package remote

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"time"
	"welink/internal/yudesk/peerpath"
	"welink/internal/yudesk/protocol"
)

// Both endpoints explicitly agree inside the authenticated encrypted tunnel.
// Never enable independent input lanes or trickle ICE unilaterally.
func negotiateTransport(ctx context.Context, base *protocol.Conn, role string, options peerpath.Options) (*protocol.Conn, peerpath.Info, error) {
	type capabilities struct {
		Version int    `json:"version"`
		Timeout int    `json:"timeoutMs"`
		Seed    []byte `json:"laneSeed"`
	}
	deadline := time.Now().Add(20 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	if err := base.SetDeadline(deadline); err != nil {
		return nil, peerpath.Info{}, err
	}
	local := capabilities{Version: 2, Timeout: int(options.Timeout / time.Millisecond)}
	write := func() error {
		raw, _ := json.Marshal(local)
		return base.WriteMessageContext(ctx, protocol.Message{Kind: "linkme-transport", Params: raw})
	}
	read := func() (capabilities, error) {
		var remote capabilities
		m, err := base.ReadMessage()
		if err != nil {
			return remote, err
		}
		if m.Kind != "linkme-transport" || m.Method != "" || m.ID != "" || m.Error != "" || m.OK || len(m.Data) != 0 || len(m.Meta) != 0 || len(m.Params) > 512 {
			return remote, errors.New("远程协议不兼容，请双方更新 LinkMe")
		}
		err = json.Unmarshal(m.Params, &remote)
		if err != nil || remote.Version != 2 || remote.Timeout < 500 || remote.Timeout > 15000 || len(remote.Seed) != 32 {
			return remote, errors.New("无效的远程连接协商")
		}
		return remote, nil
	}
	var remote capabilities
	var err error
	if role == "agent" {
		local.Seed = make([]byte, 32)
		if _, err = rand.Read(local.Seed); err == nil {
			err = write()
		}
		if err == nil {
			remote, err = read()
		}
		if err == nil && string(local.Seed) != string(remote.Seed) {
			err = errors.New("远程通道确认失败")
		}
	} else {
		remote, err = read()
		if err == nil {
			local.Seed = remote.Seed
			err = write()
		}
	}
	if err != nil {
		_ = base.Close()
		return nil, peerpath.Info{}, err
	}
	if err = base.SetDeadline(time.Time{}); err != nil {
		return nil, peerpath.Info{}, err
	}
	options.Timeout = min(options.Timeout, time.Duration(remote.Timeout)*time.Millisecond)
	options.TrickleICE = true
	return peerpath.Negotiate(ctx, base, role, nil, options.WithSessionLanes(local.Seed))
}

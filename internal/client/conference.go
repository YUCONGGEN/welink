package client

import (
	"context"
	"github.com/gorilla/websocket"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func (c *Client) DialConference(ctx context.Context, code, token string) (*websocket.Conn, error) {
	cfg := c.Config()
	u, err := validateConfig(cfg)
	if err != nil {
		return nil, err
	}
	u.Scheme = strings.Replace(u.Scheme, "http", "ws", 1)
	u.Path = "/api/meetings/" + url.PathEscape(code) + "/ws"
	d := websocket.Dialer{HandshakeTimeout: 12 * time.Second, TLSClientConfig: tlsConfig(cfg.Fingerprint)}
	conn, _, err := d.DialContext(ctx, u.String(), http.Header{"Authorization": []string{"Bearer " + token}})
	return conn, err
}

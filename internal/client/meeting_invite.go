package client

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

var localMeetingCode = regexp.MustCompile(`^[1-9][0-9]{8}$`)

type localMeetingInvite struct {
	Code    string `json:"code"`
	Created int64  `json:"created"`
}

func (c *Client) takeMeetingInvite() string {
	path := filepath.Join(c.dir, "meeting-invitation.json")
	claimed := filepath.Join(c.dir, "meeting-invitation.claimed")
	if os.Rename(path, claimed) != nil {
		return ""
	}
	defer os.Remove(claimed)
	raw, err := os.ReadFile(claimed)
	if err != nil || len(raw) > 1024 {
		return ""
	}
	var invite localMeetingInvite
	if json.Unmarshal(raw, &invite) != nil || !localMeetingCode.MatchString(invite.Code) || time.Now().UnixMilli()-invite.Created > 7200000 || invite.Created > time.Now().UnixMilli()+60000 {
		return ""
	}
	return invite.Code
}

func (c *Client) localMeetingInvitation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	code := c.takeMeetingInvite()
	if code == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	localJSON(w, map[string]string{"code": code})
}

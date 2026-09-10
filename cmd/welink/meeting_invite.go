package main

import (
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var meetingCodePattern = regexp.MustCompile(`^[1-9][0-9]{8}$`)

func meetingCodeFromURI(raw string) string {
	if len(raw) > 256 {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "welink" || u.Host != "meeting" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return ""
	}
	code := strings.TrimPrefix(u.Path, "/")
	if !meetingCodePattern.MatchString(code) {
		return ""
	}
	return code
}

type pendingMeeting struct {
	Code    string `json:"code"`
	Created int64  `json:"created"`
}

func saveMeetingInvite(directory, code string) error {
	if !meetingCodePattern.MatchString(code) {
		return errors.New("会议号无效")
	}
	raw, _ := json.Marshal(pendingMeeting{Code: code, Created: time.Now().UnixMilli()})
	file, err := os.CreateTemp(directory, "meeting-invite-*.tmp")
	if err != nil {
		return err
	}
	path := file.Name()
	defer os.Remove(path)
	if _, err = file.Write(raw); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(path, filepath.Join(directory, "meeting-invitation.json"))
}
func takeMeetingInvite(directory string) string {
	path := filepath.Join(directory, "meeting-invitation.json")
	// Rename before reading, so a simultaneous new invitation cannot be deleted.
	claimed := filepath.Join(directory, "meeting-invitation.claimed")
	if os.Rename(path, claimed) != nil {
		return ""
	}
	defer os.Remove(claimed)
	raw, err := os.ReadFile(claimed)
	if err != nil || len(raw) > 1024 {
		return ""
	}
	var invite pendingMeeting
	if json.Unmarshal(raw, &invite) != nil || !meetingCodePattern.MatchString(invite.Code) || time.Now().UnixMilli()-invite.Created > 7200000 || invite.Created > time.Now().UnixMilli()+60000 {
		return ""
	}
	return invite.Code
}

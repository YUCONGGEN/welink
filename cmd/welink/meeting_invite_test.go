package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMeetingInvitationURIAndHandoff(t *testing.T) {
	if meetingCodeFromURI("welink://meeting/123456789") != "123456789" {
		t.Fatal("valid invitation rejected")
	}
	for _, raw := range []string{"welink://meeting/123456789?server=http://evil.invalid", "welink://user@meeting/123456789", "welink://meeting/123456789#x", "welink://meeting/012345678", "welink://meeting/123456789/extra", "https://meeting/123456789", "welink://meeting/../../anything", "--server=http://evil.invalid"} {
		if meetingCodeFromURI(raw) != "" {
			t.Fatal("invalid URI accepted", raw)
		}
	}
	dir := t.TempDir()
	if err := saveMeetingInvite(dir, "123456789"); err != nil {
		t.Fatal(err)
	}
	if got := takeMeetingInvite(dir); got != "123456789" {
		t.Fatal(got)
	}
	if takeMeetingInvite(dir) != "" {
		t.Fatal("invitation consumed twice")
	}
	if err := saveMeetingInvite(dir, "987654321"); err != nil {
		t.Fatal(err)
	}
	if err := saveMeetingInvite(dir, "123456789"); err != nil {
		t.Fatal(err)
	}
	if takeMeetingInvite(dir) != "123456789" {
		t.Fatal("latest invitation not retained")
	}
	if err := os.WriteFile(filepath.Join(dir, "meeting-invitation.json"), []byte(`{"code":"123456789","created":1}`), 0600); err != nil {
		t.Fatal(err)
	}
	if takeMeetingInvite(dir) != "" {
		t.Fatal("expired invitation accepted")
	}
}

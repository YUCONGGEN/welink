package client

import (
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDomainUpgradePreservesCustomServersAndOverrides(t *testing.T) {
	for _, test := range []struct{ name, saved, override, want string }{
		{"legacy deployment", "http://223.166.147.252:8250/", "", "http://www.yucg.cn:8250"},
		{"custom server", "http://127.0.0.1:9000", "", "http://127.0.0.1:9000"},
		{"explicit IP override", "http://223.166.147.252:8250", "http://223.166.147.252:8250", "http://223.166.147.252:8250"},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, "connection.json"), []byte(`{"server":"`+test.saved+`"}`), 0600); err != nil {
				t.Fatal(err)
			}
			client, err := New(Options{Directory: dir, Listen: "127.0.0.1:0", Server: test.override})
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			if got := client.Config().Server; got != test.want {
				t.Fatalf("got %s want %s", got, test.want)
			}
		})
	}
}

func TestLocalMeetingInviteIsDeliveredOnce(t *testing.T) {
	dir := t.TempDir()
	c, err := New(Options{Directory: dir, Listen: "127.0.0.1:0", Server: "http://127.0.0.1:9"})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	raw, _ := json.Marshal(localMeetingInvite{Code: "123456789", Created: time.Now().UnixMilli()})
	if err = os.WriteFile(filepath.Join(dir, "meeting-invitation.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	jar, _ := cookiejar.New(nil)
	browser := &http.Client{Jar: jar}
	if response, getErr := browser.Get(c.URL()); getErr != nil {
		t.Fatal(getErr)
	} else {
		response.Body.Close()
	}
	base := "http://" + c.host
	endpoint, _ := url.JoinPath(base, "/local/meeting-invitation")
	response, err := browser.Get(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	var invite localMeetingInvite
	if err = json.NewDecoder(response.Body).Decode(&invite); err != nil {
		response.Body.Close()
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK || invite.Code != "123456789" {
		t.Fatalf("unexpected meeting invite: %d %#v", response.StatusCode, invite)
	}
	response, err = browser.Get(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("invite was delivered more than once: %d", response.StatusCode)
	}
}

func TestLocalServerRequiresSecretAndRejectsForeignOrigin(t *testing.T) {
	c, e := New(Options{Directory: t.TempDir(), Listen: "127.0.0.1:0", Server: "http://127.0.0.1:9"})
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	base := "http://" + c.host
	resp, e := http.Get(base + "/local/config")
	if e != nil {
		t.Fatal(e)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatal("local API exposed without token")
	}
	jar, _ := cookiejar.New(nil)
	browser := &http.Client{Jar: jar}
	resp, e = browser.Get(c.URL())
	if e != nil {
		t.Fatal(e)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("bootstrap failed %d", resp.StatusCode)
	}
	req, _ := http.NewRequest("POST", base+"/local/remote/stop", nil)
	req.Header.Set("Origin", "https://attacker.invalid")
	resp, e = browser.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatal("foreign origin reached local control")
	}
	resp, e = browser.Get(base + "/local/config")
	if e != nil {
		t.Fatal(e)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatal("authorized local API failed")
	}
}
func TestServerConfigRejectsUnsafeAddress(t *testing.T) {
	for _, s := range []string{"ftp://example.com", "https://user:pass@example.com", "https://example.com/?token=secret", "file:///tmp/data"} {
		if _, e := validateConfig(Config{Server: s}); e == nil {
			t.Fatalf("accepted unsafe address %s", s)
		}
	}
	if _, e := validateConfig(Config{Server: "https://example.com", Fingerprint: "wrong"}); e == nil {
		t.Fatal("accepted invalid fingerprint")
	}
}

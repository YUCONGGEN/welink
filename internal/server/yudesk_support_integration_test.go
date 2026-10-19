package server

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

// Opt-in cross-repository contract test. All accounts live in t.TempDir().
func TestYuDeskSupportLiveFixture(t *testing.T) {
	path := os.Getenv("WELINK_YUDESK_TEST_READY")
	if path == "" {
		t.Skip("cross-repository fixture")
	}
	key := strings.Repeat("fixture-only-", 4)
	t.Setenv("WELINK_YUDESK_SECRET", key)
	f := setup(t)
	staff := f.register("support_live")
	conn := f.socket(staff)
	defer conn.Close()
	raw, _ := json.Marshal(map[string]string{"url": f.url, "key": key, "staff": staff.User.Number, "staffToken": staff.Token})
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(90 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path + ".done"); err == nil {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("cross-repository consumer did not finish")
}

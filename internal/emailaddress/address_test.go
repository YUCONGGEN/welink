package emailaddress

import (
	"strings"
	"testing"
)

func TestNormalizeMailboxIdentity(t *testing.T) {
	for _, bad := range []string{"", "person", "a@localhost", "a..b@example.com", "a@example..com", "a@-example.com", "Name <a@example.com>", "a@example.com,b@example.com", "a@例子.com", "a@example.com\r\nBcc:b@example.com", strings.Repeat("a", 65) + "@example.com"} {
		if _, e := Normalize(bad); e == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	got, e := Normalize(" Name.Tag+test@EXAMPLE.COM ")
	if e != nil || got != "name.tag+test@example.com" {
		t.Fatal(got, e)
	}
}

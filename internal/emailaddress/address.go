package emailaddress

import (
	"errors"
	"net/mail"
	"strings"
)

// Normalize defines case-insensitive mailbox identities. It never removes dots
// or plus tags, which could otherwise join distinct users at another provider.
func Normalize(input string) (string, error) {
	s := strings.ToLower(strings.TrimSpace(input))
	bad := errors.New("invalid email address")
	if len(s) > 254 || strings.ContainsAny(s, "\r\n\t ,;<>\"\\") {
		return "", bad
	}
	for _, r := range s {
		if r < 33 || r > 126 {
			return "", bad
		}
	}
	a, err := mail.ParseAddress(s)
	if err != nil || a.Address != s || a.Name != "" {
		return "", bad
	}
	parts := strings.Split(s, "@")
	if len(parts) != 2 || len(parts[0]) > 64 || !strings.Contains(parts[1], ".") {
		return "", bad
	}
	for _, label := range strings.Split(parts[1], ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return "", bad
		}
		for _, r := range label {
			if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-') {
				return "", bad
			}
		}
	}
	return s, nil
}

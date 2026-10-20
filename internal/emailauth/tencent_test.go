package emailauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestTencentOTPRequestAndSafeFailures(t *testing.T) {
	c := Config{SecretID: "fixture-id", SecretKey: "fixture-secret", Region: "ap-guangzhou", From: "YuDesk <code@example.com>", TemplateID: 64284, Subject: "YuDesk verification"}
	if strings.Contains(fmt.Sprintf("%+v %#v", c, c), c.SecretKey) {
		t.Fatal("secret formatter leak")
	}
	p, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	p.client.Transport = transportFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != "https://ses.tencentcloudapi.com" || r.Header.Get("X-TC-Action") != "SendEmail" || !strings.HasPrefix(r.Header.Get("Authorization"), "TC3-HMAC-SHA256 ") {
			t.Fatal("invalid API/signature headers")
		}
		var body struct {
			Destination []string
			TriggerType int
			Template    struct {
				TemplateID   int
				TemplateData string
			}
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || len(body.Destination) != 1 || body.Destination[0] != "test@example.com" || body.TriggerType != 1 || body.Template.TemplateID != 64284 {
			t.Fatal("bad recipient or template")
		}
		var vars map[string]string
		_ = json.Unmarshal([]byte(body.Template.TemplateData), &vars)
		if vars["code"] != "123456" || vars["minutes"] != "5" {
			t.Fatal("template variables mismatch")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"Response":{"MessageId":"fixture"}}`)), Header: http.Header{}}, nil
	})
	if err = p.SendOTP(context.Background(), "TEST@example.com", "123456"); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal("unexpected retries")
	}
	p.client.Transport = transportFunc(func(*http.Request) (*http.Response, error) { calls++; return nil, errors.New(c.SecretKey) })
	err = p.SendOTP(context.Background(), "test@example.com", "123456")
	if err == nil || strings.Contains(err.Error(), c.SecretKey) || calls != 2 {
		t.Fatal("unsafe transport error or retry", err)
	}
}

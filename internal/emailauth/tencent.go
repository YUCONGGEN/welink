// Package emailauth is a server-only Tencent SES delivery adapter.
package emailauth

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
	"welink/internal/emailaddress"
)

type Config struct {
	SecretID   string `json:"secretId"`
	SecretKey  string `json:"secretKey"`
	Region     string `json:"region"`
	From       string `json:"from"`
	TemplateID uint64 `json:"templateId"`
	Subject    string `json:"subject"`
}

func (Config) String() string     { return "EmailConfig{credentials:redacted}" }
func (c Config) GoString() string { return c.String() }
func LoadConfig(path string) (Config, error) {
	if path == "" {
		return Config{}, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return Config{}, errors.New("cannot open private email configuration")
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 65537))
	if err != nil || len(data) > 65536 {
		return Config{}, errors.New("invalid private email configuration size")
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	var c Config
	if d.Decode(&c) != nil || d.Decode(new(any)) != io.EOF {
		return Config{}, errors.New("invalid private email configuration")
	}
	return c, c.validate()
}
func (c Config) validate() error {
	if c.SecretID == "" && c.SecretKey == "" && c.From == "" && c.TemplateID == 0 {
		return nil
	}
	if c.SecretID == "" || c.SecretKey == "" || c.From == "" || c.TemplateID == 0 || c.Subject == "" || (c.Region != "ap-guangzhou" && c.Region != "ap-hongkong") {
		return errors.New("incomplete email configuration")
	}
	for _, v := range []string{c.SecretID, c.SecretKey, c.From, c.Subject} {
		if len(v) > 512 || strings.ContainsAny(v, "\r\n\x00") {
			return errors.New("invalid email configuration value")
		}
	}
	return nil
}

type Tencent struct {
	config Config
	client *http.Client
	now    func() time.Time
}

func New(c Config) (*Tencent, error) {
	if err := c.validate(); err != nil {
		return nil, err
	}
	return &Tencent{c, &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, time.Now}, nil
}
func (t *Tencent) Enabled() bool {
	return t != nil && t.config.SecretID != "" && t.config.TemplateID != 0
}
func digest(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func mac(key []byte, s string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(s))
	return h.Sum(nil)
}
func (t *Tencent) request(ctx context.Context, action string, body []byte) (*http.Request, error) {
	const host = "ses.tencentcloudapi.com"
	now := t.now().UTC()
	date := now.Format("2006-01-02")
	stamp := strconv.FormatInt(now.Unix(), 10)
	scope := date + "/ses/tc3_request"
	canonical := "POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:" + host + "\n\ncontent-type;host\n" + digest(body)
	key := mac(mac(mac([]byte("TC3"+t.config.SecretKey), date), "ses"), "tc3_request")
	signature := hex.EncodeToString(mac(key, "TC3-HMAC-SHA256\n"+stamp+"\n"+scope+"\n"+digest([]byte(canonical))))
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+host, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	r.Header.Set("Content-Type", "application/json; charset=utf-8")
	r.Header.Set("X-TC-Action", action)
	r.Header.Set("X-TC-Version", "2020-10-02")
	r.Header.Set("X-TC-Region", t.config.Region)
	r.Header.Set("X-TC-Timestamp", stamp)
	r.Header.Set("Authorization", "TC3-HMAC-SHA256 Credential="+t.config.SecretID+"/"+scope+", SignedHeaders=content-type;host, Signature="+signature)
	return r, nil
}

// A timeout may follow acceptance. Never retry automatically and send another OTP.
func (t *Tencent) SendOTP(ctx context.Context, email, code string) error {
	if !t.Enabled() {
		return errors.New("email delivery unavailable")
	}
	email, err := emailaddress.Normalize(email)
	if err != nil {
		return err
	}
	if len(code) != 6 || strings.Trim(code, "0123456789") != "" {
		return errors.New("invalid verification code")
	}
	variables, _ := json.Marshal(map[string]string{"code": code, "minutes": "5"})
	body, _ := json.Marshal(map[string]any{"FromEmailAddress": t.config.From, "Destination": []string{email}, "Subject": t.config.Subject, "Template": map[string]any{"TemplateID": t.config.TemplateID, "TemplateData": string(variables)}, "TriggerType": 1})
	req, err := t.request(ctx, "SendEmail", body)
	if err != nil {
		return errors.New("cannot prepare email request")
	}
	res, err := t.client.Do(req)
	if err != nil {
		return errors.New("email provider unavailable")
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 65537))
	if err != nil || len(data) > 65536 {
		return errors.New("invalid email provider response")
	}
	var out struct {
		Response struct {
			MessageID string `json:"MessageId"`
			Error     *struct{ Code string }
		}
	}
	if res.StatusCode != http.StatusOK || json.Unmarshal(data, &out) != nil {
		return errors.New("email provider request failed")
	}
	if out.Response.Error != nil {
		return errors.New("email provider rejected request")
	}
	if out.Response.MessageID == "" {
		return fmt.Errorf("email provider did not acknowledge delivery")
	}
	return nil
}

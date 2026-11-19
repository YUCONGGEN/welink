package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Me reads a picture and the words sent after it together, and still answers
// when the model cannot read images.
func TestMeReadsImagesSentWithText(t *testing.T) {
	for _, visionSupported := range []bool{true, false} {
		t.Run(fmt.Sprint("vision=", visionSupported), func(t *testing.T) {
			requests := make(chan string, 4)
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var raw bytes.Buffer
				raw.ReadFrom(r.Body)
				body := raw.String()
				requests <- body
				if !visionSupported && strings.Contains(body, "image_url") {
					w.WriteHeader(400)
					w.Write([]byte(`{"error":{"message":"image input is not supported"}}`))
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"一张红色方块\"}}]}\n\ndata: [DONE]\n\n")
			}))
			defer provider.Close()
			settings := DefaultSettings()
			settings.Registration.Enabled = true
			settings.AI.Enabled, settings.AI.API, settings.AI.Model = true, "chat", "vision-test"
			settings.AI.CredentialsFile = filepath.Join(t.TempDir(), "ai.json")
			raw, _ := json.Marshal(aiCredentials{BaseURL: provider.URL, Token: "sk-vision-test"})
			os.WriteFile(settings.AI.CredentialsFile, raw, 0600)
			s, err := New(Config{DataDir: t.TempDir(), Settings: &settings})
			if err != nil {
				t.Fatal(err)
			}
			srv := httptest.NewServer(s.Handler())
			defer srv.Close()
			defer s.Close()
			f := &fixture{t: t, s: s, url: srv.URL, server: srv}
			a := f.register("vision_user")
			bot, _ := s.user(s.ai.user)
			cid := f.direct(a, account{User: bot})

			img := image.NewRGBA(image.Rect(0, 0, 8, 8))
			for i := range img.Pix {
				img.Pix[i] = 255
			}
			img.Set(0, 0, color.RGBA{255, 0, 0, 255})
			var pic bytes.Buffer
			png.Encode(&pic, img)
			status, uploaded := storageUpload(t, f, "/api/files", a.Token, "image.png", &pic, cid)
			if status != 200 {
				t.Fatalf("upload %d %s", status, uploaded)
			}
			var file struct{ ID string }
			json.Unmarshal(uploaded, &file)
			f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]string{"kind": "image", "attachmentId": file.ID, "clientId": newID()}, 200, nil)
			text := sendTestMessage(f, cid, a, "这张图里是什么？", "")
			f.request("POST", "/api/ai/runs", a.Token, map[string]string{"messageId": text.ID, "mode": "chat"}, 200, nil)

			first := <-requests
			if !strings.Contains(first, `"image_url":{"url":"data:image/png;base64,`) || !strings.Contains(first, "这张图里是什么") || !strings.Contains(first, "用户发送了一张图片：image.png") {
				t.Fatalf("image not sent with the words: %.400s", first)
			}
			if !visionSupported {
				select {
				case retry := <-requests:
					if strings.Contains(retry, "image_url") || !strings.Contains(retry, "当前模型不支持读取图片内容") {
						t.Fatalf("retry: %.400s", retry)
					}
				case <-time.After(5 * time.Second):
					t.Fatal("no retry without images")
				}
			}
			deadline := time.Now().Add(5 * time.Second)
			for {
				var list []Message
				f.request("GET", "/api/conversations/"+cid+"/messages", a.Token, nil, 200, &list)
				if last := list[len(list)-1]; last.Sender == bot.ID && last.Text == "一张红色方块" {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("Me did not answer")
				}
				time.Sleep(50 * time.Millisecond)
			}
		})
	}
}

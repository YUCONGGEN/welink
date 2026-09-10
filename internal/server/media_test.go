package server

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func voiceWAV(milliseconds int) []byte {
	size := 24000 * 2 * milliseconds / 1000
	data := make([]byte, 44+size)
	copy(data, "RIFF")
	binary.LittleEndian.PutUint32(data[4:], uint32(36+size))
	copy(data[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(data[16:], 16)
	binary.LittleEndian.PutUint16(data[20:], 1)
	binary.LittleEndian.PutUint16(data[22:], 1)
	binary.LittleEndian.PutUint32(data[24:], 24000)
	binary.LittleEndian.PutUint32(data[28:], 48000)
	binary.LittleEndian.PutUint16(data[32:], 2)
	binary.LittleEndian.PutUint16(data[34:], 16)
	copy(data[36:], "data")
	binary.LittleEndian.PutUint32(data[40:], uint32(size))
	return data
}
func mediaUpload(t *testing.T, f *fixture, cid string, who account, name string, data []byte, fields map[string]string, status int) struct {
	ID    string
	MIME  string
	Media mediaInfo
} {
	t.Helper()
	var result struct {
		ID    string
		MIME  string
		Media mediaInfo
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	writer.WriteField("conversationId", cid)
	for key, value := range fields {
		writer.WriteField(key, value)
	}
	part, _ := writer.CreateFormFile("file", name)
	part.Write(data)
	writer.Close()
	req, _ := http.NewRequest("POST", f.url+"/api/files", &body)
	req.Header.Set("Authorization", "Bearer "+who.Token)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	raw, _ := io.ReadAll(response.Body)
	if response.StatusCode != status {
		t.Fatalf("upload %s: got %d want %d: %s", name, response.StatusCode, status, raw)
	}
	if status == 200 {
		if err = json.Unmarshal(raw, &result); err != nil {
			t.Fatal(err)
		}
	}
	return result
}

func TestVoiceValidationPlaybackAuthorizationAndForwardMetadata(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("voice_alice"), f.register("voice_bobby"), f.register("voice_carol")
	f.befriend(a, b)
	f.befriend(a, c)
	source, target := f.direct(a, b), f.direct(a, c)
	wav := voiceWAV(1250)
	upload := mediaUpload(t, f, source, a, "voice.wav", wav, map[string]string{"mediaKind": "voice", "durationMs": "99999"}, 200)
	if upload.Media.DurationMS != 1250 || upload.MIME != "audio/wav" {
		t.Fatal("voice duration trusted caller instead of PCM data")
	}
	var message Message
	f.request("POST", "/api/conversations/"+source+"/messages", a.Token, map[string]string{"kind": "voice", "attachmentId": upload.ID, "clientId": newID()}, 200, &message)
	if message.DurationMS != 1250 || message.MIME != "audio/wav" {
		t.Fatal("voice metadata missing from message")
	}
	f.request("POST", "/api/conversations/"+source+"/messages", b.Token, map[string]string{"kind": "voice", "attachmentId": upload.ID, "clientId": newID()}, 400, nil)
	var history []Message
	f.request("GET", "/api/conversations/"+source+"/messages?kind=voice", b.Token, nil, 200, &history)
	if len(history) != 1 || history[0].DurationMS != 1250 {
		t.Fatal("voice history filter")
	}
	req, _ := http.NewRequest("GET", f.url+"/api/files/"+upload.ID, nil)
	req.Header.Set("Authorization", "Bearer "+b.Token)
	req.Header.Set("Range", "bytes=44-143")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 206 || response.Header.Get("Content-Type") != "audio/wav" || !bytes.Equal(data, wav[44:144]) {
		t.Fatal("authenticated playback range failed")
	}
	checkForwardDownload(t, f, upload.ID, c, 403, nil)
	var forwarded forwardResult
	f.request("POST", "/api/messages/forward", a.Token, forwardRequest{ConversationID: source, MessageIDs: []string{message.ID}, Targets: []string{target}, Mode: "merge", ClientID: newID()}, 200, &forwarded)
	var record forwardDocument
	f.request("GET", "/api/messages/"+forwarded.IDs[0]+"/forward", c.Token, nil, 200, &record)
	if len(record.Items) != 1 || record.Items[0].DurationMS != 1250 {
		t.Fatal("merged voice metadata missing")
	}
	checkForwardDownload(t, f, record.Items[0].AttachmentID, c, 200, wav)
	var copiedKind string
	var copiedDuration int64
	if err = f.s.db.QueryRow("SELECT kind,duration_ms FROM attachment_media WHERE attachment_id=?", record.Items[0].AttachmentID).Scan(&copiedKind, &copiedDuration); err != nil || copiedKind != "voice" || copiedDuration != 1250 {
		t.Fatal("attachment metadata not cloned", err)
	}
	var recalled Message
	f.request("POST", "/api/messages/"+message.ID+"/recall", a.Token, nil, 200, &recalled)
	if recalled.DurationMS != 0 || recalled.AttachmentID != "" {
		t.Fatal("recall retained media metadata")
	}
}

func TestMediaUploadRejectsMalformedFilesAndUnvalidatedVoice(t *testing.T) {
	f := setup(t)
	a, b := f.register("media_alice"), f.register("media_bobby")
	f.befriend(a, b)
	cid := f.direct(a, b)
	badRate := voiceWAV(1000)
	binary.LittleEndian.PutUint32(badRate[28:], 1)
	badSize := voiceWAV(1000)
	binary.LittleEndian.PutUint32(badSize[40:], 1000000)
	for _, data := range [][]byte{[]byte("not audio"), voiceWAV(100), voiceWAV(60001), badRate, badSize, voiceWAV(1000)[:47]} {
		mediaUpload(t, f, cid, a, "bad.wav", data, map[string]string{"mediaKind": "voice"}, 400)
	}
	files, err := os.ReadDir(filepath.Join(f.s.dir, "uploads"))
	if err != nil || len(files) != 0 {
		t.Fatal("rejected upload left file behind", err)
	}
	var count int
	f.s.db.QueryRow("SELECT COUNT(*) FROM attachments").Scan(&count)
	if count != 0 {
		t.Fatal("rejected upload left metadata")
	}
	plain := mediaUpload(t, f, cid, a, "ordinary.wav", voiceWAV(1000), nil, 200)
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]string{"kind": "voice", "attachmentId": plain.ID, "clientId": newID()}, 400, nil)
	mp4 := []byte("\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom")
	video := mediaUpload(t, f, cid, a, "clip.mp4", mp4, map[string]string{"mediaKind": "video", "durationMs": "1500", "width": "640", "height": "360"}, 200)
	var m Message
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]string{"kind": "video", "attachmentId": video.ID, "clientId": newID()}, 200, &m)
	if m.Kind != "video" || m.Width != 640 || m.Height != 360 || m.DurationMS != 1500 {
		t.Fatal("video metadata mismatch")
	}
	mediaUpload(t, f, cid, a, "fake.mp4", []byte("<html>not a movie</html>"), map[string]string{"mediaKind": "video", "durationMs": "1500", "width": "640", "height": "360"}, 400)
	mediaUpload(t, f, cid, a, "dimensions.mp4", mp4, map[string]string{"mediaKind": "video", "durationMs": "1500", "width": "9999999", "height": "360"}, 400)
	mediaUpload(t, f, cid, a, "duration.mp4", mp4, map[string]string{"mediaKind": "video", "durationMs": "0", "width": "640", "height": "360"}, 400)
}

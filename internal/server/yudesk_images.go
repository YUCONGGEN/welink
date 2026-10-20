package server

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/draw"
	_ "image/gif"
	"image/jpeg"
	"io"
	"net/http"

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// Resolve an attachment through a visible message in THIS support conversation.
// Never proxy a caller-supplied URL, unrelated attachment, deleted or recalled message.
func (s *Server) yudeskSupportImage(w http.ResponseWriter, r *http.Request, user, cid, attachment string) {
	var blob, typ string
	var size int64
	err := s.db.QueryRow(`SELECT COALESCE(b.blob_id,a.id),a.mime,a.size FROM attachments a LEFT JOIN attachment_blobs b ON b.attachment_id=a.id WHERE a.id=? AND a.conversation_id=? AND EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=? AND m.attachment_id=a.id AND m.kind='image' AND m.recalled=0 AND NOT EXISTS(SELECT 1 FROM message_deletions d WHERE d.message_id=m.id AND d.user_id=?))`, attachment, cid, cid, user).Scan(&blob, &typ, &size)
	if err != nil {
		fail(w, 404, "图片不存在或已撤回")
		return
	}
	if size < 1 || size > 12<<20 {
		fail(w, 413, "图片过大")
		return
	}
	f, err := s.openStored("uploads", "", blob)
	if err != nil {
		fail(w, 503, "图片暂不可用")
		return
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 12<<20+1))
	if err != nil || len(raw) > 12<<20 {
		fail(w, 413, "图片过大")
		return
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "png" && format != "jpeg" && format != "gif" && format != "webp") || cfg.Width < 1 || cfg.Height < 1 || int64(cfg.Width)*int64(cfg.Height) > 16<<20 {
		fail(w, 400, "图片格式无效")
		return
	}
	source, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		fail(w, 400, "图片格式无效")
		return
	}
	wid, hei := cfg.Width, cfg.Height
	if max(wid, hei) > 1280 {
		wid = max(1, wid*1280/max(cfg.Width, cfg.Height))
		hei = max(1, hei*1280/max(cfg.Width, cfg.Height))
	}
	out := image.NewRGBA(image.Rect(0, 0, wid, hei))
	draw.Draw(out, out.Bounds(), image.White, image.Point{}, draw.Src)
	xdraw.ApproxBiLinear.Scale(out, out.Bounds(), source, source.Bounds(), draw.Over, nil)
	var encoded bytes.Buffer
	if jpeg.Encode(&encoded, out, &jpeg.Options{Quality: 88}) != nil || encoded.Len() > 1400<<10 {
		fail(w, 413, "图片过大")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	ok(w, map[string]any{"ok": true, "data": base64.StdEncoding.EncodeToString(encoded.Bytes()), "mime": "image/jpeg", "width": wid, "height": hei})
}

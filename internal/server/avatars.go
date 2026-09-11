package server

import (
	"bytes"
	"database/sql"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png"
	"io"
	"math"
	"net/http"
	"strings"
	"time"
)

const avatarSchema = `CREATE TABLE IF NOT EXISTS avatar_images(scope TEXT PRIMARY KEY,id TEXT UNIQUE NOT NULL,data BLOB NOT NULL,updated INTEGER NOT NULL);`
const maxAvatarUpload = 8 << 20

// Decode dimensions before allocating the full image. Re-encoding drops source metadata.
func normalizeAvatar(raw []byte) ([]byte, error) {
	config, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "jpeg" && format != "png") || config.Width < 1 || config.Height < 1 || config.Width > 4096 || config.Height > 4096 || int64(config.Width)*int64(config.Height) > 16<<20 {
		return nil, groupFail(400, "请使用不超过 4096×4096 像素的 JPEG 或 PNG 图片")
	}
	source, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, groupFail(400, "图片损坏，无法读取")
	}
	bounds := source.Bounds()
	side := min(bounds.Dx(), bounds.Dy())
	left, top := float64(bounds.Min.X)+float64(bounds.Dx()-side)/2, float64(bounds.Min.Y)+float64(bounds.Dy()-side)/2
	result := image.NewRGBA(image.Rect(0, 0, 512, 512))
	white := func(x, y int) (float64, float64, float64) {
		r, g, b, a := source.At(x, y).RGBA()
		return float64(r+65535-a) / 257, float64(g+65535-a) / 257, float64(b+65535-a) / 257
	}
	for y := 0; y < 512; y++ {
		sy := max(float64(bounds.Min.Y), min(float64(bounds.Max.Y-1), top+(float64(y)+.5)*float64(side)/512-.5))
		y0 := int(math.Floor(sy))
		y1 := min(y0+1, bounds.Max.Y-1)
		dy := sy - float64(y0)
		for x := 0; x < 512; x++ {
			sx := max(float64(bounds.Min.X), min(float64(bounds.Max.X-1), left+(float64(x)+.5)*float64(side)/512-.5))
			x0 := int(math.Floor(sx))
			x1 := min(x0+1, bounds.Max.X-1)
			dx := sx - float64(x0)
			r0, g0, b0 := white(x0, y0)
			r1, g1, b1 := white(x1, y0)
			r2, g2, b2 := white(x0, y1)
			r3, g3, b3 := white(x1, y1)
			mix := func(a, b, c, d float64) uint8 { return uint8(math.Round((a*(1-dx)+b*dx)*(1-dy) + (c*(1-dx)+d*dx)*dy)) }
			result.SetRGBA(x, y, color.RGBA{mix(r0, r1, r2, r3), mix(g0, g1, g2, g3), mix(b0, b1, b2, b3), 255})
		}
	}
	var output bytes.Buffer
	err = jpeg.Encode(&output, result, &jpeg.Options{Quality: 90})
	return output.Bytes(), err
}

func (s *Server) avatarScope(r *http.Request) (scope string, err error) {
	if cid := r.PathValue("id"); cid != "" {
		g, e := readGroup(s.db, cid, uid(r))
		if e != nil || !g.manager() {
			return "", groupFail(403, "只有群主和管理员可以修改群头像")
		}
		return "group:" + cid, nil
	}
	return "user:" + uid(r), nil
}

func (s *Server) uploadAvatar(w http.ResponseWriter, r *http.Request) {
	scope, e := s.avatarScope(r)
	if e != nil {
		s.dbError(w, e)
		return
	}
	if !s.rate(r, "avatar:"+uid(r), 20, time.Hour) {
		fail(w, 429, "更换头像过于频繁，请稍后再试")
		return
	}
	select {
	case s.avatarSlots <- struct{}{}:
		defer func() { <-s.avatarSlots }()
	default:
		fail(w, 503, "图片正在处理中，请稍后重试")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAvatarUpload+(1<<20))
	if e = r.ParseMultipartForm(1 << 20); e != nil {
		fail(w, 400, "头像文件不能超过 8 MB")
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, _, e := r.FormFile("file")
	if e != nil {
		fail(w, 400, "请选择头像图片")
		return
	}
	defer f.Close()
	raw, e := io.ReadAll(io.LimitReader(f, maxAvatarUpload+1))
	if e != nil || len(raw) > maxAvatarUpload {
		fail(w, 400, "头像文件不能超过 8 MB")
		return
	}
	data, e := normalizeAvatar(raw)
	if e != nil {
		s.dbError(w, e)
		return
	}
	tx, e := s.db.Begin()
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer tx.Rollback()
	if strings.HasPrefix(scope, "group:") {
		g, e := groupRequired(tx, r.PathValue("id"), uid(r))
		if e != nil || !g.manager() {
			fail(w, 403, "你已没有群头像修改权限")
			return
		}
	}
	id := newID()
	if _, e = tx.Exec("INSERT INTO avatar_images(scope,id,data,updated) VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET id=excluded.id,data=excluded.data,updated=excluded.updated", scope, id, data, now()); e != nil {
		s.dbError(w, e)
		return
	}
	if strings.HasPrefix(scope, "user:") {
		if _, e = tx.Exec("UPDATE users SET avatar=? WHERE id=?", "image:"+id, uid(r)); e != nil {
			s.dbError(w, e)
			return
		}
	}
	if e = tx.Commit(); e != nil {
		s.dbError(w, e)
		return
	}
	s.avatarChanged(scope)
	ok(w, map[string]string{"avatar": "image:" + id})
}

func (s *Server) resetAvatar(w http.ResponseWriter, r *http.Request) {
	scope, e := s.avatarScope(r)
	if e != nil {
		s.dbError(w, e)
		return
	}
	tx, e := s.db.Begin()
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer tx.Rollback()
	if strings.HasPrefix(scope, "group:") {
		g, e := groupRequired(tx, r.PathValue("id"), uid(r))
		if e != nil || !g.manager() {
			fail(w, 403, "你已没有群头像修改权限")
			return
		}
	}
	if _, e = tx.Exec("DELETE FROM avatar_images WHERE scope=?", scope); e != nil {
		s.dbError(w, e)
		return
	}
	value := "group"
	if strings.HasPrefix(scope, "user:") {
		value = defaultCartoonAvatar(uid(r))
		if _, e = tx.Exec("UPDATE users SET avatar=? WHERE id=?", value, uid(r)); e != nil {
			s.dbError(w, e)
			return
		}
	}
	if e = tx.Commit(); e != nil {
		s.dbError(w, e)
		return
	}
	s.avatarChanged(scope)
	ok(w, map[string]string{"avatar": value})
}

func (s *Server) avatar(w http.ResponseWriter, r *http.Request) {
	var scope string
	var data []byte
	var updated int64
	if e := s.db.QueryRow("SELECT scope,data,updated FROM avatar_images WHERE id=?", r.PathValue("image")).Scan(&scope, &data, &updated); e != nil {
		fail(w, 404, "头像不存在")
		return
	}
	if strings.HasPrefix(scope, "group:") {
		g, e := readGroup(s.db, strings.TrimPrefix(scope, "group:"), uid(r))
		if e != nil || g.Role == "" && !g.Discoverable {
			fail(w, 404, "头像不存在")
			return
		}
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("ETag", `"`+r.PathValue("image")+`"`)
	http.ServeContent(w, r, "avatar.jpg", time.UnixMilli(updated), bytes.NewReader(data))
}

func (s *Server) avatarChanged(scope string) {
	if strings.HasPrefix(scope, "group:") {
		s.pushConversation(strings.TrimPrefix(scope, "group:"), "groups", map[string]bool{"ok": true})
		return
	}
	user := strings.TrimPrefix(scope, "user:")
	s.profileChanged(user)
}
func (s *Server) profileChanged(user string) {
	u, e := s.user(user)
	if e != nil {
		return
	}
	rows, e := s.db.Query("SELECT ? UNION SELECT peer_id FROM directory_friends WHERE user_id=? UNION SELECT b.user_id FROM members a JOIN members b ON b.conversation_id=a.conversation_id WHERE a.user_id=?", user, user, user)
	if e != nil {
		return
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	s.push(ids, "profile", map[string]string{"userId": u.ID, "name": u.Name, "avatar": u.Avatar, "bio": u.Bio, "phone": u.Phone, "gender": u.Gender, "jobTitle": u.JobTitle})
}

func validateProfileAvatar(tx *sql.Tx, user string, value *string) error {
	if value == nil {
		return nil
	}
	if validAvatarColor(*value) || validCartoonAvatar(*value) {
		_, e := tx.Exec("DELETE FROM avatar_images WHERE scope=?", "user:"+user)
		return e
	}
	var current string
	if tx.QueryRow("SELECT avatar FROM users WHERE id=?", user).Scan(&current) != nil || current != *value || !strings.HasPrefix(current, "image:") {
		return groupFail(400, "请通过头像设置上传图片")
	}
	return nil
}
func validAvatarColor(value string) bool {
	switch value {
	case "blue", "pink", "purple", "orange", "green", "cyan":
		return true
	}
	return false
}

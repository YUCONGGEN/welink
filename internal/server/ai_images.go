package server

import (
	"encoding/base64"
	"errors"
	"io"
	"strings"
)

// Images sent to Me are passed to the model with the conversation, so a
// picture and the words sent with it are read together. Only the newest few
// are included, to keep requests small.
const (
	aiMaxImages     = 4
	aiMaxImageBytes = 8 << 20
)

// attachmentDataURL reads an image attachment as a data: URL.
func (s *Server) attachmentDataURL(id string) (string, error) {
	var mime, blob string
	var size int64
	if s.db.QueryRow("SELECT a.mime,a.size,COALESCE(b.blob_id,a.id) FROM attachments a LEFT JOIN attachment_blobs b ON b.attachment_id=a.id WHERE a.id=?", id).Scan(&mime, &size, &blob) != nil {
		return "", errors.New("image missing")
	}
	if !strings.HasPrefix(mime, "image/") || mime == "image/svg+xml" || size > aiMaxImageBytes {
		return "", errors.New("unsupported image")
	}
	f, err := s.openStored("uploads", "", blob)
	if err != nil {
		return "", err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, aiMaxImageBytes+1))
	if err != nil || len(raw) > aiMaxImageBytes {
		return "", errors.New("image unreadable")
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(raw), nil
}

// aiProviderMessages shapes the history for the provider: plain role/content
// messages, with images as content parts when withImages is set. Images that
// cannot be read are left out.
func (s *Server) aiProviderMessages(history []aiContextMessage, chat, withImages bool) []any {
	out := make([]any, 0, len(history))
	for _, m := range history {
		if !withImages || len(m.Images) == 0 {
			out = append(out, map[string]string{"role": m.Role, "content": m.Content})
			continue
		}
		parts := []any{}
		if chat {
			parts = append(parts, map[string]any{"type": "text", "text": m.Content})
		} else {
			parts = append(parts, map[string]any{"type": "input_text", "text": m.Content})
		}
		for _, id := range m.Images {
			url, err := s.attachmentDataURL(id)
			if err != nil {
				continue
			}
			if chat {
				parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]string{"url": url}})
			} else {
				parts = append(parts, map[string]any{"type": "input_image", "image_url": url})
			}
		}
		out = append(out, map[string]any{"role": m.Role, "content": parts})
	}
	return out
}

func historyHasImages(history []aiContextMessage) bool {
	for _, m := range history {
		if len(m.Images) > 0 {
			return true
		}
	}
	return false
}

package server

import (
	"encoding/binary"
	"errors"
	"net/url"
	"os"
	"strconv"
)

type mediaInfo struct {
	Kind       string `json:"kind"`
	DurationMS int64  `json:"durationMs"`
	Width      int    `json:"width,omitempty"`
	Height     int    `json:"height,omitempty"`
}

func inspectMedia(path, kind, mime string, fields url.Values) (*mediaInfo, string, error) {
	if kind == "" {
		return nil, mime, nil
	}
	info := &mediaInfo{Kind: kind}
	if kind == "voice" {
		duration, err := wavDuration(path)
		if err != nil {
			return nil, mime, err
		}
		info.DurationMS = duration
		return info, "audio/wav", nil
	}
	if kind != "video" {
		return nil, mime, errors.New("媒体类型无效")
	}
	if mime != "video/mp4" && mime != "video/webm" {
		return nil, mime, errors.New("视频仅支持 MP4、WebM，其他格式可作为文件发送")
	}
	duration, err := strconv.ParseInt(fields.Get("durationMs"), 10, 64)
	if err != nil || duration < 1 || duration > 86400000 {
		return nil, mime, errors.New("视频时长无效")
	}
	width, e1 := strconv.Atoi(fields.Get("width"))
	height, e2 := strconv.Atoi(fields.Get("height"))
	if e1 != nil || e2 != nil || width < 1 || height < 1 || width > 16384 || height > 16384 || int64(width)*int64(height) > 67108864 {
		return nil, mime, errors.New("视频尺寸无效")
	}
	// Video metadata describes the client-decoded preview; it never grants access
	// or determines storage limits. Size and file signatures are checked separately.
	info.DurationMS = duration
	info.Width = width
	info.Height = height
	return info, mime, nil
}

// Voice recordings use bounded mono PCM WAV so both native hosts can play them
// without platform-specific speech codec support. Duration comes from file data.
func wavDuration(path string) (int64, error) {
	invalid := errors.New("语音文件无效，请重新录制")
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return 0, err
	}
	var header [12]byte
	if _, err = f.ReadAt(header[:], 0); err != nil || string(header[:4]) != "RIFF" || string(header[8:]) != "WAVE" || int64(binary.LittleEndian.Uint32(header[4:8]))+8 != stat.Size() {
		return 0, invalid
	}
	var rate, dataSize int64
	var hasFormat, hasData bool
	for offset := int64(12); offset < stat.Size(); {
		var chunk [8]byte
		if _, err = f.ReadAt(chunk[:], offset); err != nil {
			return 0, invalid
		}
		size := int64(binary.LittleEndian.Uint32(chunk[4:]))
		start := offset + 8
		if size > stat.Size()-start {
			return 0, invalid
		}
		switch string(chunk[:4]) {
		case "fmt ":
			if hasFormat || size < 16 || size > 4096 {
				return 0, invalid
			}
			hasFormat = true
			var format [16]byte
			if _, err = f.ReadAt(format[:], start); err != nil {
				return 0, invalid
			}
			rate = int64(binary.LittleEndian.Uint32(format[4:8]))
			if binary.LittleEndian.Uint16(format[:2]) != 1 || binary.LittleEndian.Uint16(format[2:4]) != 1 || rate < 8000 || rate > 48000 || int64(binary.LittleEndian.Uint32(format[8:12])) != rate*2 || binary.LittleEndian.Uint16(format[12:14]) != 2 || binary.LittleEndian.Uint16(format[14:]) != 16 {
				return 0, invalid
			}
		case "data":
			if hasData || size%2 != 0 {
				return 0, invalid
			}
			hasData = true
			dataSize = size
		}
		offset = start + size + (size % 2)
		if offset > stat.Size() {
			return 0, invalid
		}
	}
	if !hasFormat || !hasData || dataSize == 0 {
		return 0, invalid
	}
	if dataSize > rate*2*60 {
		return 0, errors.New("语音最长 60 秒")
	}
	duration := dataSize * 1000 / (rate * 2)
	if duration < 500 {
		return 0, errors.New("说话时间太短，请重新录制")
	}
	return duration, nil
}

package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Settings contains deployment and product policy. LoadSettings overlays a file
// on documented defaults, so omitted fields stay compatible with upgrades.
type Settings struct {
	Listen         string        `json:"listen"`
	DownloadListen string        `json:"download_listen"`
	DataDir        string        `json:"data_dir"`
	DownloadsDir   string        `json:"downloads_dir"`
	Media          MediaSettings `json:"media"`
	PublicURL      string        `json:"public_url"`
	DownloadURL    string        `json:"download_url"`
	Storage        struct {
		PrimaryEnabled    bool            `json:"primary_enabled"`
		Root              string          `json:"root"`
		RequireMarker     bool            `json:"require_marker"`
		ReserveBytes      int64           `json:"reserve_bytes"`
		ConcurrentUploads int             `json:"concurrent_uploads"`
		Volumes           []StorageVolume `json:"volumes"`
	} `json:"storage"`
	Chat struct {
		MaxAttachmentBytes         int64 `json:"max_attachment_bytes"`
		PersistAttachmentBytes     int64 `json:"persist_attachment_bytes"`
		OfflineQueueBytes          int64 `json:"offline_queue_bytes"`
		OfflineQueueMessages       int   `json:"offline_queue_messages"`
		UploadsPerHour             int   `json:"uploads_per_hour"`
		ReceivedCacheMessages      int   `json:"received_cache_messages"`
		ReceivedCacheBytes         int64 `json:"received_cache_bytes"`
		ReceivedCacheDays          int   `json:"received_cache_days"`
		ReceivedCacheConversations int   `json:"received_cache_conversations"`
	} `json:"chat"`
	Drive struct {
		QuotaGB        int64 `json:"quota_gb"`
		MaxFiles       int   `json:"max_files"`
		MaxFolders     int   `json:"max_folders"`
		MaxFolderDepth int   `json:"max_folder_depth"`
	} `json:"drive"`
	Spaces struct {
		MaxDocumentBytes int64 `json:"max_document_bytes"`
		MaxDocuments     int   `json:"max_documents"`
	} `json:"spaces"`
	Directory struct {
		AllUsers bool `json:"all_users"`
	} `json:"directory"`
	Admin struct {
		Users []string `json:"users"`
	} `json:"admin"`
	Registration struct {
		Enabled bool `json:"enabled"`
	} `json:"registration"`
	Meetings struct {
		MaxParticipants int      `json:"max_participants"`
		DurationMinutes int      `json:"duration_minutes"`
		STUNURLs        []string `json:"stun_urls"`
	} `json:"meetings"`
}

type StorageVolume struct {
	ID   string `json:"id"`
	Root string `json:"root"`
}

func DefaultSettings() Settings {
	var s Settings
	s.Listen = ":8250"
	s.DataDir = "data"
	s.DownloadsDir = "downloads"
	s.PublicURL = "http://www.yucg.cn:8250"
	s.DownloadURL = "http://www.yucg.cn:8251"
	s.Storage.PrimaryEnabled = true
	s.Media = defaultMediaSettings()
	s.Storage.ReserveBytes = 256 << 20
	s.Storage.ConcurrentUploads = 4
	s.Chat.PersistAttachmentBytes = 50 << 20
	s.Chat.OfflineQueueBytes = 250 << 20
	s.Chat.OfflineQueueMessages = 100
	s.Chat.ReceivedCacheMessages = 5000
	s.Chat.ReceivedCacheBytes = 20 << 20
	s.Chat.ReceivedCacheDays = 30
	s.Chat.ReceivedCacheConversations = 100
	s.Drive.QuotaGB = 100
	s.Drive.MaxFiles = 10000
	s.Drive.MaxFolders = 2000
	s.Drive.MaxFolderDepth = 32
	s.Spaces.MaxDocumentBytes = 2 << 20
	s.Spaces.MaxDocuments = 10000
	s.Directory.AllUsers = true
	s.Meetings.MaxParticipants = 8
	s.Meetings.DurationMinutes = 120
	s.Meetings.STUNURLs = []string{"stun:www.yucg.cn:8233"}
	return s
}
func LoadSettings(path string) (Settings, error) {
	s := DefaultSettings()
	if path != "" {
		f, err := os.Open(path)
		if err != nil {
			return s, err
		}
		defer f.Close()
		decoder := json.NewDecoder(io.LimitReader(f, 1<<20))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&s); err != nil {
			return s, fmt.Errorf("invalid configuration: %w", err)
		}
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			return s, errors.New("configuration must contain exactly one JSON object")
		}
	}
	return s, s.Validate()
}
func (s Settings) Validate() error {
	if s.Chat.ReceivedCacheMessages < 0 || s.Chat.ReceivedCacheBytes < 0 || s.Chat.ReceivedCacheDays < 1 || s.Chat.ReceivedCacheConversations < 1 {
		return errors.New("invalid received message cache settings")
	}
	if err := s.Media.validate(); err != nil {
		return err
	}
	if s.Chat.PersistAttachmentBytes < 0 || s.Chat.OfflineQueueBytes < 0 || s.Chat.OfflineQueueMessages < 1 || s.Chat.UploadsPerHour < 0 {
		return errors.New("invalid chat delivery settings")
	}
	for _, raw := range []string{s.PublicURL, s.DownloadURL} {
		u, e := url.Parse(raw)
		if e != nil || !(u.Scheme == "http" || u.Scheme == "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.Trim(u.Path, "/") != "" {
			return errors.New("public_url and download_url must be HTTP(S) origins")
		}
	}
	if s.DataDir == "" || s.Storage.ReserveBytes < 0 || s.Storage.ConcurrentUploads < 1 || s.Storage.ConcurrentUploads > 64 || s.Chat.MaxAttachmentBytes < 0 || s.Drive.QuotaGB < 1 || s.Drive.QuotaGB > 1048576 || s.Drive.MaxFiles < 1 || s.Drive.MaxFolders < 1 || s.Drive.MaxFolders > 100000 || s.Drive.MaxFolderDepth < 1 || s.Drive.MaxFolderDepth > 100 || s.Spaces.MaxDocumentBytes < 1 || s.Spaces.MaxDocumentBytes > 16<<20 || s.Spaces.MaxDocuments < 1 || s.Meetings.MaxParticipants < 2 || s.Meetings.MaxParticipants > 32 || s.Meetings.DurationMinutes < 1 || s.Meetings.DurationMinutes > 1440 {
		return errors.New("configuration contains an invalid capacity or limit")
	}
	if s.Storage.RequireMarker && s.Storage.Root == "" {
		return errors.New("storage.root is required when require_marker is enabled")
	}
	volumeIDs := map[string]bool{"primary": true}
	roots := map[string]bool{filepath.Clean(s.Storage.Root): true}
	for _, volume := range s.Storage.Volumes {
		root := filepath.Clean(volume.Root)
		if !regexp.MustCompile(`^[a-zA-Z0-9_-]{1,32}$`).MatchString(volume.ID) || volumeIDs[volume.ID] || volume.Root == "" || roots[root] {
			return errors.New("storage.volumes requires unique IDs and different nonempty root paths")
		}
		volumeIDs[volume.ID], roots[root] = true, true
	}
	for _, address := range s.Meetings.STUNURLs {
		if !strings.HasPrefix(address, "stun:") || strings.ContainsAny(address, "\r\n\t ") {
			return errors.New("meetings.stun_urls must contain STUN addresses")
		}
	}
	return nil
}
func (s Settings) driveQuota() int64 { return s.Drive.QuotaGB << 30 }

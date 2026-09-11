package server

import "net/http"

func (s *Server) publicConfig(w http.ResponseWriter, r *http.Request) {
	ok(w, map[string]any{
		"admin": s.isAdmin(uid(r)), "allUsers": s.settings.Directory.AllUsers, "publicURL": s.settings.PublicURL, "downloadURL": s.settings.DownloadURL,
		"chatPersistAttachmentBytes": s.settings.Chat.PersistAttachmentBytes, "chatOfflineQueueBytes": s.settings.Chat.OfflineQueueBytes, "chatOfflineQueueMessages": s.settings.Chat.OfflineQueueMessages, "chatMaxAttachmentBytes": s.settings.Chat.MaxAttachmentBytes,
		"receivedCacheMessages": s.settings.Chat.ReceivedCacheMessages, "receivedCacheBytes": s.settings.Chat.ReceivedCacheBytes, "receivedCacheDays": s.settings.Chat.ReceivedCacheDays, "receivedCacheConversations": s.settings.Chat.ReceivedCacheConversations,
		"driveQuota": s.settings.driveQuota(), "spaceMaxDocumentBytes": s.settings.Spaces.MaxDocumentBytes, "meetingMaxParticipants": s.settings.Meetings.MaxParticipants, "meetingDurationMinutes": s.settings.Meetings.DurationMinutes, "stunURLs": s.settings.Meetings.STUNURLs,
	})
}

package server

import "errors"

func (s *Server) meetingInvitees(user, cid string, members []string) ([]string, error) {
	if len(members) > 200 {
		return nil, errors.New("邀请人数过多")
	}
	ids := map[string]bool{}
	if cid != "" {
		if !s.member(cid, user) {
			return nil, errors.New("不能向其他会话邀请会议")
		}
		rows, e := s.db.Query("SELECT user_id FROM members WHERE conversation_id=?", cid)
		if e != nil {
			return nil, e
		}
		for rows.Next() {
			var id string
			if e = rows.Scan(&id); e != nil {
				rows.Close()
				return nil, e
			}
			ids[id] = true
		}
		rows.Close()
	}
	for _, id := range members {
		var exists int
		if id != user && s.db.QueryRow("SELECT 1 FROM friends WHERE user_id=? AND peer_id=?", user, id).Scan(&exists) != nil {
			return nil, errors.New("只能邀请会话成员或好友")
		}
		ids[id] = true
	}
	delete(ids, user)
	out := []string{}
	for id := range ids {
		out = append(out, id)
	}
	return out, nil
}

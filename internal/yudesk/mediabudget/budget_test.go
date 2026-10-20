package mediabudget

import "testing"

func TestAudioReservationSurvivesOneOfMultipleSessionsClosing(t *testing.T) {
	if CPUsForScreen(4) != 4 {
		t.Fatal("idle budget")
	}
	first, second := BeginAudio(), BeginAudio()
	if CPUsForScreen(4) != 2 || CPUsForScreen(1) != 1 {
		t.Fatal("active audio budget")
	}
	first()
	if CPUsForScreen(4) != 2 {
		t.Fatal("closing one session released another session's CPU reservation")
	}
	second()
	if CPUsForScreen(4) != 4 {
		t.Fatal("audio reservation leaked after all sessions ended")
	}
}

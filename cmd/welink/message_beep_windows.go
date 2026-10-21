//go:build windows

package main

import (
	_ "embed"
	"syscall"
	"unsafe"
)

//go:embed resources/message_beep.wav
var messageBeepWAV []byte

func playMessageBeep() {
	if len(messageBeepWAV) == 0 {
		return
	}
	syscall.NewLazyDLL("winmm.dll").NewProc("PlaySoundW").Call(
		uintptr(unsafe.Pointer(&messageBeepWAV[0])), 0, 0x1|0x2|0x4,
	)
}

//go:build windows

package mediabudget

import "golang.org/x/sys/windows"

var screenKernel = windows.NewLazySystemDLL("kernel32.dll")
var screenGetPriority = screenKernel.NewProc("GetThreadPriority")
var screenSetPriority = screenKernel.NewProc("SetThreadPriority")

// Optional AI/cleanup work stays below capture/codec workers even if sound is
// off. Frame compression/decoding uses FrameWorker; never demote input/audio.
func ScreenWorker() func() { return scopedWorker(-1) }

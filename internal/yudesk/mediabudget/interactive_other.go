//go:build !windows

package mediabudget

// Unix/Android retain their OS scheduler; no root or realtime policy is needed.
func EnableInteractiveProcess() {}
func InteractiveWorker() func() { return func() {} }
func FrameWorker() func()       { return func() {} }

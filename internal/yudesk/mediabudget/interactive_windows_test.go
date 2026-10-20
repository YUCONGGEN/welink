//go:build windows

package mediabudget

import (
	"os"
	"os/exec"
	"runtime"
	"testing"
	"time"
	"unsafe"
)

func TestDesktopPerformanceProcess(t *testing.T) {
	if os.Getenv("YUDESK_TEST_PERFORMANCE_CHILD") != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestDesktopPerformanceProcess$", "-test.v")
		cmd.Env = append(os.Environ(), "YUDESK_TEST_PERFORMANCE_CHILD=1")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("child: %v\n%s", err, out)
		} else {
			t.Log(string(out))
		}
		return
	}
	EnableInteractiveProcess()
	read := func() {
		t.Helper()
		priority, _, _ := getProcessPriority.Call(^uintptr(0))
		if priority != highPriorityClass {
			t.Fatalf("priority class %#x", priority)
		}
		var state powerThrottling
		state.Version = 1
		ok, _, err := getProcessInfo.Call(^uintptr(0), processPowerThrottling, uintptr(unsafe.Pointer(&state)), unsafe.Sizeof(state))
		if ok == 0 {
			t.Log("Power policy read-back unsupported on this Windows build; setters are checked:", err)
			return
		}
		if state.ControlMask&executionSpeed == 0 || state.StateMask&executionSpeed != 0 {
			t.Fatal("EcoQoS not explicitly disabled", state)
		}
	}
	read()
	// A backgrounded or externally throttled process is repaired on recheck.
	state := powerThrottling{Version: 1, ControlMask: executionSpeed, StateMask: executionSpeed}
	if ok, _, err := setProcessInfo.Call(^uintptr(0), processPowerThrottling, uintptr(unsafe.Pointer(&state)), unsafe.Sizeof(state)); ok == 0 {
		t.Fatal(err)
	}
	setProcessPriority.Call(^uintptr(0), 0x4000) // Below normal.
	if p, q := processPerformance(); p != nil || q != nil {
		t.Fatal(p, q)
	}
	read()
}

func TestCriticalWorkerRestoresThreadState(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	thread := ^uintptr(1)
	old, _, _ := screenGetPriority.Call(thread)
	read := func() powerThrottling {
		v := powerThrottling{Version: 1}
		ok, _, err := getThreadInfo.Call(thread, threadPowerThrottling, uintptr(unsafe.Pointer(&v)), unsafe.Sizeof(v))
		if ok == 0 {
			t.Log("Thread power read-back unsupported on this Windows build:", err)
		}
		return v
	}
	previous := read()
	leave := InteractiveWorker()
	priority, _, _ := screenGetPriority.Call(thread)
	if int32(priority) != 1 {
		t.Fatal("input/transport priority not elevated", priority)
	}
	current := read()
	if current.ControlMask != 0 && (current.ControlMask&executionSpeed == 0 || current.StateMask&executionSpeed != 0) {
		t.Fatal("critical thread still EcoQoS", current)
	}
	frame := FrameWorker()
	priority, _, _ = screenGetPriority.Call(thread)
	if int32(priority) != 0 {
		t.Fatal("frame priority", priority)
	}
	frame()
	leave()
	if err := setHighQoS(setThreadInfo, thread, threadPowerThrottling); err != nil {
		t.Fatal("HighQoS setter failed", err)
	}
	setThreadInfo.Call(thread, threadPowerThrottling, uintptr(unsafe.Pointer(&previous)), unsafe.Sizeof(previous))
	restored, _, _ := screenGetPriority.Call(thread)
	if restored != old || read() != previous {
		t.Fatalf("leaked policy to Go thread: old %d %+v, now %d %+v", old, previous, restored, read())
	}
	start := time.Now()
	for range 1000 {
		done := InteractiveWorker()
		done()
	}
	t.Logf("critical worker scope mean %s", time.Since(start)/1000)
}

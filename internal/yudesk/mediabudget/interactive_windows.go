//go:build windows

package mediabudget

import (
	"log"
	"runtime"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Explicit HighQoS prevents visibility/minimization heuristics from selecting
// EcoQoS. This changes only YuDesk, never machine power policy or other apps.
// Windows or an administrator can still override scheduling/thermal limits.
const (
	highPriorityClass      = 0x80
	processPowerThrottling = 4
	threadPowerThrottling  = 3
	executionSpeed         = 1
)

type powerThrottling struct{ Version, ControlMask, StateMask uint32 }

var (
	performanceKernel      = windows.NewLazySystemDLL("kernel32.dll")
	getProcessPriority     = performanceKernel.NewProc("GetPriorityClass")
	setProcessPriority     = performanceKernel.NewProc("SetPriorityClass")
	getProcessInfo         = performanceKernel.NewProc("GetProcessInformation")
	setProcessInfo         = performanceKernel.NewProc("SetProcessInformation")
	getThreadInfo          = performanceKernel.NewProc("GetThreadInformation")
	setThreadInfo          = performanceKernel.NewProc("SetThreadInformation")
	processPerformanceOnce sync.Once
	threadPolicies         = struct {
		sync.Mutex
		values map[uint32]powerThrottling
	}{values: map[uint32]powerThrottling{}}
)

func setHighQoS(proc *windows.LazyProc, handle uintptr, kind uintptr) error {
	if err := proc.Find(); err != nil {
		return err
	}
	state := powerThrottling{Version: 1, ControlMask: executionSpeed, StateMask: 0}
	ok, _, err := proc.Call(handle, kind, uintptr(unsafe.Pointer(&state)), unsafe.Sizeof(state))
	runtime.KeepAlive(&state)
	if ok == 0 {
		return err
	}
	return nil
}

func processPerformance() (priorityErr, qosErr error) {
	process := ^uintptr(0) // GetCurrentProcess pseudo handle.
	priority, _, _ := getProcessPriority.Call(process)
	if priority != highPriorityClass {
		if ok, _, err := setProcessPriority.Call(process, highPriorityClass); ok == 0 {
			priorityErr = err
		}
	}
	var state powerThrottling
	state.Version = 1
	if getProcessInfo.Find() == nil {
		ok, _, _ := getProcessInfo.Call(process, processPowerThrottling, uintptr(unsafe.Pointer(&state)), unsafe.Sizeof(state))
		if ok != 0 && state.ControlMask&executionSpeed != 0 && state.StateMask&executionSpeed == 0 {
			return priorityErr, nil
		}
	}
	return priorityErr, setHighQoS(setProcessInfo, process, processPowerThrottling)
}

// Called only by desktop client entry points, including the pre-login worker.
// Recheck read-back state periodically so a temporary external change does not
// silently leave an ongoing remote session at Idle/EcoQoS indefinitely.
func EnableInteractiveProcess() {
	processPerformanceOnce.Do(func() {
		priorityErr, qosErr := processPerformance()
		if priorityErr != nil || qosErr != nil {
			log.Printf("YuDesk performance scheduling: high=%v HighQoS=%v", priorityErr, qosErr)
		}
		go func() {
			ticker := time.NewTicker(5 * time.Second)
			defer ticker.Stop()
			for range ticker.C {
				processPerformance()
			}
		}()
	})
}

// Goroutines migrate among Windows threads. Keep the priority and HighQoS on
// one locked thread, then restore BOTH before returning it to Go's pool.
func scopedWorker(priority int32) func() {
	runtime.LockOSThread()
	thread := ^uintptr(1)
	old, _, _ := screenGetPriority.Call(thread)
	changed := false
	if int32(old) != 0x7fffffff && int32(old) != priority {
		ok, _, _ := screenSetPriority.Call(thread, uintptr(priority))
		changed = ok != 0
	}
	var previous powerThrottling
	previous.Version = 1
	saved := false
	if getThreadInfo.Find() == nil {
		ok, _, _ := getThreadInfo.Call(thread, threadPowerThrottling, uintptr(unsafe.Pointer(&previous)), unsafe.Sizeof(previous))
		saved = ok != 0
	}
	// Windows 10 supports SetThreadInformation(ThreadPowerThrottling) but
	// rejects its Get counterpart. Track our own nested scopes there and
	// restore inheritance when the outermost scope returns to Go's pool.
	id := windows.GetCurrentThreadId()
	threadPolicies.Lock()
	priorPolicy, tracked := threadPolicies.values[id]
	if !saved && tracked {
		previous = priorPolicy
	}
	threadPolicies.Unlock()
	qosChanged := false
	if previous.ControlMask&executionSpeed == 0 || previous.StateMask&executionSpeed != 0 {
		qosChanged = setHighQoS(setThreadInfo, thread, threadPowerThrottling) == nil
	}
	currentPolicy := previous
	if qosChanged {
		currentPolicy = powerThrottling{Version: 1, ControlMask: executionSpeed}
	}
	threadPolicies.Lock()
	threadPolicies.values[id] = currentPolicy
	threadPolicies.Unlock()
	return func() {
		if qosChanged {
			setThreadInfo.Call(thread, threadPowerThrottling, uintptr(unsafe.Pointer(&previous)), unsafe.Sizeof(previous))
			runtime.KeepAlive(&previous)
		}
		if changed {
			screenSetPriority.Call(thread, old)
		}
		threadPolicies.Lock()
		if tracked {
			threadPolicies.values[id] = priorPolicy
		} else {
			delete(threadPolicies.values, id)
		}
		threadPolicies.Unlock()
		runtime.UnlockOSThread()
	}
}

// Input/control and bounded audio transport run above the frame/AI workers.
// Audio capture/playback retain their higher native MMCSS Audio registration.
func InteractiveWorker() func() { return scopedWorker(1) }
func FrameWorker() func()       { return scopedWorker(0) }

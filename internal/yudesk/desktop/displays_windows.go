//go:build windows

package desktop

import (
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"
)

var (
	enumDisplayMonitors = user32.NewProc("EnumDisplayMonitors")
	getMonitorInfo      = user32.NewProc("GetMonitorInfoW")
	getDPIForMonitor    = syscall.NewLazyDLL("shcore.dll").NewProc("GetDpiForMonitor")
	monitorCallback     = syscall.NewCallback(collectMonitor)
	monitorContexts     sync.Map
	monitorContextID    atomic.Uint64
)

type nativeRect struct{ Left, Top, Right, Bottom int32 }
type monitorInfo struct {
	Size          uint32
	Monitor, Work nativeRect
	Flags         uint32
	Device        [32]uint16
}
type monitorCollection struct {
	displays []Display
	err      error
}

func collectMonitor(handle, _ uintptr, _ uintptr, parameter uintptr) uintptr {
	value, ok := monitorContexts.Load(parameter)
	if !ok {
		return 0
	}
	collection := value.(*monitorCollection)
	info := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
	if ok, _, _ := getMonitorInfo.Call(handle, uintptr(unsafe.Pointer(&info))); ok == 0 {
		collection.err = ErrDisplayUnavailable
		return 0
	}
	name := syscall.UTF16ToString(info.Device[:])
	scale := 1.0
	if getDPIForMonitor.Find() == nil {
		var x, y uint32
		if hr, _, _ := getDPIForMonitor.Call(handle, 0, uintptr(unsafe.Pointer(&x)), uintptr(unsafe.Pointer(&y))); hr == 0 && x > 0 {
			scale = float64(x) / 96
		}
	}
	r := info.Monitor
	collection.displays = append(collection.displays, Display{
		ID: name, Name: name, X: int(r.Left), Y: int(r.Top), Width: int(r.Right - r.Left), Height: int(r.Bottom - r.Top),
		Scale: scale, Primary: info.Flags&1 != 0,
	})
	if len(collection.displays) > maxDisplays {
		collection.err = ErrDisplayUnavailable
		return 0
	}
	return 1
}

func enumerateWindowsDisplays() ([]Display, error) {
	collection := monitorCollection{}
	var contextID uintptr
	for {
		contextID = uintptr(monitorContextID.Add(1))
		if contextID == 0 {
			continue
		}
		if _, exists := monitorContexts.LoadOrStore(contextID, &collection); !exists {
			break
		}
	}
	defer monitorContexts.Delete(contextID)
	ok, _, err := enumDisplayMonitors.Call(0, 0, monitorCallback, contextID)
	runtime.KeepAlive(&collection)
	if collection.err != nil {
		return nil, collection.err
	}
	if ok == 0 {
		return nil, fmt.Errorf("enumerate desktop monitors: %w", err)
	}
	return validateDisplays(collection.displays)
}

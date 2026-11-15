//go:build windows

package desktop

import (
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

// DXGI Desktop Duplication receives the image DWM has already composed. It is
// woken by the next present, so a changed window is available without waiting
// for a polling tick or a full-screen GDI BitBlt (tens of milliseconds at
// 1080p and above). The pointer is not part of the image, which matches the
// BitBlt path: the cursor shape and position are transmitted separately.
var (
	dxgiDLL               = syscall.NewLazyDLL("dxgi.dll")
	d3d11DLL              = syscall.NewLazyDLL("d3d11.dll")
	createDXGIFactory1    = dxgiDLL.NewProc("CreateDXGIFactory1")
	d3d11CreateDeviceProc = d3d11DLL.NewProc("D3D11CreateDevice")
)

type comGUID struct {
	Data1        uint32
	Data2, Data3 uint16
	Data4        [8]byte
}

var (
	iidDXGIFactory1   = comGUID{0x770aae78, 0xf26f, 0x4dba, [8]byte{0xa8, 0x29, 0x25, 0x3c, 0x83, 0xd1, 0xb3, 0x87}}
	iidDXGIOutput1    = comGUID{0x00cddea8, 0x939b, 0x4b83, [8]byte{0xa3, 0x40, 0xa6, 0x85, 0x22, 0x66, 0x66, 0xcc}}
	iidD3D11Texture2D = comGUID{0x6f15aaf2, 0xd208, 0x4e89, [8]byte{0x9a, 0xb4, 0x48, 0x95, 0x35, 0xd3, 0x4f, 0x9c}}
)

const (
	dxgiErrorNotFound    = 0x887A0002
	dxgiErrorWaitTimeout = 0x887A0027
	dxgiErrorAccessLost  = 0x887A0026

	dxgiFormatB8G8R8A8 = 87
	d3d11UsageStaging  = 3
	d3d11CPUAccessRead = 0x20000
	d3d11MapRead       = 1

	// COM vtable slots. IUnknown occupies 0-2 and IDXGIObject 3-6.
	vtQueryInterface         = 0
	vtAddRef                 = 1
	vtRelease                = 2
	vtFactoryEnumAdapters1   = 12
	vtAdapterEnumOutputs     = 7
	vtOutputGetDesc          = 7
	vtOutputWaitForVBlank    = 10
	vtOutput1DuplicateOutput = 22
	vtDuplicationGetDesc     = 7
	vtDuplicationAcquire     = 8
	vtDuplicationRelease     = 14
	vtDeviceCreateTexture2D  = 5
	vtContextMap             = 14
	vtContextUnmap           = 15
	vtContextCopyResource    = 47
)

var errDuplicationUnsupported = errors.New("desktop duplication is unavailable for this display")

type dxgiOutputDesc struct {
	DeviceName        [32]uint16
	Left, Top         int32
	Right, Bottom     int32
	AttachedToDesktop int32
	Rotation          uint32
	Monitor           uintptr
}

type dxgiOutduplDesc struct {
	Width, Height              uint32
	RefreshNumerator           uint32
	RefreshDenominator         uint32
	Format, ScanlineOrdering   uint32
	Scaling, Rotation          uint32
	DesktopImageInSystemMemory int32
}

type dxgiOutduplFrameInfo struct {
	LastPresentTime           int64
	LastMouseUpdateTime       int64
	AccumulatedFrames         uint32
	RectsCoalesced            int32
	ProtectedContentMaskedOut int32
	PointerX, PointerY        int32
	PointerVisible            int32
	TotalMetadataBufferSize   uint32
	PointerShapeBufferSize    uint32
}

type d3d11Texture2DDesc struct {
	Width, Height, MipLevels, ArraySize uint32
	Format                              uint32
	SampleCount, SampleQuality          uint32
	Usage, BindFlags, CPUAccessFlags    uint32
	MiscFlags                           uint32
}

type d3d11MappedSubresource struct {
	Data       unsafe.Pointer
	RowPitch   uint32
	DepthPitch uint32
}

// Callers pass uintptr(unsafe.Pointer(&local)) out-parameters. As with
// syscall.LazyProc.Call, those must stay on the heap and alive for the whole
// native call: a moved goroutine stack would leave D3D writing to stale memory.
//
//go:uintptrescapes
func comCall(object unsafe.Pointer, method uintptr, args ...uintptr) uint32 {
	table := *(*unsafe.Pointer)(object)
	function := *(*uintptr)(unsafe.Add(table, method*unsafe.Sizeof(uintptr(0))))
	r, _, _ := syscall.SyscallN(function, append([]uintptr{uintptr(object)}, args...)...)
	return uint32(r)
}

func comRelease(object unsafe.Pointer) {
	if object != nil {
		comCall(object, vtRelease)
	}
}

func hresultFailed(hr uint32) bool { return int32(hr) < 0 }

type hresultError struct {
	operation string
	code      uint32
}

func (e hresultError) Error() string { return fmt.Sprintf("%s failed: 0x%08X", e.operation, e.code) }

// One duplication owns a D3D11 device on the adapter that scans out the
// selected monitor (hybrid laptops reject a device on the other GPU) and a CPU
// readable copy of the most recent complete desktop image.
type duplicator struct {
	output, device, context, duplication, staging unsafe.Pointer
	display                                       Display
	hasFrame                                      bool
	monitor                                       *outputMonitor
}

func newDuplicator(display Display) (*duplicator, error) {
	if createDXGIFactory1.Find() != nil || d3d11CreateDeviceProc.Find() != nil {
		return nil, errDuplicationUnsupported
	}
	var factory unsafe.Pointer
	if hr, _, _ := createDXGIFactory1.Call(uintptr(unsafe.Pointer(&iidDXGIFactory1)), uintptr(unsafe.Pointer(&factory))); hresultFailed(uint32(hr)) {
		return nil, hresultError{"CreateDXGIFactory1", uint32(hr)}
	}
	defer comRelease(factory)
	for adapterIndex := uintptr(0); adapterIndex < 16; adapterIndex++ {
		var adapter unsafe.Pointer
		hr := comCall(factory, vtFactoryEnumAdapters1, adapterIndex, uintptr(unsafe.Pointer(&adapter)))
		if hr == dxgiErrorNotFound {
			break
		}
		if hresultFailed(hr) {
			return nil, hresultError{"EnumAdapters1", hr}
		}
		for outputIndex := uintptr(0); outputIndex < 16; outputIndex++ {
			var output unsafe.Pointer
			hr := comCall(adapter, vtAdapterEnumOutputs, outputIndex, uintptr(unsafe.Pointer(&output)))
			if hr == dxgiErrorNotFound || hresultFailed(hr) {
				break
			}
			var desc dxgiOutputDesc
			if hresultFailed(comCall(output, vtOutputGetDesc, uintptr(unsafe.Pointer(&desc)))) || desc.AttachedToDesktop == 0 || !strings.EqualFold(syscall.UTF16ToString(desc.DeviceName[:]), display.ID) {
				comRelease(output)
				continue
			}
			d, err := createDuplication(adapter, output, desc, display)
			if err != nil {
				comRelease(output)
			}
			comRelease(adapter)
			return d, err
		}
		comRelease(adapter)
	}
	return nil, errDuplicationUnsupported
}

func createDuplication(adapter, output unsafe.Pointer, desc dxgiOutputDesc, display Display) (*duplicator, error) {
	// A rotated panel is duplicated in scan-out orientation; keep the GDI path,
	// which already returns desktop orientation, rather than rotate on the CPU.
	if desc.Rotation > 1 || int(desc.Left) != display.X || int(desc.Top) != display.Y || int(desc.Right-desc.Left) != display.Width || int(desc.Bottom-desc.Top) != display.Height {
		return nil, errDuplicationUnsupported
	}
	var output1 unsafe.Pointer
	if hr := comCall(output, vtQueryInterface, uintptr(unsafe.Pointer(&iidDXGIOutput1)), uintptr(unsafe.Pointer(&output1))); hresultFailed(hr) {
		return nil, hresultError{"QueryInterface(IDXGIOutput1)", hr}
	}
	defer comRelease(output1)
	d := &duplicator{output: output, display: display}
	var level uint32
	// D3D_DRIVER_TYPE_UNKNOWN is required with an explicit adapter.
	if hr, _, _ := d3d11CreateDeviceProc.Call(uintptr(adapter), 0, 0, 0, 0, 0, 7, uintptr(unsafe.Pointer(&d.device)), uintptr(unsafe.Pointer(&level)), uintptr(unsafe.Pointer(&d.context))); hresultFailed(uint32(hr)) {
		return nil, hresultError{"D3D11CreateDevice", uint32(hr)}
	}
	if hr := comCall(output1, vtOutput1DuplicateOutput, uintptr(d.device), uintptr(unsafe.Pointer(&d.duplication))); hresultFailed(hr) {
		d.output = nil // the caller still owns it on failure
		d.close()
		return nil, hresultError{"DuplicateOutput", hr}
	}
	var duplicated dxgiOutduplDesc
	comCall(d.duplication, vtDuplicationGetDesc, uintptr(unsafe.Pointer(&duplicated)))
	if duplicated.DesktopImageInSystemMemory != 0 || duplicated.Rotation > 1 || int(duplicated.Width) != display.Width || int(duplicated.Height) != display.Height {
		d.output = nil
		d.close()
		return nil, errDuplicationUnsupported
	}
	staging := d3d11Texture2DDesc{Width: duplicated.Width, Height: duplicated.Height, MipLevels: 1, ArraySize: 1, Format: dxgiFormatB8G8R8A8, SampleCount: 1, Usage: d3d11UsageStaging, CPUAccessFlags: d3d11CPUAccessRead}
	if hr := comCall(d.device, vtDeviceCreateTexture2D, uintptr(unsafe.Pointer(&staging)), 0, uintptr(unsafe.Pointer(&d.staging))); hresultFailed(hr) {
		d.output = nil
		d.close()
		return nil, hresultError{"CreateTexture2D", hr}
	}
	d.monitor = startOutputMonitor(output)
	return d, nil
}

// acquire waits up to timeout milliseconds for a newly presented desktop image
// and copies it into the staging texture. Pointer-only updates are not images.
func (d *duplicator) acquire(timeout uint32) (bool, error) {
	var info dxgiOutduplFrameInfo
	var resource unsafe.Pointer
	hr := comCall(d.duplication, vtDuplicationAcquire, uintptr(timeout), uintptr(unsafe.Pointer(&info)), uintptr(unsafe.Pointer(&resource)))
	if hr == dxgiErrorWaitTimeout {
		return false, nil
	}
	if hresultFailed(hr) {
		return false, hresultError{"AcquireNextFrame", hr}
	}
	defer comCall(d.duplication, vtDuplicationRelease)
	defer comRelease(resource)
	// Pointer-only updates carry no new desktop image. A present always
	// delivers the complete desktop surface, so one copy is a full image.
	if info.LastPresentTime == 0 {
		return false, nil
	}
	var texture unsafe.Pointer
	if hr := comCall(resource, vtQueryInterface, uintptr(unsafe.Pointer(&iidD3D11Texture2D)), uintptr(unsafe.Pointer(&texture))); hresultFailed(hr) {
		return false, hresultError{"QueryInterface(ID3D11Texture2D)", hr}
	}
	// The copy is queued before ReleaseFrame; Map(READ) below waits for it.
	comCall(d.context, vtContextCopyResource, uintptr(d.staging), uintptr(texture))
	comRelease(texture)
	d.hasFrame = true
	return true, nil
}

// read converts the last complete image to opaque RGBA, nearest-neighbor
// sampled when a smaller width was requested (the GDI path uses COLORONCOLOR).
func (d *duplicator) read(destination *image.RGBA) error {
	var mapped d3d11MappedSubresource
	if hr := comCall(d.context, vtContextMap, uintptr(d.staging), 0, d3d11MapRead, 0, uintptr(unsafe.Pointer(&mapped))); hresultFailed(hr) {
		return hresultError{"Map", hr}
	}
	defer comCall(d.context, vtContextUnmap, uintptr(d.staging), 0)
	sourceW, sourceH, pitch := d.display.Width, d.display.Height, int(mapped.RowPitch)
	if mapped.Data == nil || pitch < sourceW*4 {
		return errDuplicationUnsupported
	}
	source := unsafe.Slice((*byte)(mapped.Data), pitch*(sourceH-1)+sourceW*4)
	convertDesktopRows(destination, source, pitch, sourceW, sourceH)
	return nil
}

// outputScanning reports whether the monitor is refreshing. A switched-off
// panel (closed laptop lid, monitor off) returns WaitForVBlank at once and DWM
// then presents nothing, so duplication never wakes although GDI still
// composes. After aligning to a vblank, each wait on a lit output lasts a full
// refresh period. Require two: one preempted call must not look like a lit one.
func outputScanning(output unsafe.Pointer) bool {
	if hresultFailed(comCall(output, vtOutputWaitForVBlank)) {
		return false
	}
	for range 2 {
		started := time.Now()
		if hresultFailed(comCall(output, vtOutputWaitForVBlank)) || time.Since(started) < 500*time.Microsecond {
			return false
		}
	}
	return true
}

// outputMonitor probes on its own goroutine, so capture never blocks in
// WaitForVBlank: up to three refresh periods on a lit output, and an unknown
// time while a driver changes power state. Until the first probe completes
// the output counts as dark, which keeps the previous GDI polling.
type outputMonitor struct {
	dark atomic.Bool
	stop chan struct{}
}

func startOutputMonitor(output unsafe.Pointer) *outputMonitor {
	m := &outputMonitor{stop: make(chan struct{})}
	m.dark.Store(true)
	comCall(output, vtAddRef) // released by the probe goroutine when it exits
	go func() {
		defer comRelease(output)
		ticker := time.NewTicker(scanProbeInterval)
		defer ticker.Stop()
		for {
			m.dark.Store(!outputScanning(output))
			select {
			case <-m.stop:
				return
			case <-ticker.C:
			}
		}
	}()
	return m
}

// close does not wait for a probe in progress; its goroutine owns the output
// reference and releases it after that probe returns.
func (m *outputMonitor) close() { close(m.stop) }

func (d *duplicator) close() {
	if d.monitor != nil {
		d.monitor.close()
		d.monitor = nil
	}
	comRelease(d.staging)
	comRelease(d.duplication)
	comRelease(d.context)
	comRelease(d.device)
	comRelease(d.output)
	d.staging, d.duplication, d.context, d.device, d.output = nil, nil, nil, nil, nil
}

// A 1080p frame is about 8 MB. Split the swizzle across a few cores so the
// readback does not become the new serial bottleneck; small frames stay inline.
func convertDesktopRows(destination *image.RGBA, source []byte, pitch, sourceW, sourceH int) {
	w, h := destination.Rect.Dx(), destination.Rect.Dy()
	var columns []int
	if w != sourceW {
		columns = make([]int, w)
		for x := range columns {
			columns[x] = x * sourceW / w * 4
		}
	}
	rows := func(from, to int) {
		for y := from; y < to; y++ {
			sourceY := y
			if h != sourceH {
				sourceY = y * sourceH / h
			}
			src := source[sourceY*pitch:]
			dst := destination.Pix[y*destination.Stride : y*destination.Stride+w*4]
			if columns == nil {
				swizzleBGRARow(dst, src[:w*4])
				continue
			}
			for x, offset := range columns {
				i := x * 4
				dst[i], dst[i+1], dst[i+2], dst[i+3] = src[offset+2], src[offset+1], src[offset], 255
			}
		}
	}
	// Half the logical CPUs (at most eight) leaves room for the tile encoder
	// of the previous frame, input and audio while this short burst runs.
	workers := min(8, max(1, runtime.GOMAXPROCS(0)/2), max(1, w*h/(512*512)))
	if workers <= 1 {
		rows(0, h)
		return
	}
	// Workers claim small row chunks instead of equal bands: on hybrid CPUs a
	// band that lands on an efficiency core finishes several times later and
	// the whole capture waits for it.
	const chunk = 32
	chunks := (h + chunk - 1) / chunk
	var next atomic.Int32
	claim := func() {
		for {
			i := int(next.Add(1)) - 1
			if i >= chunks {
				return
			}
			rows(i*chunk, min(h, (i+1)*chunk))
		}
	}
	var wg sync.WaitGroup
	for range workers - 1 {
		wg.Add(1)
		go func() { defer wg.Done(); claim() }()
	}
	claim()
	wg.Wait()
}

func swizzleBGRARow(dst, src []byte) {
	i := 0
	for ; i+8 <= len(dst); i += 8 {
		v := binary.LittleEndian.Uint64(src[i : i+8])
		v = (v&0x000000ff000000ff)<<16 | (v&0x00ff000000ff0000)>>16 | v&0x0000ff000000ff00 | 0xff000000ff000000
		binary.LittleEndian.PutUint64(dst[i:i+8], v)
	}
	if i < len(dst) {
		dst[i], dst[i+1], dst[i+2], dst[i+3] = src[i+2], src[i+1], src[i], 255
	}
}

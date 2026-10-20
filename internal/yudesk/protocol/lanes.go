package protocol

import (
	"context"
	"errors"
	"net"
	"sync"
	"time"

	"welink/internal/yudesk/mediabudget"
)

// Each lane has its own encrypted transport, writer and bounded receive queue.
// In particular, a partially received frame cannot hold input or sound hostage.
// EnableLanes runs only after mutual authorization, before application readers.
type messageLanes struct {
	owner, input, audio *Conn
	ctx                 context.Context
	cancel              context.CancelFunc
	once                sync.Once
	wg                  sync.WaitGroup
	queues              [3]chan Message
	mu                  sync.Mutex
	err                 error
	responses           map[string]*Conn
	burst               int // owned by the single application reader
	turn                int
}

type audioEventConsumer struct {
	consume func(Message) bool
}

// SetAudioEventHandler offers validated events on the independent audio lane
// directly to its bounded consumer. Returning false preserves normal routing.
// The handler must not retain borrowed data, perform network I/O, or call
// ReadMessage/Close. Requests and responses always retain their normal path.
func (c *Conn) SetAudioEventHandler(consume func(Message) bool) {
	if consume == nil {
		c.audioEvents.Store(nil)
		return
	}
	c.audioEvents.Store(&audioEventConsumer{consume: consume})
}

func (c *Conn) EnableLanes(input, audio net.Conn) error {
	if input == nil || audio == nil || c.lanes.Load() != nil {
		return errors.New("invalid session lanes")
	}
	ctx, cancel := context.WithCancel(context.Background())
	l := &messageLanes{owner: c, input: NewConn(input), audio: NewConn(audio), ctx: ctx, cancel: cancel, responses: make(map[string]*Conn)}
	for _, side := range []*Conn{l.input, l.audio} {
		side.readDataLimit = 64 << 10
		side.readHeaderLimit = 64 << 10
	}
	l.queues = [3]chan Message{make(chan Message, 1), make(chan Message, 8), make(chan Message, 2)}
	l.wg.Add(3)
	if !c.lanes.CompareAndSwap(nil, l) {
		cancel()
		return errors.New("session lanes already configured")
	}
	for index, connection := range []*Conn{c, l.input, l.audio} {
		go l.pump(index, connection)
	}
	return nil
}

func (c *Conn) HasLanes() bool { return c.lanes.Load() != nil }

func messageLane(m Message) int {
	if len(m.Data) > 64<<10 {
		return 0
	}
	switch m.Method {
	case "input", "input_release", "input_ok", "input_error", "cursor", "info", "ping", "frame_ack", "video_ack", "video_refresh", "stream_start", "stream_stop", "session_ended", "session_end_ack":
		return 1
	case "voice_opus", "voice_state", "audio", "audio_opus", "audio_start", "audio_stop", "audio_state", "audio_error":
		return 2
	}
	return 0
}

func (l *messageLanes) end(err error) {
	l.once.Do(func() {
		l.mu.Lock()
		l.err = err
		l.mu.Unlock()
		l.cancel()
		_ = l.owner.Conn.SetDeadline(time.Now())
		_ = l.input.SetDeadline(time.Now())
		_ = l.audio.SetDeadline(time.Now())
		// Never join a reader from that reader's own failure path.
		_ = l.owner.Conn.Close()
		_ = l.input.Close()
		_ = l.audio.Close()
	})
}

func (l *messageLanes) pump(index int, c *Conn) {
	defer l.wg.Done()
	if index == 1 {
		leave := mediabudget.InteractiveWorker()
		defer leave()
	}
	if index == 2 {
		leave := mediabudget.AudioWorker()
		defer leave()
	}
	for {
		m, err := c.readMessage()
		if err != nil {
			l.end(err)
			return
		}
		if index != 0 && (len(m.Data) > 64<<10 || len(m.Params) > 64<<10 || m.Kind != "response" && messageLane(m) != index) {
			l.end(errors.New("invalid session lane message"))
			return
		}
		if index != 0 && m.Kind == "request" && m.ID != "" {
			l.mu.Lock()
			if len(l.responses) >= 128 {
				l.mu.Unlock()
				l.end(errors.New("session lane request limit"))
				return
			}
			if _, exists := l.responses[m.ID]; exists {
				l.mu.Unlock()
				l.end(errors.New("duplicate session lane request"))
				return
			}
			l.responses[m.ID] = c
			l.mu.Unlock()
		}
		if index == 2 {
			handler := l.owner.audioEvents.Load()
			if m.Kind == "event" && handler != nil && handler.consume(m) {
				continue
			}
		}
		select {
		case l.queues[index] <- m:
		case <-l.ctx.Done():
			return
		}
	}
}

func (l *messageLanes) destination(m Message) *Conn {
	if m.Kind == "response" && m.ID != "" {
		l.mu.Lock()
		c := l.responses[m.ID]
		delete(l.responses, m.ID)
		l.mu.Unlock()
		if c != nil {
			return c
		}
	}
	switch messageLane(m) {
	case 1:
		return l.input
	case 2:
		return l.audio
	}
	return nil
}

func (l *messageLanes) read() (Message, error) {
	for {
		if l.ctx.Err() != nil {
			l.mu.Lock()
			err := l.err
			l.mu.Unlock()
			return Message{}, err
		}
		// Prefer timely input/audio, but retire at least one queued frame after
		// a bounded burst. Ordering within each lane is never changed.
		if l.burst >= 16 {
			select {
			case m := <-l.queues[0]:
				l.burst = 0
				return m, nil
			default:
			}
		}
		for step := 0; step < 2; step++ {
			index := 1 + (l.turn+step)%2
			select {
			case m := <-l.queues[index]:
				l.turn = index % 2
				l.burst++
				return m, nil
			default:
			}
		}
		select {
		case m := <-l.queues[1]:
			l.turn = 1
			l.burst++
			return m, nil
		case m := <-l.queues[2]:
			l.turn = 0
			l.burst++
			return m, nil
		case m := <-l.queues[0]:
			l.burst = 0
			return m, nil
		case <-l.ctx.Done():
		}
	}
}

func (c *Conn) Close() error {
	if l := c.lanes.Load(); l != nil {
		l.end(net.ErrClosed)
		l.wg.Wait()
		return nil
	}
	return c.Conn.Close()
}

func (c *Conn) SetDeadline(t time.Time) error {
	if err := c.Conn.SetDeadline(t); err != nil {
		return err
	}
	if l := c.lanes.Load(); l != nil {
		if err := l.input.SetDeadline(t); err != nil {
			return err
		}
		return l.audio.SetDeadline(t)
	}
	return nil
}

func (c *Conn) SetReadDeadline(t time.Time) error {
	if err := c.Conn.SetReadDeadline(t); err != nil {
		return err
	}
	if l := c.lanes.Load(); l != nil {
		if err := l.input.SetReadDeadline(t); err != nil {
			return err
		}
		return l.audio.SetReadDeadline(t)
	}
	return nil
}

func (c *Conn) SetWriteDeadline(t time.Time) error {
	if err := c.Conn.SetWriteDeadline(t); err != nil {
		return err
	}
	if l := c.lanes.Load(); l != nil {
		if err := l.input.SetWriteDeadline(t); err != nil {
			return err
		}
		return l.audio.SetWriteDeadline(t)
	}
	return nil
}

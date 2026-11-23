# Pion SCTP v1.11.1 (patched)

Unmodified copy of `github.com/pion/sctp` v1.11.1 (MIT, see `LICENSE`)
without its examples and tests, plus the changes below. Every changed line in
`association.go` ends with a `YZDESK` comment and calls into `yzdesk.go`,
which holds all new code; `yzdesk_patch_test.go` and `yzdesk_thin_test.go`
test it
(`cd third_party/sctp && go test .`, run in CI). The pristine copy is its own
commit (0e2e9239), so `git diff 0e2e9239 -- third_party/sctp` shows the patch.

All peers of a YzDesk P2P session run Pion SCTP v1.11.1 (desktop 2.3.0 and
later, Android, iOS). The changes are sender-side only and the wire format is
RFC 4960/7053: an older peer receives, acknowledges and retransmits exactly as
before, and a patched sender talking to it behaves as described here.

## Immediate SACK on the last chunk of every batch (RFC 7053)

`popPendingDataChunksToSend`, `getDataPacketsToRetransmit` (via
`bundleRetransmissions`) and `gatherOutboundFastRetransmissionPackets` set the
DATA chunk's I bit (`markImmediateSack`) on the last chunk of each batch the
write loop sends: whether the batch ends because nothing else is pending, or
because the congestion window, the peer's receive window or tail-loss
recovery's burst budget stops it, and on every batch of retransmissions.

A Pion receiver acknowledges every second packet at once and a lone packet
only when its 200 ms delayed-ACK timer fires; it already honours the I bit.
Upstream never sets it, so the last packet of a burst (the tail of a frame, an
input event, a frame acknowledgement) held the sender's queue and window for
200 ms, the smoothed RTT jumped by about 25 ms per such sample (which bulk
admission read as a queue), and after loss recovery the acknowledgement that
ends recovery waited for the timer as well. On a 40 ms virtual path a lone
message was acknowledged after about 245 ms with a smoothed RTT of 248 ms;
with the bit after 44 ms with 43 ms.

## Tail-loss probe timeout

`onRackAfterSACK` and `schedulePTOAfterSendLocked` compute RACK's probe
timeout through `probeTimeout`:

- a sole outstanding chunk that carries the I bit gets no delayed-ACK
  allowance (`soleInflightAsksImmediateSack`): 2 x SRTT + 2 ms instead of
  + 200 ms, so a lost lone input event is probed after about 82 ms on a 40 ms
  path instead of about 280 ms;
- the timeout is at least SRTT + 4 x RTTVAR and at least 10 ms (`ptoFloor`,
  Linux's TLP floor). On a LAN 2 x SRTT + 2 ms is a few milliseconds, shorter
  than a Wi-Fi power-save wake-up or a garbage-collection pause at the
  receiver: with acknowledgements stalled 8 ms every fourth packet, 12-14 of
  60 never-lost messages were probed spuriously (each entering tail-loss
  recovery's burst limit and inflating RACK's reordering window), 0-1 with
  the floor.

The probe and the T3 retransmission timer are independent, as upstream:
whichever expires first acts.

## Retransmission timeout under a sub-second RTO.Max

`internal/peerpath` caps the T3 timeout (RTO.Max) at 400 ms. Upstream's
RTO.Min is RFC 4960's one second, so every timeout was then 400 ms however
short the path, and it doubled (to the same cap). A timeout acts when a
lost packet's fast retransmission or tail-loss probe was lost as well (a
burst, a path that broke for a moment); on the direct path's video lane a
fragment that waited 400 ms missed the viewer's deadline and cost a
keyframe. When an association's RTO.Max is below one second
(`subSecondRTO`; associations without such a cap keep upstream's behaviour):

- RTO.Min is three smoothed round trips and at least 100 ms (`minRTO` in
  `rtoManager.setNewRTT`); SRTT + 4 x RTTVAR still applies above it;
- the T3 timer does not back off (`flatBackoff`): a path that returns after
  an outage is found within one timeout, not a doubled one;
- a T3 timeout resends one packet until the next SACK (`rtoProbeWindow`),
  as RFC 4960's cwnd of one MTU does. Upstream's congestion window floor
  (`WithMinCwnd`) instead resent up to the floor's 64 KB of what was in
  flight on every timeout: into a dead path or, when the timeout was
  spurious, as duplicates ahead of new data. The SACK that answers the probe
  shows what is missing, and the floor applies again.

`internal/peerpath`'s `TestLossSpikeReport` measures the effect (screen age
spike on the video lane at 20 ms RTT and 3 % loss: 534 ms before, 179 ms
after).

## Slow start after a loss

On fast retransmit and on a retransmission timeout, `ssthresh` is
`lossSSThresh()`: RFC 4960's `max(cwnd/2, 4*MTU)`, but not below twice the
configured minimum congestion window (`WithMinCwnd`; unchanged when it is 0).
Fast retransmit sets `cwnd` to `max(cwnd/2, 4*MTU)` as before (the floor still
applies); only the threshold is decoupled.

YzDesk sets a 64 KB floor (`internal/peerpath`). Upstream then halved
`ssthresh` below the floor on the first loss while `cwnd` stayed at the floor,
so the window stayed in congestion avoidance for the rest of the session
(one MTU per window of acknowledged bytes, and only while cwnd-limited): a
150 KB page change took a round trip per 64 KB. With the bound the window may
slow-start from the floor again.

A slow-start step (`onCumulativeTSNAckPointAdvanced`) ends at most one MTU
above `ssthresh`. Upstream grew `cwnd` by up to its own size per SACK, so one
step could overshoot `ssthresh` up to twice it; now the window reaches
`ssthresh + MTU` and continues in congestion avoidance. Bulk admission in
`internal/peerpath` still bounds the picture lane's flight to the measured
bandwidth-delay product.

## Thin streams: repeating what is not yet acknowledged

A thin stream carries short interactive messages with pauses between them,
far below what the congestion window allows: in YzDesk the input lane
(pointer, clicks, keys, frame acknowledgements, heartbeats). Its losses are
the ones a user sees. A lost message that nothing follows waits for a timer:
the tail-loss probe after two round trips, or the retransmission timeout
(400 ms on a long path). A lost message in a run holds every later one back,
because the stream is ordered, until the retransmission a round trip and a
reordering window later.

An association whose `LoggerFactory` also implements `ThinStreamsConfig`
(`SCTPThinStreams() []uint16`) treats the streams it names as thin; the
factory is the one per-association value an unforked `pion/webrtc` passes
through. `internal/peerpath` names the input lane's stream when both peers
negotiated `inputFastV1` (`inputfast.go`). Without such a factory
`Association.thin` is nil and every line below is skipped.

For single-chunk messages of at most 1024 bytes on an ordered, reliable thin
stream the sender repeats what is not yet acknowledged, before any loss is
known (`bundleNewData`, `gatherThinTail`, `onThinTimer` in `yzdesk.go`):

- **Redundant bundling.** The packet of a new message also carries copies of
  earlier unacknowledged messages of the thin streams, ahead of the new
  chunk. Every message rides along twice: with the next message (first
  copy), and with the first message sent 30 ms or more after it (second
  copy, until 90 ms). The first copy repairs a lost packet with the next
  one, 8-16 ms later while a pointer moves; the second repairs what a short
  burst took together with the first. A steady run carries two copies a
  packet, three when several messages come due together (a click between two
  moves). A run with less than 4 ms between messages (above 250 a second)
  sends first copies only.
- **Eager tail copies.** When no new message follows, the most recent
  unacknowledged messages (at most three, one packet) are sent again 12 ms
  after the last one, then 40, 100 and 220 ms after it, each time only if
  they are still unacknowledged. Inside a run (less than 40 ms between
  messages) the first tail copy waits one and a half spacings, at most
  36 ms, and the second at least 24 ms more: the next message normally
  comes first and carries the copy, so a 60 Hz run sends no tail packets.
- **Bounds.** A copy never makes a packet exceed the MTU or the congestion
  window. Copies spend at most 64 KB a second after an 8 KB burst, first
  copies before second ones; tail copies may overdraw that by 8 KB, so a
  click's tail is never starved by the run before it. Nothing is repeated
  while more than 4 KB of other data is in flight (`thinQuiet`): a picture
  frame or a file makes the association not thin for the moment, its
  packets follow the thin stream's and show a loss within a round trip, and
  the copies would add to a load that may already fill the path.
- **Pacing by the path.** The copies that ride along are bytes the
  congestion window does not see, and its floor (64 KB in YzDesk) is far
  above what a slow uplink carries, so the thin messages' own round trips
  pace them (`thinAcked`, `thinDelayed`, `refill`). When the last eight
  acknowledgements of thin messages, all within a second, took more than
  max(a quarter of the minimum round trip, 10 ms) longer than that minimum,
  the path shows a queue: nothing rides along while it does, and each time
  it starts to, the rate and the burst of the copies halve (down to one
  sixteenth). A few late acknowledgements, as after a loss that copies
  repaired, do not count. While copies go out without a queue the rate
  grows: doubling every second from a quarter of the full rate at the start
  of a session until the path first shows a queue, by a tenth of the full
  rate a second after that. Tail copies, a few packets after a pause, do
  not wait for this.

On a path whose acknowledgements return before the next message or the first
tail delay (a LAN) nothing is ever repeated.

A copy is the same chunk with the same TSN. The receiver drops what it
already has (`receivePayloadQueue.canPush`), so delivery stays exactly once
and in order as for any retransmission, and the receiving side needs no
change: any SCTP peer of any version accepts the copies. On the sender a
copy is not a transmission: `nSent`, `since`, the congestion window and RACK's
list are untouched, and if every copy is lost the probe and the timers act as
before.

Two things keep the sender's estimates honest:

- Round-trip samples: a copied chunk still gives its sample, counted from
  the original transmission. Karn's rule (no sample from a chunk sent more
  than once) would leave the sender of a thin stream, where nearly every
  chunk is copied before its acknowledgement can arrive, without a single
  sample, and its timers with a round trip that no longer follows the path
  (`TestThinSenderKeepsMeasuringTheRoundTrip`). When the original was lost
  and a copy was acknowledged the sample is too long by the copy's delay:
  never too short, so no timer fires early because of it, and as rare as
  the loss itself.
- `rackSendTimeCounts`: RFC 8985 section 7.2 step 2 does not let a
  retransmitted segment advance RACK's "most recently sent segment that was
  delivered" when its acknowledgement arrived sooner after the
  retransmission than the minimum round trip. Upstream has no such check.
  On a thin stream a copy regularly arrives just after RACK retransmitted
  the chunk (a burst took the original and the first copy, the second copy
  fills the gap); RACK then believed that something sent a moment ago had
  been delivered, declared the whole flight lost, retransmitted it, and the
  originals' acknowledgements repeated the mistake: about 170 spurious
  retransmissions after every 30 ms outage of a 125 Hz pointer. The check
  applies on associations with thin streams; the others keep upstream's
  behaviour.

Measured in `yzdesk_thin_test.go` with two associations over an in-memory
link in `testing/synctest`'s virtual time (exact and repeatable;
`YZDESK_SCTP_THIN_REPORT=1 go test -run TestThinReport -v .` prints all of
it). Delivery time of a message, 200-byte messages, loss in both directions:

| Scenario | plain | thin stream |
| --- | --- | --- |
| lost click (its packet is the last), 40 ms path | 102 ms | 32 ms |
| lost click, 300 ms path | 650-845 ms | 162 ms |
| 125 Hz pointer, 40 ms, 3 % loss: p95 / p99 / max | 68 / 76-124 / 174-228 ms | 20 / 28 / 52 ms |
| 125 Hz pointer, 120 ms, 3 % loss: p95 / p99 / max | 204 / 477-500 / 684 ms | 60 / 68 / 92 ms |
| 60 Hz pointer, 40 ms, 5 % loss: p95 / p99 / max | 77 / 101 / 179 ms | 20 / 37 / 110 ms |
| 125 Hz pointer, 40 ms, 30 ms outage every 2 s: p99 / max | 88 / 92 ms | 52 / 56 ms |
| 125 Hz pointer, 120 ms, 30 ms outage every 2 s: p99 / max | 212 / 216 ms | 92 / 96 ms |

The price is bytes, not packets: the 125 Hz pointer's SCTP packets grow from
30 to 86 KB/s (60 Hz: 15 to 44 KB/s) at the same 128 packets a second; an
idle stream with one 40-byte heartbeat a second sends 1.0 packets a second
on a 4 ms path as before, 2.4 on a 40 ms path and 5.0 on a 300 ms path (72,
173 and 376 bytes a second). On an uplink that carries the pointer but not
its copies (384 kbit/s for 125 Hz) the pacing keeps a message at 29 ms
(median; p99 40 ms, the plain stream 25 ms) with a quarter of the copies
still going out (`TestThinCopiesDoNotFillASlowUplink`); the congestion
window alone would let them queue up to its 64 KB, more than a second of
such a link.

## Module file

`go.mod` requires the versions of `github.com/pion/transport/v4` (v4.1.0) and
its dependencies that the application builds with (the main and mobile
modules select them anyway), drops upstream's test-only requirements, as
upstream's tests are not vendored, and replaces `github.com/wlynxg/anet` with
YzDesk's patched copy, as the application does (a dependency's replace
directives do not apply to the application). `go test`, `go vet` and
`go mod verify` then work here with `-mod=readonly` from the application's
module cache alone; `go list -m all` walks test-only modules of the
dependencies that the application never downloads and needs the network once.

`github.com/stretchr/objx` stays out of `go.mod` (only testify's mock package
uses it). Every module listed here is in `go list -m all` of `mobile/`, and
`gomobile bind` makes each of those a direct requirement of the module it
generates; its `go mod tidy` then has to read that module's `go.mod`. objx
v0.5.3 was in no offline module cache of the iOS build, so the iOS packaging
failed with `GOPROXY=off`; without the line `mobile/` no longer lists objx.

To update Pion SCTP, copy the new release here the same way, reapply the
`YZDESK` lines, keep `yzdesk.go` and the two test files, and run the tests
here and in `internal/peerpath` (`TestLoneMessageAcknowledgedPromptly`,
`TestTailLossProbeIgnoresReceiverStalls`, `TestSCTPRecoveryTraceFormatsExist`,
`TestPionSCTPIsTheVendoredFork`, `TestInputFastLane*`).

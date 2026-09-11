package cn.welink.app;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class MicrophoneInputTest {
    public static void main(String[] args) throws Exception {
        FakeDevice device = new FakeDevice();
        MicrophoneInput input = new MicrophoneInput(device);
        check(input.level(10) == 0 && device.starts == 0, "disabled entry never captures");
        input.setEnabled(true);
        input.setEnabled(true);
        check(device.starts == 1 && device.running && !device.muted, "one capture request without any peer");
        check(input.level(10) == 0, "no synthetic wave before PCM arrives");
        input.samples(pcm(4096), 100);
        float quiet = input.level(100);
        input.samples(pcm(16384), 110);
        check(quiet > 0 && input.level(110) > quiet, "real PCM amplitude drives level");
        for (int i = 0; i < 24; i++) input.level(1000 + i * 100);
        check(input.level(4000) == 0, "stalled capture decays to zero");
        input.samples(pcm(8192), 4010);
        check(input.level(4010) > 0, "new samples restore meter");
        input.setEnabled(false);
        input.samples(pcm(32767), 4020);
        check(input.level(4020) == 0 && !device.running && device.muted, "mute discards late audio");
        input.setEnabled(true);
        check(input.level(4030) == 0, "unmute does not reuse pre-mute audio");
        input.samples(new byte[960], 4040);
        check(input.level(4040) == 0, "captured silence stays flat");
        input.close();
        int starts = device.starts, stops = device.stops;
        input.close();input.setEnabled(true);input.samples(pcm(32767), 5000);
        check(!input.enabled() && input.level(5000) == 0 && starts == device.starts && stops == device.stops,
                "closed meeting cannot restart capture or display queued samples");

        device = new FakeDevice();input = new MicrophoneInput(device);
        device.failStart = true;
        try { input.setEnabled(true); throw new AssertionError("expected start failure"); }
        catch (IllegalStateException expected) { }
        check(!input.enabled() && !device.running && device.muted && device.stops == 1,
                "partial capture startup is stopped on failure");
        device.failStart = false;input.setEnabled(true);input.samples(pcm(4096), 1);
        check(input.level(1) > 0, "capture can retry after startup failure");
        device.failMute = true;
        try { input.close(); throw new AssertionError("expected mute failure"); }
        catch (IllegalStateException expected) { }
        check(!device.running && !input.enabled(), "close still stops capture if muting fails");
        closeDoesNotBlockSamples();
        System.out.println("PASS: solo capture lifecycle, actual PCM, stale samples, mute/retry, close and audio-thread join");
    }

    static void closeDoesNotBlockSamples() throws Exception {
        CountDownLatch stopStarted = new CountDownLatch(1), sampleFinished = new CountDownLatch(1);
        AtomicReference<MicrophoneInput> reference = new AtomicReference<>();
        AtomicReference<Throwable> audioFailure = new AtomicReference<>();
        MicrophoneInput input = new MicrophoneInput(new MicrophoneInput.Device() {
            public void mute(boolean muted) { }
            public void start() { }
            public void stop() {
                stopStarted.countDown();
                try { check(sampleFinished.await(2, TimeUnit.SECONDS), "stop must not hold the sample lock"); }
                catch (InterruptedException error) { throw new AssertionError(error); }
            }
        });
        reference.set(input);input.setEnabled(true);
        Thread audio = new Thread(() -> {
            try {
                check(stopStarted.await(2, TimeUnit.SECONDS), "close reaches device stop");
                reference.get().samples(pcm(4096), 1);
            } catch (Throwable error) { audioFailure.set(error); }
            finally { sampleFinished.countDown(); }
        });
        audio.start();input.close();audio.join(2500);
        if (audioFailure.get() != null) throw new AssertionError("audio callback failed", audioFailure.get());
        check(!audio.isAlive() && input.level(1) == 0, "closing joins audio thread without stale meter");
    }

    static byte[] pcm(int value) { byte[] bytes = new byte[960];for (int i = 0; i < bytes.length; i += 2) { bytes[i] = (byte)value;bytes[i+1] = (byte)(value >> 8); }return bytes; }
    static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    static final class FakeDevice implements MicrophoneInput.Device {
        int starts, stops;boolean running, muted, failStart, failMute;
        public void mute(boolean value) { if (failMute) throw new IllegalStateException("device mute unavailable");muted = value; }
        public void start() { starts++;running = true;if (failStart) throw new IllegalStateException("device busy"); }
        public void stop() { stops++;running = false; }
    }
}

package cn.welink.app;

/** Owns the local capture request and meters only PCM received while enabled. */
final class MicrophoneInput implements AutoCloseable {
    interface Device {
        void mute(boolean muted);
        void start();
        void stop();
    }

    private final Device device;
    private boolean enabled, closed;
    private float captured, displayed;
    private long sampleTime = -1;

    MicrophoneInput(Device device) { this.device = device; }

    // Control methods run on the meeting thread; samples arrive on the audio thread.
    void setEnabled(boolean value) {
        synchronized (this) {
            if (closed || enabled == value) return;
            enabled = value;
            clearLevel();
        }
        try {
            device.mute(!value);
            if (value) device.start(); else device.stop();
        } catch (RuntimeException | LinkageError failure) {
            synchronized (this) { enabled = false; clearLevel(); }
            stopAfterFailure(failure);
            throw failure;
        }
    }

    synchronized void samples(byte[] pcm, long now) {
        if (!enabled || closed) return;
        captured = MicrophoneLevel.pcm16(pcm);
        sampleTime = now;
    }

    synchronized float level(long now) {
        if (!enabled || closed) return 0;
        float current = sampleTime >= 0 && now >= sampleTime && now - sampleTime < 500 ? captured : 0;
        displayed = Math.max(current, displayed * .65f);
        if (displayed < .001f) displayed = 0;
        return displayed;
    }

    synchronized boolean enabled() { return enabled && !closed; }

    @Override public void close() {
        synchronized (this) {
            if (closed) return;
            closed = true;
            enabled = false;
            clearLevel();
        }
        // Never hold the sample lock while stopping: the device joins its audio thread.
        try { device.mute(true); } finally { device.stop(); }
    }

    private void clearLevel() { captured = displayed = 0; sampleTime = -1; }
    private void stopAfterFailure(Throwable failure) {
        try { device.mute(true); } catch (RuntimeException | LinkageError cleanup) { failure.addSuppressed(cleanup); }
        try { device.stop(); } catch (RuntimeException | LinkageError cleanup) { failure.addSuppressed(cleanup); }
    }
}

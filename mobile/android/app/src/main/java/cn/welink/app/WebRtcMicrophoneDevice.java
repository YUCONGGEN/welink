package cn.welink.app;

import org.webrtc.audio.JavaAudioDeviceModule;

/** Uses the meeting ADM's existing AudioRecord, including before a peer connects. */
final class WebRtcMicrophoneDevice implements MicrophoneInput.Device {
    private final JavaAudioDeviceModule device;
    WebRtcMicrophoneDevice(JavaAudioDeviceModule device) { this.device = device; }
    @Override public void mute(boolean muted) { device.setMicrophoneMute(muted); }
    @Override public void start() {
        device.setAudioRecordEnabled(true);
        device.requestStartRecording();
    }
    @Override public void stop() { device.requestStopRecording(); }
}

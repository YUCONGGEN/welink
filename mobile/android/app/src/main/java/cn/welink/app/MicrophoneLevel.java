package cn.welink.app;

/** RMS of the existing capture stream; no second microphone or recording. */
final class MicrophoneLevel {
    static float pcm16(byte[] bytes) {
        int count=bytes.length/2;if(count==0)return 0;
        double energy=0;
        for(int i=0;i+1<bytes.length;i+=2){int sample=(short)((bytes[i]&255)|(bytes[i+1]<<8));double value=sample/32768.0;energy+=value*value;}
        double rms=Math.sqrt(energy/count);
        return (float)Math.max(0,Math.min(1,(20*Math.log10(Math.max(rms,0.000001))+60)/60));
    }
}

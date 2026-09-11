package cn.welink.app;
public final class MicrophoneLevelTest {
    public static void main(String[] args){
        check(MicrophoneLevel.pcm16(new byte[0])==0,"empty buffer");
        check(MicrophoneLevel.pcm16(new byte[960])==0,"silence");
        check(level(128)>0&&level(128)<level(4096)&&level(4096)<level(16384),"level follows actual amplitude");
        check(Math.abs(level(-4096)-level(4096))<.0001f,"signed PCM symmetry");
        check(level(-32768)==1,"full negative amplitude does not overflow");
        check(Float.isFinite(MicrophoneLevel.pcm16(new byte[]{1,0,7})),"partial final sample");
        System.out.println("PASS: microphone PCM silence, signed amplitude, monotonic levels and partial samples");
    }
    static float level(int sample){byte[] bytes=new byte[960];for(int i=0;i<bytes.length;i+=2){bytes[i]=(byte)sample;bytes[i+1]=(byte)(sample>>8);}return MicrophoneLevel.pcm16(bytes);}
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
}

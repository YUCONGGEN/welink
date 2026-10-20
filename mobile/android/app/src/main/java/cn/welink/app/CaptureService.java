package cn.welink.app;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.graphics.*;
import android.hardware.display.*;
import android.media.*;
import android.media.projection.*;
import android.os.*;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import cn.welink.bridge.core.Engine;

public final class CaptureService extends Service {
    private static final String CHANNEL="welink-sharing",STOP="cn.welink.STOP_SHARING";
    private final Handler main=new Handler(Looper.getMainLooper());
    private HandlerThread worker;
    private Handler capture;
    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private Engine engine;
    private Bitmap padded,frame;
    private final Canvas canvas=new Canvas();
    private final Paint paint=new Paint(Paint.FILTER_BITMAP_FLAG);
    private final ByteArrayOutputStream jpeg=new ByteArrayOutputStream(256*1024);
    private final CapturePacer pacer=new CapturePacer(66);
    private volatile boolean stopping;
    private boolean registered;
    private int width,height,density;
    private final Runnable latest=()->{pacer.begin();if(reader!=null&&!stopping)image(reader);};
    private final BroadcastReceiver screenOff=new BroadcastReceiver(){@Override public void onReceive(Context c,Intent i){stopSelf();}};
    private final DisplayManager.DisplayListener changes=new DisplayManager.DisplayListener(){public void onDisplayAdded(int id){}public void onDisplayRemoved(int id){}public void onDisplayChanged(int id){if(Build.VERSION.SDK_INT<34&&capture!=null){DisplayMetrics m=metrics();capture.post(()->resize(m.widthPixels,m.heightPixels));}}};
    private WeLinkApp app(){return (WeLinkApp)getApplication();}
    @Override public void onCreate(){super.onCreate();getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL,"屏幕共享",NotificationManager.IMPORTANCE_LOW));}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null||STOP.equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}if(projection!=null)return START_NOT_STICKY;
        PendingIntent open=PendingIntent.getActivity(this,1,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop=PendingIntent.getService(this,2,new Intent(this,CaptureService.class).setAction(STOP),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notice=new Notification.Builder(this,CHANNEL).setSmallIcon(R.drawable.ic_notification).setContentTitle("LinkMe · 屏幕共享中").setContentText("已同意的好友可以查看屏幕，随时停止共享。").setOngoing(true).setContentIntent(open).addAction(new Notification.Action.Builder(null,"停止共享",stop).build()).build();
        if(Build.VERSION.SDK_INT>=29)startForeground(101,notice,ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);else startForeground(101,notice);
        Intent result=Build.VERSION.SDK_INT>=33?intent.getParcelableExtra("projection",Intent.class):intent.getParcelableExtra("projection");
        if(intent.getIntExtra("result",Activity.RESULT_CANCELED)!=Activity.RESULT_OK||result==null){stopSelf();return START_NOT_STICKY;}
        try{engine=app().engine();engine.setAccessibility(RemoteAccessibilityService.available());worker=new HandlerThread("LinkMe-screen",android.os.Process.THREAD_PRIORITY_DISPLAY);worker.start();capture=new Handler(worker.getLooper());projection=getSystemService(MediaProjectionManager.class).getMediaProjection(Activity.RESULT_OK,result);
            projection.registerCallback(new MediaProjection.Callback(){@Override public void onStop(){main.post(()->stopSelf());}@Override public void onCapturedContentResize(int w,int h){resize(w,h);}},capture);
            DisplayMetrics m=metrics();density=m.densityDpi;capture.post(()->{try{configure(m.widthPixels,m.heightPixels);display=projection.createVirtualDisplay("LinkMe authorized sharing",width,height,density,DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,reader.getSurface(),null,capture);engine.setSharing(true);app().sharing=true;}catch(Exception e){fail(e.getMessage());}});
            getSystemService(DisplayManager.class).registerDisplayListener(changes,capture);if(Build.VERSION.SDK_INT>=33)registerReceiver(screenOff,new IntentFilter(Intent.ACTION_SCREEN_OFF),Context.RECEIVER_NOT_EXPORTED);else registerReceiver(screenOff,new IntentFilter(Intent.ACTION_SCREEN_OFF));registered=true;
            new Thread(()->{while(!stopping){String input=engine.nextInput(500);if(input.isEmpty())continue;CountDownLatch done=new CountDownLatch(1);main.post(()->{try{if(!stopping)RemoteAccessibilityService.receive(input);}finally{done.countDown();}});try{while(!stopping&&!done.await(500,TimeUnit.MILLISECONDS)){} }catch(InterruptedException e){return;}}},"LinkMe-input").start();
        }catch(Exception e){fail(e.getMessage());}return START_NOT_STICKY;
    }
    private DisplayMetrics metrics(){DisplayMetrics m=new DisplayMetrics();((WindowManager)getSystemService(WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(m);return m;}
    private void configure(int w,int h){float scale=Math.min(1f,1280f/Math.max(w,h));width=Math.max(2,Math.round(w*scale));height=Math.max(2,Math.round(h*scale));reader=ImageReader.newInstance(width,height,PixelFormat.RGBA_8888,2);reader.setOnImageAvailableListener(source->{if(source!=reader||stopping)return;long delay=pacer.schedule(SystemClock.elapsedRealtime());if(delay>=0)capture.postDelayed(latest,delay);},capture);}
    private void resize(int w,int h){if(stopping||display==null||w<1||h<1)return;float scale=Math.min(1f,1280f/Math.max(w,h));if(Math.round(w*scale)==width&&Math.round(h*scale)==height)return;try{capture.removeCallbacks(latest);pacer.reset();display.setSurface(null);reader.close();configure(w,h);display.resize(width,height,density);display.setSurface(reader.getSurface());recycle();}catch(Exception e){fail("屏幕尺寸改变，请重新授权共享");}}
    private void image(ImageReader source){if(source!=reader||stopping)return;try(Image image=source.acquireLatestImage()){if(image==null||engine==null||!engine.wantsFrame())return;pacer.captured(SystemClock.elapsedRealtime());Image.Plane plane=image.getPlanes()[0];int row=plane.getRowStride();if(plane.getPixelStride()!=4||row%4!=0)throw new IllegalStateException("不支持的屏幕格式");int pw=row/4;if(padded==null||padded.getWidth()!=pw||padded.getHeight()!=height){recycle();padded=Bitmap.createBitmap(pw,height,Bitmap.Config.ARGB_8888);frame=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);}ByteBuffer data=plane.getBuffer();data.rewind();if(data.remaining()>=row*height){padded.copyPixelsFromBuffer(data);canvas.setBitmap(frame);canvas.drawBitmap(padded,0,0,paint);}else{ByteBuffer compact=ByteBuffer.allocateDirect(width*height*4);for(int y=0;y<height;y++){ByteBuffer line=data.duplicate();line.position(y*row);line.limit(y*row+width*4);compact.put(line);}compact.flip();frame.copyPixelsFromBuffer(compact);}jpeg.reset();frame.compress(Bitmap.CompressFormat.JPEG,72,jpeg);engine.submitJPEG(jpeg.toByteArray(),width,height);}catch(Exception e){if(!stopping)fail(e.getMessage());}}
    private void recycle(){canvas.setBitmap(null);if(padded!=null){padded.recycle();padded=null;}if(frame!=null){frame.recycle();frame=null;}}
    private void fail(String message){app().notice=message;main.post(()->stopSelf());}
    @Override public void onTaskRemoved(Intent root){stopSelf();}
    @Override public void onDestroy(){stopping=true;app().sharing=false;if(engine!=null)engine.setSharing(false);RemoteAccessibilityService.receive("[{\"type\":\"release\"}]");if(registered)unregisterReceiver(screenOff);getSystemService(DisplayManager.class).unregisterDisplayListener(changes);if(capture!=null)capture.post(()->{capture.removeCallbacks(latest);if(display!=null)display.release();if(reader!=null)reader.close();if(projection!=null)projection.stop();recycle();worker.quitSafely();});stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
    @Override public IBinder onBind(Intent i){return null;}
}

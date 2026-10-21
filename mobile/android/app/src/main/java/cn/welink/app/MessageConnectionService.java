package cn.welink.app;

import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

// A visible, low-importance ongoing notification keeps the logged-in process
// eligible to receive messages. The partial wake lock is released on logout.
public final class MessageConnectionService extends Service {
    static final int ID=27;
    private PowerManager.WakeLock wakeLock;
    private void acquireWakeLock(){
        if(wakeLock!=null)return;
        PowerManager power=(PowerManager)getSystemService(POWER_SERVICE);
        if(power==null)return;
        wakeLock=power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"LinkMe:message-connection");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire();
    }
    private void releaseWakeLock(){
        if(wakeLock!=null&&wakeLock.isHeld())wakeLock.release();
        wakeLock=null;
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        WeLinkApp app=(WeLinkApp)getApplication();
        MessageNotifications notices=app.messages();
        if(!notices.enabled){releaseWakeLock();stopSelf();return START_NOT_STICKY;}
        try{
            if(Build.VERSION.SDK_INT>=34)startForeground(ID,notices.connectionNotification(),ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
            else startForeground(ID,notices.connectionNotification());
            acquireWakeLock();
            app.engine().restoreNotifications();
        }catch(Exception error){android.util.Log.e("LinkMe","Unable to restore background message receiver",error);}
        return START_STICKY;
    }
    @Override public void onDestroy(){releaseWakeLock();super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}

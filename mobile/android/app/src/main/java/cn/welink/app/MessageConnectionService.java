package cn.welink.app;

import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

// A visible, low-importance ongoing notification keeps the logged-in process
// eligible to receive messages. It is stopped on logout, never a hidden service.
public final class MessageConnectionService extends Service {
    static final int ID=27;
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        MessageNotifications notices=((WeLinkApp)getApplication()).messages();
        if(!notices.enabled){stopSelf();return START_NOT_STICKY;}
        if(Build.VERSION.SDK_INT>=34)startForeground(ID,notices.connectionNotification(),ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
        else startForeground(ID,notices.connectionNotification());
        return START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent intent){return null;}
}

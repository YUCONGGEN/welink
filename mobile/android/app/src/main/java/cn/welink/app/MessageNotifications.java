package cn.welink.app;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.*;
import org.json.JSONObject;

// Application scoped: Activity destruction and WebView suspension do not stop it.
final class MessageNotifications {
    static final String SOUND="welink-messages-v1", SILENT="welink-messages-silent-v1", CONNECTION="welink-connection-v1";
    private final WeLinkApp app;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final NotificationManager manager;
    private final java.util.Set<String> tags=new java.util.HashSet<>();
    private String pending="";
    volatile boolean enabled;
    volatile boolean connected;
    MessageNotifications(WeLinkApp app){
        this.app=app;manager=app.getSystemService(NotificationManager.class);
        NotificationChannel audible=new NotificationChannel(SOUND,"聊天消息（有声音）",NotificationManager.IMPORTANCE_HIGH);
        audible.setDescription("显示发送人的姓名和消息内容");
        audible.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
        NotificationChannel silent=new NotificationChannel(SILENT,"聊天消息（无声音）",NotificationManager.IMPORTANCE_HIGH);
        silent.setSound(null,null);silent.enableVibration(false);
        manager.createNotificationChannel(audible);manager.createNotificationChannel(silent);
        manager.createNotificationChannel(new NotificationChannel(CONNECTION,"在线连接",NotificationManager.IMPORTANCE_LOW));
    }
    boolean sound(){return app.getSharedPreferences("message-notifications",Context.MODE_PRIVATE).getBoolean("sound",true);}
    void sound(boolean value){app.getSharedPreferences("message-notifications",Context.MODE_PRIVATE).edit().putBoolean("sound",value).apply();}
    void start(){
        enabled=true;
        try{app.startForegroundService(new Intent(app,MessageConnectionService.class));}
        catch(RuntimeException unavailable){android.widget.Toast.makeText(app,"后台连接暂未启动，请重新打开 LinkMe",android.widget.Toast.LENGTH_LONG).show();}
    }
    void stop(){enabled=false;connected=false;clear();app.stopService(new Intent(app,MessageConnectionService.class));}
    void receive(String json){main.post(()->{
        try{
            JSONObject event=new JSONObject(json);String type=event.optString("type");
            if("reset".equals(type)){for(String tag:tags)manager.cancel(tag,34);tags.clear();return;}
            if("signed-out".equals(type)){stop();return;}
            if("connected".equals(type)||"reconnecting".equals(type)){connected="connected".equals(type);if(enabled)manager.notify(MessageConnectionService.ID,connectionNotification());return;}
            if(!enabled||!"message".equals(type))return;
            if(Build.VERSION.SDK_INT>=33&&app.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return;
            String cid=event.optString("conversationId"),user=event.optString("userId"),title=event.optString("title"),body=event.optString("body");
            if(!cid.matches("[a-f0-9]{32}")||!user.matches("[a-f0-9]{32}"))return;
            Intent intent=new Intent(app,MainActivity.class).setAction("cn.welink.OPEN_MESSAGE").setData(Uri.parse("welink-message://conversation/"+cid)).putExtra("welink_message",json).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent open=PendingIntent.getActivity(app,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            Notification.MessagingStyle style=new Notification.MessagingStyle("我").addMessage(body,System.currentTimeMillis(),title);
            Notification notification=new Notification.Builder(app,sound()?SOUND:SILENT).setSmallIcon(R.drawable.ic_notification).setContentTitle(title).setContentText(body).setStyle(style).setCategory(Notification.CATEGORY_MESSAGE).setVisibility(Notification.VISIBILITY_PRIVATE).setAutoCancel(true).setContentIntent(open).setOnlyAlertOnce(false).build();
            String tag="message:"+cid;tags.add(tag);manager.notify(tag,34,notification);
        }catch(Exception unavailable){android.util.Log.w("LinkMe","Unable to display message notification",unavailable);}
    });}
    private void clear(){for(String tag:tags)manager.cancel(tag,34);tags.clear();synchronized(this){pending="";}}
    synchronized void accept(Intent intent){String value=intent==null?null:intent.getStringExtra("welink_message");if(value!=null&&value.length()<8192){pending=value;intent.removeExtra("welink_message");}}
    synchronized String take(){String value=pending;pending="";return value;}
    Notification connectionNotification(){
        PendingIntent open=PendingIntent.getActivity(app,1,new Intent(app,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(app,CONNECTION).setSmallIcon(R.drawable.ic_notification).setContentTitle(connected?"LinkMe · 在线":"LinkMe · 正在连接").setContentText(connected?"正在接收消息，点击打开 LinkMe":"网络恢复后自动连接").setOngoing(true).setOnlyAlertOnce(true).setContentIntent(open).build();
    }
}

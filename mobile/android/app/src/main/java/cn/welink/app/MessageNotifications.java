package cn.welink.app;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.*;
import android.app.Person;
import org.json.JSONObject;
import java.util.LinkedHashMap;
import java.util.Map;

// Application scoped: Activity destruction and WebView suspension do not stop it.
final class MessageNotifications {
    static final String SOUND="welink-messages-v2", SILENT="welink-messages-silent-v1", CONNECTION="welink-connection-v1", INVITES="welink-invites-v1";
    private static final int MESSAGE_ID=34, INVITE_ID=35, MISSED_ID=36;
    private final WeLinkApp app;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final NotificationManager manager;
    private final java.util.Set<String> tags=new java.util.HashSet<>();
    private final Map<String,String> activeInvites=new LinkedHashMap<>();
    private final LinkedHashMap<String,String> pendingInviteEvents=new LinkedHashMap<>(), pendingInviteActions=new LinkedHashMap<>();
    private String pending="";
    private Ringtone inviteRing;
    private Runnable ringRepeat;
    volatile boolean enabled;
    volatile boolean connected;

    MessageNotifications(WeLinkApp app){
        this.app=app;manager=app.getSystemService(NotificationManager.class);enabled=app.getSharedPreferences("message-notifications",Context.MODE_PRIVATE).getBoolean("enabled",false);
        NotificationChannel audible=new NotificationChannel(SOUND,"聊天消息（QQ 双短音）",NotificationManager.IMPORTANCE_HIGH);
        audible.setDescription("显示发送人的姓名和消息内容");
        audible.setSound(Uri.parse("android.resource://"+app.getPackageName()+"/"+R.raw.linkme_message),new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        NotificationChannel silent=new NotificationChannel(SILENT,"聊天消息（无声音）",NotificationManager.IMPORTANCE_HIGH);
        silent.setSound(null,null);silent.enableVibration(false);
        NotificationChannel invites=new NotificationChannel(INVITES,"来电、远程和会议邀请",NotificationManager.IMPORTANCE_HIGH);
        invites.setDescription("持续提醒，点按后直接打开 LinkMe 处理");
        invites.setSound(null,null);invites.enableVibration(true);invites.setVibrationPattern(new long[]{0,240,180,240});
        manager.createNotificationChannel(audible);manager.createNotificationChannel(silent);manager.createNotificationChannel(invites);
        manager.createNotificationChannel(new NotificationChannel(CONNECTION,"在线连接",NotificationManager.IMPORTANCE_LOW));
    }
    boolean sound(){return app.getSharedPreferences("message-notifications",Context.MODE_PRIVATE).getBoolean("sound",true);}
    void sound(boolean value){app.getSharedPreferences("message-notifications",Context.MODE_PRIVATE).edit().putBoolean("sound",value).apply();}
    void start(){
        enabled=true;app.getSharedPreferences("message-notifications",Context.MODE_PRIVATE).edit().putBoolean("enabled",true).apply();
        try{app.startForegroundService(new Intent(app,MessageConnectionService.class));}
        catch(RuntimeException unavailable){android.widget.Toast.makeText(app,"后台连接暂未启动，请重新打开 LinkMe",android.widget.Toast.LENGTH_LONG).show();}
    }
    void stop(){enabled=false;connected=false;app.getSharedPreferences("message-notifications",Context.MODE_PRIVATE).edit().putBoolean("enabled",false).apply();clear();app.stopService(new Intent(app,MessageConnectionService.class));}

    void receive(String json){main.post(()->{
        try{
            JSONObject event=new JSONObject(json);String type=event.optString("type");
            if("reset".equals(type)){clear();return;}
            if("signed-out".equals(type)){stop();return;}
            if("connected".equals(type)||"reconnecting".equals(type)){connected="connected".equals(type);if(enabled)manager.notify(MessageConnectionService.ID,connectionNotification());return;}
            if(!enabled)return;
            if("message".equals(type)){receiveMessage(event,json);return;}
            if("call".equals(type)||"remote".equals(type)||"meeting".equals(type)){receiveInvite(event,json);return;}
        }catch(Exception unavailable){android.util.Log.w("LinkMe","Unable to display notification",unavailable);}
    });}

    private void receiveMessage(JSONObject event,String json){
        if(Build.VERSION.SDK_INT>=33&&app.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return;
        String cid=event.optString("conversationId"),user=event.optString("userId"),title=event.optString("title"),body=event.optString("body");
        if(!cid.matches("[a-f0-9]{32}")||!user.matches("[a-f0-9]{32}"))return;
        Intent intent=new Intent(app,MainActivity.class).setAction("cn.welink.OPEN_MESSAGE").setData(Uri.parse("welink-message://conversation/"+cid)).putExtra("welink_message",json).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent open=PendingIntent.getActivity(app,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.MessagingStyle style=new Notification.MessagingStyle("我").addMessage(body,System.currentTimeMillis(),title);
        Notification notification=new Notification.Builder(app,sound()?SOUND:SILENT).setSmallIcon(R.drawable.ic_notification).setContentTitle(title).setContentText(body).setStyle(style).setCategory(Notification.CATEGORY_MESSAGE).setVisibility(Notification.VISIBILITY_PRIVATE).setAutoCancel(true).setContentIntent(open).setOnlyAlertOnce(false).build();
        String tag="message:"+cid;tags.add(tag);manager.notify(tag,MESSAGE_ID,notification);
    }

    private void receiveInvite(JSONObject event,String json){
        if(Build.VERSION.SDK_INT>=33&&app.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return;
        String type=event.optString("type"),key=inviteKey(event),state=event.optString("state");
        if(key.isEmpty()||key.endsWith(":"))return;
        if("call".equals(type)&&"ringing".equals(state)&&event.optBoolean("canRespond")){
            keepInvite(key,event,json,"LinkMe 来电",event.optString("mode").equals("video")?"邀请你进行视频通话":"邀请你进行语音通话",true);
        }else if("remote".equals(type)&&"pending".equals(state)&&!event.optString("recipient").isEmpty()&&event.optString("recipient").equals(event.optString("userId"))){
            String detail="请求观看并控制你的设备";
            if("view".equals(event.optString("mode")))detail="邀请你进行远程协助";
            keepInvite(key,event,json,"LinkMe 远程协助",detail,true);
        }else if("meeting".equals(type)&&"pending".equals(state)){
            keepInvite(key,event,json,"LinkMe 会议邀请","会议号 "+event.optString("code"),false);
        }else{
            synchronized(this){activeInvites.remove(key);pendingInviteActions.remove(key);enqueueEventLocked(key,json);}
            manager.cancel("invite:"+key,INVITE_ID);
            stopInviteRingIfIdle();
            if("call".equals(type)&&"ended".equals(state)&&event.optLong("started")==0&&event.optString("recipient").equals(event.optString("userId"))&&("no_answer".equals(event.optString("reason"))||"cancelled".equals(event.optString("reason"))||"offline".equals(event.optString("reason"))||"interrupted".equals(event.optString("reason"))))postMissedCall(event);
        }
    }

    private String inviteKey(JSONObject event){
        switch(event.optString("type")){
            case "call": return "call:"+validId(event.optString("id"));
            case "remote": return "remote:"+validId(event.optString("id"));
            case "meeting": return "meeting:"+(event.optString("code").matches("[1-9][0-9]{8}")?event.optString("code"):"");
            default:return "";
        }
    }
    private String validId(String id){return id.matches("[a-f0-9]{32}")?id:"";}

    private void keepInvite(String key,JSONObject event,String json,String title,String detail,boolean actions){
        synchronized(this){activeInvites.put(key,json);enqueueEventLocked(key,json);}
        Intent openIntent=inviteIntent(key,json,"open");PendingIntent open=PendingIntent.getActivity(app,pendingCode(key,"open"),openIntent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=new Notification.Builder(app,INVITES)
            .setSmallIcon(R.drawable.ic_notification).setContentTitle(event.optString("title").isEmpty()?title+" · "+fallbackName(event):title)
            .setContentText(detail).setCategory(Notification.CATEGORY_CALL).setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true).setAutoCancel(false).setOnlyAlertOnce(true).setContentIntent(open).setFullScreenIntent(open,true)
            .setWhen(System.currentTimeMillis());
        if(actions){
            String positive=event.optString("type").equals("remote")?"同意":"接听";
            PendingIntent accept=PendingIntent.getActivity(app,pendingCode(key,"accept"),inviteIntent(key,json,"accept"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            PendingIntent reject=PendingIntent.getActivity(app,pendingCode(key,"reject"),inviteIntent(key,json,"reject"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            if("call".equals(event.optString("type"))&&Build.VERSION.SDK_INT>=31){
                Person caller=new Person.Builder().setName(event.optString("title").isEmpty()?fallbackName(event):event.optString("title")).build();
                builder.setStyle(Notification.CallStyle.forIncomingCall(caller,reject,accept));
            }else builder.addAction(android.R.drawable.sym_action_call,positive,accept).addAction(android.R.drawable.ic_menu_close_clear_cancel,"拒绝",reject);
        }else{
            PendingIntent enter=PendingIntent.getActivity(app,pendingCode(key,"accept"),inviteIntent(key,json,"accept"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            PendingIntent reject=PendingIntent.getActivity(app,pendingCode(key,"reject"),inviteIntent(key,json,"reject"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            builder.addAction(android.R.drawable.ic_menu_view,"进入",enter).addAction(android.R.drawable.ic_menu_close_clear_cancel,"忽略",reject);
        }
        manager.notify("invite:"+key,INVITE_ID,builder.build());
        startInviteRing();
    }
    private String fallbackName(JSONObject event){String name=event.optString("fromName");return name.isEmpty()?"新邀请":name;}
    private int pendingCode(String key,String action){return (key+":"+action).hashCode()&0x7fffffff;}
    private Intent inviteIntent(String key,String json,String action){
        return new Intent(app,MainActivity.class).setAction("cn.welink.INCOMING_INVITE")
            .setData(Uri.parse("linkme-invite://"+Uri.encode(key)+"/"+action))
            .putExtra("welink_invite",json).putExtra("welink_invite_key",key).putExtra("welink_invite_action",action)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }
    private void postMissedCall(JSONObject event){
        String title=event.optString("title");if(title.isEmpty())title="LinkMe";
        Intent open=new Intent(app,MainActivity.class).setAction("cn.welink.MISSED_CALL").addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pending=PendingIntent.getActivity(app,Math.abs(event.optString("id").hashCode()),open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification notification=new Notification.Builder(app,SILENT).setSmallIcon(R.drawable.ic_notification).setContentTitle("未接来电 · "+title).setContentText("你有一个未接听的"+("video".equals(event.optString("mode"))?"视频":"语音")+"通话").setCategory(Notification.CATEGORY_MISSED_CALL).setAutoCancel(true).setContentIntent(pending).build();
        manager.notify("missed:"+event.optString("id"),MISSED_ID,notification);
    }

    private void startInviteRing(){
        if(inviteRing!=null||activeInvites.isEmpty())return;
        try{
            Uri uri=Uri.parse("android.resource://"+app.getPackageName()+"/"+R.raw.linkme_ringtone);
            inviteRing=RingtoneManager.getRingtone(app,uri);
            if(inviteRing==null)return;
            inviteRing.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            if(Build.VERSION.SDK_INT>=28){inviteRing.setLooping(true);inviteRing.setVolume(0.22f);}
            inviteRing.play();
            if(Build.VERSION.SDK_INT<28){ringRepeat=new Runnable(){@Override public void run(){if(inviteRing==null||activeInvites.isEmpty())return;if(!inviteRing.isPlaying())inviteRing.play();main.postDelayed(this,2600);}};main.postDelayed(ringRepeat,2600);}
        }catch(RuntimeException unavailable){stopInviteRing();}
    }
    private void stopInviteRingIfIdle(){synchronized(this){if(activeInvites.isEmpty())stopInviteRing();}}
    private void stopInviteRing(){if(ringRepeat!=null)main.removeCallbacks(ringRepeat);ringRepeat=null;if(inviteRing!=null){try{inviteRing.stop();}catch(RuntimeException ignored){}inviteRing=null;}}
    void dismissInvite(String key){if(key==null||key.isEmpty())return;main.post(()->{synchronized(this){activeInvites.remove(key);pendingInviteEvents.remove(key);pendingInviteActions.remove(key);}manager.cancel("invite:"+key,INVITE_ID);stopInviteRingIfIdle();});}

    synchronized void acceptMessage(Intent intent){String value=intent==null?null:intent.getStringExtra("welink_message");if(value!=null&&value.length()<8192){pending=value;intent.removeExtra("welink_message");}}
    synchronized void acceptInviteIntent(Intent intent){
        if(intent==null)return;String value=intent.getStringExtra("welink_invite"),key=intent.getStringExtra("welink_invite_key"),action=intent.getStringExtra("welink_invite_action");
        if(value!=null&&value.length()<8192&&key!=null&&!key.isEmpty()&&activeInvites.containsKey(key)){
            if("accept".equals(action)||"reject".equals(action)){
                pendingInviteActions.put(key,"{\"action\":"+org.json.JSONObject.quote(action)+",\"notification\":"+value+"}");
                activeInvites.remove(key);pendingInviteEvents.remove(key);manager.cancel("invite:"+key,INVITE_ID);stopInviteRingIfIdle();
            }else enqueueEventLocked(key,value);
        }
        if(intent.getData()!=null&&intent.getData().getScheme()!=null&&intent.getData().getScheme().equals("welink-message")){String path=intent.getData().getPath();if(path!=null&&path.matches("/conversation/[a-f0-9]{32}"))manager.cancel("message:"+path.substring(13),MESSAGE_ID);}
        intent.removeExtra("welink_invite");intent.removeExtra("welink_invite_key");intent.removeExtra("welink_invite_action");
    }
    private void enqueueEventLocked(String key,String json){pendingInviteEvents.put(key,json);while(pendingInviteEvents.size()>32)pendingInviteEvents.remove(pendingInviteEvents.keySet().iterator().next());}
    synchronized String take(){String value=pending;pending="";return value;}
    synchronized String takeInviteEvent(){if(pendingInviteEvents.isEmpty())return "";String key=pendingInviteEvents.keySet().iterator().next();return pendingInviteEvents.remove(key);}
    synchronized String takeInviteAction(){if(pendingInviteActions.isEmpty())return "";String key=pendingInviteActions.keySet().iterator().next();return pendingInviteActions.remove(key);}

    private void clear(){
        for(String tag:tags)manager.cancel(tag,MESSAGE_ID);tags.clear();
        synchronized(this){pending="";pendingInviteEvents.clear();pendingInviteActions.clear();for(String key:activeInvites.keySet())manager.cancel("invite:"+key,INVITE_ID);activeInvites.clear();}
        stopInviteRing();
    }
    Notification connectionNotification(){
        PendingIntent open=PendingIntent.getActivity(app,1,new Intent(app,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(app,CONNECTION).setSmallIcon(R.drawable.ic_notification).setContentTitle(connected?"LinkMe · 在线":"LinkMe · 正在连接").setContentText(connected?"正在接收消息，点击打开 LinkMe":"网络恢复后自动连接").setOngoing(true).setOnlyAlertOnce(true).setContentIntent(open).build();
    }
}

package cn.welink.app;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.projection.MediaProjectionManager;
import android.os.*;
import android.view.*;
import android.widget.*;
import cn.welink.bridge.core.Conference;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** WeLink account entry into the native YuDesk WebRTC meeting implementation. */
public final class MeetingActivity extends Activity {
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private ConferenceController conference;
    private String code,token,name;
    private boolean host,microphone,camera,opening;
    @Override public void onCreate(Bundle saved){super.onCreate(saved);getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        code=getIntent().getStringExtra("code");token=getIntent().getStringExtra("token");name=getIntent().getStringExtra("name");
        host=getIntent().getBooleanExtra("host",false);microphone=getIntent().getBooleanExtra("microphone",false);camera=getIntent().getBooleanExtra("camera",false);
        if(code==null||!code.matches("[1-9][0-9]{8}")||token==null||!token.matches("[a-f0-9]{64}")){finish();return;}
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        TextView loading=new TextView(this);loading.setText("正在进入 WeLink 会议…");loading.setTextColor(0xff0099ff);loading.setBackgroundColor(0xfff5f6f7);loading.setGravity(Gravity.CENTER);setContentView(loading);
        ArrayList<String> permissions=new ArrayList<>();if(microphone&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)permissions.add(Manifest.permission.RECORD_AUDIO);if(camera&&checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)permissions.add(Manifest.permission.CAMERA);
        if(permissions.isEmpty())open();else requestPermissions(permissions.toArray(new String[0]),80);
    }
    private void open(){if(opening)return;opening=true;boolean mic=microphone&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED,cam=camera&&checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED;
        worker.execute(()->{try{Conference channel=((WeLinkApp)getApplication()).engine().openConference(code,token);main.post(()->{if(isFinishing()||isDestroyed()){channel.close();return;}try{conference=new ConferenceController(this,channel,code,name,host,mic,cam);setContentView(conference.view());}catch(Exception failure){channel.close();conferenceNotice("无法开启会议："+failure.getMessage());finish();}});}catch(Exception failure){main.post(()->{conferenceNotice("入会失败："+failure.getMessage());finish();});}});
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==80){open();return;}if(conference!=null)conference.mediaPermissionResult(request,results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED);}
    void requestConferenceProjection(boolean recording){if(conference==null||!conference.isHost())return;String message=recording?"录制本次会议的屏幕画面（当前不含声音）。参会成员将看到录制提示，结束后保存到本机。":"共享后参会成员可以看到你的屏幕，可随时在通知中停止。";new AlertDialog.Builder(this).setTitle(recording?"录制会议":"共享屏幕").setMessage(message).setNegativeButton("取消",null).setPositiveButton("继续",(d,w)->{MediaProjectionManager manager=(MediaProjectionManager)getSystemService(MEDIA_PROJECTION_SERVICE);startActivityForResult(manager.createScreenCaptureIntent(),recording?71:70);}).show();}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if((request==70||request==71)&&result==RESULT_OK&&data!=null&&conference!=null){boolean recording=request==71;ConferenceProjectionService.onReady=()->main.post(()->{if(conference==null||isFinishing())return;if(recording)conference.startRecording(data);else conference.startScreenShare(data);});startForegroundService(new Intent(this,ConferenceProjectionService.class).putExtra("recording",recording));}}
    void requestConferenceLeave(){if(conference==null){finish();return;}AlertDialog.Builder dialog=new AlertDialog.Builder(this).setTitle("离开会议").setMessage(conference.isHost()?"可以仅自己离开并自动转交主持人，或结束所有人的会议。":"确定离开本次会议？").setNegativeButton("取消",null).setPositiveButton("离开",(d,w)->conference.leave(false));if(conference.isHost())dialog.setNeutralButton("结束会议",(d,w)->conference.leave(true));dialog.show();}
    void requestConferenceTransfer(String id,String name){new AlertDialog.Builder(this).setTitle("转交主持人").setMessage("将主持人权限转交给 "+name+"？").setNegativeButton("取消",null).setPositiveButton("确定",(d,w)->{if(conference!=null)conference.transfer(id);}).show();}
    void conferenceNotice(String text){Toast.makeText(this,text,Toast.LENGTH_LONG).show();}
    void onConferenceClosed(String reason,boolean unexpected){conference=null;if(!reason.isEmpty())conferenceNotice(reason);finish();}
    @Override public void onBackPressed(){requestConferenceLeave();}
    @Override protected void onDestroy(){ConferenceProjectionService.onReady=null;if(conference!=null){ConferenceController active=conference;conference=null;active.leave(false);}worker.shutdownNow();super.onDestroy();}
}

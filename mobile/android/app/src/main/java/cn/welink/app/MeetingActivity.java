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

/** LinkMe account entry into the native YuDesk WebRTC meeting implementation. */
public final class MeetingActivity extends Activity {
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private ConferenceController conference;
    private String code,token,name,callID="",callMode="",peerName="";
    private static java.lang.ref.WeakReference<MeetingActivity> current=new java.lang.ref.WeakReference<>(null);
    static void closeCall(String id){MeetingActivity active=current.get();if(active!=null&&active.callID.equals(id))active.finish();}
    private boolean host,microphone,camera,opening;
    @Override public void onCreate(Bundle saved){super.onCreate(saved);ScreenInsets.install(this);current=new java.lang.ref.WeakReference<>(this);
        code=getIntent().getStringExtra("code");token=getIntent().getStringExtra("token");name=getIntent().getStringExtra("name");
        callID=getIntent().getStringExtra("call_id");callID=callID==null?"":callID;callMode=getIntent().getStringExtra("call_mode");callMode=callMode==null?"":callMode;peerName=getIntent().getStringExtra("peer_name");peerName=peerName==null?"":peerName;
        host=getIntent().getBooleanExtra("host",false);microphone=getIntent().getBooleanExtra("microphone",false);camera=getIntent().getBooleanExtra("camera",false);
        if(code==null||!code.matches("[1-9][0-9]{8}")||token==null||!token.matches("[a-f0-9]{64}")){finish();return;}
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        TextView loading=new TextView(this);loading.setText(callID.isEmpty()?"正在进入 LinkMe 会议…":"正在连接通话…");loading.setTextColor(0xff0099ff);loading.setBackgroundColor(0xfff5f6f7);loading.setGravity(Gravity.CENTER);setContentView(loading);
        ArrayList<String> permissions=new ArrayList<>();if(microphone&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)permissions.add(Manifest.permission.RECORD_AUDIO);if(camera&&checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)permissions.add(Manifest.permission.CAMERA);
        if(permissions.isEmpty())open();else requestPermissions(permissions.toArray(new String[0]),80);
    }
    private void open(){if(opening||isFinishing()||isDestroyed())return;opening=true;boolean mic=microphone&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED,cam=camera&&checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED;
        if(!callID.isEmpty()&&!mic){conferenceNotice("通话需要麦克风权限，请在系统设置中允许后重试");finish();return;}
        worker.execute(()->{try{Conference channel=((WeLinkApp)getApplication()).engine().openConference(code,token);main.post(()->{if(isFinishing()||isDestroyed()){channel.close();return;}try{conference=new ConferenceController(this,channel,code,name,host,mic,cam,callMode,peerName);setContentView(conference.view());}catch(Exception|LinkageError failure){channel.close();conferenceNotice("无法开启会议，请检查设备权限后重试");finish();}});}catch(Exception failure){main.post(()->{if(isFinishing()||isDestroyed())return;conferenceNotice("入会失败："+failure.getMessage());finish();});}});
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==80){open();return;}if(conference!=null)conference.mediaPermissionResult(request,results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED);}
    void requestConferenceProjection(boolean recording){if(conference==null||!conference.isHost())return;String message=recording?"录制本次会议的屏幕画面（当前不含声音）。参会成员将看到录制提示，结束后保存到本机。":"共享后参会成员可以看到你的屏幕，可随时在通知中停止。";new AlertDialog.Builder(this).setTitle(recording?"录制会议":"共享屏幕").setMessage(message).setNegativeButton("取消",null).setPositiveButton("继续",(d,w)->{MediaProjectionManager manager=(MediaProjectionManager)getSystemService(MEDIA_PROJECTION_SERVICE);startActivityForResult(manager.createScreenCaptureIntent(),recording?71:70);}).show();}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if((request==70||request==71)&&result==RESULT_OK&&data!=null&&conference!=null){boolean recording=request==71;ConferenceProjectionService.onReady=()->main.post(()->{if(conference==null||isFinishing())return;if(recording)conference.startRecording(data);else conference.startScreenShare(data);});startForegroundService(new Intent(this,ConferenceProjectionService.class).putExtra("recording",recording));}}
    private String meetingShareText(){String server=getIntent().getStringExtra("server");if(server==null||!(server.startsWith("http://")||server.startsWith("https://")))server="http://www.yucg.cn:8250";return "邀请你加入 LinkMe 会议\n会议号："+code.replaceAll("(\\d{3})(?=\\d)","$1 ")+"\n会议链接："+server.replaceAll("/+$","")+"/join/"+code;}
    void copyMeetingInvitation(){android.content.ClipboardManager clipboard=(android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE);clipboard.setPrimaryClip(ClipData.newPlainText("LinkMe 会议邀请",meetingShareText()));conferenceNotice("邀请链接和会议号已复制");}
    private AlertDialog inviteDialog;
    private String meetingRequest(String path,org.json.JSONObject body)throws Exception{String address=((WeLinkApp)getApplication()).engine().url();android.net.Uri uri=android.net.Uri.parse(address);String origin="http://"+uri.getAuthority();java.net.HttpURLConnection conn=(java.net.HttpURLConnection)new java.net.URL(origin+path).openConnection();conn.setConnectTimeout(10000);conn.setReadTimeout(15000);conn.setRequestProperty("Authorization","Bearer "+token);String cookie=android.webkit.CookieManager.getInstance().getCookie(origin);if(cookie!=null)conn.setRequestProperty("Cookie",cookie);try{if(body!=null){conn.setRequestMethod("POST");conn.setDoOutput(true);conn.setRequestProperty("Content-Type","application/json");try(java.io.OutputStream out=conn.getOutputStream()){out.write(body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));}}int status=conn.getResponseCode();java.io.InputStream input=status==200?conn.getInputStream():conn.getErrorStream();java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();if(input!=null)try(java.io.InputStream in=input){byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1){if(bytes.size()+n>1024*1024)throw new java.io.IOException("邀请数据过大");bytes.write(buffer,0,n);}}String result=bytes.toString("UTF-8");if(status!=200)throw new java.io.IOException(new org.json.JSONObject(result).optString("error","邀请失败"));return result;}finally{conn.disconnect();}}
    void requestConferenceInvite(){
        if(conference==null||!callID.isEmpty()||inviteDialog!=null&&inviteDialog.isShowing())return;
        LinearLayout content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);int pad=Math.round(20*getResources().getDisplayMetrics().density);content.setPadding(pad,pad,pad,pad);
        TextView status=new TextView(this);status.setText("正在读取联系人…");content.addView(status);
        ListView list=new ListView(this);list.setChoiceMode(ListView.CHOICE_MODE_MULTIPLE);content.addView(list,new LinearLayout.LayoutParams(-1,Math.round(260*getResources().getDisplayMetrics().density)));
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("邀请好友入会").setView(content).setNeutralButton("复制邀请",null).setNegativeButton("取消",null).setPositiveButton("发送邀请",null).create();inviteDialog=dialog;dialog.show();
        Button send=dialog.getButton(AlertDialog.BUTTON_POSITIVE);send.setEnabled(false);dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v->copyMeetingInvitation());
        worker.execute(()->{try{org.json.JSONArray friends=new org.json.JSONArray(meetingRequest("/api/friends",null));main.post(()->{
            if(isFinishing()||conference==null||!dialog.isShowing())return;
            String[] names=new String[friends.length()];for(int i=0;i<names.length;i++){org.json.JSONObject p=friends.optJSONObject(i);String label=p.optString("remark","");names[i]=(label.isEmpty()?p.optString("name"):label)+" · "+p.optString("number");}
            status.setText(names.length==0?"暂无联系人，可以复制邀请链接。":"选择要邀请的联系人");list.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_list_item_multiple_choice,names));send.setEnabled(names.length>0);
            send.setOnClickListener(v->{org.json.JSONArray ids=new org.json.JSONArray();for(int i=0;i<names.length;i++)if(list.isItemChecked(i))ids.put(friends.optJSONObject(i).optString("id"));if(ids.length()==0){status.setText("请先选择要邀请的联系人");return;}send.setEnabled(false);status.setText("正在发送邀请…");worker.execute(()->{try{meetingRequest("/api/meetings/"+code+"/invite",new org.json.JSONObject().put("members",ids));main.post(()->{if(dialog.isShowing())dialog.dismiss();conferenceNotice("会议邀请已发送");});}catch(Exception failure){main.post(()->{if(dialog.isShowing()){status.setText(failure.getMessage());send.setEnabled(true);}});}});});
        });}catch(Exception failure){main.post(()->{if(dialog.isShowing())status.setText("读取失败："+failure.getMessage()+"。可取消后重试，或复制邀请链接。");});}});
    }
    void requestConferenceLeave(){ConferenceController active=conference;if(active==null){finish();return;}if(!callID.isEmpty()){active.leave(true);return;}AlertDialog.Builder dialog=new AlertDialog.Builder(this).setTitle("离开会议").setMessage(active.isHost()?"可以仅自己离开并自动转交主持人，或结束所有人的会议。":"确定离开本次会议？").setNegativeButton("取消",null).setPositiveButton("离开",(d,w)->{if(conference==active)active.leave(false);});if(active.isHost())dialog.setNeutralButton("结束会议",(d,w)->{if(conference==active)active.leave(true);});dialog.show();}
    void requestConferenceTransfer(String id,String name){new AlertDialog.Builder(this).setTitle("转交主持人").setMessage("将主持人权限转交给 "+name+"？").setNegativeButton("取消",null).setPositiveButton("确定",(d,w)->{if(conference!=null)conference.transfer(id);}).show();}
    void conferenceNotice(String text){Toast.makeText(this,text,Toast.LENGTH_LONG).show();}
    void onConferenceClosed(String reason,boolean unexpected){conference=null;if(!reason.isEmpty())conferenceNotice(reason);finish();}
    @Override public void onBackPressed(){requestConferenceLeave();}
    @Override protected void onDestroy(){if(current.get()==this){ConferenceProjectionService.onReady=null;current.clear();}if(conference!=null){ConferenceController active=conference;conference=null;active.destroy();}worker.shutdownNow();if(!callID.isEmpty())MainActivity.notifyCallClosed(callID);super.onDestroy();}
}

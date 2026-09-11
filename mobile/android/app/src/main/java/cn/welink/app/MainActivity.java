package cn.welink.app;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.provider.MediaStore;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.Executors;
import java.util.ArrayList;

public final class MainActivity extends Activity {
    private WebView web;
    private static java.lang.ref.WeakReference<MainActivity> current=new java.lang.ref.WeakReference<>(null);
    private android.media.Ringtone callRing;
    private android.media.ToneGenerator callTone;
    private Runnable ringRepeat;
    private String origin;
    private ValueCallback<Uri[]> chooser;
    private String pendingDownload;
    private String pendingCookies;
    private PermissionRequest pendingWebPermission;
    private boolean pendingVideoCapture;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final java.util.concurrent.ExecutorService io=Executors.newSingleThreadExecutor();
    private boolean starting;
    private WeLinkApp app(){return (WeLinkApp)getApplication();}
    @Override public void onCreate(Bundle state){super.onCreate(state);ScreenInsets.install(this);MainActivity previous=current.get();if(previous!=null&&previous!=this&&!previous.isFinishing()&&getIntent().getData()!=null){previous.receiveMeetingIntent(getIntent());finish();return;}current=new java.lang.ref.WeakReference<>(this);receiveMeetingIntent(getIntent());start();}
    private void receiveMeetingIntent(Intent intent){Uri uri=intent==null?null:intent.getData();if(uri==null||!"welink".equals(uri.getScheme())||!"meeting".equals(uri.getAuthority())||uri.getQuery()!=null||uri.getFragment()!=null)return;String path=uri.getPath();if(path!=null&&path.matches("/[1-9][0-9]{8}"))getSharedPreferences("meeting-invitation",MODE_PRIVATE).edit().putString("code",path.substring(1)).putLong("created",System.currentTimeMillis()).apply();}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);receiveMeetingIntent(intent);}
    private void start(){
        if(starting||isFinishing()||isDestroyed())return;starting=true;
        LinearLayout loading=new LinearLayout(this);loading.setGravity(Gravity.CENTER);loading.setOrientation(LinearLayout.VERTICAL);int padding=Math.round(24*getResources().getDisplayMetrics().density);loading.setPadding(padding,padding,padding,padding);loading.setBackgroundColor(Color.rgb(239,248,255));TextView title=new TextView(this);title.setGravity(Gravity.CENTER);title.setText(R.string.app_name);title.setTextColor(Color.rgb(0,153,255));title.setTextSize(34);loading.addView(title);setContentView(loading);
        io.execute(()->{try{String url=app().engine().url();main.post(()->{if(isFinishing()||isDestroyed())return;starting=false;origin="http://"+Uri.parse(url).getAuthority();try{showWeb(url);}catch(RuntimeException unavailable){startupFailure(loading,title,"系统 WebView 组件不可用，请更新 Android System WebView 后重试。");}});}catch(Exception e){main.post(()->{if(isFinishing()||isDestroyed())return;starting=false;startupFailure(loading,title,getString(R.string.startup_failed,e.getMessage()));});}});
    }
    private void startupFailure(LinearLayout loading,TextView title,String message){title.setText(message);title.setTextSize(16);Button retry=new Button(this);retry.setText(R.string.retry);retry.setOnClickListener(v->start());loading.addView(retry);setContentView(loading);}
    @SuppressWarnings("SetJavaScriptEnabled")
    private void showWeb(String url){
        if(web!=null){web.removeJavascriptInterface("WeLinkAndroid");web.destroy();web=null;}
        android.webkit.WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);web=new WebView(this);web.setBackgroundColor(Color.WHITE);WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setMediaPlaybackRequiresUserGesture(true);settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.addJavascriptInterface(new Bridge(),"WeLinkAndroid");
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !isLocal(request.getUrl());}
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,android.net.http.SslError error){handler.cancel();}
            @Override public void onPageFinished(WebView view,String url){CookieManager.getInstance().flush();}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){finishChooser(null);chooser=callback;String[] types=params.getAcceptTypes();String type=types.length>0?types[0]:"";if(params.isCaptureEnabled()&&type.startsWith("video/")){pendingVideoCapture=true;if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.CAMERA},62);else captureVideo();}else{Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(type.startsWith("image/")?"image/*":type.startsWith("video/")?"video/*":"*/*");launchPicker(intent);}return true;}
            @Override public void onPermissionRequest(PermissionRequest request){main.post(()->requestWebPermission(request));}
            @Override public void onPermissionRequestCanceled(PermissionRequest request){main.post(()->{if(pendingWebPermission==request)pendingWebPermission=null;});}
        });
        setContentView(web);web.loadUrl(url);
    }
    private boolean isLocal(Uri uri){return origin!=null&&uri.toString().startsWith(origin+"/");}
    private boolean isLocalOrigin(Uri uri){return origin!=null&&(origin.equals(uri.toString())||(origin+"/").equals(uri.toString()));}
    private void requestWebPermission(PermissionRequest request){
        if(web==null||!isLocalOrigin(request.getOrigin())){request.deny();return;}
        ArrayList<String> missing=new ArrayList<>();
        for(String resource:request.getResources()){
            String permission;
            if(PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource))permission=Manifest.permission.RECORD_AUDIO;
            else if(PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource))permission=Manifest.permission.CAMERA;
            else{request.deny();return;}
            if(checkSelfPermission(permission)!=PackageManager.PERMISSION_GRANTED&&!missing.contains(permission))missing.add(permission);
        }
        if(missing.isEmpty()){request.grant(request.getResources());return;}
        if(pendingWebPermission!=null)pendingWebPermission.deny();
        pendingWebPermission=request;requestPermissions(missing.toArray(new String[0]),61);
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){
        super.onRequestPermissionsResult(request,permissions,grants);
        if(request==61){PermissionRequest pending=pendingWebPermission;pendingWebPermission=null;if(pending==null)return;boolean allowed=web!=null&&isLocalOrigin(pending.getOrigin());for(String resource:pending.getResources()){String permission=PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)?Manifest.permission.RECORD_AUDIO:Manifest.permission.CAMERA;allowed&=checkSelfPermission(permission)==PackageManager.PERMISSION_GRANTED;}if(allowed)pending.grant(pending.getResources());else pending.deny();}
        if(request==62&&pendingVideoCapture){if(checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)captureVideo();else{finishChooser(null);Toast.makeText(this,"拍摄视频需要相机权限",Toast.LENGTH_SHORT).show();}}
    }
    private void captureVideo(){Intent capture=new Intent(MediaStore.ACTION_VIDEO_CAPTURE);capture.putExtra(MediaStore.EXTRA_DURATION_LIMIT,60);capture.putExtra(MediaStore.EXTRA_VIDEO_QUALITY,1);launchPicker(capture);}
    private void launchPicker(Intent intent){try{startActivityForResult(intent,40);}catch(ActivityNotFoundException|SecurityException error){finishChooser(null);Toast.makeText(this,"无法打开相机或文件选择器，请检查系统应用与权限",Toast.LENGTH_LONG).show();}}
    private void finishChooser(Uri[] result){ValueCallback<Uri[]> callback=chooser;chooser=null;pendingVideoCapture=false;if(callback!=null)callback.onReceiveValue(result);}
    private void stopRinging(){if(ringRepeat!=null)main.removeCallbacks(ringRepeat);ringRepeat=null;if(callRing!=null){callRing.stop();callRing=null;}if(callTone!=null){callTone.release();callTone=null;}}
    private void ring(boolean incoming){stopRinging();try{if(incoming){callRing=android.media.RingtoneManager.getRingtone(this,android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE));if(callRing==null)return;ringRepeat=new Runnable(){public void run(){if(callRing==null)return;if(!callRing.isPlaying())callRing.play();main.postDelayed(this,3000);}};}else{callTone=new android.media.ToneGenerator(android.media.AudioManager.STREAM_MUSIC,40);ringRepeat=new Runnable(){public void run(){if(callTone==null)return;callTone.startTone(android.media.ToneGenerator.TONE_SUP_RINGTONE,1000);main.postDelayed(this,3200);}};}main.post(ringRepeat);}catch(RuntimeException unavailable){stopRinging();}}
    static void notifyCallClosed(String id){MainActivity activity=current.get();if(activity!=null)activity.main.post(()->{if(activity.web!=null)activity.web.evaluateJavascript("window.WeLinkCallNativeClosed&&window.WeLinkCallNativeClosed("+org.json.JSONObject.quote(id)+")",null);});}
    private final class Bridge {
        @JavascriptInterface public synchronized String takeMeetingInvitation(){android.content.SharedPreferences prefs=getSharedPreferences("meeting-invitation",MODE_PRIVATE);String code=prefs.getString("code","");long created=prefs.getLong("created",0);prefs.edit().clear().apply();return System.currentTimeMillis()-created<=7200000&&code.matches("[1-9][0-9]{8}")?code:"";}
        @JavascriptInterface public void callRinging(boolean incoming){main.post(()->ring(incoming));}
        @JavascriptInterface public void stopCallRinging(){main.post(MainActivity.this::stopRinging);}
        @JavascriptInterface public void closeCall(String id){main.post(()->MeetingActivity.closeCall(id));}
        @JavascriptInterface public void openCall(String code,String token,String name,String id,String peer,String mode,String stunURLs){main.post(()->{if(code==null||!code.matches("[1-9][0-9]{8}")||token==null||!token.matches("[a-f0-9]{64}")||id==null||!id.matches("[a-f0-9]{32}")||!("audio".equals(mode)||"video".equals(mode)))return;stopRinging();startActivity(new Intent(MainActivity.this,MeetingActivity.class).putExtra("code",code).putExtra("token",token).putExtra("name",name).putExtra("microphone",true).putExtra("camera","video".equals(mode)).putExtra("call_id",id).putExtra("call_mode",mode).putExtra("peer_name",peer).putExtra("rtc_config",stunURLs));});}

        @JavascriptInterface public void scanQRCode(){main.post(()->startActivityForResult(new Intent(MainActivity.this,QrScannerActivity.class),42));}
        @JavascriptInterface public void openMeeting(String code,String token,String name,boolean host,boolean microphone,boolean camera,String server,String stunURLs){main.post(()->{if(!code.matches("[1-9][0-9]{8}")||!token.matches("[a-f0-9]{64}"))return;Intent meeting=new Intent(MainActivity.this,MeetingActivity.class).putExtra("code",code).putExtra("token",token).putExtra("name",name).putExtra("host",host).putExtra("microphone",microphone).putExtra("camera",camera).putExtra("server",server).putExtra("rtc_config",stunURLs);startActivity(meeting);});}
        @JavascriptInterface public void requestSharing(){main.post(()->{if(app().sharing)return;new AlertDialog.Builder(MainActivity.this).setTitle("开启屏幕共享").setMessage("好友接受远程协助后可以看到你的屏幕。你可以随时在通知中停止共享。远程操作还需要单独开启触控权限。").setNegativeButton("取消",null).setPositiveButton("继续",(d,w)->{MediaProjectionManager mgr=(MediaProjectionManager)getSystemService(MEDIA_PROJECTION_SERVICE);startActivityForResult(mgr.createScreenCaptureIntent(),50);}).show();});}
        @JavascriptInterface public void requestNotifications(){main.post(()->{if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},60);});}
        @JavascriptInterface public void downloadDriveFile(String id,String name){if(id!=null&&id.matches("[a-f0-9]{32}"))saveCloudDownload("/api/drive/files/"+id,name);}
        private void saveCloudDownload(String path,String name){main.post(()->{pendingDownload=origin+path;pendingCookies=CookieManager.getInstance().getCookie(origin);Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("application/octet-stream");i.putExtra(Intent.EXTRA_TITLE,name.replace('/','_').replace('\\','_'));startActivityForResult(i,41);});}
        @JavascriptInterface public void downloadFile(String path,String name){main.post(()->{if(!path.matches("/api/files/[a-f0-9]{32}"))return;pendingDownload=origin+path;pendingCookies=CookieManager.getInstance().getCookie(origin);Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("application/octet-stream");i.putExtra(Intent.EXTRA_TITLE,name.replace('/','_').replace('\\','_'));startActivityForResult(i,41);});}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==42){if(result==RESULT_OK&&data!=null&&web!=null){String value=data.getStringExtra("qr");if(value!=null)web.evaluateJavascript("window.WeLinkQrScanned&&window.WeLinkQrScanned("+org.json.JSONObject.quote(value)+")",null);}return;}if(request==40){Uri uri=result==RESULT_OK&&data!=null?data.getData():null;if(uri==null&&result==RESULT_OK&&data!=null&&data.getClipData()!=null&&data.getClipData().getItemCount()>0)uri=data.getClipData().getItemAt(0).getUri();finishChooser(uri==null?null:new Uri[]{uri});return;}if(request==41&&result==RESULT_OK&&data!=null){Uri destination=data.getData();String address=pendingDownload,cookies=pendingCookies;pendingDownload=null;pendingCookies=null;if(address!=null)Executors.newSingleThreadExecutor().execute(()->download(address,cookies,destination));return;}if(request==50&&result==RESULT_OK&&data!=null){Intent service=new Intent(this,CaptureService.class).putExtra("result",result).putExtra("projection",data);startForegroundService(service);if(!RemoteAccessibilityService.available())new AlertDialog.Builder(this).setTitle("远程触控权限").setMessage("仅观看不需要此权限。如需好友操作手机，请在系统无障碍设置中主动启用 WeLink 远程触控。").setNegativeButton("仅共享屏幕",null).setPositiveButton("前往设置",(d,w)->startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))).show();}}
    private void download(String address,String cookies,Uri destination){HttpURLConnection conn=null;try{conn=(HttpURLConnection)new URL(address).openConnection();conn.setConnectTimeout(15000);conn.setReadTimeout(30000);conn.setRequestProperty("Cookie",cookies==null?"":cookies);if(conn.getResponseCode()!=200)throw new IOException("下载失败："+conn.getResponseCode());try(InputStream in=conn.getInputStream();OutputStream out=getContentResolver().openOutputStream(destination,"w")){if(out==null)throw new IOException("无法保存文件");byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}main.post(()->Toast.makeText(this,"文件已保存",Toast.LENGTH_SHORT).show());}catch(Exception e){main.post(()->Toast.makeText(this,e.getMessage(),Toast.LENGTH_LONG).show());}finally{if(conn!=null)conn.disconnect();}}
    @Override public void onBackPressed(){if(web!=null){web.evaluateJavascript("(()=>{const b=document.querySelector('.remote-screen [data-action=stop-remote]')||document.querySelector('.modal [data-action=close-modal]')||document.querySelector('.in-chat [data-action=back]');if(b){b.click();return true}return false})()",value->{if(!"true".equals(value))moveTaskToBack(true);});}else super.onBackPressed();}
    @Override protected void onPause(){if(web!=null)web.evaluateJavascript("window.WeLinkMediaBackground&&window.WeLinkMediaBackground()",null);super.onPause();}
    @Override protected void onDestroy(){stopRinging();io.shutdown();if(current.get()==this)current.clear();finishChooser(null);if(pendingWebPermission!=null){pendingWebPermission.deny();pendingWebPermission=null;}if(web!=null){web.removeJavascriptInterface("WeLinkAndroid");web.destroy();web=null;}super.onDestroy();}
}

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
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private WebView web;
    private String origin;
    private ValueCallback<Uri[]> chooser;
    private String pendingDownload;
    private String pendingCookies;
    private final Handler main=new Handler(Looper.getMainLooper());
    private WeLinkApp app(){return (WeLinkApp)getApplication();}
    @Override public void onCreate(Bundle state){super.onCreate(state);getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);start();}
    private void start(){
        LinearLayout loading=new LinearLayout(this);loading.setGravity(Gravity.CENTER);loading.setOrientation(LinearLayout.VERTICAL);loading.setBackgroundColor(Color.rgb(239,248,255));TextView title=new TextView(this);title.setText(R.string.app_name);title.setTextColor(Color.rgb(0,153,255));title.setTextSize(34);loading.addView(title);setContentView(loading);
        Executors.newSingleThreadExecutor().execute(()->{try{String url=app().engine().url();origin="http://"+Uri.parse(url).getAuthority();main.post(()->{try{showWeb(url);}catch(RuntimeException unavailable){title.setText("系统 WebView 组件不可用，请更新 Android System WebView 后重试。");title.setTextSize(16);Button retry=new Button(this);retry.setText(R.string.retry);retry.setOnClickListener(v->start());loading.addView(retry);setContentView(loading);}});}catch(Exception e){main.post(()->{title.setText(getString(R.string.startup_failed,e.getMessage()));title.setTextSize(16);Button retry=new Button(this);retry.setText(R.string.retry);retry.setOnClickListener(v->start());loading.addView(retry);});}});
    }
    @SuppressWarnings("SetJavaScriptEnabled")
    private void showWeb(String url){
        android.webkit.WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);web=new WebView(this);web.setBackgroundColor(Color.WHITE);WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setMediaPlaybackRequiresUserGesture(true);settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.addJavascriptInterface(new Bridge(),"WeLinkAndroid");
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !isLocal(request.getUrl());}
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,android.net.http.SslError error){handler.cancel();}
            @Override public void onPageFinished(WebView view,String url){CookieManager.getInstance().flush();}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){if(chooser!=null)chooser.onReceiveValue(null);chooser=callback;Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);String[] types=params.getAcceptTypes();intent.setType(types.length>0&&types[0].startsWith("image/")?"image/*":"*/*");startActivityForResult(intent,40);return true;}
        });
        setContentView(web);getWindow().getDecorView();if(Build.VERSION.SDK_INT>=30){getWindow().setDecorFitsSystemWindows(true);}web.loadUrl(url);
    }
    private boolean isLocal(Uri uri){return origin!=null&&uri.toString().startsWith(origin+"/");}
    private final class Bridge {
        @JavascriptInterface public void scanQRCode(){main.post(()->startActivityForResult(new Intent(MainActivity.this,QrScannerActivity.class),42));}
        @JavascriptInterface public void openMeeting(String code,String token,String name,boolean host,boolean microphone,boolean camera){main.post(()->{if(!code.matches("[1-9][0-9]{8}")||!token.matches("[a-f0-9]{64}"))return;Intent meeting=new Intent(MainActivity.this,MeetingActivity.class).putExtra("code",code).putExtra("token",token).putExtra("name",name).putExtra("host",host).putExtra("microphone",microphone).putExtra("camera",camera);startActivity(meeting);});}
        @JavascriptInterface public void requestSharing(){main.post(()->{if(app().sharing)return;new AlertDialog.Builder(MainActivity.this).setTitle("开启屏幕共享").setMessage("好友接受远程协助后可以看到你的屏幕。你可以随时在通知中停止共享。远程操作还需要单独开启触控权限。").setNegativeButton("取消",null).setPositiveButton("继续",(d,w)->{MediaProjectionManager mgr=(MediaProjectionManager)getSystemService(MEDIA_PROJECTION_SERVICE);startActivityForResult(mgr.createScreenCaptureIntent(),50);}).show();});}
        @JavascriptInterface public void requestNotifications(){main.post(()->{if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},60);});}
        @JavascriptInterface public void downloadFile(String path,String name){main.post(()->{if(!path.matches("/api/files/[a-f0-9]{32}"))return;pendingDownload=origin+path;pendingCookies=CookieManager.getInstance().getCookie(origin);Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("application/octet-stream");i.putExtra(Intent.EXTRA_TITLE,name.replace('/','_').replace('\\','_'));startActivityForResult(i,41);});}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==42){if(result==RESULT_OK&&data!=null&&web!=null){String value=data.getStringExtra("qr");if(value!=null)web.evaluateJavascript("window.WeLinkQrScanned&&window.WeLinkQrScanned("+org.json.JSONObject.quote(value)+")",null);}return;}if(request==40){if(chooser!=null){chooser.onReceiveValue(result==RESULT_OK&&data!=null?new Uri[]{data.getData()}:null);chooser=null;}return;}if(request==41&&result==RESULT_OK&&data!=null){Uri destination=data.getData();String address=pendingDownload,cookies=pendingCookies;pendingDownload=null;pendingCookies=null;if(address!=null)Executors.newSingleThreadExecutor().execute(()->download(address,cookies,destination));return;}if(request==50&&result==RESULT_OK&&data!=null){Intent service=new Intent(this,CaptureService.class).putExtra("result",result).putExtra("projection",data);startForegroundService(service);if(!RemoteAccessibilityService.available())new AlertDialog.Builder(this).setTitle("远程触控权限").setMessage("仅观看不需要此权限。如需好友操作手机，请在系统无障碍设置中主动启用 WeLink 远程触控。").setNegativeButton("仅共享屏幕",null).setPositiveButton("前往设置",(d,w)->startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))).show();}}
    private void download(String address,String cookies,Uri destination){HttpURLConnection conn=null;try{conn=(HttpURLConnection)new URL(address).openConnection();conn.setConnectTimeout(15000);conn.setReadTimeout(30000);conn.setRequestProperty("Cookie",cookies==null?"":cookies);if(conn.getResponseCode()!=200)throw new IOException("下载失败："+conn.getResponseCode());try(InputStream in=conn.getInputStream();OutputStream out=getContentResolver().openOutputStream(destination,"w")){if(out==null)throw new IOException("无法保存文件");byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}main.post(()->Toast.makeText(this,"文件已保存",Toast.LENGTH_SHORT).show());}catch(Exception e){main.post(()->Toast.makeText(this,e.getMessage(),Toast.LENGTH_LONG).show());}finally{if(conn!=null)conn.disconnect();}}
    @Override public void onBackPressed(){if(web!=null){web.evaluateJavascript("(()=>{const b=document.querySelector('.remote-screen [data-action=stop-remote]')||document.querySelector('.modal [data-action=close-modal]')||document.querySelector('.in-chat [data-action=back]');if(b){b.click();return true}return false})()",value->{if(!"true".equals(value))moveTaskToBack(true);});}else super.onBackPressed();}
    @Override protected void onDestroy(){if(chooser!=null){chooser.onReceiveValue(null);chooser=null;}if(web!=null){web.removeJavascriptInterface("WeLinkAndroid");web.destroy();web=null;}super.onDestroy();}
}

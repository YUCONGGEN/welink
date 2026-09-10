package cn.welink.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.hardware.Camera;
import android.net.Uri;
import android.os.Bundle;
import android.view.*;
import android.widget.*;
import com.google.zxing.*;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Decodes locally. Scanned text is returned to the signed-in page for confirmation. */
@SuppressWarnings("deprecation")
public final class QrScannerActivity extends Activity implements SurfaceHolder.Callback {
    private Camera camera;
    private SurfaceView preview;
    private TextView notice;
    private final ExecutorService decoder=Executors.newSingleThreadExecutor();
    private final AtomicBoolean decoding=new AtomicBoolean();
    private boolean resumed,finished;
    private long lastFrame;
    @Override public void onCreate(Bundle state){super.onCreate(state);getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(Color.WHITE);
        LinearLayout top=new LinearLayout(this);top.setGravity(Gravity.CENTER_VERTICAL);top.setPadding(dp(14),0,dp(14),0);
        Button back=new Button(this);back.setText("返回");back.setOnClickListener(v->finish());top.addView(back);
        TextView title=new TextView(this);title.setText("扫一扫");title.setTextSize(19);title.setTextColor(0xff22262b);title.setGravity(Gravity.CENTER);top.addView(title,new LinearLayout.LayoutParams(0,dp(58),1));
        Button album=new Button(this);album.setText("图片");album.setOnClickListener(v->{Intent select=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(select,2);});top.addView(album);root.addView(top);
        FrameLayout stage=new FrameLayout(this);stage.setBackgroundColor(0xffeef3f8);preview=new SurfaceView(this);preview.getHolder().addCallback(this);stage.addView(preview,new FrameLayout.LayoutParams(-1,-1));stage.addView(new FrameGuide(this),new FrameLayout.LayoutParams(-1,-1));root.addView(stage,new LinearLayout.LayoutParams(-1,0,1));
        notice=new TextView(this);notice.setText("将电脑上的 WeLink 登录二维码放入框内\n扫码后还需在手机上确认登录");notice.setTextColor(0xff6b7c90);notice.setGravity(Gravity.CENTER);notice.setTextSize(14);notice.setPadding(dp(16),dp(20),dp(16),dp(20));root.addView(notice,new LinearLayout.LayoutParams(-1,dp(100)));setContentView(root);
        if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.CAMERA},1);
    }
    @Override protected void onResume(){super.onResume();resumed=true;openCamera();}
    @Override protected void onPause(){resumed=false;closeCamera();super.onPause();}
    @Override protected void onDestroy(){decoder.shutdownNow();super.onDestroy();}
    @Override public void surfaceCreated(SurfaceHolder holder){openCamera();}
    @Override public void surfaceChanged(SurfaceHolder holder,int format,int width,int height){}
    @Override public void surfaceDestroyed(SurfaceHolder holder){closeCamera();}
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==1){if(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED)openCamera();else notice.setText("相机权限未开启。可以选择二维码图片，或返回后重新授权。");}}
    private void openCamera(){if(!resumed||camera!=null||!preview.getHolder().getSurface().isValid()||checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)return;
        try{int id=0;Camera.CameraInfo info=new Camera.CameraInfo();for(int i=0;i<Camera.getNumberOfCameras();i++){Camera.getCameraInfo(i,info);if(info.facing==Camera.CameraInfo.CAMERA_FACING_BACK){id=i;break;}}Camera.getCameraInfo(id,info);camera=Camera.open(id);Camera.Parameters parameters=camera.getParameters();Camera.Size chosen=null;for(Camera.Size size:parameters.getSupportedPreviewSizes())if(size.width<=1280&&(chosen==null||size.width>chosen.width))chosen=size;if(chosen!=null)parameters.setPreviewSize(chosen.width,chosen.height);parameters.setPreviewFormat(ImageFormat.NV21);if(parameters.getSupportedFocusModes().contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE))parameters.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);camera.setParameters(parameters);int degrees=getWindowManager().getDefaultDisplay().getRotation()*90;camera.setDisplayOrientation((info.orientation-degrees+360)%360);camera.setPreviewDisplay(preview.getHolder());Camera.Size size=camera.getParameters().getPreviewSize();final int width=size.width,height=size.height;
            camera.setPreviewCallback((bytes,source)->{if(!resumed||finished||System.currentTimeMillis()-lastFrame<350||!decoding.compareAndSet(false,true))return;lastFrame=System.currentTimeMillis();byte[] data=bytes.clone();decoder.execute(()->{try{decode(new PlanarYUVLuminanceSource(data,width,height,0,0,width,height,false));}catch(Exception ignored){}finally{decoding.set(false);}});});camera.startPreview();
        }catch(Exception error){closeCamera();notice.setText("相机无法开启，可选择二维码图片。请检查相机权限及占用情况。");}
    }
    private void closeCamera(){if(camera!=null){try{camera.setPreviewCallback(null);camera.stopPreview();}catch(RuntimeException ignored){}camera.release();camera=null;}}
    private void decode(LuminanceSource source)throws Exception{String value=new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source))).getText();runOnUiThread(()->result(value));}
    private void result(String value){if(finished||isFinishing())return;if(value==null||!value.matches("welink://login/[a-f0-9]{32}\\?key=[a-f0-9]{64}")){notice.setText("这不是 WeLink 登录二维码，请扫描电脑登录界面上的二维码。");return;}finished=true;setResult(RESULT_OK,new Intent().putExtra("qr",value));finish();}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request!=2||result!=RESULT_OK||data==null||data.getData()==null)return;Uri uri=data.getData();decoder.execute(()->{Bitmap bitmap=null;try{BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;try(InputStream in=getContentResolver().openInputStream(uri)){BitmapFactory.decodeStream(in,null,options);}options.inSampleSize=1;while(Math.max(options.outWidth,options.outHeight)/options.inSampleSize>2048)options.inSampleSize*=2;options.inJustDecodeBounds=false;try(InputStream in=getContentResolver().openInputStream(uri)){bitmap=BitmapFactory.decodeStream(in,null,options);}if(bitmap==null)throw new IllegalArgumentException("无法读取图片");int width=bitmap.getWidth(),height=bitmap.getHeight();int[] pixels=new int[width*height];bitmap.getPixels(pixels,0,width,0,0,width,height);decode(new RGBLuminanceSource(width,height,pixels));}catch(Exception failure){runOnUiThread(()->notice.setText("图片中未识别到登录二维码，请选择清晰、完整的二维码图片。"));}finally{if(bitmap!=null)bitmap.recycle();}});}
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private final class FrameGuide extends View {private final Paint pen=new Paint(Paint.ANTI_ALIAS_FLAG);FrameGuide(Activity activity){super(activity);}@Override protected void onDraw(Canvas canvas){float side=Math.min(getWidth(),getHeight())*.72f,left=(getWidth()-side)/2,top=(getHeight()-side)/2;pen.setColor(0xff0099ff);pen.setStrokeWidth(dp(3));pen.setStyle(Paint.Style.STROKE);float corner=dp(25);for(int i=0;i<4;i++){canvas.save();canvas.rotate(90*i,getWidth()/2f,getHeight()/2f);Path path=new Path();path.moveTo(left,top+corner);path.lineTo(left,top);path.lineTo(left+corner,top);canvas.drawPath(path,pen);canvas.restore();}}}
}

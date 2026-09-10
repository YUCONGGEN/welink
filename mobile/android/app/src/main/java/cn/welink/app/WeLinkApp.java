package cn.welink.app;

import android.app.Application;
import cn.welink.bridge.core.Core;
import cn.welink.bridge.core.Engine;
import org.json.JSONObject;
import java.io.*;

public final class WeLinkApp extends Application {
    private Engine engine;
    volatile String notice="";
    volatile boolean sharing;
    synchronized Engine engine() throws Exception { if(engine==null){installUiAssets();engine=Core.start(getFilesDir().getAbsolutePath());}return engine; }
    private void installUiAssets() throws IOException {
        File directory=new File(getFilesDir(),"ui");if(!directory.exists()&&!directory.mkdirs())throw new IOException("无法创建界面目录");
        String[] names=getAssets().list("ui");if(names==null||names.length==0)throw new IOException("安装包缺少界面资源");
        for(String name:names){if(name.contains("/")||name.contains("\\"))throw new IOException("界面资源名称无效");File target=new File(directory,name),temporary=new File(directory,name+".new");try(InputStream in=getAssets().open("ui/"+name);OutputStream out=new FileOutputStream(temporary)){byte[] data=new byte[65536];for(int n;(n=in.read(data))!=-1;)out.write(data,0,n);}if(!temporary.renameTo(target))throw new IOException("无法更新界面资源");}
    }
    synchronized Engine existingEngine(){return engine;}
    JSONObject state(){try{return new JSONObject(engine().stateJSON());}catch(Exception e){return new JSONObject();}}
}

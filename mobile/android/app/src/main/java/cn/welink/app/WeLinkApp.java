package cn.welink.app;

import android.app.Application;
import cn.welink.bridge.core.Core;
import cn.welink.bridge.core.Engine;
import org.json.JSONObject;
import java.io.*;

public final class WeLinkApp extends Application {
    private Engine engine;
	private MessageNotifications messages;
	@Override public void onCreate(){super.onCreate();messages=new MessageNotifications(this);}
	MessageNotifications messages(){return messages;}
    volatile String notice="";
    volatile boolean sharing;
    synchronized Engine engine() throws Exception { if(engine==null){installUiAssets();engine=Core.start(getFilesDir().getAbsolutePath());engine.setNotificationListener(messages::receive);try{engine.restoreNotifications();}catch(Exception ignored){}}return engine; }
    private void installUiAssets() throws IOException {
        UiAssets.install(new UiAssets.Source(){
            public String[] list(String path) throws IOException{return getAssets().list(path);}
            public InputStream open(String path) throws IOException{return getAssets().open(path);}
        },new File(getFilesDir(),"ui"));
    }
    synchronized Engine existingEngine(){return engine;}
    JSONObject state(){try{return new JSONObject(engine().stateJSON());}catch(Exception e){return new JSONObject();}}
}

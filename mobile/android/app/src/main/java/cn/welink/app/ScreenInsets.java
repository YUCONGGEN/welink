package cn.welink.app;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;

/** Keep every Activity's content inside system bars, cutouts and the keyboard. */
final class ScreenInsets {
    static void theme(Activity activity,boolean dark) {
        Window window=activity.getWindow();int color=dark?0xff22252b:Color.WHITE;
        window.setStatusBarColor(color);window.setNavigationBarColor(color);
        activity.findViewById(android.R.id.content).setBackgroundColor(color);
        int light=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        int flags=window.getDecorView().getSystemUiVisibility();
        window.getDecorView().setSystemUiVisibility(dark?flags&~light:flags|light);
        if(Build.VERSION.SDK_INT>=30){android.view.WindowInsetsController controller=window.getInsetsController();if(controller!=null){int mask=android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;controller.setSystemBarsAppearance(dark?0:mask,mask);}}
    }
    static void install(Activity activity) {
        Window window=activity.getWindow();
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        window.setStatusBarColor(Color.WHITE);window.setNavigationBarColor(Color.WHITE);
        int light=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        if(Build.VERSION.SDK_INT>=30)window.setDecorFitsSystemWindows(false);
        else light|=View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
        window.getDecorView().setSystemUiVisibility(window.getDecorView().getSystemUiVisibility()|light);
        View content=activity.findViewById(android.R.id.content);
        content.setBackgroundColor(Color.WHITE);
        int topGap=Math.round(6*activity.getResources().getDisplayMetrics().density);
        int bottomGap=Math.round(8*activity.getResources().getDisplayMetrics().density);
        content.setOnApplyWindowInsetsListener((view,insets)->{
            int left,top,right,bottom;
            if(Build.VERSION.SDK_INT>=30){
                android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard=insets.getInsets(WindowInsets.Type.ime());
                left=bars.left;top=bars.top;right=bars.right;bottom=Math.max(bars.bottom,keyboard.bottom);
            }else{
                left=insets.getSystemWindowInsetLeft();top=insets.getSystemWindowInsetTop();right=insets.getSystemWindowInsetRight();bottom=insets.getSystemWindowInsetBottom();
                if(Build.VERSION.SDK_INT>=28&&insets.getDisplayCutout()!=null){
                    android.view.DisplayCutout cutout=insets.getDisplayCutout();
                    left=Math.max(left,cutout.getSafeInsetLeft());top=Math.max(top,cutout.getSafeInsetTop());right=Math.max(right,cutout.getSafeInsetRight());bottom=Math.max(bottom,cutout.getSafeInsetBottom());
                }
            }
            view.setPadding(left,top+topGap,right,bottom+bottomGap);
            if(Build.VERSION.SDK_INT>=30)return WindowInsets.CONSUMED;
            WindowInsets consumed=insets.consumeSystemWindowInsets();
            return Build.VERSION.SDK_INT>=28?consumed.consumeDisplayCutout():consumed;
        });
        content.requestApplyInsets();
    }
}

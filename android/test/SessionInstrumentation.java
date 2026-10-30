package org.appleseed.test;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.UiModeManager;
import android.content.res.Configuration;
import android.content.Intent;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.content.ClipDescription;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.WindowInsets;
import android.view.View;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.JsPromptResult;
import java.lang.reflect.Field;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Runs against the signed APK in a disposable emulator; never uses a real Mac or credentials. */
public final class SessionInstrumentation extends Instrumentation {
    private static final String ORIGIN = "https://mac.example.ts.net:9447/";
    private String stage = "launch";
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            getTargetContext().getSharedPreferences("MainActivity", 0).edit().putString("macURL", ORIGIN).putBoolean("notificationAsked", true).commit();
            Activity first = open();
            Object session = field(first, "remote"); WebView web = (WebView) field(session, "web");
            stage = "fixture"; fixture(session, web);
            stage = "Apps and browser tabs"; testApps(web);
            boolean tools = "true".equals(eval(web, "JSON.parse(window.prompt('AppleSeedNative','{\"op\":\"capabilities\"}')).tools"));
            stage = "copy code";
            boolean copyAccepted = "true".equals(eval(web, "window.prompt('AppleSeedNative',JSON.stringify({op:'copy-portal-code',code:'ABCD2345'}))"));
            require(tools && copyAccepted, "Copy code capability did not match the edition");
            if (tools) {
                AtomicReference<ClipData> copied = new AtomicReference<>();
                runOnMainSync(() -> copied.set(getTargetContext().getSystemService(ClipboardManager.class).getPrimaryClip()));
                require(copied.get() != null && "ABCD2345".contentEquals(copied.get().getItemAt(0).getText()), "Clipboard did not contain the session code");
                require(copied.get().getDescription().getExtras().getBoolean(ClipDescription.EXTRA_IS_SENSITIVE), "Code clipboard preview was not marked sensitive");
            }
            require(!"true".equals(eval(web, "window.prompt('AppleSeedNative',JSON.stringify({op:'copy-portal-code',code:'not-a-session-code'}))")), "Copy bridge accepted arbitrary text");
            String started = eval(web, "window.prompt('AppleSeedNative',JSON.stringify({op:'session-start',seconds:600}))");
            stage = "fullscreen window";
            require("true".equals(eval(web,"window.prompt('AppleSeedNative',JSON.stringify({op:'fullscreen',enabled:true}))")), "Fullscreen request failed");
            AtomicReference<Boolean> immersive = new AtomicReference<>(false);
            View firstRoot = (View) field(first,"root");
            for (int i=0;i<40 && !immersive.get();i++) {
                runOnMainSync(() -> {
                    WindowInsets insets = firstRoot.getRootWindowInsets();
                    immersive.set(insets != null && !insets.isVisible(WindowInsets.Type.statusBars()) && !insets.isVisible(WindowInsets.Type.navigationBars()) && firstRoot.getPaddingTop()==0 && firstRoot.getPaddingBottom()==0);
                });
                if(!immersive.get()) SystemClock.sleep(50);
            }
            require(immersive.get(), "Fullscreen did not remove system bars and reserved space");
            require(Boolean.TRUE.equals(field(session,"requestedFullscreen")), "Fullscreen choice was not retained");
            require("true".equals(eval(web,"window.prompt('AppleSeedNative',JSON.stringify({op:'fullscreen',enabled:false}))")), "Exit fullscreen request failed");
            require(Boolean.FALSE.equals(field(session,"requestedFullscreen")), "Exit fullscreen was not retained");
            require("true".equals(started), "Native bridge could not start session: " + started + "; url=" + eval(web, "location.href") + "; owner=" + ((java.lang.ref.WeakReference<?>) field(session, "owner")).get());
            Object lifetime = field(session, "lifetime"); long deadline = (long) field(lifetime, "deadline");
            for (String mode : new String[]{"light", "dark", "auto"}) {
                stage = "select " + mode;
                require("true".equals(eval(web, "window.prompt('AppleSeedNative',JSON.stringify({op:'appearance-preference',mode:'" + mode + "'}))")), "Theme change rejected: " + mode);
                require("true".equals(eval(web, "JSON.parse(window.prompt('AppleSeedNative','{\"op\":\"settings\"}')).appearance==='" + mode + "'")), "Theme choice was not saved");
                if (!"auto".equals(mode)) awaitTheme(web, mode);
                require(field(session,"web")==web && (long)field(lifetime,"deadline")==deadline && !first.isDestroyed(), "Theme change recreated the session or Activity");
            }
            require(!"true".equals(eval(web, "window.prompt('AppleSeedNative',JSON.stringify({op:'appearance-preference',mode:'invalid'}))")), "Invalid appearance was accepted");
            if (android.os.Build.VERSION.SDK_INT >= 31) {
                UiModeManager manager = getTargetContext().getSystemService(UiModeManager.class);
                boolean wasDark = (getTargetContext().getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
                try {
                    stage = "Auto night"; manager.setApplicationNightMode(UiModeManager.MODE_NIGHT_YES); awaitTheme(web,"dark");
                    stage = "Auto day"; manager.setApplicationNightMode(UiModeManager.MODE_NIGHT_NO); awaitTheme(web,"light");
                    require(!first.isDestroyed() && field(session,"web")==web && (long)field(lifetime,"deadline")==deadline,"Auto theme interrupted the session");
                } finally { manager.setApplicationNightMode(wasDark ? UiModeManager.MODE_NIGHT_YES : UiModeManager.MODE_NIGHT_NO); }
            }
            stage = "Back dispatch";
            eval(web, "window.seedBackCount=0;window.appleSeedBack=()=>{window.seedBackCount++;return true;}");
            runOnMainSync(first::onBackPressed);
            for (int i=0;i<30 && !"1".equals(eval(web,"window.seedBackCount"));i++) SystemClock.sleep(50);
            require("1".equals(eval(web,"window.seedBackCount")), "Android Back did not reach the page control layer");
            require(!first.isFinishing() && field(session,"web")==web && (long)field(lifetime,"deadline")==deadline, "Back recreated or ended the session");
            eval(web,"delete window.appleSeedBack");
            stage = "background session"; runOnMainSync(first::finishAndRemoveTask); destroyed(first); SystemClock.sleep(1500);
            require(!(boolean) field(session, "closed"), "Swiping task away destroyed session");
            require((boolean) field(lifetime, "active"), "Task removal stopped foreground service");
            require(field(session, "web") == web, "Activity destruction destroyed WebView");
            require(((java.lang.ref.WeakReference<?>) field(session, "owner")).get() == null, "Destroyed Activity was retained");
            require(!"true".equals(eval(web, "window.prompt('AppleSeedNative',JSON.stringify({op:'copy-portal-code',code:'ABCD2345'}))")), "Detached page could change the clipboard");
            Activity second = open();
            require(field(second, "remote") == session, "Reopen created another session");
            require((long) field(lifetime, "deadline") == deadline, "Reopen restarted timer");
            require("\"kept\"".equals(eval(web, "window.seedMarker")), "Reopen reloaded page");
            require("true".equals(eval(web, "JSON.parse(window.prompt('AppleSeedNative','{\"op\":\"settings\"}')).appearance==='auto'")), "Reopen lost saved appearance");
            require("true".equals(eval(web, "window.prompt('AppleSeedNative',JSON.stringify({op:'session-start',seconds:1}))")), "Apply timer failed");
            runOnMainSync(second::finishAndRemoveTask); destroyed(second);
            for (int i = 0; i < 50 && !(boolean) field(session, "closed"); i++) SystemClock.sleep(100);
            require((boolean) field(session, "closed"), "Timer did not end background session");
            Activity third = open(); Object last = field(third, "remote"); WebView lastWeb = (WebView) field(last, "web"); stage = "replacement fixture"; fixture(last, lastWeb);
            require("true".equals(eval(lastWeb, "window.prompt('AppleSeedNative',JSON.stringify({op:'session-start',seconds:0}))")), "No timer failed");
            SystemClock.sleep(1000);
            runOnMainSync(third::finishAndRemoveTask); destroyed(third);
            getTargetContext().startService(new Intent().setClassName("org.appleseed.remote", "org.appleseed.remote.SessionService").setAction("disconnect"));
            for (int i = 0; i < 50 && !(boolean) field(last, "closed"); i++) SystemClock.sleep(100);
            require((boolean) field(last, "closed"), "Notification Disconnect did not close detached session");
            result.putString("stream", "Native Android AppleSeed checks passed: Apps sheet, Chrome tabs, exact tab selection, monitor follow, filtering, three-finger gesture and metadata cleanup; immersive fullscreen and exit; Back dispatch without ending session; Light/Dark/Auto persistence and live system-theme changes without session recreation; " + "Copy code and sensitive clipboard flag" + "; invalid/background copy rejection; task removal, Activity release, same page/deadline, background expiry and notification Disconnect.\n");
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            result.putString("stream", "FAILED at " + stage + ": " + error + "\n"); finish(Activity.RESULT_CANCELED, result);
        }
    }
    private Activity open() { return startActivitySync(new Intent().setClassName("org.appleseed.remote", "org.appleseed.remote.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
    private Object field(Object target, String name) throws Exception { Field field = target.getClass().getDeclaredField(name); field.setAccessible(true); return field.get(target); }
    private void fixture(Object session, WebView web) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (InputStream input = getTargetContext().getAssets().open("client/appearance.js")) { byte[] chunk = new byte[4096]; int count; while ((count=input.read(chunk))!=-1) bytes.write(chunk,0,count); }
        String appearance = new String(bytes.toByteArray(),StandardCharsets.UTF_8).replace("export function mountAppearance", "function mountAppearance");
        String html = "<html><head><meta name='theme-color' content='#090a0c'></head><body><div id='preferences'></div><button id='tools-toggle'></button><div id='session-tools'></div><script>window.seedMarker='kept';window.addEventListener('appleseed-appearance',e=>window.seedThemeEvent=e.detail);"+appearance+";</script></body></html>";
        CountDownLatch loaded = new CountDownLatch(1);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        runOnMainSync(() -> {
            WebViewClient client = web.getWebViewClient(); WebChromeClient chrome = web.getWebChromeClient();
            web.stopLoading();
            web.setWebChromeClient(new WebChromeClient() {
                @Override public boolean onJsPrompt(WebView view, String url, String message, String payload, JsPromptResult result) {
                    // Only this synthetic page uses loadDataWithBaseURL, whose prompt URL is data:.
                    return chrome.onJsPrompt(view, ORIGIN, message, payload, result);
                }
            });
            web.setWebViewClient(new WebViewClient() {
                @Override public void onPageFinished(WebView view, String url) {
                    view.evaluateJavascript("window.seedMarker", value -> {
                        if (!"\"kept\"".equals(value) || loaded.getCount() == 0) return;
                        try {
                            // The initial, deliberately nonexistent Mac can fail before fixture setup.
                            // Clear that old navigation's state, then exercise production page completion.
                            Field failed = session.getClass().getDeclaredField("loadFailed"); failed.setAccessible(true); failed.setBoolean(session, false);
                            client.onPageFinished(view, ORIGIN);
                        } catch (Throwable error) { failure.set(error); }
                        loaded.countDown();
                    });
                }
            });
            web.loadDataWithBaseURL(ORIGIN, html, "text/html", "UTF-8", null);
        });
        require(loaded.await(10, TimeUnit.SECONDS), "Fixture page completion timed out");
        require(failure.get() == null, "Fixture page completion failed: " + failure.get());
        // Finish the trusted synthetic page through the production callback.
        for (int i = 0; i < 50 && !(boolean) field(session, "pageReady"); i++) SystemClock.sleep(100);
        require((boolean) field(session, "pageReady") && !(boolean) field(session, "loadFailed"), "Fixture did not reach production ready state");
        eval(web,"mountAppearance({native:true,nativeCall:(op,value={})=>JSON.parse(window.prompt('AppleSeedNative',JSON.stringify({op,...value}))||'null')})");
    }
    private String asset(String name) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try(InputStream input=getTargetContext().getAssets().open("client/"+name)){byte[] b=new byte[4096];int n;while((n=input.read(b))!=-1)bytes.write(b,0,n);}
        return new String(bytes.toByteArray(),StandardCharsets.UTF_8);
    }
    private void waitForJS(WebView web,String expression) throws Exception {
        for(int i=0;i<50;i++){if("true".equals(eval(web,expression)))return;SystemClock.sleep(100);}
        throw new AssertionError("App switcher condition timed out: "+expression+" state="+eval(web,"JSON.stringify({status:document.getElementById('apps-status')?.textContent,open:document.getElementById('apps-sheet')?.open})"));
    }
    private void testApps(WebView web) throws Exception {
        String source=asset("app-switcher.js").replace("export function", "function").replace("export class", "class");
        String model=asset("desktop-model.js").replace("export function", "function").replace("export class", "class");
        eval(web,"window.SwitcherFixture=(()=>{"+source+";return AppSwitcher;})()");
        eval(web,"window.GestureFixture=(()=>{"+model+";return AppsGesture;})()");
        eval(web,"var style=document.createElement('style');style.textContent="+org.json.JSONObject.quote(asset("style.css"))+";document.head.append(style);var toolbar=document.createElement('nav');toolbar.className='live-toolbar with-quick-actions';toolbar.innerHTML='<button id=keyboard-toggle>Keyboard</button><select id=monitor-select><option value=all>All</option></select>';document.body.append(toolbar);window.appRequests=[];window.selectedMonitor=null;window.testDesktop={$:id=>document.getElementById(id),release:()=>{},toggleKeyboard:()=>{},options:{closeUnlock:()=>{}},nativeCall:()=>{},hostScreens:[{id:'10'},{id:'20'}],monitors:[{id:'all'},{id:'host-10'},{id:'host-20'}],selectMonitor:id=>window.selectedMonitor=id};window.appsFixture=new SwitcherFixture(testDesktop,{session:'test-session',request:async(url,options)=>{const v=JSON.parse(options.body);appRequests.push(v);return {ok:true,json:async()=>v.op==='list'?{ok:true,apps:[{id:'chrome',name:'Chrome',browser:true},{id:'notes',name:'Notes',browser:false}]}:v.op==='tabs'?{ok:true,tabs:[{id:'tab-one',title:'AppleSeed setup',window:1},{id:'tab-two',title:'Project notes',window:2}]}:v.op==='windows'?{ok:true,tabs:[{id:'notes-window',title:'Notes window',window:1,kind:'window'}]}:{ok:true,displayId:'20'}}}});document.getElementById('apps-toggle').click();true");
        waitForJS(web,"document.querySelectorAll('.app-entry').length===2");
        require("true".equals(eval(web,"document.getElementById('apps-sheet').open")),"Apps button did not open sheet");
        eval(web,"document.querySelector('.app-expand').click()");
        waitForJS(web,"document.querySelectorAll('.app-tab').length===2");
        require("true".equals(eval(web,"document.querySelectorAll('.app-tab')[1].textContent.includes('Window 2')")),"Browser window labels missing");
        eval(web,"document.querySelectorAll('.app-tab')[1].click()");
        waitForJS(web,"!document.getElementById('apps-sheet').open");
        require("true".equals(eval(web,"selectedMonitor==='host-20'&&appRequests.at(-1).op==='tab-activate'&&appRequests.at(-1).tab==='tab-two'&&!('password' in appRequests.at(-1))")),"Tab target or monitor selection incorrect");
        require("true".equals(eval(web,"(()=>{const g=new GestureFixture(()=>appsFixture.open());for(let i=0;i<3;i++)g.down(i,i*50,250,'touch');for(let i=0;i<3;i++)g.motion(i,i*50,150);g.up(0);g.up(1);g.up(2);return document.getElementById('apps-sheet').open;})()")),"Three-finger gesture did not open Apps");
        waitForJS(web,"document.querySelectorAll('.app-entry').length===2");
        eval(web,"document.getElementById('apps-search').value='notes';document.getElementById('apps-search').dispatchEvent(new Event('input'))");
        require("true".equals(eval(web,"document.querySelectorAll('.app-entry').length===1&&document.querySelector('.app-activate').textContent.includes('Notes')")),"App filter failed");
        eval(web,"document.querySelector('.app-expand').click()");
        waitForJS(web,"document.querySelectorAll('.app-tab').length===1");
        eval(web,"document.querySelector('.app-tab').click()");
        waitForJS(web,"!document.getElementById('apps-sheet').open");
        require("true".equals(eval(web,"appRequests.at(-1).op==='window-activate'&&appRequests.at(-1).window==='notes-window'")),"App window target incorrect");
        require("true".equals(eval(web,"!document.getElementById('apps-sheet').open&&appsFixture.apps.length===0&&appsFixture.expanded.size===0")),"App metadata retained after close");
        for(int i=0;i<3;i++){
            eval(web,"appsFixture.open();appsFixture.close();appsFixture.open();true");
            waitForJS(web,"document.querySelectorAll('.app-entry').length===2");
            eval(web,"appsFixture.close();true");
        }
        eval(web,"appsFixture.destroy();toolbar.remove();true");
    }
    private String eval(WebView web, String code) throws Exception {
        CountDownLatch done = new CountDownLatch(1); AtomicReference<String> result = new AtomicReference<>();
        runOnMainSync(() -> web.evaluateJavascript(code, value -> { result.set(value); done.countDown(); }));
        require(done.await(10, TimeUnit.SECONDS), "JavaScript callback timed out");
        String value = result.get(); return "\"true\"".equals(value) ? "true" : value;
    }
    private void destroyed(Activity activity) throws Exception {
        for (int i = 0; i < 50 && !activity.isDestroyed(); i++) SystemClock.sleep(100);
        require(activity.isDestroyed(), "Activity not destroyed");
    }
    private void awaitTheme(WebView web,String theme) throws Exception {
        for(int i=0;i<50;i++){ if (("\""+theme+"\"").equals(eval(web,"document.documentElement.dataset.theme"))) return; SystemClock.sleep(100); }
        throw new AssertionError("Theme did not switch to "+theme+": "+eval(web,"JSON.stringify({theme:document.documentElement.dataset.theme,event:window.seedThemeEvent})"));
    }
    private void require(boolean value, String message) { if (!value) throw new AssertionError(message); }
}

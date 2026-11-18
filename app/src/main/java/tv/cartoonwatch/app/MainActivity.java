package tv.cartoonwatch.app;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JsResult;
import android.webkit.JsPromptResult;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.ScriptHandler;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.URLEncoder;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

public class MainActivity extends Activity {
    private static final String APP_ORIGIN = "https://app.cartoonwatch.local/";
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newFixedThreadPool(3);
    private final ExecutorService fallbackIo = Executors.newFixedThreadPool(2);
    private final CatalogRepository catalog = new CatalogRepository();
    private final PlaybackResolver resolver = new PlaybackResolver(catalog);
    private CatalogIndex catalogIndex;
    private ArtworkRepository artwork;
    private ResumeThumbnails resumeThumbnails;
    private final AdBlocker blocker = new AdBlocker();
    private FrameLayout root, browserFrame;
    private LinearLayout playerPanel, toolbar;
    private WebView homeView, player, catalogBrowser;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private TextView playerStatus, playbackMessage;
    private Button cursorButton, shieldButton,playPauseButton;
    private Cursor cursor;
    private SharedPreferences preferences;
    private VoiceControls voice;
    private boolean homeReady;
    private final java.util.ArrayDeque<String> pendingSearches=new java.util.ArrayDeque<>();
    private JSONObject state, currentItem, requestedEpisode, pendingAttempt;
    private String playerScript, frameGuardScript, siteSkipsScript,qualityScript;
    private ScriptHandler frameGuardHandle;
    private boolean frameGuardSupported;
    private boolean cursorMode, toolbarVisible = true, closed;
    private float pointerX, pointerY;
    private long lastProgressSave;
    private int playSession, fallbackIndex;
    private long attemptStarted, lastPlaybackAt;
    private double lastPosition,lastDuration;
    private boolean playbackConfirmed, metadataSeen, mediaPaused, resolving, exhausted, foreground, lastSavedPaused;
    private boolean framePlaying,frameReady,waitingPausedFrame,closingPlayer;
    private Future<?> resolutionTask;
    private Runnable fallbackDeadline;
    private final String[] fallbackProviders={"aniwave","kissanime","hdtoday"};
    private final Runnable hideCursor = () -> { if(cursor!=null) cursor.setVisibility(View.INVISIBLE); };
    private final Runnable hidePlaybackButton=() -> {if(playPauseButton!=null&&!mediaPaused&&!toolbarVisible){playPauseButton.setVisibility(View.GONE);if(player!=null)player.requestFocus();}};
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (!closed) {
                if (foreground && playerPanel != null && playerPanel.getVisibility() == View.VISIBLE) {
                    player.evaluateJavascript("window.CWPlayerTick&&window.CWPlayerTick()", null);
                    if(requestedEpisode!=null && requestedEpisode.has("seriesTitle") && !resolving && !exhausted) {
                        long now=SystemClock.elapsedRealtime();
                        if((!playbackConfirmed && now-attemptStarted>(metadataSeen?20000:9000)) || (playbackConfirmed && !mediaPaused && now-lastPlaybackAt>15000)) tryFallback();
                    }
                }
                main.postDelayed(this, 2000);
            }
        }
    };

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences("cartoonwatch", MODE_PRIVATE);
        catalogIndex=new CatalogIndex(this);
        artwork=new ArtworkRepository(this);
        resumeThumbnails=new ResumeThumbnails(this);
        try { state = new JSONObject(preferences.getString("state", "{}")); } catch (Exception e) { state = new JSONObject(); }
        try {
            if (!state.has("favorites")) state.put("favorites", new JSONArray());
            if (!state.has("history")) state.put("history", new JSONArray());
            if (!state.has("settings")) state.put("settings", new JSONObject().put("provider", "wco").put("adBlock", true));
            state.getJSONObject("settings").put("provider","wco");
            blocker.enabled = state.getJSONObject("settings").optBoolean("adBlock", true);
            playerScript = readAsset("player.js");
            qualityScript=readAsset("quality.js");
            frameGuardScript = readAsset("frame-guard.js");
            siteSkipsScript = readAsset("aniwave-skips.js");
        } catch (Exception e) { playerScript = ""; }
        WebView.setWebContentsDebuggingEnabled(true);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(11,13,20));
        setContentView(root);
        homeView = new WebView(this);
        setupWebView(homeView, false);
        homeView.addJavascriptInterface(new AppBridge(), "CartoonWatch");

        homeView.setWebViewClient(new HomeClient());
        root.addView(homeView, new FrameLayout.LayoutParams(-1,-1));
        createPlayer();
        voice=new VoiceControls(this,new VoiceControls.Callback() {
            @Override public void play() { mediaControl("play",0); }
            @Override public void pause() { mediaControl("pause",0); }
            @Override public void seekTo(long positionMs) { mediaControl("seek",positionMs/1000.0); }
            @Override public void fastForward() { mediaControl("forward",10); }
            @Override public void rewind() { mediaControl("rewind",10); }
            @Override public void search(String query) { dispatchSearch(query); }
        });
        voice.handleIntent(getIntent());
        homeView.loadUrl(APP_ORIGIN + "index.html");
        immersive();
        main.post(poll);
    }

    private final class HomeClient extends WebViewClient {
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!"app.cartoonwatch.local".equals(uri.getHost())) {
                if (request.isForMainFrame() || !"https".equals(uri.getScheme())) return blocker.empty();
                return blocker.shouldBlock(uri.toString()) ? blocker.empty() : null;
            }
            String path = uri.getPath();
            if(path!=null&&path.startsWith("/art/")) {WebResourceResponse cached=artwork.open(path);return cached==null?blocker.empty():cached;}
            if(path!=null&&path.startsWith("/frame/")) {WebResourceResponse cached=resumeThumbnails.response(uri);return cached==null?blocker.empty():cached;}
            if (path == null || path.equals("/")) path = "/index.html";
            if (!path.matches("/[a-zA-Z0-9_.-]+")) return blocker.empty();
            try { return new WebResourceResponse(path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "application/javascript" : "text/html", "UTF-8", getAssets().open(path.substring(1))); }
            catch (Exception e) { return blocker.empty(); }
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !"app.cartoonwatch.local".equals(request.getUrl().getHost()); }
    }

    private void setupWebView(WebView view, boolean playback) {
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(playback);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        if (playback) {

            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
            s.setUserAgentString(s.getUserAgentString().replace("; wv", "").replace("Version/4.0 ", ""));
        }
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, playback);
        view.setBackgroundColor(Color.rgb(11,13,20));
        view.setFocusable(true);
        view.setFocusableInTouchMode(true);
        view.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public boolean onCreateWindow(WebView v, boolean dialog, boolean gesture, android.os.Message message) { return false; }
        });
    }

    private void createPlayer() {
        playerPanel = new LinearLayout(this);
        playerPanel.setOrientation(LinearLayout.VERTICAL);
        playerPanel.setBackgroundColor(Color.BLACK);
        toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setPadding(dp(10),dp(5),dp(10),dp(5));
        toolbar.setBackgroundColor(Color.rgb(20,24,36));
        addButton("‹ Library", () -> closePlayer());
        addButton("Back", () -> { if (player.canGoBack()) player.goBack(); else closePlayer(); });
        addButton("Reload", () -> { if(requestedEpisode!=null && requestedEpisode.has("seriesTitle"))openPlayer(requestedEpisode);else player.reload(); });
        addButton("Fresh session", () -> {
            android.webkit.WebStorage.getInstance().deleteAllData();
            player.clearCache(true);
            CookieManager.getInstance().removeAllCookies(removed -> { CookieManager.getInstance().flush(); player.reload(); });
            toast("Provider session reset. Your watch list is saved.");
        });
        addButton("Fit player", () -> { player.evaluateJavascript("window.CWZoomPlayer&&window.CWZoomPlayer(true)", null); showToolbar(false); });
        cursorButton = addButton("Cursor: off", () -> {
            cursorMode = !cursorMode; cursorButton.setText(cursorMode ? "Cursor: on" : "Cursor: off");
            playPauseButton.setVisibility(View.GONE);
            cursor.setVisibility(cursorMode ? View.VISIBLE : View.GONE); showToolbar(false);
        });
        shieldButton = addButton("Shield: on", () -> {
            blocker.enabled = !blocker.enabled;
            try { state.getJSONObject("settings").put("adBlock", blocker.enabled); persist(); } catch(Exception ignored) {}
            shieldButton.setText(blocker.enabled ? "Shield: on" : "Shield: off");
            configureFrameGuard();
            player.reload();
        });
        addButton("Skip intro", () -> player.evaluateJavascript("window.CWSkipIntro&&window.CWSkipIntro()", null));
        playerStatus = new TextView(this);
        playerStatus.setTextColor(Color.LTGRAY); playerStatus.setTextSize(11);
        playerStatus.setPadding(dp(8),0,0,0);
        toolbar.addView(playerStatus, new LinearLayout.LayoutParams(0,-1,1));
        playerPanel.addView(toolbar, new LinearLayout.LayoutParams(-1,dp(49)));
        browserFrame = new FrameLayout(this);
        player = new WebView(this);
        setupWebView(player,true);
        player.addJavascriptInterface(new PlayerEvents(), "PlayerEvents");
        browserFrame.addView(player,new FrameLayout.LayoutParams(-1,-1));
        playbackMessage=new TextView(this);
        playbackMessage.setTextColor(Color.rgb(220,227,238));playbackMessage.setTextSize(18);
        playbackMessage.setGravity(android.view.Gravity.CENTER);playbackMessage.setBackgroundColor(Color.rgb(11,13,20));
        playbackMessage.setVisibility(View.GONE);
        browserFrame.addView(playbackMessage,new FrameLayout.LayoutParams(-1,-1));
        cursor = new Cursor();
        cursor.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        browserFrame.addView(cursor,new FrameLayout.LayoutParams(-1,-1));
        playerPanel.addView(browserFrame,new LinearLayout.LayoutParams(-1,0,1));
        root.addView(playerPanel,new FrameLayout.LayoutParams(-1,-1));
        playPauseButton=new Button(this);playPauseButton.setTextColor(Color.WHITE);playPauseButton.setTextSize(22);playPauseButton.setAllCaps(false);
        android.graphics.drawable.GradientDrawable playBackground=new android.graphics.drawable.GradientDrawable();playBackground.setColor(Color.argb(235,18,24,36));playBackground.setCornerRadius(dp(14));playBackground.setStroke(dp(4),Color.rgb(255,121,91));playPauseButton.setBackground(playBackground);
        playPauseButton.setOnFocusChangeListener((view,focused)->playBackground.setStroke(dp(focused?4:1),focused?Color.rgb(255,121,91):Color.GRAY));
        playPauseButton.setOnClickListener(view->{boolean paused=!playPauseButton.isActivated();mediaControl(paused?"pause":"play",0);showPlaybackButton(paused);});
        root.addView(playPauseButton,new FrameLayout.LayoutParams(Math.min(dp(220),getResources().getDisplayMetrics().widthPixels*2/5),dp(70),android.view.Gravity.CENTER));playPauseButton.setVisibility(View.GONE);
        playerPanel.setVisibility(View.GONE);
        player.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url=request.getUrl().toString();
                if(blocker.shouldBlock(url)) return blocker.empty();
                String path=request.getUrl().getPath();
                if(path!=null && path.toLowerCase(Locale.US).matches(".*\\.(?:m3u8|mp4|webm|mpd)$")) {

                    String episode=currentItem==null?"":currentItem.optString("url");
                    if(!episode.isEmpty()) preferences.edit().putString("lastMediaEpisode",episode).putString("lastMediaUrl",url).putLong("lastMediaSeen",System.currentTimeMillis()).apply();
                }
                return null;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) return true;

                if (request.isForMainFrame() && !AdBlocker.isProvider(uri.getHost())) {
                    toast("Blocked an outside redirect"); return true;
                }
                return blocker.shouldBlock(uri.toString());
            }
            @Override public void onPageFinished(WebView view, String url) {
                injectPlayer();
                playerStatus.setText("Menu: controls  ·  arrows: cursor");
                main.postDelayed(() -> {
                    if (playerPanel.getVisibility()==View.VISIBLE) {
                        injectPlayer();
                        if(currentItem!=null&&currentItem.has("seriesTitle")) player.evaluateJavascript("window.CWZoomPlayer&&window.CWZoomPlayer(true)",null);
                    }
                }, 1800);
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && currentItem!=null && requestedEpisode!=null && requestedEpisode.has("seriesTitle")) {
                    String currentHost=Uri.parse(currentItem.optString("url")).getHost();
                    String failedHost=request.getUrl().getHost();
                    String path=Uri.parse(currentItem.optString("url")).getPath();
                    if(currentHost!=null && failedHost!=null && path!=null && path.equals(request.getUrl().getPath()) && currentHost.replaceFirst("^(www|m)\\.","").equals(failedHost.replaceFirst("^(www|m)\\.",""))) tryFallback();
                }
            }
        });
        player.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view,int progress) { if(progress<100) playerStatus.setText("Loading " + progress + "%"); }
            @Override public boolean onCreateWindow(WebView v,boolean dialog,boolean gesture,android.os.Message msg) { blocker.blocked.incrementAndGet(); return false; }
            @Override public boolean onJsAlert(WebView view,String url,String message,JsResult result) { if(!blocker.enabled)return false;result.confirm();blocker.blocked.incrementAndGet();return true; }
            @Override public boolean onJsConfirm(WebView view,String url,String message,JsResult result) { if(!blocker.enabled)return false;result.cancel();blocker.blocked.incrementAndGet();return true; }
            @Override public boolean onJsPrompt(WebView view,String url,String message,String value,JsPromptResult result) { if(!blocker.enabled)return false;result.cancel();blocker.blocked.incrementAndGet();return true; }
            @Override public boolean onJsBeforeUnload(WebView view,String url,String message,JsResult result) { result.confirm();return true; }
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public void onShowCustomView(View view,CustomViewCallback callback) {
                if(fullscreen!=null) { callback.onCustomViewHidden(); return; }
                fullscreen=view; fullscreenCallback=callback;
                root.addView(view,new FrameLayout.LayoutParams(-1,-1)); immersive();
            }
            @Override public void onHideCustomView() { hideFullscreen(); }
        });
    }

    private Button addButton(String text,Runnable action) {
        Button b = new Button(this); b.setText(text); b.setTextSize(11); b.setAllCaps(false);
        b.setMinWidth(0); b.setMinimumWidth(0); b.setPadding(dp(8),0,dp(8),0);
        android.graphics.drawable.StateListDrawable background=new android.graphics.drawable.StateListDrawable();
        android.graphics.drawable.GradientDrawable focused=new android.graphics.drawable.GradientDrawable();
        focused.setColor(Color.rgb(255,121,91)); focused.setCornerRadius(dp(4));
        android.graphics.drawable.GradientDrawable normal=new android.graphics.drawable.GradientDrawable();
        normal.setColor(Color.rgb(45,51,65)); normal.setCornerRadius(dp(4));
        background.addState(new int[]{android.R.attr.state_focused},focused);
        background.addState(new int[]{android.R.attr.state_pressed},focused);
        background.addState(new int[]{},normal); b.setBackground(background);
        b.setTextColor(new android.content.res.ColorStateList(new int[][]{new int[]{android.R.attr.state_focused},new int[]{}},new int[]{Color.rgb(11,13,20),Color.WHITE}));
        b.setOnClickListener(v -> action.run());
        LinearLayout.LayoutParams buttonLayout=new LinearLayout.LayoutParams(-2,-1); buttonLayout.setMargins(dp(3),0,dp(3),0);
        toolbar.addView(b,buttonLayout); return b;
    }
    private void injectPlayer() {
        double resume=currentItem==null?0:currentItem.optDouble("resumeSeconds",currentItem.optDouble("currentTime",0));
        player.evaluateJavascript("window.CW_CONFIG={adBlock:"+blocker.enabled+",resumeSeconds:"+resume+",session:'"+playSession+"',autoPlay:true,crossFrame:"+frameGuardSupported+"};"+(frameGuardSupported?"":siteSkipsScript+frameGuardScript)+qualityScript+playerScript,null);
    }
    private void configureFrameGuard() {
        if(frameGuardHandle!=null) { frameGuardHandle.remove();frameGuardHandle=null; }
        frameGuardSupported=WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
        if(!frameGuardSupported || frameGuardScript==null) return;
        double resume=currentItem==null?0:currentItem.optDouble("resumeSeconds",currentItem.optDouble("currentTime",0));
        String config="window.CW_CONFIG={adBlock:"+blocker.enabled+",resumeSeconds:"+resume+",session:'"+playSession+"',crossFrame:true,autoPlay:"+(currentItem!=null&&currentItem.has("seriesTitle"))+"};";
        String script=config+siteSkipsScript+frameGuardScript+"\n(function(){function boot(){"+qualityScript+playerScript+"}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();})();";
        frameGuardHandle=WebViewCompat.addDocumentStartJavaScript(player,script,java.util.Collections.singleton("*"));
    }
    private void openPlayer(JSONObject item) {
        if(resolutionTask!=null)resolutionTask.cancel(true);
        pendingAttempt=null;
        try { requestedEpisode=new JSONObject(item.toString()); }catch(Exception e){return;}
        fallbackIndex=0;resolving=false;exhausted=false;
        if("wco".equals(item.optString("provider"))) {
            try { item=new JSONObject(item.toString()).put("provider","wcostream").put("url",item.optString("url").replace("www.wco.tv","www.wcostream.tv")); }catch(Exception e){return;}
        }
        JSONObject first=item;int ticket=++playSession;
        framePlaying=false;frameReady=false;waitingPausedFrame=false;closingPlayer=false;playbackConfirmed=false;
        homeView.evaluateJavascript("window.refreshThumbnails&&window.refreshThumbnails()",null);
        resumeThumbnails.invalidate(requestedEpisode,() -> {if(!closed&&ticket==playSession)openAttempt(first);});
    }
    private void openAttempt(JSONObject item) {
        String url=item.optString("url");
        if (!validProviderUrl(url)) { toast("Choose a supported source"); return; }
        playSession++;attemptStarted=lastPlaybackAt=SystemClock.elapsedRealtime();lastPosition=-1;lastDuration=0;frameReady=false;
        playbackConfirmed=false;metadataSeen=false;mediaPaused=false;resolving=false;
        currentItem=item; blocker.blocked.set(0);
        playPauseButton.setVisibility(View.GONE);
        JSONObject metadata=requestedEpisode==null?item:requestedEpisode;
        voice.begin(metadata.optString("title","Cartoon Watch"),metadata.optString("seriesTitle"),0,(long)(item.optDouble("resumeSeconds",0)*1000));
        configureFrameGuard();
        shieldButton.setText(blocker.enabled?"Shield: on":"Shield: off");
        playerPanel.setVisibility(View.VISIBLE); homeView.setVisibility(View.GONE);
        pointerX=browserFrame.getWidth()/2f; pointerY=browserFrame.getHeight()/2f;
        showToolbar(false); cursor.setVisibility(cursorMode?View.VISIBLE:View.GONE);
        playbackMessage.setText("Starting episode…");playbackMessage.setVisibility(item.has("seriesTitle")?View.VISIBLE:View.GONE);
        main.removeCallbacks(hideCursor); main.postDelayed(hideCursor,4500);
        player.loadUrl(url); player.requestFocus();
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        main.postDelayed(() -> { pointerX=browserFrame.getWidth()/2f; pointerY=browserFrame.getHeight()/2f; cursor.invalidate(); },500);
        if(item.has("seriesTitle")) recordProgress(item.optDouble("resumeSeconds",0),0,true);
    }
    private void tryFallback() {
        if(closed || !foreground || resolving || exhausted || requestedEpisode==null || !requestedEpisode.has("seriesTitle") || playerPanel.getVisibility()!=View.VISIBLE) return;
        if(fallbackIndex>=fallbackProviders.length) {
            exhausted=true;playbackMessage.setText("No working player found. Use Reload to retry or return to the catalog.");playbackMessage.setVisibility(View.VISIBLE);showToolbar(true);return;
        }
        String provider=fallbackProviders[fallbackIndex++];
        if(provider.equals(currentItem.optString("provider"))) { tryFallback();return; }
        resolving=true;int session=++playSession;
        playbackMessage.setText("Trying another player…");playbackMessage.setVisibility(View.VISIBLE);
        player.stopLoading();player.loadUrl("about:blank");
        JSONObject target;
        try { target=new JSONObject(requestedEpisode.toString()).put("resumeSeconds",lastPosition>=0?lastPosition:requestedEpisode.optDouble("resumeSeconds",0)); }catch(Exception e){return;}
        if(resolutionTask!=null)resolutionTask.cancel(true);
        ((java.util.concurrent.ThreadPoolExecutor)fallbackIo).purge();
        armFallbackTimeout(session);
        resolutionTask=fallbackIo.submit(() -> {
            JSONObject match=null;
            try {match=resolver.resolve(target,provider);}catch(Exception ignored){}
            JSONObject result=match;
            main.post(() -> {
                if(closed || session!=playSession || !resolving || playerPanel.getVisibility()!=View.VISIBLE)return;
                resolving=false;
                if(!foreground){pendingAttempt=result;return;}
                if(result==null)tryFallback();else openAttempt(result);
            });
        });
    }
    private void armFallbackTimeout(int session) {
        if(fallbackDeadline!=null)main.removeCallbacks(fallbackDeadline);
        fallbackDeadline=() -> {if(foreground && session==playSession && resolving){resolving=false;if(resolutionTask!=null)resolutionTask.cancel(true);tryFallback();}};
        main.postDelayed(fallbackDeadline,10000);
    }
    private void closePlayer() {
        if(closingPlayer)return;
        closingPlayer=true;int session=playSession;
        captureResumeFrame(() -> {if(closingPlayer&&session==playSession)finishClosePlayer();});
    }
    private void finishClosePlayer() {
        if(playbackConfirmed&&lastPosition>=0)recordProgress(lastPosition,lastDuration,true);
        voice.deactivate();
        playPauseButton.setVisibility(View.GONE);main.removeCallbacks(hidePlaybackButton);
        playSession++;requestedEpisode=null;resolving=false;framePlaying=false;closingPlayer=false;
        pendingAttempt=null;if(resolutionTask!=null)resolutionTask.cancel(true);
        if(fallbackDeadline!=null)main.removeCallbacks(fallbackDeadline);
        hideFullscreen();
        player.evaluateJavascript("window.CWPlayerTick&&window.CWPlayerTick()",null);
        player.loadUrl("about:blank"); playerPanel.setVisibility(View.GONE);
        homeView.setVisibility(View.VISIBLE); homeView.requestFocus();
        homeView.evaluateJavascript("window.refreshThumbnails&&window.refreshThumbnails()",null);
        homeView.evaluateJavascript("window.refreshState&&window.refreshState()",null);
        getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    private void captureResumeFrame(Runnable copied) {
        captureResumeFrame(copied,false);
    }
    private void captureResumeFrame(Runnable copied,boolean keepActive) {
        if(!playbackConfirmed||!frameReady||requestedEpisode==null||lastPosition<0||playerPanel.getVisibility()!=View.VISIBLE) {if(copied!=null)copied.run();return;}
        resumeThumbnails.capture(getWindow(),fullscreen==null?player:fullscreen,requestedEpisode,lastPosition,keepActive,copied,() -> {
            if(!closed)homeView.evaluateJavascript("window.refreshThumbnails&&window.refreshThumbnails()",null);
        });
    }
    private void showPlaybackButton(boolean paused) {
        if(playPauseButton==null||closingPlayer)return;
        playPauseButton.setActivated(paused);playPauseButton.setText(paused?"▶  Resume":"Ⅱ  Pause");playPauseButton.setContentDescription(paused?"Resume video":"Pause video");playPauseButton.setVisibility(View.VISIBLE);playPauseButton.bringToFront();playPauseButton.requestFocus();
        main.removeCallbacks(hidePlaybackButton);if(!paused&&!toolbarVisible)main.postDelayed(hidePlaybackButton,3000);
    }
    private void showToolbar(boolean visible) {
        if(playPauseButton!=null)playPauseButton.setVisibility(View.GONE);
        toolbarVisible=visible; toolbar.setVisibility(visible?View.VISIBLE:View.GONE);
        if(cursor!=null&&visible) cursor.setVisibility(View.INVISIBLE);
        if(visible) {if(playbackConfirmed&&!cursorMode)showPlaybackButton(mediaPaused);else toolbar.getChildAt(0).requestFocus();} else player.requestFocus();
    }
    private void hideFullscreen() {
        if(fullscreen!=null) {
            root.removeView(fullscreen); fullscreen=null;
            if(fullscreenCallback!=null) fullscreenCallback.onCustomViewHidden(); fullscreenCallback=null; immersive();
        }
    }
    private void recordProgress(double position,double duration,boolean paused) {
        if(currentItem==null || requestedEpisode==null || !requestedEpisode.has("seriesTitle")) return;
        try {
            JSONObject entry=new JSONObject(requestedEpisode.toString());
            entry.put("lastWatched",System.currentTimeMillis());
            if(duration>0) entry.put("currentTime",position).put("position",position).put("duration",duration).put("progress",position/duration);
            JSONArray old=state.optJSONArray("history"), history=new JSONArray(); history.put(entry);
            if(old!=null) for(int i=0;i<old.length()&&history.length()<100;i++) {
                JSONObject prior=old.optJSONObject(i);
                if(prior!=null&&!entry.optString("url").equals(prior.optString("url"))) history.put(prior);
            }
            state.put("history",history); persist();
            homeView.evaluateJavascript("window.onPlaybackProgress&&window.onPlaybackProgress("+entry.toString()+")",null);
        } catch(Exception ignored) {}
    }

    private final class PlayerEvents {
        @JavascriptInterface public void quality(String session,int width,int height) {
            if(width<1||height<1||width>8192||height>4320)return;
            main.post(() -> {if(String.valueOf(playSession).equals(session)&&currentItem!=null)playerStatus.setText(width+" × "+height+(height>=2160?" · UHD":""));});
        }
        @JavascriptInterface public void promotionClosed() { blocker.blocked.incrementAndGet(); }
        @JavascriptInterface public void introSkipped() { main.post(() -> playerStatus.setText("Intro skipped")); }

        @JavascriptInterface public void report(String session,double position,double duration,boolean paused,boolean played,boolean ready) {
            if(Double.isNaN(position)||Double.isInfinite(position)||Double.isNaN(duration)||Double.isInfinite(duration)||position<0||duration<=0||duration>86400||position>duration+5) return;
            main.post(() -> {
                if(!String.valueOf(playSession).equals(session)||currentItem==null||playerPanel.getVisibility()!=View.VISIBLE) return;
                metadataSeen=true;
                long now=SystemClock.elapsedRealtime();
                boolean wasConfirmed=playbackConfirmed,wasPaused=mediaPaused;
                if((!paused && position>0.1) || played) {
                    if(!playbackConfirmed || mediaPaused || Math.abs(position-lastPosition)>0.05)lastPlaybackAt=now;
                    playbackConfirmed=true;playbackMessage.setVisibility(View.GONE);
                }
                boolean moved=lastPosition>=0&&Math.abs(position-lastPosition)>.5;
                lastPosition=position;lastDuration=duration;mediaPaused=paused && playbackConfirmed;frameReady=ready;
                if(playbackConfirmed&&!closingPlayer) {
                    if(paused) {if(framePlaying||moved)waitingPausedFrame=true;framePlaying=false;if(waitingPausedFrame&&ready){waitingPausedFrame=false;captureResumeFrame(null);}}
                    else if(!framePlaying) {framePlaying=true;waitingPausedFrame=false;resumeThumbnails.invalidate(requestedEpisode,null);}
                }
                voice.update((long)(position*1000),(long)(duration*1000),paused);
                if(!cursorMode&&playbackConfirmed&&(!wasConfirmed||wasPaused!=mediaPaused))showPlaybackButton(mediaPaused);
                if(!paused) getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                if(paused!=lastSavedPaused || (!paused && now-lastProgressSave>9000)) { lastProgressSave=now;lastSavedPaused=paused;recordProgress(position,duration,paused); }
            });
        }
    }

    private final class AppBridge {
        @JavascriptInterface public void request(String action,String payload,String callbackId) {
            if(payload==null||payload.length()>1000000||callbackId==null||callbackId.length()>160) return;
            main.post(() -> handleRequest(action,payload,callbackId));
        }
    }
    private void handleRequest(String action,String payload,String callbackId) {
        try {
            JSONObject args=new JSONObject(payload);
            if("ready".equals(action)) {
                homeReady=true;
                while(!pendingSearches.isEmpty())dispatchSearch(pendingSearches.removeFirst());
                respond(callbackId,new JSONObject().put("ok",true));return;
            }
            if("control".equals(action)) {
                if(!mediaControl(args.optString("command"),args.optDouble("value",10))) { respondError(callbackId,"Open an episode before using playback controls.");return; }
                respond(callbackId,new JSONObject().put("ok",true));return;
            }
            if("getState".equals(action)) { respond(callbackId,new JSONObject(state.toString())); return; }
            if("artwork".equals(action)) {
                io.execute(() -> {
                    try {
                        JSONArray input=args.optJSONArray("items"),remaining=new JSONArray(),frames=new JSONArray();
                        if(input!=null)for(int i=0;i<input.length()&&i<12;i++) {
                            JSONObject item=input.optJSONObject(i);if(item==null)continue;
                            String frame=resumeThumbnails.image(item);
                            if(frame.isEmpty())remaining.put(item);else frames.put(new JSONObject().put("url",item.optString("url")).put("image",frame).put("imageSource","Resume frame").put("resumeFrame",true));
                        }
                        JSONObject result=artwork.lookup(remaining);JSONArray found=result.getJSONArray("items");for(int i=0;i<frames.length();i++)found.put(frames.get(i));
                        if(args.optBoolean("debug"))result.put("frameDebug",new JSONObject().put("ready",frameReady).put("playing",framePlaying).put("confirmed",playbackConfirmed).put("closing",closingPlayer).put("kind",requestedEpisode==null?"":requestedEpisode.optString("kind")).put("snapshot",resumeThumbnails.diagnostics()));
                        main.post(() -> respond(callbackId,result));
                    }
                    catch(Exception e){main.post(() -> respondError(callbackId,"Artwork is temporarily unavailable."));}
                });return;
            }
            if("clearHistory".equals(action)) {
                state.put("history",new JSONArray());persist();
                resumeThumbnails.clear(() -> {if(!closed)respond(callbackId,new JSONObject());});return;
            }
            if("saveState".equals(action)) {

                for(String key:new String[]{"favorites","history","settings"}) if(args.has(key)) state.put(key,args.get(key));
                JSONObject settings=state.optJSONObject("settings");
                if(settings!=null) blocker.enabled=settings.optBoolean("adBlock",true);
                persist(); respond(callbackId,new JSONObject().put("ok",true)); return;
            }
            if("settings".equals(action)) {
                blocker.enabled=args.optBoolean("adBlock",blocker.enabled); state.getJSONObject("settings").put("adBlock",blocker.enabled); persist();
                respond(callbackId,new JSONObject().put("ok",true)); return;
            }
            if("play".equals(action)) { openPlayer(args); respond(callbackId,new JSONObject().put("ok",true)); return; }
            if("openSource".equals(action)) {
                String provider=args.optString("provider","wco");
                if(!args.has("url")||args.optString("url").isEmpty()) args.put("url",providerRoot(provider)+("hdtoday".equals(provider)?"home/":""));
                openPlayer(args); respond(callbackId,new JSONObject().put("ok",true)); return;
            }
            if("exit".equals(action)) { finish(); return; }
            String provider=args.optString("provider","wco");
            if("catalog".equals(action) || (("home".equals(action)||"search".equals(action)) && ("wco".equals(provider)||"wcostream".equals(provider)))) {
                io.execute(() -> {
                    try {JSONObject result=catalogIndex.query(args.optString("query"),args.optString("category","all"),args.optString("sort","az"),args.optInt("offset"),args.optInt("limit",60));main.post(() -> respond(callbackId,result));}
                    catch(Exception e){main.post(() -> respondError(callbackId,"The catalog could not be opened."));}
                });return;
            }
            if("home".equals(action)||"search".equals(action)||"details".equals(action)) {
                io.execute(() -> {
                    try {
                        JSONObject result="home".equals(action)?catalog.home(provider):"search".equals(action)?catalog.search(provider,args.optString("query")):catalog.details(provider,args.optString("url"));
                        if(!"kissanime".equals(provider) && (("search".equals(action) && result.optJSONArray("items")!=null && result.optJSONArray("items").length()==0) || ("details".equals(action) && result.optJSONArray("episodes")!=null && result.optJSONArray("episodes").length()==0))) {
                            main.post(() -> browserCatalog(action,args,callbackId)); return;
                        }
                        main.post(() -> respond(callbackId,result));
                    } catch(Exception error) {

                        main.post(() -> browserCatalog(action,args,callbackId));
                    }
                }); return;
            }
            respondError(callbackId,"Unsupported action");
        } catch(Exception error) { respondError(callbackId,"Could not complete that action"); }
    }

    private void browserCatalog(String action,JSONObject args,String callbackId) {
        if(closed) return;
        if(catalogBrowser!=null) { respondError(callbackId,"Source is busy. Please try again."); return; }
        final String provider=args.optString("provider","wco");
        final String base;
        try { base=providerRoot(provider); } catch(Exception e) { respondError(callbackId,"Choose a supported source"); return; }
        final String url="details".equals(action)?args.optString("url"):"search".equals(action)?("aniwave".equals(provider)?base+"filter?keyword="+Uri.encode(args.optString("query")):"hdtoday".equals(provider)?base+"search?keyword="+Uri.encode(args.optString("query")):base+("kissanime".equals(provider)?"Search/Anime":"search")):base+("hdtoday".equals(provider)?"home/":"");
        if(!validProviderUrl(url)) { respondError(callbackId,"Choose a supported source"); return; }
        final WebView web=new WebView(this); catalogBrowser=web;
        setupWebView(web,true); web.setVisibility(View.INVISIBLE);

        web.getSettings().setUserAgentString("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36");
        root.addView(web,new FrameLayout.LayoutParams(960,540));
        final boolean[] done={false};
        final Runnable cleanup=() -> { if(catalogBrowser==web) catalogBrowser=null; root.removeView(web); web.stopLoading(); web.destroy(); };
        final Runnable timeout=() -> { if(!done[0]) { done[0]=true; cleanup.run(); respondError(callbackId,"This source needs its browser. Open source, or try KissAnime."); } };
        main.postDelayed(timeout,22000);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request) { return request.isForMainFrame()&&!AdBlocker.isProvider(request.getUrl().getHost()); }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request) { return blocker.shouldBlock(request.getUrl().toString())?blocker.empty():null; }
            @Override public void onPageFinished(WebView view,String loadedUrl) {
                main.postDelayed(() -> {
                    if(done[0]) return;
                    view.evaluateJavascript("document.documentElement.outerHTML",encoded -> {
                        if(done[0]) return;
                        try {
                            Object decoded=new JSONTokener(encoded).nextValue();
                            if(!(decoded instanceof String)) throw new Exception();
                            String html=(String)decoded;
                            if(html.contains("Just a moment")||html.contains("cf-chl-")) return;
                            done[0]=true; main.removeCallbacks(timeout); cleanup.run();
                            io.execute(() -> {
                                try { JSONObject result=catalog.parseLoadedPage(action,provider,url,html,args.optString("query")); main.post(() -> respond(callbackId,result)); }
                                catch(Exception e) { main.post(() -> respondError(callbackId,"This source could not load. Try KissAnime or open source.")); }
                            });
                        } catch(Exception e) { done[0]=true; cleanup.run(); respondError(callbackId,"This source could not load. Try KissAnime."); }
                    });
                },1500);
            }
        });
        if("search".equals(action)&&!"aniwave".equals(provider)&&!"hdtoday".equals(provider)) {
            try {
                String body=("kissanime".equals(provider)?"keyword=":"catara=")+URLEncoder.encode(args.optString("query"),"UTF-8")+("kissanime".equals(provider)?"":"&konuara=series");
                web.postUrl(url,body.getBytes("UTF-8"));
            } catch(Exception e) { done[0]=true; cleanup.run(); respondError(callbackId,"Search could not load"); }
        } else web.loadUrl(url);
    }

    private void respond(String callbackId,JSONObject value) { if(!closed) homeView.evaluateJavascript("window.onNativeResult&&window.onNativeResult("+JSONObject.quote(callbackId)+","+JSONObject.quote(value.toString())+")",null); }
    private void respondError(String callbackId,String message) { try { respond(callbackId,new JSONObject().put("error",message)); } catch(Exception ignored) {} }
    private void persist() { preferences.edit().putString("state",state.toString()).apply(); }
    private boolean mediaControl(String command,double value) {
        if(player==null || playerPanel.getVisibility()!=View.VISIBLE || Double.isNaN(value) || Double.isInfinite(value))return false;
        if("skipIntro".equals(command))player.evaluateJavascript("window.CWSkipIntro&&window.CWSkipIntro()",null);
        else {
            if("forwardBy".equals(command))command="forward";
            if("backward".equals(command))command="rewind";
            if(!command.matches("play|pause|toggle|seek|forward|rewind"))return false;
            String script="window.CWControl&&window.CWControl("+JSONObject.quote(command)+","+Math.max(0,Math.min(86400,value))+")";int session=playSession;
            Runnable dispatch=() -> {if(!closed&&session==playSession)player.evaluateJavascript(script,null);};
            if(("play".equals(command)||"toggle".equals(command))&&mediaPaused) {framePlaying=true;resumeThumbnails.invalidate(requestedEpisode,dispatch);}
            else if("seek".equals(command)||"forward".equals(command)||"rewind".equals(command)) {frameReady=false;resumeThumbnails.invalidate(requestedEpisode,dispatch);}
            else dispatch.run();
        }
        return true;
    }
    private void dispatchSearch(String query) {
        if(query==null || query.trim().isEmpty())return;
        if(!homeReady) { if(pendingSearches.size()==8)pendingSearches.removeFirst();pendingSearches.addLast(query);return; }
        String value=JSONObject.quote(query);
        homeView.evaluateJavascript("(function(){var c=window.CartoonVoice&&window.CartoonVoice.parse("+value+");return c&&c.action||'unknown';})()",result -> {
            if(closed)return;
            boolean watching=playerPanel.getVisibility()==View.VISIBLE;
            if(watching && "\"back\"".equals(result)) { closePlayer();return; }
            if(watching && !"\"control\"".equals(result))closePlayer();
            homeView.evaluateJavascript("window.runVoiceCommand&&window.runVoiceCommand("+("\"unknown\"".equals(result)?JSONObject.quote("search for "+query):value)+")",null);
        });
    }
    private static String providerRoot(String provider) {
        if("kissanime".equals(provider)) return "https://kissanime.tv.in/";
        if("wco".equals(provider)) return "https://www.wco.tv/";
        if("wcostream".equals(provider)) return "https://www.wcostream.tv/";
        if("aniwave".equals(provider)) return "https://aniwave.gr/";
        if("hdtoday".equals(provider)) return "https://hdtoday.one/";
        throw new IllegalArgumentException("Unsupported provider");
    }
    private boolean validProviderUrl(String url) { try { Uri uri=Uri.parse(url); return "https".equals(uri.getScheme())&&AdBlocker.isProvider(uri.getHost())&&uri.getUserInfo()==null; } catch(Exception e) { return false; } }
    private String readAsset(String name) throws Exception { try(InputStream in=getAssets().open(name)) { java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream(); byte[] data=new byte[8192]; int n; while((n=in.read(data))!=-1) out.write(data,0,n); return out.toString("UTF-8"); } }
    private int dp(int n) { return Math.round(n*getResources().getDisplayMetrics().density); }
    private void toast(String message) { Toast.makeText(this,message,Toast.LENGTH_LONG).show(); }
    private void immersive() { getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_STABLE); }

    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        boolean watching=playerPanel!=null&&playerPanel.getVisibility()==View.VISIBLE;
        int key=event.getKeyCode();
        if(watching&&playbackConfirmed&&!toolbarVisible&&(key==KeyEvent.KEYCODE_DPAD_CENTER||key==KeyEvent.KEYCODE_ENTER)&&(!cursorMode||playPauseButton.getVisibility()==View.VISIBLE)) {
            if(event.getAction()==KeyEvent.ACTION_DOWN&&event.getRepeatCount()==0){if(playPauseButton.getVisibility()!=View.VISIBLE)showPlaybackButton(mediaPaused);playPauseButton.performClick();}return true;
        }
        if(watching&&event.getAction()==KeyEvent.ACTION_DOWN) {
            if(key==KeyEvent.KEYCODE_MENU) { showToolbar(!toolbarVisible); return true; }
            String command=key==KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE?"toggle":key==KeyEvent.KEYCODE_MEDIA_PLAY?"play":key==KeyEvent.KEYCODE_MEDIA_PAUSE||key==KeyEvent.KEYCODE_MEDIA_STOP?"pause":key==KeyEvent.KEYCODE_MEDIA_FAST_FORWARD?"forward":key==KeyEvent.KEYCODE_MEDIA_REWIND?"rewind":null;
            if(command!=null) {
                int session=playSession;
                Runnable dispatch=() -> {if(closed||session!=playSession)return;player.evaluateJavascript("window.CWControl&&window.CWControl('"+command+"')",handled -> {
                    if(!"true".equals(handled) && !"play".equals(command) && !"pause".equals(command)) {

                        int fallback="toggle".equals(command)?KeyEvent.KEYCODE_SPACE:"forward".equals(command)?KeyEvent.KEYCODE_DPAD_RIGHT:KeyEvent.KEYCODE_DPAD_LEFT;
                        player.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN,fallback));
                        player.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_UP,fallback));
                    }
                });};
                if(("play".equals(command)||"toggle".equals(command))&&mediaPaused){framePlaying=true;resumeThumbnails.invalidate(requestedEpisode,dispatch);}
                else if("forward".equals(command)||"rewind".equals(command)){frameReady=false;resumeThumbnails.invalidate(requestedEpisode,dispatch);}
                else dispatch.run();return true;
            }
            if(fullscreen==null&&!toolbarVisible&&cursorMode) {
                float step=dp(event.getRepeatCount()>6?35:18);
                if(key==KeyEvent.KEYCODE_DPAD_LEFT) pointerX-=step;
                else if(key==KeyEvent.KEYCODE_DPAD_RIGHT) pointerX+=step;
                else if(key==KeyEvent.KEYCODE_DPAD_UP) pointerY-=step;
                else if(key==KeyEvent.KEYCODE_DPAD_DOWN) pointerY+=step;
                else if(key==KeyEvent.KEYCODE_DPAD_CENTER||key==KeyEvent.KEYCODE_ENTER) { clickAtPointer(); return true; }
                else return super.dispatchKeyEvent(event);
                if(pointerY>browserFrame.getHeight()-dp(20)) { player.scrollBy(0,dp(75)); pointerY=browserFrame.getHeight()-dp(35); }
                if(pointerY<dp(20)) { player.scrollBy(0,-dp(75)); pointerY=dp(35); }
                pointerX=Math.max(dp(10),Math.min(browserFrame.getWidth()-dp(10),pointerX));
                cursor.setVisibility(View.VISIBLE); main.removeCallbacks(hideCursor); main.postDelayed(hideCursor,2500);
                cursor.invalidate(); return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }
    private void clickAtPointer() {
        long now=SystemClock.uptimeMillis();
        MotionEvent down=MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,pointerX,pointerY,0);
        MotionEvent up=MotionEvent.obtain(now,now+70,MotionEvent.ACTION_UP,pointerX,pointerY,0);
        player.dispatchTouchEvent(down); player.dispatchTouchEvent(up); down.recycle(); up.recycle();
        main.removeCallbacks(hideCursor); main.postDelayed(hideCursor,1200);
    }
    @Override public void onBackPressed() {
        if(fullscreen!=null) { hideFullscreen(); return; }
        if(playerPanel.getVisibility()==View.VISIBLE) { if(toolbarVisible) closePlayer(); else showToolbar(true); return; }
        homeView.evaluateJavascript("window.handleBack?window.handleBack():false",result -> { if(!"true".equals(result)) super.onBackPressed(); });
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent);setIntent(intent);if(voice!=null)voice.handleIntent(intent); }
    @Override protected void onPause() { if(foreground&&!closingPlayer){captureResumeFrame(null,framePlaying&&!mediaPaused);if(playbackConfirmed&&lastPosition>=0)recordProgress(lastPosition,lastDuration,true);}foreground=false;super.onPause(); }
    @Override protected void onStop() { framePlaying=false;if(voice!=null)voice.setForeground(false);if(player!=null)player.onPause();if(resumeThumbnails!=null&&requestedEpisode!=null)resumeThumbnails.settleEpisode(requestedEpisode);super.onStop(); }
    @Override protected void onResume() {
        boolean continued=framePlaying&&!mediaPaused;
        super.onResume();foreground=true;attemptStarted=lastPlaybackAt=SystemClock.elapsedRealtime();mediaPaused=playbackConfirmed;
        if(voice!=null)voice.setForeground(true);
        if(continued&&requestedEpisode!=null)resumeThumbnails.invalidate(requestedEpisode,null);
        if(player!=null) {
            player.onResume();
            if(pendingAttempt!=null){JSONObject item=pendingAttempt;pendingAttempt=null;openAttempt(item);}
            else if(resolving)armFallbackTimeout(playSession);
            else if(requestedEpisode!=null && "about:blank".equals(player.getUrl()))tryFallback();
        }
        immersive();
    }
    @Override protected void onDestroy() { closed=true;if(voice!=null)voice.close();main.removeCallbacksAndMessages(null);io.shutdownNow();fallbackIo.shutdownNow();if(artwork!=null)artwork.close();if(resumeThumbnails!=null)resumeThumbnails.close();if(catalogBrowser!=null)catalogBrowser.destroy();player.destroy();homeView.destroy();super.onDestroy(); }
    private final class Cursor extends View {
        private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
        Cursor() { super(MainActivity.this); setFocusable(false); setClickable(false); }
        @Override protected void onDraw(Canvas canvas) {
            paint.setColor(Color.BLACK); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(dp(5)); canvas.drawCircle(pointerX,pointerY,dp(10),paint);
            paint.setColor(Color.rgb(255,121,91)); paint.setStrokeWidth(dp(3)); canvas.drawCircle(pointerX,pointerY,dp(10),paint);
            paint.setStyle(Paint.Style.FILL); paint.setColor(Color.WHITE); canvas.drawCircle(pointerX,pointerY,dp(2),paint);
        }
    }
}

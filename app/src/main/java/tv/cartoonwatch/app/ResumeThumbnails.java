package tv.cartoonwatch.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.PixelCopy;
import android.view.SurfaceView;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.net.URI;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

public final class ResumeThumbnails implements AutoCloseable {
    private static final int WIDTH=160,HEIGHT=90,MAX_FILES=64,MAX_BYTES=1048576;
    private static final Pattern NAME=Pattern.compile("([a-f0-9]{64})-([0-9]{1,16})-([0-9]{1,11})\\.jpg");
    private static final Pattern PATH=Pattern.compile("/frame/([a-f0-9]{64})\\.jpg");
    private final File directory,active;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ThreadPoolExecutor writer=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<Runnable>(4));
    private final ConcurrentHashMap<String,Frame> frames=new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String,Long> invalidations=new ConcurrentHashMap<>();
    private final AtomicLong generation=new AtomicLong();
    private final AtomicBoolean copying=new AtomicBoolean();
    private volatile boolean closed;
    private volatile String status="ready";
    private volatile int copyResult=-1;
    private volatile int surfaces,textures,captureWidth,captureHeight;
    private volatile String layerName="window";
    private volatile long clearGeneration;
    private String lastId="";
    private double lastPosition=-1;
    private long lastCapture,version;

    private static final class Frame {
        final File file;
        final long capturedAt,positionMs,generation;
        Frame(File file,long capturedAt,long positionMs,long generation) { this.file=file;this.capturedAt=capturedAt;this.positionMs=positionMs;this.generation=generation; }
    }

    public ResumeThumbnails(Context context) {
        directory=new File(context.getCacheDir(),"resume-thumbnails");
        active=new File(directory,"active");
        enqueue(() -> {
            directory.mkdirs();
            String playing="";
            try(FileInputStream input=new FileInputStream(active)) { byte[] bytes=new byte[64];if(input.read(bytes)==64)playing=new String(bytes,"US-ASCII");else playing="invalid"; }catch(Exception ignored){}
            File[] files=directory.listFiles();
            if(files!=null)for(File file:files) {
                Matcher name=NAME.matcher(file.getName());
                if(name.matches()&&file.isFile()&&file.length()>0&&file.length()<=32768) {
                    long capturedAt=Long.parseLong(name.group(2));version=Math.max(version,capturedAt);
                    String id=name.group(1);Frame previous=frames.get(id);
                    if(!"invalid".equals(playing)&&!id.equals(playing)&&(previous==null||previous.capturedAt<capturedAt))frames.put(id,new Frame(file,capturedAt,Long.parseLong(name.group(3)),0));
                }
            }
            prune();
        },null);
    }

    public static String canonical(String value) {
        try {
            URI uri=new URI(value==null?"":value.trim());
            String scheme=uri.getScheme(),host=uri.getHost();
            if(host==null||uri.getUserInfo()!=null||!("https".equalsIgnoreCase(scheme)||"http".equalsIgnoreCase(scheme)))return "";
            host=host.toLowerCase(Locale.US).replaceFirst("^(?:www\\.|m\\.)","");
            if(!("wco.tv".equals(host)||"wcostream.tv".equals(host))||uri.getPort()!=-1)return "";
            String path=uri.getRawPath();if(path==null||path.length()<2)return "";
            path=path.replaceAll("/+$","");
            return "https://www.wcostream.tv"+path;
        } catch(Exception error) { return ""; }
    }

    public static String episodeKey(JSONObject item) {
        if(item==null||"series".equals(item.optString("kind"))||"movie".equals(item.optString("kind")))return "";
        if(!"episode".equals(item.optString("kind"))&&!item.has("seriesTitle"))return "";
        return canonical(item.optString("url"));
    }

    private static String id(String key) {
        if(key.isEmpty())return "";
        try { byte[] bytes=MessageDigest.getInstance("SHA-256").digest(key.getBytes("UTF-8"));char[] result=new char[64],hex="0123456789abcdef".toCharArray();for(int i=0;i<bytes.length;i++) { result[i*2]=hex[(bytes[i]>>4)&15];result[i*2+1]=hex[bytes[i]&15]; }return new String(result); }
        catch(Exception error) { return ""; }
    }

    private Frame lookup(JSONObject item) {
        String id=id(episodeKey(item));Frame frame=frames.get(id);Long invalid=invalidations.get(id);
        return frame==null||frame.generation<clearGeneration||(invalid!=null&&frame.generation<invalid)?null:frame;
    }

    private String image(Frame frame) { return "https://app.cartoonwatch.local/frame/"+frame.file.getName().substring(0,64)+".jpg?v="+frame.capturedAt; }
    public String image(JSONObject item) { Frame frame=lookup(item);return frame==null?"":image(frame); }

    public void decorate(JSONObject item) {
        if(item==null)return;
        item.remove("resumeImage");item.remove("resumeImagePosition");item.remove("resumeImageCapturedAt");
        Frame frame=lookup(item);if(frame==null)return;
        try { item.put("resumeImage",image(frame)).put("resumeImagePosition",frame.positionMs/1000.0).put("resumeImageCapturedAt",frame.capturedAt); }catch(Exception ignored){}
    }

    public void decorate(JSONArray items) { if(items!=null)for(int i=0;i<items.length();i++)decorate(items.optJSONObject(i)); }

    public void invalidate(JSONObject item,Runnable ready) {
        String id=id(episodeKey(item));if(id.isEmpty()) { run(ready);return; }
        long serial=generation.incrementAndGet();invalidations.put(id,serial);frames.remove(id);status="invalidated";
        enqueueDurable(() -> {
            directory.mkdirs();
            try { mark(id); }catch(Exception ignored){}
            remove(id);frames.remove(id);invalidations.remove(id,serial);
            run(ready);
        });
    }

    public void settleEpisode(JSONObject item) {
        String id=id(episodeKey(item));if(id.isEmpty())return;long serial=generation.get();
        enqueueDurable(() -> {if(serial==generation.get())try {mark("");}catch(Exception ignored){}});
    }

    public void clear(Runnable ready) {
        clearGeneration=generation.incrementAndGet();frames.clear();invalidations.clear();status="cleared";
        enqueueDurable(() -> {
            File[] files=directory.listFiles();if(files!=null)for(File file:files)if(file.isFile())file.delete();
            frames.clear();run(ready);
        });
    }

    public void capture(Window window,View view,JSONObject item,double position,Runnable copied,Runnable saved) { capture(window,view,item,position,false,copied,saved); }

    public void capture(Window window,View view,JSONObject item,double position,boolean keepActive,Runnable copied,Runnable saved) {
        if(Looper.myLooper()!=Looper.getMainLooper()) { main.post(() -> capture(window,view,item,position,keepActive,copied,saved));return; }
        String key=episodeKey(item),id=id(key);long now=SystemClock.elapsedRealtime();
        if(closed||id.isEmpty()||Double.isNaN(position)||Double.isInfinite(position)||position<0||position>86400||view==null||window==null||!view.isShown()||view.getWidth()<2||view.getHeight()<2||(frames.containsKey(id)&&id.equals(lastId)&&now-lastCapture<1500&&Math.abs(position-lastPosition)<.5)) { status=closed?"guard:closed":id.isEmpty()?"guard:identity":view==null||window==null?"guard:view":!view.isShown()?"guard:hidden":"guard:position-or-duplicate";run(copied);return; }
        if(!copying.compareAndSet(false,true)) { status="busy";if(copied!=null)main.postDelayed(copied,240);return; }
        long serial=generation.get();lastId=id;lastCapture=now;lastPosition=position;
        status="requested";copyResult=-1;
        View layer=findLayer(window,view);
        int sourceWidth=view.getWidth(),sourceHeight=view.getHeight();
        if(layer instanceof SurfaceView) {Rect size=((SurfaceView)layer).getHolder().getSurfaceFrame();if(size.width()>0&&size.height()>0){sourceWidth=size.width();sourceHeight=size.height();}}
        else if(layer!=null) {sourceWidth=layer.getWidth();sourceHeight=layer.getHeight();}
        int width=WIDTH,height=Math.max(1,(int)Math.round((double)WIDTH*sourceHeight/sourceWidth));
        if(height>HEIGHT) {height=HEIGHT;width=Math.max(1,(int)Math.round((double)HEIGHT*sourceWidth/sourceHeight));}
        captureWidth=width;captureHeight=height;
        Bitmap bitmap;
        try { bitmap=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888); }
        catch(Exception|OutOfMemoryError error) { status="bitmap-failed";copying.set(false);run(copied);return; }
        AtomicInteger phase=new AtomicInteger();
        Runnable timeout=() -> { if(phase.compareAndSet(0,2)) { status="timeout";run(copied); } };
        main.postDelayed(timeout,240);
        if(Build.VERSION.SDK_INT>=24&&layer instanceof SurfaceView) {
            try {PixelCopy.request((SurfaceView)layer,bitmap,result -> {copyResult=result;status="surface-copy:"+result;if(result==PixelCopy.SUCCESS)finish(bitmap,id,position,serial,keepActive,true,phase,timeout,copied,saved);else copyWindow(window,view,bitmap,id,position,serial,keepActive,phase,timeout,copied,saved);},main);return;}
            catch(Exception error) {status="surface-exception";}
        } else if(layer instanceof TextureView) {
            try {boolean success=((TextureView)layer).getBitmap(bitmap)!=null;status="texture-copy";if(success){finish(bitmap,id,position,serial,keepActive,true,phase,timeout,copied,saved);return;}}
            catch(Exception error) {status="texture-exception";}
        }
        copyWindow(window,view,bitmap,id,position,serial,keepActive,phase,timeout,copied,saved);
    }

    private View findLayer(Window window,View target) {
        Rect area=new Rect();if(!target.getGlobalVisibleRect(area))return null;
        ArrayList<View> pending=new ArrayList<>();pending.add(window.getDecorView());
        View bestSurface=null,bestTexture=null;int surfaceArea=0,textureArea=0;surfaces=0;textures=0;
        for(int i=0;i<pending.size()&&i<128;i++) {
            View view=pending.get(i);Rect bounds=new Rect();if(view==null||!view.isShown()||!view.getGlobalVisibleRect(bounds)||!bounds.intersect(area))continue;
            int size=bounds.width()*bounds.height();
            if(Build.VERSION.SDK_INT>=24&&view instanceof SurfaceView&&view.getWidth()>32&&view.getHeight()>32&&((SurfaceView)view).getHolder().getSurface().isValid()) {surfaces++;if(size>surfaceArea){bestSurface=view;surfaceArea=size;}}
            if(view instanceof TextureView&&view.getWidth()>32&&view.getHeight()>32&&((TextureView)view).isAvailable()) {textures++;if(size>textureArea){bestTexture=view;textureArea=size;}}
            if(view instanceof ViewGroup) {ViewGroup group=(ViewGroup)view;for(int child=0;child<group.getChildCount()&&pending.size()<128;child++)pending.add(group.getChildAt(child));}
        }
        View result=bestSurface!=null?bestSurface:bestTexture;layerName=result==null?"window":result.getClass().getSimpleName();return result;
    }

    private void copyWindow(Window window,View view,Bitmap bitmap,String id,double position,long serial,boolean keepActive,AtomicInteger phase,Runnable timeout,Runnable copied,Runnable saved) {
        if(phase.get()!=0) {finish(bitmap,id,position,serial,keepActive,false,phase,timeout,copied,saved);return;}
        if(Build.VERSION.SDK_INT>=26) {
            int[] location=new int[2];view.getLocationInWindow(location);
            Rect source=new Rect(location[0],location[1],location[0]+view.getWidth(),location[1]+view.getHeight());
            try { PixelCopy.request(window,source,bitmap,result -> {copyResult=result;status="window-copy:"+result;finish(bitmap,id,position,serial,keepActive,result==PixelCopy.SUCCESS,phase,timeout,copied,saved);},main); }
            catch(Exception error) { finish(bitmap,id,position,serial,keepActive,false,phase,timeout,copied,saved); }
        } else {
            boolean success=false;
            try { Canvas canvas=new Canvas(bitmap);canvas.scale((float)bitmap.getWidth()/view.getWidth(),(float)bitmap.getHeight()/view.getHeight());view.draw(canvas);success=true; }catch(Exception ignored){}
            finish(bitmap,id,position,serial,keepActive,success,phase,timeout,copied,saved);
        }
    }

    private void finish(Bitmap bitmap,String id,double position,long serial,boolean keepActive,boolean success,AtomicInteger phase,Runnable timeout,Runnable copied,Runnable saved) {
        if(!phase.compareAndSet(0,1)) { status="late-copy";bitmap.recycle();copying.set(false);return; }
        main.removeCallbacks(timeout);
        if(!success||serial!=generation.get()) { status=success?"stale":"copy-failed";bitmap.recycle();copying.set(false);run(copied);return; }
        enqueue(() -> {
            try {
                int width=bitmap.getWidth(),height=bitmap.getHeight();int[] pixels=new int[width*height];bitmap.getPixels(pixels,0,width,0,0,width,height);
                if(serial!=generation.get()) {status="stale";return;}if(!usefulPixels(pixels)) {status="blank";return;}
                ByteArrayOutputStream bytes=new ByteArrayOutputStream(8192);
                if(!bitmap.compress(Bitmap.CompressFormat.JPEG,55,bytes)||bytes.size()>32768) {status="encode-failed";return;}
                directory.mkdirs();long capturedAt=Math.max(System.currentTimeMillis(),++version);version=capturedAt;
                File temporary=new File(directory,id+".pending"),file=new File(directory,id+"-"+capturedAt+"-"+(long)(position*1000)+".jpg");
                try(FileOutputStream output=new FileOutputStream(temporary)) { bytes.writeTo(output);output.getFD().sync(); }
                if(serial!=generation.get()) { temporary.delete();return; }
                remove(id);
                if(!temporary.renameTo(file)) { temporary.delete();return; }
                frames.put(id,new Frame(file,capturedAt,(long)(position*1000),serial));if(!keepActive)try { mark(""); }catch(Exception ignored){}prune();status="saved";
                main.post(() -> { if(!closed&&serial==generation.get())run(saved); });
            } catch(Exception|OutOfMemoryError error) {status="save-failed:"+error.getClass().getSimpleName();}
            finally { bitmap.recycle();copying.set(false); }
        },() -> { bitmap.recycle();copying.set(false); });
        run(copied);
    }

    static boolean usefulPixels(int[] pixels) {
        if(pixels==null||pixels.length<16)return false;
        int first=pixels[0],different=0,min=255,max=0;
        long sum=0,sumSquares=0;
        for(int pixel:pixels) {
            int r=(pixel>>16)&255,g=(pixel>>8)&255,b=pixel&255,y=(77*r+150*g+29*b)>>8;
            min=Math.min(min,y);max=Math.max(max,y);sum+=y;sumSquares+=(long)y*y;
            if(Math.abs(r-((first>>16)&255))+Math.abs(g-((first>>8)&255))+Math.abs(b-(first&255))>24)different++;
        }
        double mean=(double)sum/pixels.length,variance=(double)sumSquares/pixels.length-mean*mean;
        return max-min>16&&variance>12&&different>pixels.length/30;
    }

    public JSONObject diagnostics() {
        JSONObject result=new JSONObject();try {result.put("frames",frames.size()).put("status",status).put("copyResult",copyResult).put("busy",copying.get()).put("layer",layerName).put("surfaces",surfaces).put("textures",textures).put("width",captureWidth).put("height",captureHeight);}catch(Exception ignored){}return result;
    }

    public WebResourceResponse response(Uri uri) {
        if(!"https".equals(uri.getScheme())||!"app.cartoonwatch.local".equals(uri.getHost()))return null;
        Matcher path=PATH.matcher(uri.getPath()==null?"":uri.getPath());
        if(!path.matches())return null;
        Frame frame=frames.get(path.group(1));Long invalid=invalidations.get(path.group(1));
        try {
            if(frame!=null&&frame.generation>=clearGeneration&&(invalid==null||frame.generation>=invalid)&&(uri.getQueryParameter("v")==null||String.valueOf(frame.capturedAt).equals(uri.getQueryParameter("v")))) {
                Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("Content-Length",String.valueOf(frame.file.length()));
                return new WebResourceResponse("image/jpeg",null,200,"OK",headers,new FileInputStream(frame.file));
            }
        }catch(Exception error) { if(frame!=null)frames.remove(path.group(1),frame); }
        return new WebResourceResponse("image/jpeg",null,404,"Not Found",Collections.singletonMap("Cache-Control","no-store"),new ByteArrayInputStream(new byte[0]));
    }

    private void remove(String id) { File[] files=directory.listFiles();if(files!=null)for(File file:files)if(file.isFile()&&file.getName().startsWith(id+"-"))file.delete(); }
    private void mark(String id) throws Exception { try(FileOutputStream output=new FileOutputStream(active)) { output.write((id.isEmpty()?"0000000000000000000000000000000000000000000000000000000000000000":id).getBytes("US-ASCII"));output.getFD().sync(); } }

    private void prune() {
        ArrayList<Map.Entry<String,Frame>> ordered=new ArrayList<>(frames.entrySet());
        Collections.sort(ordered,(a,b)->Long.compare(a.getValue().capturedAt,b.getValue().capturedAt));
        long bytes=active.length();for(Map.Entry<String,Frame> entry:ordered)bytes+=entry.getValue().file.length();
        int count=ordered.size();
        for(Map.Entry<String,Frame> entry:ordered) {
            if(count<=MAX_FILES&&bytes<=MAX_BYTES)break;
            Frame frame=entry.getValue();if(frames.remove(entry.getKey(),frame)) { bytes-=frame.file.length();frame.file.delete();count--; }
        }
        File[] files=directory.listFiles();if(files!=null)for(File file:files) {
            Matcher name=NAME.matcher(file.getName());
            if(name.matches()) { Frame frame=frames.get(name.group(1));if(frame==null||!frame.file.equals(file))file.delete(); }
            else if(file.getName().endsWith(".pending"))file.delete();
        }
    }

    private void run(Runnable action) { if(action!=null) { if(Looper.myLooper()==Looper.getMainLooper())action.run();else main.post(action); } }
    private void enqueueDurable(Runnable action) {
        try {writer.execute(action);}catch(java.util.concurrent.RejectedExecutionException error) {if(!closed&&!writer.isShutdown()){status="queue-retry";main.postDelayed(() -> enqueueDurable(action),32);}}
    }
    private void enqueue(Runnable action,Runnable rejected) { try { writer.execute(action); }catch(Exception error) { run(rejected); } }
    @Override public void close() { closed=true;main.postDelayed(() -> writer.shutdown(),400); }
}

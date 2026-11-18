package tv.cartoonwatch.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.zip.GZIPInputStream;
import org.json.JSONArray;
import org.json.JSONObject;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

public final class ArtworkRepository extends SQLiteOpenHelper {
    private static final String ORIGIN="https://app.cartoonwatch.local/";
    private static final long NEGATIVE_TTL=86400000L;
    private static final Set<String> IMAGE_HOSTS=new HashSet<>(Arrays.asList("static.tvmaze.com","cdn.myanimelist.net","cdn.anime-planet.com","cdn.anisearch.com","media.kitsu.app","s4.anilist.co","cdn.animenewsnetwork.com","cdn.anidb.net","simkl.in","u.livechart.me","upload.wikimedia.org","images.wcostream.com","www.wcostream.tv","wcostream.tv","www.wco.tv","wco.tv"));
    private final File directory;
    private final Object files=new Object();
    private final Set<String> pending=Collections.newSetFromMap(new ConcurrentHashMap<String,Boolean>());
    private final ThreadPoolExecutor workers=new ThreadPoolExecutor(2,2,30,TimeUnit.SECONDS,new ArrayBlockingQueue<Runnable>(24));
    private volatile boolean closed;
    private int writes;

    public ArtworkRepository(Context context) {
        super(context,"artwork-v2.db",null,1);
        directory=new File(context.getCacheDir(),"artwork");
        directory.mkdirs();
        setWriteAheadLoggingEnabled(true);
    }

    @Override public void onCreate(SQLiteDatabase db) { db.execSQL("CREATE TABLE artwork(url TEXT PRIMARY KEY,image TEXT NOT NULL,source TEXT NOT NULL,source_url TEXT NOT NULL,attribution TEXT NOT NULL,checked INTEGER NOT NULL,retry INTEGER NOT NULL)");db.execSQL("CREATE INDEX artwork_age ON artwork(checked)"); }
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion) { }

    public JSONObject lookup(JSONArray requested) throws Exception {
        JSONArray found=new JSONArray(),waiting=new JSONArray();
        Set<String> seen=new HashSet<>();
        if(requested==null)return new JSONObject().put("items",found).put("pending",waiting);
        for(int i=0;i<requested.length()&&i<12;i++) {
            JSONObject item=requested.optJSONObject(i);
            if(item==null)continue;
            String output=item.optString("url"),target=target(item),variant=variant(item),key=variant+"\n"+target;
            if(output.length()>2048||!seen.add(variant+"\n"+output))continue;
            if(target.isEmpty()) { found.put(result(output,variant,null));continue; }
            JSONObject saved=stored(key),input=provided(item,variant),value=preferred(saved,input,variant);
            if(value!=null&&!value.optString("image").isEmpty()&&exists(value.optString("image"),variant)) { found.put(result(output,variant,value));continue; }
            if("backdrop".equals(variant)&&(value==null||value.optString("image").isEmpty())) {found.put(result(output,variant,null));continue;}
            if(saved!=null&&saved.optLong("retry")>System.currentTimeMillis()&&(value==null||value.optString("image").equals(saved.optString("image")))) { found.put(result(output,variant,null));continue; }
            enqueue(key,target,variant,value);
            waiting.put(new JSONObject().put("url",output).put("variant",variant));
        }
        return new JSONObject().put("items",found).put("pending",waiting).put("retryAfter",1000);
    }

    private static JSONObject result(String url,String variant,JSONObject value) throws Exception {
        JSONObject result=new JSONObject().put("url",url).put("image","").put("variant",variant);
        if(value!=null)result.put("image",ORIGIN+"art/"+fileKey(value.optString("image"),variant)+".jpg").put("imageSource",value.optString("imageSource")).put("imageSourceUrl",value.optString("imageSourceUrl")).put("imageAttribution",value.optString("imageAttribution"));
        return result;
    }

    private static JSONObject provided(JSONObject item,String variant) throws Exception {
        boolean backdrop="backdrop".equals(variant);String prefix=backdrop?"backdrop":"image";
        String image=backdrop?TrendingRepository.animeImage(item.optString("backdrop"),true):imageUrl(item.optString("image"));
        if(image.isEmpty())return null;
        return new JSONObject().put("image",image).put("imageSource",limited(item.optString(prefix+"Source"),120)).put("imageSourceUrl",limited(item.optString(prefix+"SourceUrl"),2048)).put("imageAttribution",limited(item.optString(prefix+"Attribution"),300));
    }

    private static JSONObject preferred(JSONObject saved,JSONObject input,String variant) {
        if(input==null)return saved;
        if(saved!=null&&"poster".equals(variant)&&input.optString("imageSourceUrl").equals(saved.optString("imageSourceUrl"))&&TrendingRepository.posterSize(input.optString("image"))>0&&TrendingRepository.posterSize(saved.optString("image"))>TrendingRepository.posterSize(input.optString("image")))return saved;
        return input;
    }

    private static String variant(JSONObject item){return "backdrop".equals(item.optString("variant"))?"backdrop":"poster";}

    private static String limited(String value,int size) { return value.length()>size?value.substring(0,size):value; }

    private static String target(JSONObject item) {
        String url="episode".equals(item.optString("kind"))?item.optString("seriesUrl"):item.optString("url");
        try { URI uri=new URI(url);String host=uri.getHost();if(!"https".equals(uri.getScheme())||uri.getUserInfo()!=null||host==null||!host.matches("(?i)(?:www\\.)?(?:wco|wcostream)\\.tv")||uri.getPort()!=-1||uri.getRawQuery()!=null||uri.getPath()==null||uri.getPath().length()<2||url.length()>2048)return "";return "https://www.wcostream.tv"+uri.getRawPath(); } catch(Exception e) { return ""; }
    }

    private static String imageUrl(String value) {
        try { URI uri=new URI(value);String host=uri.getHost();if(value.length()>2048||!"https".equals(uri.getScheme())||uri.getUserInfo()!=null||uri.getPort()!=-1||host==null||!IMAGE_HOSTS.contains(host.toLowerCase(Locale.US))||value.contains("no_pic"))return "";String result=uri.toASCIIString();return "cdn.myanimelist.net".equalsIgnoreCase(host)?result.replace("/r/160x225/images/","/r/300x450/images/"):result; } catch(Exception e) { return ""; }
    }

    private synchronized JSONObject stored(String url) throws Exception {
        try(Cursor cursor=getReadableDatabase().rawQuery("SELECT image,source,source_url,attribution,retry FROM artwork WHERE url=?",new String[]{url})) {
            if(!cursor.moveToFirst())return null;
            return new JSONObject().put("image",cursor.getString(0)).put("imageSource",cursor.getString(1)).put("imageSourceUrl",cursor.getString(2)).put("imageAttribution",cursor.getString(3)).put("retry",cursor.getLong(4));
        }
    }

    private synchronized void remember(String url,JSONObject value,boolean failed) {
        if(closed)return;
        long now=System.currentTimeMillis();
        ContentValues row=new ContentValues();row.put("url",url);row.put("image",value==null?"":value.optString("image"));row.put("source",value==null?"":value.optString("imageSource"));row.put("source_url",value==null?"":value.optString("imageSourceUrl"));row.put("attribution",value==null?"":value.optString("imageAttribution"));row.put("checked",now);row.put("retry",value==null||failed?now+NEGATIVE_TTL:0);
        SQLiteDatabase db=getWritableDatabase();db.insertWithOnConflict("artwork",null,row,SQLiteDatabase.CONFLICT_REPLACE);
        if(++writes%32==0)db.execSQL("DELETE FROM artwork WHERE url IN (SELECT url FROM artwork ORDER BY checked DESC LIMIT -1 OFFSET 4096)");
    }

    private void enqueue(String key,String url,String variant,JSONObject known) {
        if(closed||!pending.add(key))return;
        try { workers.execute(() -> { JSONObject value=null;try {value=known!=null&&!known.optString("image").isEmpty()?known:"poster".equals(variant)?resolve(url):null;if(value!=null)thumbnail(value.getString("image"),variant);remember(key,value,false);} catch(Exception error) {try{remember(key,value,true);}catch(Exception ignored){}} finally {pending.remove(key);} }); }
        catch(java.util.concurrent.RejectedExecutionException e) { pending.remove(key); }
    }

    static JSONObject poster(String html,String url) throws Exception {
        Document document=Jsoup.parse(html,url);
        Element poster=document.select("#sidebar_cat img[src], .katcont img[src*=catimg], img[src*=catimg]").first();
        String image=poster==null?"":imageUrl(poster.absUrl("src"));
        if(image.isEmpty())return null;
        return new JSONObject().put("image",image).put("imageSource","WCO").put("imageSourceUrl",url).put("imageAttribution","Artwork provided by WCO");
    }

    private JSONObject resolve(String url) throws Exception { return poster(new String(fetch(url,786432,false),"UTF-8"),url); }

    private static byte[] fetch(String initial,int limit,boolean image) throws Exception {
        return fetch(initial,limit,image,false);
    }

    private static byte[] fetch(String initial,int limit,boolean image,boolean backdrop) throws Exception {
        String url=initial;long end=System.currentTimeMillis()+6000;
        for(int redirect=0;redirect<4;redirect++) {
            if(Thread.currentThread().isInterrupted()||System.currentTimeMillis()>end)throw new java.io.IOException("Artwork request expired");
            if(image&&(imageUrl(url).isEmpty()||backdrop&&TrendingRepository.animeImage(url,true).isEmpty()))throw new java.io.IOException("Unsupported artwork host");
            if(!image&&target(new JSONObject().put("url",url)).isEmpty())throw new java.io.IOException("Unsupported title host");
            HttpURLConnection connection=(HttpURLConnection)new URL(url).openConnection();
            connection.setConnectTimeout(2200);connection.setReadTimeout(2600);connection.setInstanceFollowRedirects(false);connection.setRequestProperty("User-Agent","CartoonWatch/0.4 (local TV artwork; bounded cache)");connection.setRequestProperty("Accept",image?"image/jpeg,image/png,image/webp":"text/html");connection.setRequestProperty("Accept-Encoding","gzip");
            try {
                int code=connection.getResponseCode();
                if(code>=300&&code<400) {String location=connection.getHeaderField("Location");if(location==null)throw new java.io.IOException("Artwork redirect missing");url=new URL(new URL(url),location).toString();continue;}
                if(code!=200||connection.getContentLength()>limit)throw new java.io.IOException("Artwork unavailable");
                String type=connection.getContentType();if(image&&(type==null||!type.toLowerCase(Locale.US).startsWith("image/")))throw new java.io.IOException("Invalid artwork response");
                try(InputStream raw=connection.getInputStream();InputStream input="gzip".equalsIgnoreCase(connection.getContentEncoding())?new GZIPInputStream(raw):raw;ByteArrayOutputStream output=new ByteArrayOutputStream()) {
                    byte[] buffer=new byte[8192];int count;
                    while((count=input.read(buffer))!=-1) {if(Thread.currentThread().isInterrupted()||System.currentTimeMillis()>end||output.size()+count>limit)throw new java.io.IOException("Artwork limit exceeded");output.write(buffer,0,count);}
                    return output.toByteArray();
                }
            } finally { connection.disconnect(); }
        }
        throw new java.io.IOException("Too many artwork redirects");
    }

    private static String hash(String value) throws Exception {byte[] bytes=MessageDigest.getInstance("SHA-256").digest(value.getBytes("UTF-8"));String alphabet="0123456789abcdef";StringBuilder result=new StringBuilder(64);for(byte b:bytes)result.append(alphabet.charAt((b&255)>>>4)).append(alphabet.charAt(b&15));return result.toString();}
    private static String fileKey(String image,String variant) throws Exception {return hash("v2\n"+variant+"\n"+image);}

    private boolean exists(String image,String variant) throws Exception { synchronized(files) {File file=new File(directory,fileKey(image,variant)+".jpg");if(!file.isFile())return false;file.setLastModified(System.currentTimeMillis());return true;} }

    private void thumbnail(String image,String variant) throws Exception {
        if(exists(image,variant))return;
        boolean backdrop="backdrop".equals(variant);
        if(backdrop&&TrendingRepository.animeImage(image,true).isEmpty())throw new java.io.IOException("Unsupported backdrop");
        byte[] bytes=fetch(image,1048576,true,backdrop);
        BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
        if(options.outWidth<=0||options.outHeight<=0||options.outWidth>20000||options.outHeight>20000)throw new java.io.IOException("Invalid artwork dimensions");
        if(backdrop&&options.outWidth*3<options.outHeight*4)throw new java.io.IOException("Backdrop is not landscape artwork");
        options.inSampleSize=sampleSize(options.outWidth,options.outHeight,backdrop);
        options.inJustDecodeBounds=false;options.inPreferredConfig=Bitmap.Config.ARGB_8888;
        Bitmap decoded=BitmapFactory.decodeByteArray(bytes,0,bytes.length,options),scaled=null;
        if(decoded==null)throw new java.io.IOException("Artwork could not be decoded");
        File temporary=new File(directory,fileKey(image,variant)+"-"+System.nanoTime()+".tmp");
        try {
            int[] size=dimensions(decoded.getWidth(),decoded.getHeight(),backdrop);
            scaled=size[0]!=decoded.getWidth()||size[1]!=decoded.getHeight()?Bitmap.createScaledBitmap(decoded,size[0],size[1],true):decoded;
            try(FileOutputStream output=new FileOutputStream(temporary)) {if(!scaled.compress(Bitmap.CompressFormat.JPEG,75,output))throw new java.io.IOException("Artwork could not be stored");}
            synchronized(files) {File destination=new File(directory,fileKey(image,variant)+".jpg");if(destination.isFile())temporary.delete();else if(!temporary.renameTo(destination))throw new java.io.IOException("Artwork could not be stored");trim();}
        } finally {temporary.delete();if(scaled!=null&&scaled!=decoded)scaled.recycle();decoded.recycle();}
    }

    static int sampleSize(int width,int height) {return sampleSize(width,height,false);}
    static int sampleSize(int width,int height,boolean backdrop) {int sample=1;while(width/sample>(backdrop?1920:640)||height/sample>(backdrop?1080:960))sample*=2;return sample;}
    static int[] dimensions(int width,int height) {return dimensions(width,height,false);}
    static int[] dimensions(int width,int height,boolean backdrop) {float factor=Math.min(1f,Math.min((backdrop?960f:320f)/width,(backdrop?540f:480f)/height));return new int[]{Math.max(1,Math.round(width*factor)),Math.max(1,Math.round(height*factor))};}

    private void trim() {
        File[] entries=directory.listFiles((dir,name)->name.matches("[a-f0-9]{64}\\.jpg"));if(entries==null)return;
        List<File> ordered=new ArrayList<>(Arrays.asList(entries));Collections.sort(ordered,(a,b)->Long.compare(a.lastModified(),b.lastModified()));
        long size=0;for(File file:ordered)size+=file.length();int count=ordered.size();
        for(File file:ordered) {if(count<=256&&size<=16777216)break;long length=file.length();if(file.delete()){size-=length;count--;}}
    }

    public WebResourceResponse open(String path) {
        if(path==null||!path.matches("/art/[a-f0-9]{64}\\.jpg"))return null;
        synchronized(files) {try {File file=new File(directory,path.substring(5));file.setLastModified(System.currentTimeMillis());return new WebResourceResponse("image/jpeg",null,new FileInputStream(file));} catch(Exception e) {return new WebResourceResponse("image/jpeg",null,new ByteArrayInputStream(new byte[0]));}}
    }

    @Override public void close() {closed=true;workers.shutdownNow();super.close();}
}

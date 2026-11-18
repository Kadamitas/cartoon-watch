package tv.cartoonwatch.app;

import android.content.Context;
import android.util.AtomicFile;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;
import org.json.JSONArray;
import org.json.JSONObject;

public final class TrendingRepository {
    public interface Callback {void complete(JSONObject value);}
    private static final long DAY=86400000L,TTL=DAY,STALE=7*DAY;
    private static final int MAX_RESPONSE=524288,MAX_CACHE=131072;
    private static final Pattern LANGUAGE=Pattern.compile(" (?:english )?(?:dubbed|subbed|dub|sub)$");
    private static final Pattern SEASON=Pattern.compile(" (?:season|part|cour)(?: |$)");
    private static final Pattern FAMILY=Pattern.compile(" (?:(?:season|part|cour) (?:[0-9]+|[ivx]+|one|two|three|four|five|six|seven|eight|nine|ten|final)|(?:[0-9]+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|final) season)$");
    private final Context context;
    private final CatalogIndex catalog;
    private final AtomicFile file;
    private final Object lock=new Object();
    private final LinkedHashMap<String,JSONObject> cache=new LinkedHashMap<>(16,.75f,true);
    private final Map<String,JSONObject> categories=new LinkedHashMap<>(),cartoonFeeds=new LinkedHashMap<>();
    private final Map<String,List<Callback>> pending=new LinkedHashMap<>();
    private final ThreadPoolExecutor worker=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<Runnable>(4));
    private volatile boolean closed;
    private volatile HttpURLConnection connection;
    private boolean loaded,registryLoaded,cartoonsLoaded;
    private int waiters;
    private long retryAt;
    private String catalogVersion="";

    public TrendingRepository(Context context,CatalogIndex catalog) {
        this.context=context.getApplicationContext();this.catalog=catalog;
        file=new AtomicFile(new File(this.context.getCacheDir(),"anime-discovery.json"));
    }

    public void request(String genre,Callback callback) {
        String key=genre==null||genre.isEmpty()?"weekly":genre;
        if(!key.matches("[a-z0-9][a-z0-9-]{0,63}"))throw new IllegalArgumentException("Unsupported category");
        JSONObject immediate=null;
        synchronized(lock) {
            if(closed)return;
            long now=System.currentTimeMillis();
            JSONObject saved=cache.get(key);
            if(registryLoaded&&!"weekly".equals(key)&&genreLabel(key)==null)immediate=result(key,null,now);
            else if(isCartoon(key)&&cartoonsLoaded)immediate=result(key,null,now);
            else if(!isCartoon(key)&&loaded&&(fresh(saved,now)||now<retryAt))immediate=result(key,saved,now);
            else if(waiters>=8||(!pending.containsKey(key)&&pending.size()>=5))immediate=result(key,saved,now);
            else {
                List<Callback> callbacks=pending.get(key);
                if(callbacks!=null){callbacks.add(callback);waiters++;return;}
                callbacks=new ArrayList<>();callbacks.add(callback);pending.put(key,callbacks);waiters++;
                try {worker.execute(()->load(key));return;}
                catch(RejectedExecutionException error){pending.remove(key);waiters--;immediate=result(key,saved,now);}
            }
        }
        callback.complete(immediate);
    }

    private void load(String key) {
        JSONObject value;
        try {
            if(!registryLoaded)readRegistry();
            if(isCartoon(key))readCartoons();
            else if("weekly".equals(key)||genreLabel(key)!=null) {
                if(!loaded)readCache();
                long now=System.currentTimeMillis();
                boolean fetch;
                synchronized(lock){fetch=!closed&&!fresh(cache.get(key),now)&&now>=retryAt;}
                if(fetch) {
                    JSONObject feed=fetch(key,now);
                    synchronized(lock){if(!closed){cache.put(key,new JSONObject().put("savedAt",now).put("feed",feed));while(cache.size()>14)cache.remove(cache.keySet().iterator().next());}}
                    writeCache();
                }
            }
        } catch(Exception error) {
            synchronized(lock){retryAt=Math.max(retryAt,System.currentTimeMillis()+900000L);loaded=true;}
            writeCache();
        }
        List<Callback> callbacks;
        synchronized(lock){callbacks=pending.remove(key);if(callbacks==null)return;waiters-=callbacks.size();value=result(key,cache.get(key),System.currentTimeMillis());}
        if(!closed)for(Callback callback:callbacks)try{callback.complete(new JSONObject(value.toString()));}catch(Exception ignored){}
    }

    private void readRegistry() {
        Map<String,JSONObject> found=new LinkedHashMap<>();
        try(InputStream in=context.getAssets().open("discovery-categories.json")) {
            JSONObject registry=new JSONObject(read(in,32768));if(registry.optInt("version")!=2)throw new IllegalStateException("Category registry unavailable");
            JSONArray list=registry.optJSONArray("categories");
            if(list!=null)for(int i=0;i<list.length()&&i<64;i++) {
                JSONObject item=list.optJSONObject(i);if(item==null)continue;
                String key=item.optString("key"),label=item.optString("label"),type=item.optString("type");
                if(key.matches("[a-z0-9][a-z0-9-]{0,63}")&&!"weekly".equals(key)&&!label.isEmpty()&&label.length()<=80&&("anime".equals(type)||"cartoons".equals(type)))found.put(key,item);
            }
        } catch(Exception ignored){}
        synchronized(lock){categories.putAll(found);registryLoaded=true;}
    }

    private void readCartoons() {
        if(cartoonsLoaded)return;
        Map<String,JSONObject> feeds=new LinkedHashMap<>();
        try(InputStream in=context.getAssets().open("cartoon-discovery.json")) {
            JSONObject snapshot=new JSONObject(read(in,131072)),collections=snapshot.optJSONObject("collections");
            if(snapshot.optInt("version")!=1||!"TVmaze".equals(snapshot.optString("source"))||collections==null)throw new IllegalStateException("Cartoon collection unavailable");
            String date=snapshot.isNull("updatedAt")?"":snapshot.optString("updatedAt");
            for(Map.Entry<String,JSONObject> entry:categories.entrySet()) {
                if(!"cartoons".equals(entry.getValue().optString("type")))continue;
                JSONArray rows=collections==null?null:collections.optJSONArray(entry.getKey()),items=new JSONArray();
                List<Cartoon> ranked=new ArrayList<>();Set<String> seen=new HashSet<>();
                if(rows!=null)for(int i=0;i<rows.length()&&i<200;i++) {
                    JSONObject row=rows.optJSONObject(i);if(row==null)continue;
                    JSONObject item=catalog.cartoon(row.optString("url"));if(item==null||!seen.add(item.optString("url")))continue;
                    Object raw=row.opt("rating");double rating=raw instanceof Number?((Number)raw).doubleValue():Double.NaN;
                    if(Double.isInfinite(rating)||rating<0||rating>10)rating=Double.NaN;
                    ranked.add(new Cartoon(item,rating));
                }
                Collections.sort(ranked,(a,b)->{int score=Double.compare(Double.isNaN(b.rating)?-1:b.rating,Double.isNaN(a.rating)?-1:a.rating);if(score!=0)return score;int title=CatalogIndex.key(a.item.optString("title")).compareTo(CatalogIndex.key(b.item.optString("title")));return title!=0?title:a.item.optString("url").compareTo(b.item.optString("url"));});
                for(Cartoon cartoon:ranked) {cartoon.item.put("trendRank",items.length()+1);if(!Double.isNaN(cartoon.rating))cartoon.item.put("trendRating",cartoon.rating);items.put(cartoon.item);if(items.length()==50)break;}
                feeds.put(entry.getKey(),new JSONObject().put("items",items).put("genre",entry.getKey()).put("genreLabel",entry.getValue().optString("label")).put("type","cartoons").put("metric","rating").put("source","TVmaze").put("snapshotAt",date).put("updatedAt",date).put("stale",false).put("available",items.length()>0));
            }
        } catch(Exception ignored){}
        synchronized(lock){cartoonFeeds.putAll(feeds);cartoonsLoaded=true;}
    }

    private void readCache() throws Exception {
        catalogVersion=catalog.version();
        try(FileInputStream in=file.openRead()) {
            JSONObject saved=new JSONObject(read(in,MAX_CACHE));
            if(saved.optInt("queryVersion")==5&&catalogVersion.equals(saved.optString("catalogVersion"))) {
                JSONArray entries=saved.optJSONArray("entries");
                synchronized(lock) {
                    long now=System.currentTimeMillis();retryAt=Math.min(now+DAY,saved.optLong("retryAt"));
                    if(entries!=null)for(int i=0;i<entries.length()&&i<14;i++) {
                        JSONObject entry=entries.optJSONObject(i);if(entry==null)continue;
                        String key=entry.optString("key");long age=now-entry.optLong("savedAt");
                        if(("weekly".equals(key)||genreLabel(key)!=null&&!isCartoon(key))&&age>=-300000&&age<=STALE&&entry.optJSONObject("feed")!=null)cache.put(key,entry);
                    }
                }
            }
        } catch(Exception ignored){}
        synchronized(lock){loaded=true;}
    }

    private void writeCache() {
        FileOutputStream out=null;
        try {
            byte[] bytes;
            synchronized(lock) {
                if(closed)return;
                do {
                    JSONArray entries=new JSONArray();for(Map.Entry<String,JSONObject> entry:cache.entrySet()){JSONObject value=new JSONObject(entry.getValue().toString());value.put("key",entry.getKey());entries.put(value);}
                    bytes=new JSONObject().put("queryVersion",5).put("catalogVersion",catalogVersion).put("retryAt",retryAt).put("entries",entries).toString().getBytes("UTF-8");
                    if(bytes.length<=MAX_CACHE||cache.isEmpty())break;
                    cache.remove(cache.keySet().iterator().next());
                } while(true);
            }
            out=file.startWrite();out.write(bytes);file.finishWrite(out);
        } catch(Exception ignored){if(out!=null)file.failWrite(out);}
    }

    private JSONObject fetch(String key,long now) throws Exception {
        boolean weekly="weekly".equals(key);long end=now/DAY*DAY,start=end-STALE;
        JSONObject category=categories.get(key);
        JSONObject variables=weekly?new JSONObject().put("since",start/1000-1).put("until",end/1000):new JSONObject().put("genre",category.opt("genre")==null?JSONObject.NULL:category.opt("genre")).put("tag",category.opt("tag")==null?JSONObject.NULL:category.opt("tag")).put("genres",category.optJSONArray("genres")==null?JSONObject.NULL:category.optJSONArray("genres")).put("tagRank",category.isNull("tag")||category.optString("tag").isEmpty()?JSONObject.NULL:70);
        String query;try(InputStream in=context.getAssets().open(weekly?"trending-query.graphql":"genre-query.graphql")){query=read(in,16384);}
        JSONObject body=new JSONObject().put("query",query).put("variables",variables);
        JSONObject raw=post(body);
        if(raw.has("errors"))throw new IllegalStateException("Discovery feed unavailable");
        JSONObject page=raw.optJSONObject("data");page=page==null?null:page.optJSONObject("Page");
        if(page==null)throw new IllegalStateException("Discovery feed unavailable");
        JSONArray input=page.optJSONArray(weekly?"mediaTrends":"media");
        if(input==null)throw new IllegalStateException("Discovery feed unavailable");
        Map<Integer,Candidate> unique=new LinkedHashMap<>();
        for(int i=0;i<input.length()&&i<50;i++) {
            JSONObject item=input.optJSONObject(i),media=weekly&&item!=null?item.optJSONObject("media"):item;
            if(!eligible(media))continue;
            int id=media.optInt("id");if(id<=0||unique.containsKey(id))continue;
            long score=weekly?weeklyScore(media,start/1000,end/1000):Math.max(0,media.optLong("popularity"));
            if(score>0)unique.put(id,new Candidate(media,score));
        }
        List<Candidate> ranked=new ArrayList<>(unique.values());
        Collections.sort(ranked,(a,b)->{int score=Long.compare(b.score,a.score);return score!=0?score:Integer.compare(a.media.optInt("id"),b.media.optInt("id"));});
        JSONArray items=new JSONArray();Set<String> urls=new HashSet<>();
        for(Candidate candidate:ranked) {
            if(closed)throw new InterruptedException();
            Match matched=match(candidate.media);JSONObject item=matched==null?null:matched.item;
            if(item==null||!urls.add(item.optString("url")))continue;
            cover(item,candidate.media,matched.direct);
            item.put("trendRank",items.length()+1).put("trendTitle",title(candidate.media));items.put(item);
            if(items.length()>=(weekly?20:50))break;
        }
        JSONObject result=new JSONObject().put("items",items).put("source","AniList").put("type","anime").put("metric",weekly?"weeklyActivity":"popularity").put("updatedAt",iso(now)).put("stale",false).put("available",items.length()>0);
        if(weekly)result.put("periodStart",iso(start)).put("periodEnd",iso(end));
        else result.put("genre",key).put("genreLabel",genreLabel(key));
        return result;
    }

    static void cover(JSONObject item,JSONObject media,boolean direct) throws Exception {
        if(!"series".equals(item.optString("kind"))||media.optInt("id")<=0)return;
        String source="https://anilist.co/anime/"+media.optInt("id"),known=item.optString("image");
        JSONObject image=media.optJSONObject("coverImage");String value="";
        if(image!=null)for(String field:new String[]{"large","medium"})if(!image.isNull(field)){value=animeImage(image.optString(field),false);if(!value.isEmpty())break;}
        boolean upgrade=direct&&posterSize(value)>posterSize(known)&&posterSize(known)>0;
        if(!value.isEmpty()&&(known.isEmpty()||upgrade))item.put("image",value).put("imageSource","AniList").put("imageSourceUrl",source).put("imageAttribution","Cover metadata from AniList; artwork belongs to its respective owners.");
        String backdrop=media.isNull("bannerImage")?"":animeImage(media.optString("bannerImage"),true);
        if(!backdrop.isEmpty())item.put("backdrop",backdrop).put("backdropSource","AniList").put("backdropSourceUrl",source).put("backdropAttribution","Promotional backdrop metadata from AniList; artwork belongs to its respective owners.");
    }

    static String animeImage(String value,boolean backdrop) {
        try {
            URI uri=new URI(value);
            String path=backdrop?"banner/":"cover/(?:small|medium|large)/";
            return value.length()<=2048&&"https".equalsIgnoreCase(uri.getScheme())&&"s4.anilist.co".equalsIgnoreCase(uri.getHost())&&uri.getPort()==-1&&uri.getUserInfo()==null&&uri.getRawQuery()==null&&uri.getRawFragment()==null&&uri.getRawPath()!=null&&uri.getRawPath().matches("/file/anilistcdn/media/anime/"+path+"[A-Za-z0-9._-]+\\.(?:jpe?g|png|webp)")?uri.toASCIIString():"";
        } catch(Exception ignored){return "";}
    }

    static int posterSize(String value){if(animeImage(value,false).isEmpty())return 0;return value.contains("/cover/large/")?3:value.contains("/cover/medium/")?2:1;}

    private JSONObject post(JSONObject body) throws Exception {
        HttpURLConnection request=(HttpURLConnection)new URL("https://graphql.anilist.co").openConnection();connection=request;
        try {
            request.setConnectTimeout(5000);request.setReadTimeout(5000);request.setInstanceFollowRedirects(false);request.setRequestMethod("POST");request.setDoOutput(true);
            request.setRequestProperty("Content-Type","application/json");request.setRequestProperty("Accept","application/json");request.setRequestProperty("Accept-Encoding","gzip");request.setRequestProperty("User-Agent","CartoonWatch/0.5 (anonymous anime discovery)");
            byte[] bytes=body.toString().getBytes("UTF-8");request.setFixedLengthStreamingMode(bytes.length);
            try(java.io.OutputStream out=request.getOutputStream()){out.write(bytes);}
            int status=request.getResponseCode();
            if(status!=200) {
                long retry=retry(request.getHeaderField("Retry-After"));
                synchronized(lock){retryAt=Math.max(retryAt,System.currentTimeMillis()+Math.max(900000L,retry));}
                throw new IllegalStateException("Discovery feed unavailable");
            }
            if(request.getContentLength()>MAX_RESPONSE)throw new IllegalStateException("Discovery response too large");
            try(InputStream input=request.getInputStream();InputStream decoded="gzip".equalsIgnoreCase(request.getContentEncoding())?new GZIPInputStream(input):input){return new JSONObject(read(decoded,MAX_RESPONSE));}
        } finally {request.disconnect();if(connection==request)connection=null;}
    }

    private Match match(JSONObject media) throws Exception {
        JSONObject item=catalog.matchTrend(media.optInt("idMal"),aliases(media,false),false);
        if(item!=null)return new Match(item,true);
        JSONObject relations=media.optJSONObject("relations");JSONArray edges=relations==null?null:relations.optJSONArray("edges");
        Map<String,JSONObject> matches=new LinkedHashMap<>();
        if(edges!=null)for(int i=0;i<edges.length()&&i<64;i++) {
            JSONObject edge=edges.optJSONObject(i);if(edge==null||!"PREQUEL".equals(edge.optString("relationType")))continue;
            JSONObject parent=edge.optJSONObject("node");if(!eligible(parent)||!related(media,parent))continue;
            JSONObject value=catalog.matchTrend(parent.optInt("idMal"),aliases(parent,true),true);
            if(value!=null)matches.put(value.optString("url"),value);
        }
        return matches.size()==1?new Match(matches.values().iterator().next(),false):null;
    }

    static boolean eligible(JSONObject media) {
        if(media==null||!"ANIME".equals(media.optString("type"))||media.optBoolean("isAdult")||"NOT_YET_RELEASED".equals(media.optString("status")))return false;
        String format=media.optString("format");return "TV".equals(format)||"TV_SHORT".equals(format)||"ONA".equals(format);
    }

    static String normalize(String value){return LANGUAGE.matcher(CatalogIndex.key(value)).replaceAll("").trim();}
    static boolean hasSeason(String value){return SEASON.matcher(" "+normalize(value)).find();}
    static String family(String value) {
        String result=normalize(value);
        for(int i=0;i<3;i++){String next=FAMILY.matcher(result).replaceAll("").trim();if(next.equals(result))break;result=next;}
        return result;
    }

    static List<String> aliases(JSONObject media,boolean families) {
        LinkedHashSet<String> result=new LinkedHashSet<>();JSONObject titles=media.optJSONObject("title");
        if(titles!=null)for(String field:new String[]{"english","romaji","native"})if(!titles.isNull(field))addAlias(result,titles.optString(field),families);
        JSONArray synonyms=media.optJSONArray("synonyms");if(synonyms!=null)for(int i=0;i<synonyms.length()&&i<21;i++)if(!synonyms.isNull(i))addAlias(result,synonyms.optString(i),families);
        return new ArrayList<>(result);
    }

    private static void addAlias(Set<String> aliases,String value,boolean families) {
        if(value.isEmpty()||value.length()>300||aliases.size()>=24)return;
        String normalized=normalize(value);if(!normalized.isEmpty())aliases.add(normalized);
        if(families&&aliases.size()<24){String base=family(value);if(!base.isEmpty())aliases.add(base);}
    }

    static boolean related(JSONObject media,JSONObject parent) {
        for(String leaf:aliases(media,false))for(String value:aliases(parent,false)) {
            String base=family(value);if(base.length()>=4&&(leaf.equals(base)||leaf.startsWith(base+" ")))return true;
        }
        return false;
    }

    static long weeklyScore(JSONObject media,long since,long until) {
        JSONObject trends=media.optJSONObject("trends");JSONArray nodes=trends==null?null:trends.optJSONArray("nodes");
        Set<Long> seen=new HashSet<>();long result=0;
        if(nodes!=null)for(int i=0;i<nodes.length()&&i<8;i++){JSONObject node=nodes.optJSONObject(i);if(node==null)continue;long date=node.optLong("date");if(date>=since&&date<until&&seen.add(date/86400))result+=Math.max(0,Math.min(1000000000L,node.optLong("trending")));}
        return result;
    }

    private static String title(JSONObject media) {
        JSONObject title=media.optJSONObject("title");if(title==null)return "";
        String value=title.isNull("english")?"":title.optString("english","");if(value.isEmpty())value=title.isNull("romaji")?"":title.optString("romaji","");return value.substring(0,Math.min(300,value.length()));
    }

    private String genreLabel(String key){JSONObject category=categories.get(key);return category==null?null:category.optString("label");}
    private boolean isCartoon(String key){JSONObject category=categories.get(key);return category!=null&&"cartoons".equals(category.optString("type"));}
    private static boolean fresh(JSONObject entry,long now){return entry!=null&&now-entry.optLong("savedAt")>=-300000&&now-entry.optLong("savedAt")<TTL;}
    private JSONObject result(String key,JSONObject entry,long now) {
        try {
            if(isCartoon(key)) {
                JSONObject saved=cartoonFeeds.get(key);
                return saved==null?new JSONObject().put("items",new JSONArray()).put("genre",key).put("genreLabel",genreLabel(key)).put("type","cartoons").put("source","TVmaze").put("metric","rating").put("snapshotAt","").put("updatedAt","").put("available",false).put("stale",false):new JSONObject(saved.toString());
            }
            if(entry!=null&&now-entry.optLong("savedAt")>=-300000&&now-entry.optLong("savedAt")<=STALE)return new JSONObject(entry.getJSONObject("feed").toString()).put("stale",!fresh(entry,now));
            JSONObject result=new JSONObject().put("items",new JSONArray()).put("source","AniList").put("type","anime").put("metric","weekly".equals(key)?"weeklyActivity":"popularity").put("available",false).put("stale",false);
            if(registryLoaded&&!"weekly".equals(key)&&genreLabel(key)==null)result.put("error","Choose an available category");
            if(!"weekly".equals(key))result.put("genre",key).put("genreLabel",genreLabel(key));return result;
        } catch(Exception ignored){return new JSONObject();}
    }

    private static long retry(String value) {
        if(value==null)return 0;
        try{return Math.min(DAY,Math.max(0,Long.parseLong(value.trim())*1000));}catch(Exception ignored){}
        try{SimpleDateFormat format=new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz",Locale.US);return Math.min(DAY,Math.max(0,format.parse(value).getTime()-System.currentTimeMillis()));}catch(Exception ignored){return 0;}
    }

    private static String iso(long time){SimpleDateFormat format=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'",Locale.US);format.setTimeZone(TimeZone.getTimeZone("UTC"));return format.format(new Date(time));}
    private static String read(InputStream input,int limit) throws Exception {
        ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int count;
        while((count=input.read(buffer))!=-1){if(out.size()+count>limit)throw new IllegalStateException("Discovery response too large");out.write(buffer,0,count);}return out.toString("UTF-8");
    }

    public void close(){closed=true;HttpURLConnection active=connection;if(active!=null)active.disconnect();worker.shutdownNow();synchronized(lock){pending.clear();waiters=0;}}
    private static final class Candidate {final JSONObject media;final long score;Candidate(JSONObject media,long score){this.media=media;this.score=score;}}
    private static final class Match {final JSONObject item;final boolean direct;Match(JSONObject item,boolean direct){this.item=item;this.direct=direct;}}
    private static final class Cartoon {final JSONObject item;final double rating;Cartoon(JSONObject item,double rating){this.item=item;this.rating=rating;}}
}

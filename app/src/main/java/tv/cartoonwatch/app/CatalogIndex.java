package tv.cartoonwatch.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.database.sqlite.SQLiteStatement;
import android.util.JsonReader;
import java.io.InputStreamReader;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

public final class CatalogIndex extends SQLiteOpenHelper {
    private static final Pattern MARKS=Pattern.compile("\\p{M}+");
    private static final Pattern SPACES=Pattern.compile("[^\\p{L}\\p{N}]+");
    private final Context context;
    private boolean ready;
    private String version="", generatedAt="";

    public CatalogIndex(Context context) {
        super(context,"catalog.db",null,1);
        this.context=context.getApplicationContext();
        setWriteAheadLoggingEnabled(true);
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE titles(id INTEGER PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL UNIQUE,image TEXT NOT NULL,kind TEXT NOT NULL,category TEXT NOT NULL,search_key TEXT NOT NULL)");
        db.execSQL("CREATE INDEX title_order ON titles(search_key)");
        db.execSQL("CREATE TABLE categories(title_id INTEGER NOT NULL,category TEXT NOT NULL,PRIMARY KEY(title_id,category))");
        db.execSQL("CREATE INDEX category_titles ON categories(category,title_id)");
        db.execSQL("CREATE TABLE metadata(name TEXT PRIMARY KEY,value TEXT NOT NULL)");
    }

    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion) { }

    private static String key(String value) {
        return SPACES.matcher(MARKS.matcher(Normalizer.normalize(value,Normalizer.Form.NFKD)).replaceAll("").toLowerCase(Locale.US)).replaceAll(" ").trim();
    }

    private synchronized void prepare() throws Exception {
        if(ready) return;
        SQLiteDatabase db=getWritableDatabase();
        String stored="";
        try(Cursor cursor=db.rawQuery("SELECT value FROM metadata WHERE name='version'",null)) { if(cursor.moveToFirst()) stored=cursor.getString(0); }
        try(JsonReader reader=new JsonReader(new InputStreamReader(context.getAssets().open("catalog-index.json"),"UTF-8"))) {
            reader.beginObject();
            db.beginTransaction();
            try(SQLiteStatement insert=db.compileStatement("INSERT INTO titles(title,url,image,kind,category,search_key) VALUES(?,?,?,?,?,?)");SQLiteStatement categoryInsert=db.compileStatement("INSERT OR IGNORE INTO categories(title_id,category) VALUES(?,?)")) {
                boolean replace=false;
                while(reader.hasNext()) {
                    String name=reader.nextName();
                    if("version".equals(name)) {
                        version=reader.nextString();
                        replace=!version.equals(stored);
                        if(replace) { db.delete("categories",null,null);db.delete("titles",null,null); }
                    } else if("generatedAt".equals(name)) generatedAt=reader.nextString();
                    else if("items".equals(name) && replace) {
                        reader.beginArray();
                        while(reader.hasNext()) {
                            String title="",url="",image="",kind="series",category="";
                            List<String> categories=new ArrayList<>();
                            reader.beginObject();
                            while(reader.hasNext()) {
                                String field=reader.nextName();
                                switch(field) {
                                    case "title":title=reader.nextString();break;
                                    case "url":url=reader.nextString();break;
                                    case "image":image=reader.nextString();break;
                                    case "kind":kind=reader.nextString();break;
                                    case "category":category=reader.nextString();break;
                                    case "categories":reader.beginArray();while(reader.hasNext())categories.add(reader.nextString());reader.endArray();break;
                                    default:reader.skipValue();
                                }
                            }
                            reader.endObject();
                            insert.bindString(1,title);insert.bindString(2,url);insert.bindString(3,image);insert.bindString(4,kind);insert.bindString(5,category);insert.bindString(6,key(title));
                            long id=insert.executeInsert();
                            if(categories.isEmpty())categories.add(category);
                            for(String value:categories) { categoryInsert.bindLong(1,id);categoryInsert.bindString(2,value);categoryInsert.executeInsert(); }
                        }
                        reader.endArray();
                    } else reader.skipValue();
                }
                reader.endObject();
                ContentValues value=new ContentValues();value.put("name","version");value.put("value",version);db.insertWithOnConflict("metadata",null,value,SQLiteDatabase.CONFLICT_REPLACE);
                db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
        }
        ready=true;
    }

    public JSONObject query(String query,String category,String sort,int offset,int limit) throws Exception {
        prepare();
        offset=Math.max(0,offset);limit=Math.max(1,Math.min(120,limit));
        List<String> args=new ArrayList<>();
        String where="1=1";
        String normalized=key(query==null?"":query);
        if(!normalized.isEmpty()) { where+=" AND search_key LIKE ?";args.add("%"+normalized+"%"); }
        if(category!=null && !category.isEmpty() && !"all".equals(category)) { where+=" AND id IN (SELECT title_id FROM categories WHERE category=?)";args.add(category); }
        SQLiteDatabase db=getReadableDatabase();
        int total;
        try(Cursor cursor=db.rawQuery("SELECT COUNT(*) FROM titles WHERE "+where,args.toArray(new String[0]))) { cursor.moveToFirst();total=cursor.getInt(0); }
        String order="za".equals(sort)?"search_key DESC,id":"source".equals(sort)?"id":"search_key,id";
        List<String> pageArgs=new ArrayList<>(args);pageArgs.add(String.valueOf(limit));pageArgs.add(String.valueOf(offset));
        JSONArray items=new JSONArray();
        try(Cursor cursor=db.rawQuery("SELECT title,url,image,kind,category FROM titles WHERE "+where+" ORDER BY "+order+" LIMIT ? OFFSET ?",pageArgs.toArray(new String[0]))) {
            while(cursor.moveToNext()) items.put(new JSONObject().put("title",cursor.getString(0)).put("url",cursor.getString(1)).put("image",cursor.getString(2)).put("kind",cursor.getString(3)).put("category",cursor.getString(4)).put("provider","wcostream"));
        }
        return new JSONObject().put("items",items).put("total",total).put("offset",offset).put("limit",limit).put("hasMore",offset+items.length()<total).put("indexed",true).put("version",version).put("generatedAt",generatedAt).put("provider","wcostream").put("categories",new JSONArray().put("Dubbed anime").put("Cartoons").put("Subbed anime").put("Movies").put("OVA"));
    }
}

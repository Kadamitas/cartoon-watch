import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
import tv.cartoonwatch.app.CatalogRepository;
import tv.cartoonwatch.app.PlaybackResolver;

public final class MetadataServer {
    public static void main(String[] args) throws Exception {
        CatalogRepository catalog=new CatalogRepository();
        PlaybackResolver resolver=new PlaybackResolver(catalog);
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.setExecutor(new ThreadPoolExecutor(3,3,30,TimeUnit.SECONDS,new ArrayBlockingQueue<Runnable>(12)));
        server.createContext("/request",exchange -> {
            JSONObject result;
            try {
                java.io.ByteArrayOutputStream body=new java.io.ByteArrayOutputStream();
                byte[] bytes=new byte[8192];int count;
                while((count=exchange.getRequestBody().read(bytes))!=-1){body.write(bytes,0,count);if(body.size()>7000000)throw new IllegalArgumentException("Request too large");}
                JSONObject request=new JSONObject(new String(body.toByteArray(),StandardCharsets.UTF_8));
                JSONObject data=request.getJSONObject("payload");
                String action=request.getString("action"), provider=data.optString("provider","wcostream");
                switch(action) {
                    case "details":result=catalog.details(provider,data.getString("url"));break;
                    case "search":result=catalog.search(provider,data.optString("query"));break;
                    case "resolve":result=resolver.resolve(data.getJSONObject("episode"),provider);if(result==null)result=new JSONObject().put("missing",true);break;
                    case "parse":result=catalog.parseLoadedPage(data.getString("action"),provider,data.getString("url"),data.getString("html"),data.optString("query"));break;
                    default:throw new IllegalArgumentException("Unsupported request");
                }
            } catch(Exception error){result=new JSONObject().put("error",error.getMessage()==null?"Metadata unavailable":error.getMessage());}
            byte[] response=result.toString().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type","application/json; charset=utf-8");
            exchange.sendResponseHeaders(200,response.length);exchange.getResponseBody().write(response);exchange.close();
        });
        server.start();System.out.println("METADATA_PORT="+server.getAddress().getPort());System.out.flush();
    }
}

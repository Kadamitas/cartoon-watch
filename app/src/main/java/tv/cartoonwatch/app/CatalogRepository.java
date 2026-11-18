package tv.cartoonwatch.app;

import org.json.JSONArray;
import org.json.JSONObject;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

public class CatalogRepository {
    public static final String USER_AGENT = "Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
    private static final int MAX_DOCUMENT_BYTES = 6 * 1024 * 1024;
    private static final long CACHE_MILLIS = 5 * 60 * 1000L;
    private final Map<String, CacheEntry> cache = new HashMap<>();

    public JSONObject home(String provider) throws Exception {
        String root = root(provider);
        String cacheKey = provider + ":home";
        JSONObject cached = cached(cacheKey);
        if (cached != null) return cached;
        Document doc = fetch(provider, "hdtoday".equals(provider) ? root + "home/" : root, null);
        JSONObject result = parseHome(provider, doc);
        putCache(cacheKey, result);
        return result;
    }

    private JSONObject parseHome(String provider, Document doc) throws Exception {
        JSONObject result = new JSONObject();
        JSONArray sections = new JSONArray();
        JSONArray items;
        if ("kissanime".equals(provider)) {
            items = kissItems(doc, provider, 120);
            JSONArray recent = kissItems(doc.select(".scrollable .items, .scrollable").first(), provider, 40);
            if (recent.length() > 0) sections.put(section("Recently updated", recent));
            if (items.length() > 0) sections.put(section("Discover anime", items));
        } else if ("aniwave".equals(provider)) {
            items = aniItems(doc, 120);
            if (items.length() > 0) sections.put(section("Discover anime", items));
        } else if ("hdtoday".equals(provider)) {
            items = hdtItems(doc, 160);
            JSONArray series = new JSONArray(), movies = new JSONArray();
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                if ("movie".equals(item.optString("kind"))) movies.put(item); else series.put(item);
            }
            if (series.length() > 0) sections.put(section("TV shows", series));
            if (movies.length() > 0) sections.put(section("Movies", movies));
        } else {
            items = wcoItems(doc, provider, 120);
            JSONArray recent = wcoItems(doc.select(".recent-release-main, .sidebar_body, .recent-release").first(), provider, 40);
            if (recent.length() > 0) sections.put(section("Latest episodes", recent));
            JSONArray series = new JSONArray();
            for (Element anchor : doc.select("a[href*=/anime/]")) {
                addUnique(series, itemFromAnchor(anchor, provider), 48);
            }
            if (series.length() > 0) sections.put(section("Explore series", series));
        }
        result.put("provider", provider).put("items", items).put("sections", sections);
        checkCatalog(doc, result, items.length());
        return result;
    }

    public JSONObject search(String provider, String query) throws Exception {
        root(provider);
        query = query == null ? "" : query.trim();
        if (query.length() == 0) return home(provider);
        if (query.length() > 120) query = query.substring(0, 120);
        String encoded = URLEncoder.encode(query, "UTF-8");
        String url = root(provider) + ("kissanime".equals(provider) ? "Search/Anime" : "aniwave".equals(provider) ? "filter?keyword=" + encoded : "hdtoday".equals(provider) ? "search?keyword=" + encoded : "search");
        String body = "kissanime".equals(provider) ? "keyword=" + encoded : "catara=" + encoded + "&konuara=series";
        if ("aniwave".equals(provider) || "hdtoday".equals(provider)) body = null;
        Document doc = fetch(provider, url, body);
        return parseSearch(provider, query, doc);
    }

    private JSONObject parseSearch(String provider, String query, Document doc) throws Exception {
        JSONArray items = "hdtoday".equals(provider) ? hdtItems(doc, 160) : "aniwave".equals(provider) ? aniItems(doc, 160) : "kissanime".equals(provider) ? kissItems(searchScope(doc, provider), provider, 160)
                : wcoItems(searchScope(doc, provider), provider, 160);
        JSONObject result = new JSONObject().put("provider", provider).put("query", query).put("items", items);
        checkCatalog(doc, result, items.length());
        return result;
    }

    public JSONObject details(String provider, String url) throws Exception {
        validateUrl(provider, url);
        String cacheKey = provider + ":" + url;
        JSONObject cached = cached(cacheKey);
        if (cached != null) return cached;
        Document doc = fetch(provider, url, null);
        JSONObject result = parseDetails(provider, url, doc);
        putCache(cacheKey, result);
        return result;
    }

    private JSONObject parseDetails(String provider, String url, Document doc) throws Exception {
        if ("aniwave".equals(provider)) return parseAniDetails(url, doc);
        if ("hdtoday".equals(provider)) return parseHdtDetails(url, doc);
        JSONObject result = new JSONObject().put("provider", provider).put("url", canonicalSourceUrl(doc.location()));
        String title;
        String image;
        String description;
        JSONArray genres = new JSONArray();
        JSONArray episodes = new JSONArray();
        if ("kissanime".equals(provider)) {
            title = text(doc.select("#leftside a.bigChar, #leftside .bigChar, a.bigChar").first());
            image = imageUrl(doc.select("img[src*=/img/480/], img[src*=/uploads/], img[src*=/img/]").first());
            description = meta(doc, "name", "description");
            Element content = doc.select("#leftside .barContent").first();
            if (content != null) {
                boolean summary = false;
                for (Element p : content.select("p")) {
                    if (p.text().startsWith("Summary:")) {
                        String own = p.text().replaceFirst("^Summary:\\s*", "");
                        if (own.length() > 30) { description = own; break; }
                        summary = true;
                    } else if (summary && p.text().length() > 40) { description = p.text(); break; }
                }
            }
            for (Element genre : doc.select("#leftside a[href*=/Genre/]")) addString(genres, genre.text());
            for (Element a : doc.select(".episodeList a[href*=/Anime/], table.listing a[href*=/Anime/]")) {
                if (!isKissEpisode(a.absUrl("href"))) continue;
                addEpisode(episodes, provider, a, a.text(), "");
            }
        } else {
            title = meta(doc, "property", "og:title");
            if (title.length() == 0) title = text(doc.select(".vsbaslik .film-name, .video-title .film-name").first());
            if (title.length() == 0) title = text(doc.select(".video-title h1, .vsbaslik").first());
            if (title.length() == 0) title = doc.title().replaceFirst("(?i)\\s*(?:\\|| - Watch).*$", "").trim();
            image = imageUrl(doc.select("#sidebar_cat img, .katcont img[src*=catimg], img[src*=catimg]").first());
            if (image.length() == 0) image = resolve(doc.location(), meta(doc, "property", "og:image"));
            description = text(doc.select("#sidebar_cat p, .iltext p, .iltext").first());
            if (description.length() == 0) description = meta(doc, "name", "description");
            for (Element genre : doc.select("#sidebar_cat a[href*=search-by-genre], #cat-genre a[href*=search-by-genre]")) addString(genres, genre.text());
            Elements links = doc.select("#episodeList a.dark-episode-item, .cat-eps a, #catlist-listview a");
            if (links.isEmpty()) links = doc.select(".episode-list a, .episodes a, .catlist a");
            for (Element a : links) {
                String label = a.children().isEmpty() ? a.text() : a.child(0).text();
                addEpisode(episodes, provider, a, label, a.attr("data-season"));
            }
        }
        if (title.length() == 0) title = doc.title().replaceFirst("(?i)\\s*(?:\\|| - Watch| - KissAnime).*$", "").trim();
        boolean episodePage = "kissanime".equals(provider) ? isKissEpisode(url) : !new URI(url).getPath().startsWith("/anime/");
        if (episodes.length() == 0 && episodePage) episodes.put(new JSONObject().put("title", title).put("url", canonicalSourceUrl(url)));
        result.put("title", title).put("image", image).put("description", description)
                .put("genres", genres).put("episodes", episodes).put("kind", episodePage ? "episode" : "series");
        if (episodes.length() == 0) result.put("notice", "This page did not expose an episode list. Open the source page to use its own controls.");
        return result;
    }

    private JSONArray aniItems(Document doc, int limit) throws Exception {
        LinkedHashMap<String, JSONObject> unique = new LinkedHashMap<>();
        for (Element card : doc.select(".ani.items .item, #list-items .item")) {
            Element anchor = card.select("a.name[href*=/watch/], .title a[href*=/watch/]").first();
            if (anchor == null) anchor = card.select("a[href*=/watch/]:has(img)").first();
            JSONObject item = itemFromAnchor(anchor, "aniwave");
            if (item == null) continue;
            item.put("url", aniSeriesUrl(item.optString("url"))).put("kind", "series");
            String poster = imageUrl(card.select("img").first());
            if (!poster.isEmpty()) item.put("image", poster);
            String description = text(card.select(".synopsis, .description").first());
            if (!description.isEmpty()) item.put("description", description);
            merge(unique, item);
            if (unique.size() >= limit) break;
        }
        return array(unique);
    }

    private JSONObject parseAniDetails(String url, Document doc) throws Exception {
        String title = text(doc.select("#w-info h1, h1.title").first());
        if (title.isEmpty()) title = meta(doc, "property", "og:title").replaceFirst("(?i)\\s+Episode\\s+.*$", "").replaceFirst("(?i)\\s*-\\s*Aniwave.*$", "").trim();
        String image = imageUrl(doc.select("#w-info .poster img, img[itemprop=image]").first());
        if (image.isEmpty()) image = meta(doc, "property", "og:image");
        String description = text(doc.select("#w-info .synopsis .content, #w-info .synopsis").first());
        JSONArray genres = new JSONArray(), episodes = new JSONArray();
        for (Element genre : doc.select("#w-info a[href*=/genre/]")) addString(genres, genre.text());
        String seriesUrl = aniSeriesUrl(url);
        Element watch = doc.select("#watch-main[data-url]").first();
        if (watch != null && allowed("aniwave", watch.absUrl("data-url"))) seriesUrl = aniSeriesUrl(watch.absUrl("data-url"));
        appendAniEpisodes(episodes, doc, seriesUrl);
        if (episodes.length() == 0 && watch != null && watch.attr("data-id").matches("\\d{1,10}")) {
            try {
                FetchedPage response = fetchPage("aniwave", root("aniwave") + "ajax/episode/list/" + watch.attr("data-id") + "?vrf=", null);
                JSONObject data = new JSONObject(response.html);
                if (data.optInt("status") == 200) appendAniEpisodes(episodes, Jsoup.parseBodyFragment(data.optString("result"), seriesUrl), seriesUrl);
            } catch (Exception ignored) {  }
        }
        boolean episodePage = new URI(url).getPath().matches(".*/ep-[^/]+/?$");
        if (episodes.length() == 0 && episodePage) {
            String ep = new URI(url).getPath().replaceFirst("^.*/ep-", "");
            episodes.put(new JSONObject().put("title", "Episode " + ep).put("url", url));
        }
        JSONObject result = new JSONObject().put("provider", "aniwave").put("url", seriesUrl).put("title", title)
                .put("image", image).put("description", description).put("genres", genres).put("episodes", episodes).put("kind", "series");
        if (episodes.length() == 0) result.put("notice", "Open the source page if this catalog cannot load its episode list.");
        return result;
    }

    private void appendAniEpisodes(JSONArray episodes, Document doc, String seriesUrl) throws Exception {
        for (Element anchor : doc.select("#w-episodes a[data-slug], .episodes a[data-slug]")) {
            String slug = anchor.attr("data-slug");
            if (!slug.matches("[a-zA-Z0-9._-]{1,40}")) continue;
            String number = anchor.attr("data-num");
            String name = anchor.parent() == null ? "" : anchor.parent().attr("title");
            String label = "Episode " + (number.isEmpty() ? slug : number) + (name.isEmpty() ? "" : " · " + name);
            Element link = new Element("a").attr("href", seriesUrl + "/ep-" + slug);
            addEpisode(episodes, "aniwave", link, label, "");
        }
    }

    private static String aniSeriesUrl(String url) { return url.replaceFirst("/ep-[^/?#]+(?:[?#].*)?$", "").replaceFirst("/$", ""); }

    private JSONArray hdtItems(Document doc, int limit) throws Exception {
        LinkedHashMap<String, JSONObject> unique = new LinkedHashMap<>();
        for (Element card : doc.select(".flw-item")) {
            Element anchor = card.select(".film-name a[href], a.film-poster-ahref[href]").first();
            if (anchor == null) continue;
            String url = anchor.absUrl("href");
            if (!allowed("hdtoday", url)) continue;
            String path = new URI(url).getPath();
            if (path == null || !path.matches("/(?:series|movie)/[^/]+/?")) continue;
            String title = text(anchor);
            if (title.isEmpty()) title = anchor.attr("title").trim();
            if (title.isEmpty()) continue;
            JSONObject item = new JSONObject().put("provider", "hdtoday").put("title", title).put("url", url)
                    .put("image", imageUrl(card.select("img").first())).put("kind", path.startsWith("/movie/") ? "movie" : "series").put("description", "");
            merge(unique, item);
            if (unique.size() >= limit) break;
        }
        return array(unique);
    }

    private JSONObject parseHdtDetails(String url, Document doc) throws Exception {
        String path = new URI(url).getPath();
        boolean movie = path != null && path.startsWith("/movie/");
        String title = text(doc.select(".detail_page-infor .heading-name, .heading-name").first());
        if (title.isEmpty()) title = meta(doc, "property", "og:title").replaceFirst("(?i)^Watch\\s+", "").replaceFirst("(?i)\\s+Online.*$", "");
        String image = imageUrl(doc.select(".dp-i-c-poster img, .detail_page-infor .film-poster img").first());
        if (image.isEmpty()) image = meta(doc, "property", "og:image");
        String description = text(doc.select(".detail_page-infor .description, .description").first());
        if (description.isEmpty()) description = meta(doc, "name", "description");
        JSONArray genres = new JSONArray(), episodes = new JSONArray();
        for (Element genre : doc.select(".detail_page-infor a[href*=/genre/]")) addString(genres, genre.text());
        String seriesUrl = url;
        Element canonical = doc.select("link[rel=canonical]").first();
        if (canonical != null && allowed("hdtoday", canonical.absUrl("href"))) seriesUrl = canonical.absUrl("href");
        if (!movie) {
            appendHdtEpisodes(episodes, doc, "");
            if (episodes.length() == 0) {
                List<Callable<Document>> requests = new ArrayList<>();
                List<String> seasonNumbers = new ArrayList<>();
                for (Element season : doc.select("a.ss-item[data-id][data-ss]")) {
                    final String token = season.attr("data-id");
                    String seasonNumber = season.attr("data-ss");
                    if (!seasonNumber.matches("\\d{1,4}") || token.isEmpty() || token.length() > 4096 || requests.size() >= 40) continue;
                    final String address = root("hdtoday") + "ajax/ajax.php?episode=" + token;
                    seasonNumbers.add(seasonNumber);
                    requests.add(() -> fetch("hdtoday", address, null));
                }
                ExecutorService workers = Executors.newFixedThreadPool(Math.max(1, Math.min(4, requests.size())));
                try {
                    List<Future<Document>> pages = workers.invokeAll(requests, 20, TimeUnit.SECONDS);
                    for (int i = 0; i < pages.size(); i++) {
                        if (!pages.get(i).isCancelled()) {
                            try { appendHdtEpisodes(episodes, pages.get(i).get(), seasonNumbers.get(i)); }
                            catch (Exception ignored) {  }
                        }
                    }
                } finally { workers.shutdownNow(); }
            }
            if (episodes.length() == 0 && path != null && path.matches("/series/[^/]+/\\d+-\\d+/?")) {
                String numbers = path.replaceFirst("^/series/[^/]+/", "").replace("/", "");
                episodes.put(new JSONObject().put("title", "Season " + numbers.split("-")[0] + " · Episode " + numbers.split("-")[1]).put("url", url));
            }
        }
        JSONObject result = new JSONObject().put("provider", "hdtoday").put("url", seriesUrl).put("title", title)
                .put("image", image).put("description", description).put("genres", genres).put("episodes", episodes).put("kind", movie ? "movie" : "series");
        if (!movie && episodes.length() == 0) result.put("notice", "This show did not expose its episode list. Open the source page to select a season.");
        return result;
    }

    private void appendHdtEpisodes(JSONArray episodes, Document doc, String seasonNumber) throws Exception {
        for (Element anchor : doc.select("a.eps-item[href], #episodes a[href*=/series/]")) {
            String address = anchor.absUrl("href");
            if (!allowed("hdtoday", address)) continue;
            Matcher numbers = Pattern.compile("/series/[^/]+/(\\d+)-(\\d+)/?$").matcher(new URI(address).getPath());
            if (!numbers.find()) continue;
            String season = numbers.group(1), number = numbers.group(2);
            String label = anchor.attr("title").trim();
            if (label.isEmpty()) label = "Episode " + number;
            addEpisode(episodes, "hdtoday", anchor, "Season " + season + " · " + label, season);
        }
    }

    public JSONObject parseLoadedPage(String action, String provider, String url, String html, String query) throws Exception {
        validateUrl(provider, url);
        if (html == null || html.length() > MAX_DOCUMENT_BYTES) throw new IOException("Source page is too large to load on TV.");
        Document doc = Jsoup.parse(html, url);
        String title = doc.title().toLowerCase(Locale.US);
        if (title.contains("just a moment") || title.contains("access denied") || title.contains("attention required")
                || doc.select("#challenge-running, #challenge-stage, form#challenge-form").size() > 0) {
            throw new IOException("Source verification is still required. Complete the check in the source browser, then retry.");
        }
        if ("home".equals(action)) {
            JSONObject result = parseHome(provider, doc);
            putCache(provider + ":home", result);
            return result;
        }
        if ("search".equals(action)) return parseSearch(provider, query == null ? "" : query, doc);
        if ("details".equals(action)) {
            JSONObject result = parseDetails(provider, url, doc);
            putCache(provider + ":" + url, result);
            return result;
        }
        throw new IllegalArgumentException("Unknown catalog action.");
    }

    private Element searchScope(Document doc, String provider) {
        if ("kissanime".equals(provider)) {
            Element table = doc.select("#leftside table.listing, table.listing").first();
            return table == null ? new Element("div") : table;
        }
        Element scope = doc.select(".recent-release-main .items, .recent-release .items, .items").first();
        if (scope != null) return scope;
        Elements cards = doc.select(".cerceve .iccerceve");
        if (!cards.isEmpty()) {
            Element holder = new Element("div");
            holder.setBaseUri(doc.location());
            for (Element card : cards) holder.appendChild(card.clone());
            return holder;
        }
        return new Element("div");
    }

    private JSONArray kissItems(Element scope, String provider, int limit) throws Exception {
        LinkedHashMap<String, JSONObject> unique = new LinkedHashMap<>();
        if (scope == null) return new JSONArray();
        Map<String, String> posters = new HashMap<>();
        for (Element a : scope.select("a[href*=/Anime/]:has(img)")) {
            String poster = imageUrl(a.select("img").first());
            if (poster.length() > 0) posters.put(a.absUrl("href"), poster);
        }
        for (Element a : scope.select("a[href*=/Anime/]")) {
            JSONObject item = itemFromAnchor(a, provider);
            if (item == null) continue;
            String url = item.optString("url");
            if (isKissEpisode(url)) continue;
            if (item.optString("image").length() == 0 && posters.containsKey(url)) item.put("image", posters.get(url));
            Element container = closest(a, "td, .item, .list-item, .details");
            if (container != null) {
                Element tooltip = container.hasAttr("title") ? container : container.select("[title*=&lt;img], td[title]").first();
                if (tooltip != null && tooltip.attr("title").contains("<")) {
                    Document fragment = Jsoup.parseBodyFragment(tooltip.attr("title"), a.baseUri());
                    String tooltipImage = imageUrl(fragment.select("img").first());
                    if (tooltipImage.length() > 0) item.put("image", tooltipImage);
                    String desc = text(fragment.select("p").first());
                    if (desc.length() > 0) item.put("description", desc);
                }
                if (container.hasClass("details") && item.optString("description").length() == 0) {
                    Element paragraph = container.select("p").last();
                    if (paragraph != null && paragraph.text().length() > 40) item.put("description", paragraph.text());
                }
            }
            merge(unique, item);
            if (unique.size() >= limit) break;
        }
        return array(unique);
    }

    private JSONArray wcoItems(Element scope, String provider, int limit) throws Exception {
        LinkedHashMap<String, JSONObject> unique = new LinkedHashMap<>();
        if (scope == null) return new JSONArray();
        Elements cards = scope.select(".items > li, .cerceve, .iccerceve, .pe-episode-card, .mansetlisteleme li");
        if ("ul".equals(scope.tagName()) && scope.hasClass("items")) cards = scope.select("li");
        for (Element card : cards) {
            Element a = card.select(".recent-release-episodes a, .aramadabaslik a, .pe-title a, a[href]").first();
            JSONObject item = itemFromAnchor(a, provider);
            if (item == null) continue;
            String image = imageUrl(card.select("img").first());
            if (image.length() > 0) item.put("image", image);
            merge(unique, item);
            if (unique.size() >= limit) break;
        }
        if (unique.isEmpty()) {
            for (Element a : scope.select("a[href*=/anime/]")) {
                merge(unique, itemFromAnchor(a, provider));
                if (unique.size() >= limit) break;
            }
        }
        return array(unique);
    }

    private JSONObject itemFromAnchor(Element a, String provider) throws Exception {
        if (a == null) return null;
        String url = a.absUrl("href");
        if (!allowed(provider, url)) return null;
        url = canonicalSourceUrl(url);
        String path = new URI(url).getPath();
        if (path == null || path.length() < 3) return null;
        if ("kissanime".equals(provider) && !path.startsWith("/Anime/")) return null;
        if ("aniwave".equals(provider) && !path.startsWith("/watch/")) return null;
        if (!"kissanime".equals(provider) && (path.contains("search") || path.contains("-list") || path.contains("contact") || path.contains("legal") || path.contains("important-regarding"))) return null;
        String title = a.text().trim();
        if (title.length() == 0) {
            Element image = a.select("img").first();
            if (image != null) title = image.attr("alt").trim();
        }
        if (title.length() == 0) title = a.attr("title").trim();
        if (title.length() == 0) return null;
        boolean series = "aniwave".equals(provider) ? !path.matches(".*/ep-[^/]+/?$") : "kissanime".equals(provider) ? !isKissEpisode(url) : path.startsWith("/anime/");
        if (series && "kissanime".equals(provider)) title = title.replaceFirst("(?i)\\s*Episode\\s*\\d+.*$", "").trim();
        if (title.length() < 2) return null;
        return new JSONObject().put("title", title).put("url", url).put("image", imageUrl(a.select("img").first()))
                .put("provider", provider).put("kind", series ? "series" : "episode").put("description", "");
    }

    private void addEpisode(JSONArray episodes, String provider, Element a, String title, String season) throws Exception {
        if (episodes.length() >= 3000) return;
        String url = a.absUrl("href");
        if (!allowed(provider, url) || title.trim().length() == 0) return;
        url = canonicalSourceUrl(url);
        JSONObject episode = new JSONObject().put("title", title.trim()).put("url", url);
        if (season.length() > 0) episode.put("season", season);
        if (a.hasAttr("data-lang")) episode.put("language", a.attr("data-lang"));
        Matcher number = Pattern.compile("(?i)episode[\\s-]*(\\d+(?:\\.\\d+)?)").matcher(title);
        if (number.find()) episode.put("number", number.group(1));
        episodes.put(episode);
    }

    private Document fetch(String provider, String address, String form) throws Exception {
        FetchedPage page = fetchPage(provider, address, form);
        return Jsoup.parse(page.html, page.url);
    }

    private static final class FetchedPage {
        final String html, url;
        FetchedPage(String html, String url) { this.html = html; this.url = url; }
    }

    private FetchedPage fetchPage(String provider, String address, String form) throws Exception {
        validateUrl(provider, address);
        String current = address;
        for (int redirects = 0; redirects < 5; redirects++) {
            validateUrl(provider, current);
            HttpURLConnection connection = (HttpURLConnection) new URL(current).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(20000);
            connection.setRequestProperty("User-Agent", USER_AGENT);
            connection.setRequestProperty("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5");
            connection.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
            connection.setRequestProperty("Accept-Encoding", "gzip");
            if (("aniwave".equals(provider) || "hdtoday".equals(provider)) && new URI(current).getPath().startsWith("/ajax/")) {
                connection.setRequestProperty("X-Requested-With", "XMLHttpRequest");
                connection.setRequestProperty("Referer", root(provider));
            }
            try {
                if (form != null) {
                    byte[] bytes = form.getBytes("UTF-8");
                    connection.setRequestMethod("POST");
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
                    connection.setRequestProperty("Origin", root(provider).replaceFirst("/$", ""));
                    connection.setRequestProperty("Referer", root(provider));
                    connection.setFixedLengthStreamingMode(bytes.length);
                    try (java.io.OutputStream stream = connection.getOutputStream()) { stream.write(bytes); }
                }
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) {
                    String target = connection.getHeaderField("Location");
                    if (target == null) throw new IOException("Source returned an incomplete redirect.");
                    current = resolve(current, target);
                    if (status == 303 || status == 301 || status == 302) form = null;
                    continue;
                }
                if (status == 403 || status == 429 || status == 503) throw new IOException("Source requires a browser check or is temporarily unavailable (HTTP " + status + "). Try Open source or another provider.");
                if (status < 200 || status >= 300) throw new IOException("Source returned HTTP " + status + ". Try another provider.");
                InputStream raw = connection.getInputStream();
                InputStream decoded = "gzip".equalsIgnoreCase(connection.getContentEncoding()) ? new GZIPInputStream(raw) : raw;
                try (InputStream stream = decoded; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = stream.read(buffer)) != -1) {
                        if (output.size() + count > MAX_DOCUMENT_BYTES) throw new IOException("Source page is too large to load on TV.");
                        output.write(buffer, 0, count);
                    }
                    return new FetchedPage(output.toString("UTF-8"), current);
                }
            } finally { connection.disconnect(); }
        }
        throw new IOException("Source redirected too many times.");
    }

    public static String root(String provider) {
        if ("kissanime".equals(provider)) return "https://kissanime.tv.in/";
        if ("wco".equals(provider)) return "https://www.wco.tv/";
        if ("wcostream".equals(provider)) return "https://www.wcostream.tv/";
        if ("aniwave".equals(provider)) return "https://aniwave.gr/";
        if ("hdtoday".equals(provider)) return "https://hdtoday.one/";
        throw new IllegalArgumentException("Unknown provider.");
    }

    private static void validateUrl(String provider, String url) throws IOException {
        root(provider);
        if (!allowed(provider, url)) throw new IOException("That address is outside the selected source.");
    }

    private static boolean allowed(String provider, String address) {
        try {
            URI uri = new URI(address);
            if (!"https".equalsIgnoreCase(uri.getScheme()) && !"http".equalsIgnoreCase(uri.getScheme())) return false;
            if (uri.getRawUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443 && uri.getPort() != 80)) return false;
            String host = uri.getHost();
            if (host == null) return false;
            host = host.toLowerCase(Locale.US);
            if ("kissanime".equals(provider)) return host.equals("kissanime.tv.in") || host.equals("www.kissanime.tv.in");
            if ("wco".equals(provider)) return host.equals("wco.tv") || host.equals("www.wco.tv") || host.equals("m.wco.tv");
            if ("wcostream".equals(provider)) return host.equals("wcostream.tv") || host.equals("www.wcostream.tv") || host.equals("m.wcostream.tv");
            if ("aniwave".equals(provider)) return host.equals("aniwave.gr") || host.equals("www.aniwave.gr");
            if ("hdtoday".equals(provider)) return host.equals("hdtoday.one") || host.equals("www.hdtoday.one");
            return false;
        } catch (Exception e) { return false; }
    }

    private static boolean isKissEpisode(String address) {
        try {
            String path = new URI(address).getPath();
            return path != null && path.startsWith("/Anime/") && path.substring(7).contains("/");
        } catch (Exception e) { return false; }
    }

    private static String canonicalSourceUrl(String address) {
        try {
            URI uri = new URI(address);
            String host = uri.getHost();
            if (!"m.wco.tv".equalsIgnoreCase(host) && !"m.wcostream.tv".equalsIgnoreCase(host)) return address;
            String path = uri.getRawPath() == null ? "/" : uri.getRawPath();
            String query = uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery();
            String fragment = uri.getRawFragment() == null ? "" : "#" + uri.getRawFragment();
            return "https://www." + host.substring(2).toLowerCase(Locale.US) + path + query + fragment;
        } catch (Exception e) { return address; }
    }

    private static String imageUrl(Element image) {
        if (image == null) return "";
        for (String attr : new String[]{"src", "data-src", "srcTemp", "data-original"}) {
            String value = image.attr(attr);
            if (value.length() > 0 && !value.startsWith("data:") && !value.contains("blank.gif")) return resolve(image.baseUri(), value);
        }
        return "";
    }

    private static String resolve(String base, String value) {
        if (value == null || value.trim().length() == 0) return "";
        try {
            String resolved = new URI(base).resolve(value.trim()).toString();
            String scheme = new URI(resolved).getScheme();
            return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme) ? resolved : "";
        } catch (Exception e) { return ""; }
    }

    private static Element closest(Element element, String selector) {
        Element current = element;
        for (int depth = 0; current != null && depth < 5; depth++, current = current.parent()) if (current.is(selector)) return current;
        return null;
    }

    private static String text(Element element) { return element == null ? "" : element.text().trim(); }
    private static String meta(Document doc, String attribute, String value) {
        Element meta = doc.select("meta[" + attribute + "=" + value + "]").first();
        return meta == null ? "" : meta.attr("content").trim();
    }
    private static JSONObject section(String title, JSONArray items) throws Exception { return new JSONObject().put("title", title).put("items", items); }
    private static void addString(JSONArray array, String value) {
        if (value.trim().length() == 0) return;
        for (int i = 0; i < array.length(); i++) if (value.equals(array.optString(i))) return;
        array.put(value);
    }
    private static void merge(LinkedHashMap<String, JSONObject> map, JSONObject item) throws Exception {
        if (item == null) return;
        String key = item.optString("url").replaceFirst("/$", "");
        JSONObject old = map.get(key);
        if (old == null) { map.put(key, item); return; }
        for (String field : new String[]{"image", "description"}) if (old.optString(field).length() == 0 && item.optString(field).length() > 0) old.put(field, item.optString(field));
    }
    private static JSONArray array(LinkedHashMap<String, JSONObject> map) {
        JSONArray result = new JSONArray();
        for (JSONObject value : map.values()) result.put(value);
        return result;
    }
    private static void addUnique(JSONArray array, JSONObject value, int limit) {
        if (value == null || array.length() >= limit) return;
        for (int i = 0; i < array.length(); i++) if (array.optJSONObject(i).optString("url").equals(value.optString("url"))) return;
        array.put(value);
    }
    private static void checkCatalog(Document doc, JSONObject result, int count) throws Exception {
        if (count > 0) return;
        String title = doc.title().toLowerCase(Locale.US);
        if (title.contains("just a moment") || title.contains("access denied") || title.contains("attention required")) result.put("error", "This source needs a browser verification. Use Open source, then retry or select another provider.");
    }
    private synchronized JSONObject cached(String key) throws Exception {
        CacheEntry entry = cache.get(key);
        return entry != null && System.currentTimeMillis() - entry.time < CACHE_MILLIS ? new JSONObject(entry.json) : null;
    }
    private synchronized void putCache(String key, JSONObject value) {
        if (cache.size() > 30) cache.clear();
        cache.put(key, new CacheEntry(value.toString()));
    }
    private static class CacheEntry {
        final long time = System.currentTimeMillis();
        final String json;
        CacheEntry(String json) { this.json = json; }
    }
}

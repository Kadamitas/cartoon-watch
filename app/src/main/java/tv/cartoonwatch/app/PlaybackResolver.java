package tv.cartoonwatch.app;

import org.json.JSONArray;
import org.json.JSONObject;
import java.math.BigDecimal;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class PlaybackResolver {
    private final CatalogRepository catalog;
    private final LinkedHashMap<String, JSONObject> cache = new LinkedHashMap<>();
    private static final Pattern NUMBER = Pattern.compile("(?i)(?:episode|\\bep\\.?|\\be)[\\s._-]*(\\d+(?:\\.\\d+)?)");
    private static final Pattern SEASON = Pattern.compile("(?i)(?:season|\\bs)[\\s._-]*(\\d{1,3})");
    private static final Pattern SEASON_SUFFIX = Pattern.compile("(?i)\\s+(?:(\\d+)(?:st|nd|rd|th)\\s+season|season\\s*(\\d+)|s(\\d+))\\s*$");
    private static final Pattern EPISODE_PATH = Pattern.compile("/(\\d+)-(\\d+)(?:/|$|[?#])");
    private static final Pattern YEAR = Pattern.compile("\\(((?:19|20)\\d{2})\\)");

    public PlaybackResolver(CatalogRepository catalog) { this.catalog = catalog; }

    public JSONObject resolve(JSONObject episode, String provider) throws Exception {
        interrupted();
        CatalogRepository.root(provider);
        String title = episode.optString("seriesTitle", episode.optString("title"));
        boolean movie = "movie".equals(episode.optString("kind")) || episode.optString("url").contains("/movie/");
        String number = episodeNumber(episode);
        if (!movie && number.isEmpty()) return null;
        if (movie) title = episode.optString("title", title);
        int releaseYear = releaseYear(episode, title);
        title = clean(title);
        if (title.isEmpty()) return null;
        int season = seasonNumber(episode);
        String key = provider + "|" + normalized(title) + "|" + releaseYear + "|" + season + "|" + number + "|" + movie;
        synchronized (cache) {
            JSONObject found = cache.get(key);
            if (found != null && System.currentTimeMillis() - found.optLong("_cachedAt") < 600000) return combine(episode, found);
        }
        JSONObject results = catalog.search(provider, title);
        interrupted();
        JSONArray items = results.optJSONArray("items");
        if (items == null) return null;
        LinkedHashMap<String, JSONObject> unique = new LinkedHashMap<>();
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null || item.optString("url").isEmpty()) continue;
            if (!movie && "movie".equals(item.optString("kind"))) continue;
            int score = score(title, season, releaseYear, item.optString("title"), releaseYear(item, item.optString("title")));
            if (score > 0) {
                String address = item.optString("url").replaceFirst("/$", "");
                JSONObject prior = unique.get(address);
                if (prior == null || score > prior.optInt("_matchScore")) unique.put(address, new JSONObject(item.toString()).put("_matchScore", score));
            }
        }
        List<JSONObject> candidates = new ArrayList<>(unique.values());
        Collections.sort(candidates,(a,b)->Integer.compare(b.optInt("_matchScore"),a.optInt("_matchScore")));
        for (int i = 0; i < Math.min(3, candidates.size()); i++) {
            interrupted();
            if (i + 1 < candidates.size() && candidates.get(i).optInt("_matchScore") == candidates.get(i + 1).optInt("_matchScore")) return null;
            JSONObject item = candidates.get(i), details;
            try { details = catalog.details(provider, item.optString("url")); }
            catch (Exception ignored) { interrupted();continue; }
            interrupted();
            String resolvedTitle = details.optString("title", item.optString("title"));
            int resolvedYear = releaseYear(details, resolvedTitle);
            if (score(title, season, releaseYear, resolvedTitle, resolvedYear) <= 0) continue;
            JSONObject match = movie ? movieMatch(details) : episodeMatch(details, season, number);
            if (match == null) continue;
            JSONObject answer = new JSONObject();
            answer.put("provider", provider).put("url", match.optString("url"))
                    .put("title", match.optString("title", details.optString("title")))
                    .put("seriesTitle", details.optString("title", item.optString("title")))
                    .put("seriesUrl", details.optString("url", item.optString("url")))
                    .put("kind", movie ? "movie" : "episode");
            String image = details.optString("image", item.optString("image"));
            if (!image.isEmpty()) answer.put("image", image);
            if (match.has("season")) answer.put("season", match.get("season"));
            if (!number.isEmpty()) answer.put("number", number);
            if (releaseYear > 0) answer.put("releaseYear", releaseYear);
            else if (resolvedYear > 0) answer.put("releaseYear", resolvedYear);
            synchronized (cache) {
                cache.put(key, new JSONObject(answer.toString()).put("_cachedAt", System.currentTimeMillis()));
                if (cache.size() > 64) cache.remove(cache.keySet().iterator().next());
            }
            return combine(episode, answer);
        }
        return null;
    }

    private static JSONObject combine(JSONObject original, JSONObject source) throws Exception {
        JSONObject result = new JSONObject(original.toString());
        for (String name : new String[]{"provider", "url", "title", "seriesTitle", "seriesUrl", "kind", "image", "season", "number", "releaseYear"})
            if (source.has(name)) result.put(name, source.get(name));
        return result;
    }
    private static void interrupted() throws InterruptedException { if(Thread.currentThread().isInterrupted()) throw new InterruptedException(); }

    private static JSONObject movieMatch(JSONObject details) throws Exception {
        JSONArray episodes = details.optJSONArray("episodes");
        if ("movie".equals(details.optString("kind")) && !details.optString("url").isEmpty())
            return new JSONObject().put("title", details.optString("title")).put("url", details.optString("url"));
        if (episodes != null && episodes.length() == 1) {
            JSONObject item = episodes.optJSONObject(0);
            if (item != null && !item.optString("url").isEmpty() && episodeNumber(item).isEmpty()) return item;
        }
        return null;
    }

    private static JSONObject episodeMatch(JSONObject details, int targetSeason, String targetNumber) {
        JSONArray episodes = details.optJSONArray("episodes");
        if (episodes == null) return null;
        int showSeason = titleSeason(details.optString("title"));
        LinkedHashMap<String, JSONObject> matches = new LinkedHashMap<>();
        for (int i = 0; i < episodes.length(); i++) {
            JSONObject episode = episodes.optJSONObject(i);
            if (episode == null || !targetNumber.equals(episodeNumber(episode))) continue;
            int season = seasonNumber(episode);
            if (season == 0) season = showSeason;
            if (targetSeason > 0 && season == 0 && targetSeason == 1) season = 1;
            if (targetSeason > 0 && season != targetSeason) continue;
            String url = episode.optString("url");
            if (!url.isEmpty()) matches.put(url, episode);
        }
        return matches.size() == 1 ? matches.values().iterator().next() : null;
    }

    private static int score(String target, int targetSeason, int targetYear, String candidate, int candidateYear) {
        if (candidate == null || candidate.trim().isEmpty()) return 0;
        if (targetYear > 0 && candidateYear > 0 && targetYear != candidateYear) return 0;
        String wanted = normalized(target), actual = normalized(candidate);
        int season = titleSeason(candidate);
        if (targetSeason > 0 && season > 0 && targetSeason != season) return 0;
        if (targetSeason == 0 && season > 1) return 0;
        int yearBonus = targetYear > 0 && candidateYear == targetYear ? 10 : 0;
        if (wanted.equals(actual)) return 100 + yearBonus;
        if (normalized(removeSeason(target)).equals(normalized(removeSeason(candidate)))) return 95 + yearBonus;
        return 0;
    }

    private static int releaseYear(JSONObject item, String title) {
        for (String field : new String[]{"releaseYear", "release_year", "year"}) {
            int year = integer(item.optString(field));
            if (year >= 1900 && year <= 2099) return year;
        }
        Matcher match = YEAR.matcher(title == null ? "" : title);
        return match.find() ? integer(match.group(1)) : 0;
    }

    private static String clean(String title) {
        return title.replaceFirst("(?i)^watch\\s+", "")
                .replaceAll("(?i)\\s*\\((?:english\\s+)?(?:dubbed|subbed|dub|sub)\\)\\s*", " ")
                .replaceFirst("(?i)\\s*[-–—:]?\\s*(?:season\\s*\\d+\\s*)?(?:episode|ep\\.?)[\\s._-]*\\d+(?:\\.\\d+)?.*$", "")
                .replaceFirst("(?i)\\s+(?:english\\s+)?(?:dubbed|subbed|dub|sub)\\s*$", "")
                .replaceFirst("\\s*\\((?:19|20)\\d{2}\\)\\s*$", "").trim();
    }

    private static String normalized(String title) {
        return Normalizer.normalize(clean(title), Normalizer.Form.NFD).replaceAll("\\p{M}", "")
                .toLowerCase(Locale.US).replace("shippuuden", "shippuden").replaceAll("[^\\p{L}\\p{N}]", "");
    }

    private static String removeSeason(String title) { return SEASON_SUFFIX.matcher(clean(title)).replaceFirst(""); }

    private static int titleSeason(String title) {
        Matcher match = SEASON_SUFFIX.matcher(clean(title));
        if (!match.find()) return 0;
        for (int i = 1; i <= 3; i++) if (match.group(i) != null) return integer(match.group(i));
        return 0;
    }

    private static String episodeNumber(JSONObject item) {
        String value = decimal(item.optString("number", item.optString("episodeNumber")));
        if (!value.isEmpty()) return value;
        for (String source : new String[]{item.optString("title"), item.optString("url")}) {
            Matcher match = NUMBER.matcher(source);
            if (match.find()) return decimal(match.group(1));
            match = EPISODE_PATH.matcher(source);
            if (match.find()) return decimal(match.group(2));
        }
        return "";
    }

    private static int seasonNumber(JSONObject item) {
        String field = item.optString("season").replaceFirst("(?i)^s(?:eason)?\\s*", "");
        int value = integer(field);
        if (value > 0) return value;
        for (String source : new String[]{item.optString("title"), item.optString("url")}) {
            Matcher match = SEASON.matcher(source);
            if (match.find()) return integer(match.group(1));
            match = EPISODE_PATH.matcher(source);
            if (match.find()) return integer(match.group(1));
        }
        return titleSeason(item.optString("seriesTitle"));
    }

    private static int integer(String value) { try { return Integer.parseInt(value); } catch (Exception ignored) { return 0; } }
    private static String decimal(String value) {
        try { BigDecimal number = new BigDecimal(value); return number.signum() >= 0 ? number.stripTrailingZeros().toPlainString() : ""; }
        catch (Exception ignored) { return ""; }
    }
}

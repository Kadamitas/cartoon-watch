package tv.cartoonwatch.app;

import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;


public final class AdBlocker {
    public volatile boolean enabled = true;
    public final AtomicInteger blocked = new AtomicInteger();
    private final Set<String> hosts = new HashSet<>(Arrays.asList(
        "doubleclick.net", "googlesyndication.com", "googleadservices.com", "googletagservices.com",
        "google-analytics.com", "googletagmanager.com", "adservice.google.com", "ads.google.com",
        "adnxs.com", "adsrvr.org", "adsystem.com", "amazon-adsystem.com", "cpmstar.com",
        "popads.net", "popcash.net", "propellerads.com", "adsterra.com", "adsterra.org",
        "exoclick.com", "exosrv.com", "exdynsrv.com", "trafficjunky.net", "trafficstars.com",
        "juicyads.com", "onclickads.net", "onclkds.com", "onclickalgo.com", "onclickperformance.com",
        "onclickprediction.com", "onclckvd.com", "onclicka.com", "pushwhy.com", "pushground.com",
        "pushwoosh.com", "pushnami.com", "onesignal.com", "hilltopads.net", "hilltopads.com",
        "highperformanceformat.com", "highperformancecpm.com", "profitablecpmrate.com",
        "profitabledisplaynetwork.com", "effectivegatecpm.com", "effectivecreativeformat.com",
        "realsrv.com", "realsrvcdn.com", "tsyndicate.com", "twinrdsyn.com", "syndication.realsrv.com",
        "bebi.com", "mgid.com", "taboola.com", "outbrain.com", "revcontent.com", "adroll.com",
        "criteo.com", "criteo.net", "rubiconproject.com", "pubmatic.com", "openx.net", "smartadserver.com",
        "casalemedia.com", "scorecardresearch.com", "quantserve.com", "histats.com", "yadro.ru",
        "statcounter.com", "clksite.com", "clickadu.com", "clickadilla.com", "clickaine.com",
        "a-ads.com", "coinzilla.com", "monetag.com", "monetag.net", "vaugroar.com",
        "dtscout.com", "demdex.net", "bidvertiser.com", "ad-maven.com", "ad-maven.net",
        "admaven.com", "advinci.net", "adblade.com", "adform.net", "adform.com", "ad-delivery.net",
        "livejasmin.com", "stripchat.com", "chaturbate.com", "bongacams.com", "adultfriendfinder.com",
        "faillouvre.com", "pubadx.one", "funnedravage.com", "adllvpn.com", "llvpn.com"
    ));

    public static boolean isProvider(String host) {
        if (host == null) return false;
        host = host.toLowerCase(Locale.US);
        return sameDomain(host, "kissanime.tv.in") || sameDomain(host, "wco.tv") || sameDomain(host, "wcostream.tv") || sameDomain(host, "aniwave.gr") || sameDomain(host, "hdtoday.one");
    }
    private static boolean sameDomain(String host, String domain) {
        return host.equals(domain) || host.endsWith("." + domain);
    }
    public boolean shouldBlock(String url) {
        if (!enabled || url == null) return false;
        try {
            Uri uri=Uri.parse(url);
            String host = uri.getHost();


            if(host!=null && sameDomain(host.toLowerCase(Locale.US),"wcostream.com") && "/inc/js/adblock-detector-wcostream.js".equals(uri.getPath())) {
                blocked.incrementAndGet(); return true;
            }
            if (host == null || isProvider(host)) return false;
            host = host.toLowerCase(Locale.US);
            for (String part = host; part.contains("."); part = part.substring(part.indexOf('.') + 1)) {
                if (hosts.contains(part)) { blocked.incrementAndGet(); return true; }
            }
        } catch (Exception ignored) { }
        return false;
    }
    public WebResourceResponse empty() {
        return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
    }
}

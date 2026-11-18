(function() {
    "use strict";
    var config = window.CW_CONFIG || {};
    window.open = function() {
        return null;
    };
    var old = document.getElementById("cw-player-style");
    if (old) old.remove();
    var style = document.createElement("style");
    style.id = "cw-player-style";
    style.textContent = ":focus{outline:4px solid #ff795b!important;outline-offset:3px!important}video{max-width:100%}" + (config.adBlock ? 'iframe[src*="cpmstar"],iframe[src*="doubleclick"],[id^="google_ads"],[class*="adsterra"],[id^="div-gpt-ad"],.adsbygoogle,.ad-container,.advertisement,.popunder{display:none!important}' : "");
    (document.head || document.documentElement).appendChild(style);
    function videos(doc) {
        var list = Array.prototype.slice.call(doc.querySelectorAll("video"));
        Array.prototype.forEach.call(doc.querySelectorAll("iframe"), function(frame) {
            try {
                if (frame.contentDocument) list = list.concat(videos(frame.contentDocument));
            } catch (_) {}
        });
        return list;
    }
    function mainVideo() {
        var list = videos(document);
        list.sort(function(a, b) {
            return b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight;
        });
        return list[0];
    }
    window.CWPlayerTick = function() {
        var v = mainVideo();
        if (!v) return;
        if (!v.__cwAttached) {
            v.__cwAttached = true;
            var resume = Number((window.CW_CONFIG || {}).resumeSeconds) || 0;
            var applyResume = function() {
                if (resume > 5 && isFinite(v.duration) && resume < v.duration - 10) {
                    v.currentTime = resume;
                    resume = 0;
                }
            };
            v.addEventListener("loadedmetadata", applyResume);
            if (v.readyState >= 1) applyResume();
            v.addEventListener("pause", window.CWPlayerTick);
            v.addEventListener("ended", window.CWPlayerTick);
        }
        try {
            if (window.PlayerEvents && isFinite(v.currentTime) && isFinite(v.duration)) window.PlayerEvents.report(String((window.CW_CONFIG || {}).session || ""), v.currentTime, v.duration, v.paused, v.played.length > 0, v.readyState>=2&&!v.seeking);
        } catch (_) {}
    };
    window.CWControl = function(key, value) {
        var v = mainVideo();
        if (!v) return window.CWRelayMedia ? window.CWRelayMedia(key, value) : false;
        if (key === "play" || key === "toggle" && v.paused) {
                var p = v.play();
                if (p && p.catch) p.catch(function() {});
        } else if (key === "pause" || key === "toggle") { v.__cwAutoplayDone=true;v.pause(); }
        if (key === "seek" && isFinite(Number(value))) v.currentTime = Math.max(0, Math.min(isFinite(v.duration) ? v.duration : 1e8, Number(value)));
        if (key === "forward" || key === "rewind") {
            var step=Number(value)>0 && isFinite(Number(value))?Math.min(3600,Number(value)):10;
            v.currentTime = Math.max(0, Math.min(isFinite(v.duration) ? v.duration : 1e8, v.currentTime + (key === "forward" ? step : -step)));
        }
        if (key === "fullscreen") {
            var f = v.requestFullscreen || v.webkitRequestFullscreen;
            if (f) f.call(v);
        }
        window.CWPlayerTick();
        return true;
    };
    window.CWZoomPlayer = function(force) {
        var els = Array.prototype.slice.call(document.querySelectorAll("iframe,video"));
        els = els.filter(function(el) {
            var r = el.getBoundingClientRect();
            return r.width > 220 && r.height > 120 && !/cpmstar|doubleclick/.test(el.src || "");
        });
        els.sort(function(a, b) {
            return b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight;
        });
        var el = els[0];
        if (!el) return false;
        var css = document.getElementById("cw-zoom");
        if (css) {
            if (force) {
                el.setAttribute("data-cw-zoom", "1");
                return true;
            }
            css.remove();
            el.removeAttribute("data-cw-zoom");
            return false;
        }
        el.setAttribute("data-cw-zoom", "1");
        css = document.createElement("style");
        css.id = "cw-zoom";
        css.textContent = '[data-cw-zoom="1"]{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483646!important;background:#000!important;margin:0!important;border:0!important}' + (/^(?:www\.)?hdtoday\.one$/i.test(location.hostname) ? "#header{visibility:hidden!important;pointer-events:none!important}" : "");
        document.head.appendChild(css);
        return true;
    };
    window.CWPlayerTick();
})();

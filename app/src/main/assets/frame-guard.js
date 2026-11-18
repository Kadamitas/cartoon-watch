(function() {
    "use strict";
    if (window.__cwFrameGuard) return;
    window.__cwFrameGuard = true;
    var config = window.CW_CONFIG || {};
    var enabled = config.adBlock !== false;
    var promo = false;
    var closing = false;
    var scheduled = false;
    var autoplayAttempts = 0;
    var sitePlayAttempts = 0;
    var serverChosen = false;
    var host = location.hostname.toLowerCase();
    var knownAnnouncement = (host === "embed.wcostream.com" || host === "vhs.wcostream.com") && location.pathname === "/inc/embed/index.php";
    var genericCss = 'iframe[src*="cpmstar"],iframe[src*="doubleclick"],[id^="google_ads"],[id^="div-gpt-ad"],.adsbygoogle,.ad-container,.advertisement,.popunder,.push-notification-prompt{display:none!important}';
    var promoCss = "#announcement,#backdrop{visibility:hidden!important;pointer-events:none!important}.cd-roll.cd-play{animation-duration:.01s!important;-webkit-animation-duration:.01s!important}";
    function mountStyle() {
        if (!enabled || document.getElementById("cw-frame-guard-style")) return;
        var parent = document.head || document.documentElement;
        if (!parent) return;
        var css = document.createElement("style");
        css.id = "cw-frame-guard-style";
        css.textContent = genericCss + (knownAnnouncement ? promoCss : "");
        parent.appendChild(css);
    }
    window.open = function() {
        return null;
    };
    function loading(show) {
        var node = document.getElementById("cw-video-loading");
        if (!show) {
            if (node) node.remove();
            return;
        }
        if (node || !document.body) return;
        node = document.createElement("div");
        node.id = "cw-video-loading";
        node.textContent = "Loading video…";
        node.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#0b0d14;color:#d7deea;display:flex;align-items:center;justify-content:center;font:500 20px sans-serif;letter-spacing:.03em";
        document.body.appendChild(node);
    }
    function cleanAnnouncement() {
        if (!enabled || !knownAnnouncement || closing) return;
        var dialog = document.getElementById("announcement");
        var close = document.getElementById("close-btn");
        var backdrop = document.getElementById("backdrop");
        if (!dialog || !close || !backdrop || document.title !== "Announcement") return;
        promo = true;
        loading(true);
        if (close.disabled) return;
        closing = true;
        var ready = window.AdGate && window.AdGate.ready;
        Promise.resolve(ready).then(function() {
            setTimeout(function() {
                if (!close.disabled && document.contains(close)) {
                    close.click();
                    try {
                        if (window.PlayerEvents) window.PlayerEvents.promotionClosed();
                    } catch (_) {}
                }
            }, 500);
        }).catch(function() {
            closing = false;
        });
    }
    function skipControl() {
        var nodes = document.querySelectorAll('button,a,[role="button"],.skip-intro,.skip-opening,#skip-intro');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var label = ((node.getAttribute("aria-label") || "") + " " + (node.textContent || "") + " " + (node.getAttribute("title") || "")).trim();
            if (!/\bskip\s+(?:the\s+)?(?:intro|opening)\b/i.test(label)) continue;
            if (node.disabled || node.getAttribute("aria-disabled") === "true") continue;
            var rect = node.getBoundingClientRect();
            if (rect.width && rect.height && getComputedStyle(node).visibility !== "hidden" && getComputedStyle(node).display !== "none") return node;
        }
        return null;
    }
    window.CWSkipIntro = function() {
        if (window.CWSiteSkipIntro && window.CWSiteSkipIntro()) return true;
        var control = skipControl();
        if (control) {
            control.click();
            try {
                if (window.PlayerEvents) window.PlayerEvents.introSkipped();
            } catch (_) {}
            return true;
        }
        var frames = document.querySelectorAll("iframe");
        for (var i = 0; i < frames.length; i++) try {
            frames[i].contentWindow.postMessage({
                channel: "cartoon-watch-control",
                command: "skipIntro"
            }, "*");
        } catch (_) {}
        return frames.length > 0;
    };
    window.CWRelayMedia = function(key, value) {
        if (config.crossFrame === false) return false;
        var frames = document.querySelectorAll("iframe"), sent = 0;
        for (var i = 0; i < frames.length; i++) {
            var rect = frames[i].getBoundingClientRect();
            if (rect.width < 180 || rect.height < 100 || getComputedStyle(frames[i]).visibility === "hidden") continue;
            try {
                frames[i].contentWindow.postMessage({
                    channel: "cartoon-watch-control",
                    command: "mediaControl",
                    key: key,
                    value: value
                }, "*");
                sent++;
            } catch (_) {}
        }
        return sent > 0;
    };
    window.addEventListener("message", function(event) {
        if (event.source !== window.parent || !event.data || event.data.channel !== "cartoon-watch-control") return;
        if (event.data.command === "skipIntro") window.CWSkipIntro();
        if (event.data.command === "mediaControl" && /^(play|pause|toggle|forward|rewind|seek|fullscreen)$/.test(event.data.key) && window.CWControl) window.CWControl(event.data.key, event.data.value);
    });
    function startVideo() {
        if (!config.autoPlay || autoplayAttempts > 12 || promo) return;
        var video = document.querySelector("video");
        if (!video || video.ended || video.error) return;
        if (!video.paused) {
            video.__cwAutoplayDone = true;
            return;
        }
        if (!video.currentSrc && !video.getAttribute("src") && !video.querySelector("source")) return;
        if (video.__cwAutoplayDone) return;
        autoplayAttempts++;
        var result = video.play();
        if (result && result.then) result.then(function() {
            video.__cwAutoplayDone = true;
        }).catch(function() {}); else video.__cwAutoplayDone = true;
    }
    function startSitePlayer() {
        if (!config.autoPlay) return;
        if (/^(?:www\.)?hdtoday\.one$/.test(host)) {
            var server = document.querySelector('.sv-item[data-srv="Vidmoly"]');
            if (server && !serverChosen) {
                serverChosen = true;
                server.click();
            }
            if (document.querySelector("#iframe-player") && window.CWZoomPlayer) window.CWZoomPlayer(true);
            return;
        }
        if (!/^(?:www\.)?aniwave\.gr$/.test(host)) return;
        var frame = document.querySelector("#player iframe");
        if (frame) {
            if (window.CWZoomPlayer) window.CWZoomPlayer(true);
            return;
        }
        var play = document.querySelector("#player .play");
        if (play && sitePlayAttempts < 12 && play.getBoundingClientRect().width && getComputedStyle(play).display !== "none") {
            sitePlayAttempts++;
            play.click();
        }
    }
    function scan() {
        scheduled = false;
        mountStyle();
        cleanAnnouncement();
        if (window.CWPlayerTick) window.CWPlayerTick();
        startSitePlayer();
        startVideo();
        var timedVideo = document.querySelector("video");
        if (timedVideo && window.parent !== window && isFinite(timedVideo.currentTime)) {
            try {
                window.parent.postMessage({
                    channel: "cartoon-watch-player",
                    event: "time",
                    position: timedVideo.currentTime
                }, "*");
            } catch (_) {}
        }
        if (enabled && /(?:^|\.)wcostream\.com$/.test(host)) {
            var v = document.querySelector("video");
            if (v && v.readyState >= 1 && isFinite(v.duration) && v.duration > 0) {
                var nag = document.getElementById("__abd_hardblock");
                if (nag) nag.remove();
            }
        }
    }
    function schedule() {
        if (!scheduled) {
            scheduled = true;
            setTimeout(scan, 100);
        }
    }
    new MutationObserver(schedule).observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [ "disabled", "src" ]
    });
    document.addEventListener("DOMContentLoaded", scan);
    document.addEventListener("canplay", schedule, true);
    mountStyle();
    schedule();
    setInterval(scan, 2500);
    if (knownAnnouncement) setTimeout(function() {
        if (location.pathname === "/inc/embed/index.php") {
            loading(false);
            var css = document.getElementById("cw-frame-guard-style");
            if (css) css.textContent = genericCss;
            var close = document.getElementById("close-btn");
            if (close && !close.disabled) close.click();
        }
    }, 15e3);
})();

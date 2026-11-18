(function() {
    "use strict";
    if (!/^(?:www\.)?aniwave\.gr$/i.test(location.hostname) || window.__cwAniWaveSkips) return;
    window.__cwAniWaveSkips = true;
    var ranges = null;
    var position = null;
    function pair(value) {
        if (!Array.isArray(value) || value.length < 2) return null;
        var start = Number(value[0]), end = Number(value[1]);
        return isFinite(start) && isFinite(end) && start >= 0 && end > start && end < 86400 ? [ start, end ] : null;
    }
    function playerFrames() {
        return Array.prototype.slice.call(document.querySelectorAll("#player iframe"));
    }
    function send(command) {
        var sent = false;
        playerFrames().forEach(function(frame) {
            try {
                var target = new URL(frame.src, location.href);
                if (/^https?:$/.test(target.protocol) && frame.contentWindow) {
                    frame.contentWindow.postMessage(JSON.stringify(command), target.origin);
                    sent = true;
                }
            } catch (_) {}
        });
        return sent;
    }
    function adopt(data) {
        ranges = data && typeof data === "object" ? {
            intro: pair(data.intro),
            outro: pair(data.outro)
        } : null;
        window.CW_SITE_SKIP_DATA = ranges;
        window.dispatchEvent(new CustomEvent("cw-site-skip-data", {
            detail: ranges
        }));
    }
    var open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, address) {
        try {
            var url = new URL(String(address), document.baseURI || location.href);
            this.__cwAniSkipResponse = url.origin === location.origin && url.pathname === "/ajax/server" && url.searchParams.has("get");
            if (this.__cwAniSkipResponse) {
                ranges = null;
                position = null;
            }
            if (!this.__cwAniSkipListener) {
                this.__cwAniSkipListener = true;
                this.addEventListener("load", function() {
                    if (!this.__cwAniSkipResponse) return;
                    try {
                        var result = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
                        if (result && result.status === 200) adopt(result.result && result.result.skip_data);
                    } catch (_) {}
                });
            }
        } catch (_) {}
        return open.apply(this, arguments);
    };
    window.addEventListener("message", function(event) {
        var frame = playerFrames().filter(function(item) {
            try {
                return event.source === item.contentWindow && event.origin === new URL(item.src, location.href).origin;
            } catch (_) {
                return false;
            }
        })[0];
        if (!frame) return;
        try {
            var message = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
            if (message && message.event === "PLAY_TIMING" && message.data && isFinite(Number(message.data.position))) position = Number(message.data.position);
            if (message && message.channel === "cartoon-watch-player" && message.event === "time" && isFinite(Number(message.position))) position = Number(message.position);
        } catch (_) {}
    });
    window.CWUseSiteSkips = function() {
        var control = document.querySelector('.ctrl.auto-skip[data-name="auto_skip_intro"]');
        if (!control) return false;
        if (control.querySelector(".fa-square")) control.click();
        return !!control.querySelector(".fa-check");
    };
    window.CWSiteSkipIntro = function() {
        window.CWUseSiteSkips();
        if (!ranges || !ranges.intro) return false;
        if (position === null || !isFinite(position) || position < ranges.intro[0] || position >= ranges.intro[1]) return false;
        return send({
            cmd: "SEEK",
            value: ranges.intro[1]
        });
    };
    var attempts = 0;
    var timer = setInterval(function() {
        attempts++;
        if (window.CWUseSiteSkips() || attempts >= 50) clearInterval(timer);
    }, 400);
})();

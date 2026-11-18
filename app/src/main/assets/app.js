(function(root) {
    "use strict";
    function number(value) {
        var names = {zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
        if(Object.prototype.hasOwnProperty.call(names,value))return names[value];
        var parts=value.split(/[ -]+/);
        return parts.length===2 && names[parts[0]]>=20 && names[parts[1]]<10?names[parts[0]]+names[parts[1]]:Number(value);
    }
    function parse(value) {
        var text=String(value || "").trim().replace(/^please\s+/i, "").replace(/[.!?]+$/, "");
        if (!text || text.length>400) return {action:"unknown"};
        var lower=text.toLowerCase(), match;
        if (/^(?:play|resume|continue)(?:\s+(?:the\s+)?(?:video|playback))?$/.test(lower)) return {action:"control",command:"play"};
        if (/^(?:pause|stop)(?:\s+(?:the\s+)?(?:video|playback))?$/.test(lower)) return {action:"control",command:"pause"};
        if (/^skip\s+(?:the\s+)?(?:intro|opening)$/.test(lower)) return {action:"control",command:"skipIntro"};
        if (/^(?:restart|start over)$/.test(lower)) return {action:"control",command:"seek",value:0};
        if (/^(?:go\s+)?back$/.test(lower)) return {action:"back"};
        if (/^(?:go\s+)?(?:home|catalog|library)$/.test(lower)) return {action:"home"};
        match=lower.match(/^(?:fast[ -]?forward|forward|rewind|go back)(?:\s+([\w. -]+?)\s*(?:seconds?|secs?))?$/);
        if (match) {
            var seconds=match[1]?number(match[1]):10;
            if (isFinite(seconds) && seconds>0 && seconds<=3600) return {action:"control",command:/rewind|go back/.test(match[0])?"backward":"forwardBy",value:seconds};
        }
        match=lower.match(/^(?:pick|choose|play|open)?\s*(?:season\s+([\w. -]+?)\s+)?episode\s+([\w. -]+)$/);
        if (match) {
            var episode=number(match[2]), season=match[1]?number(match[1]):null;
            if (isFinite(episode) && episode>0 && episode<=10000 && (season===null || isFinite(season) && season>0 && season<=1000)) return {action:"episode",episode:episode,season:season};
        }
        match=text.match(/^(?:play|watch|open)\s+(.+?)\s+(?:season\s+([\w. -]+?)\s+)?episode\s+([\w. -]+)$/i);
        if (match) {
            var ep=number(match[3].toLowerCase()), ss=match[2]?number(match[2].toLowerCase()):null;
            if (isFinite(ep) && ep>0 && ep<=10000 && (ss===null || isFinite(ss) && ss>0 && ss<=1000)) return {action:"title",title:match[1].trim(),episode:ep,season:ss};
        }
        var category=/\b(?:subbed|subtitled)\s+anime\b/.test(lower)?"Subbed anime":/\b(?:dubbed|english dubbed)\s+anime\b/.test(lower)?"Dubbed anime":/\bcartoons?\b/.test(lower)?"Cartoons":/\bmovies?|films?\b/.test(lower)?"Movies":/\b(?:ovas?|o v a|original video animations?)\b/.test(lower)?"OVA":null;
        if (/^(?:show|browse|filter|only)(?:\s+me)?\s+/.test(lower) && category) return {action:"catalog",category:category,query:""};
        if (/^(?:show|browse|filter)(?:\s+me)?\s+(?:all|everything|all titles)$/.test(lower)) return {action:"catalog",category:"all",query:""};
        if (/^(?:sort|order)\s+/.test(lower)) {
            if (/\bz\s*(?:to|[-–])\s*a\b|reverse|descending/.test(lower)) return {action:"sort",sort:"za"};
            if (/\ba\s*(?:to|[-–])\s*z\b|alphabetical|ascending/.test(lower)) return {action:"sort",sort:"az"};
        }
        match=text.match(/^(?:search(?:\s+for)?|find)\s+(.+)$/i);
        if (match) return {action:"catalog",query:match[1].trim(),category:"all"};
        match=text.match(/^(?:play|watch|open)\s+(.+)$/i);
        if (match) return {action:"title",title:match[1].trim(),episode:null,season:null};
        return {action:"unknown"};
    }
    var commands={parse:parse};
    if (typeof module==="object" && module.exports) module.exports=commands;
    else root.CartoonVoice=commands;
})(typeof window!=="undefined"?window:globalThis);
(function() {
    "use strict";
    if (typeof document === "undefined") return;
    var PROVIDERS = [ {
        id: "wco",
        name: "WCO",
        fullName: "Watch Cartoons Online",
        url: "https://www.wco.tv/",
        search: "https://www.wco.tv/search"
    }, {
        id: "kissanime",
        name: "KissAnime",
        fullName: "KissAnime",
        url: "https://kissanime.tv.in/"
    }, {
        id: "wcostream",
        name: "WCO Stream",
        fullName: "WCO Stream",
        url: "https://www.wcostream.tv/"
    }, {
        id: "aniwave",
        name: "AniWave",
        fullName: "AniWave",
        url: "https://aniwave.gr/",
        search: "https://aniwave.gr/filter"
    }, {
        id: "hdtoday",
        name: "HDToday",
        fullName: "HDToday",
        url: "https://hdtoday.one/home/",
        search: "https://hdtoday.one/search"
    } ];
    var content = document.getElementById("content");
    var detailLayer = document.getElementById("detail");
    var main = document.getElementById("main");
    var callbacks = {};
    var requestIndex = 0;
    var loadIndex = 0;
    var detailIndex = 0;
    var saveTimer;
    var toastTimer;
    var route = "home";
    var currentProvider = "wco";
    var catalog = [];
    var trendingData = { items: [] }, trendingPending, trendingLoaded = false, trendingNext = 0, trendingVersion = 0, homeTrendingDirty = false;
    var discoveryCategories = Array.isArray(window.CWDiscoveryCategories) ? window.CWDiscoveryCategories : [];
    var genreDomains = { anime: { key: "isekai", data: { items: [] }, cache: {}, version: 0, dirty: false }, cartoons: { key: "cartoon-essentials", data: { items: [] }, cache: {}, version: 0, dirty: false } };
    var genreDomain = "anime", genrePending, genreQueued = {};
    var catalogInfo = {
        total: 0,
        categories: [ "Dubbed anime", "Cartoons", "Subbed anime", "Movies", "OVA" ]
    };
    var searchResults = [];
    var searchPage = null;
    var searchOffset = 0;
    var searchCategory = "all";
    var searchOrder = "az";
    var pageSize = 60;
    var query = "";
    var listSort = "recent";
    var currentDetail = null;
    var returnFocus = null;
    var detailOpen = false;
    var historyDirty = false;
    var state = {
        favorites: [],
        history: [],
        settings: {
            provider: "wco",
            adBlock: true
        }
    };
    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    }
    function icon(name) {
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "#i-" + name);
        use.setAttributeNS("http://www.w3.org/1999/xlink", "href", "#i-" + name);
        svg.setAttribute("aria-hidden", "true");
        svg.appendChild(use);
        return svg;
    }
    function button(label, className, handler, iconName) {
        var node = el("button", className || "button");
        node.type = "button";
        if (iconName) node.appendChild(icon(iconName));
        if (label) node.appendChild(el("span", "", label));
        if (handler) node.addEventListener("click", handler);
        return node;
    }
    function provider(id) {
        for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i];
        return PROVIDERS[0];
    }
    function safeUrl(value) {
        try {
            var url = new URL(String(value || ""));
            var host = url.hostname.toLowerCase();
            return url.protocol === "https:" && /^(www\.)?(wco\.tv|wcostream\.tv|kissanime\.tv\.in|aniwave\.gr|hdtoday\.one)$/.test(host) ? url.href : "";
        } catch (e) {
            return "";
        }
    }
    function imageUrl(value) {
        if(typeof value==="string" && value.length<=50000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value))return value;
        try {
            var url = new URL(String(value || ""));
            return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
        } catch (e) {
            return "";
        }
    }
    function normalizeItem(item) {
        if (!item || !safeUrl(item.url)) return null;
        var result = Object.assign({}, item);
        result.url = safeUrl(item.url);
        result.title = String(item.title || "Untitled");
        result.provider = provider(item.provider || currentProvider).id;
        result.image = imageUrl(item.image);
        return result;
    }
    function itemsFrom(data) {
        var input = data && Array.isArray(data.items) ? data.items : [];
        if (!input.length && data && Array.isArray(data.sections)) {
            data.sections.forEach(function(section) {
                input = input.concat(section.items || []);
            });
        }
        var seen = {};
        return input.map(normalizeItem).filter(function(item) {
            if (!item || seen[item.url]) return false;
            seen[item.url] = true;
            return true;
        });
    }
    function nativeAvailable() {
        return !!(window.CartoonWatch && typeof window.CartoonWatch.request === "function");
    }
    function request(action, payload) {
        return new Promise(function(resolve, reject) {
            var id = "cw" + ++requestIndex;
            if (!nativeAvailable()) {
                if (action === "getState") {
                    try {
                        resolve(JSON.parse(localStorage.getItem("cartoonWatchState") || "null") || state);
                    } catch (error) {
                        resolve(state);
                    }
                } else if (action === "saveState") {
                    try {
                        localStorage.setItem("cartoonWatchState", JSON.stringify(payload));
                    } catch (error) {}
                    resolve({
                        ok: true
                    });
                } else if (action === "settings") resolve({
                    ok: true
                }); else if (action === "openSource") {
                    var externalUrl = safeUrl(payload.url) || provider(payload.provider).url;
                    window.open(externalUrl, "_blank", "noopener");
                    resolve({
                        ok: true
                    });
                } else resolve({
                    items: [],
                    error: "Live catalogs and playback are available in the Cartoon Watch Android app."
                });
                return;
            }
            var timer = setTimeout(function() {
                delete callbacks[id];
                reject(new Error("This source is taking longer than expected. Try again or switch sources."));
            }, /^(home|search|catalog|details)$/.test(action) ? 65e3 : 15e3);
            callbacks[id] = function(result) {
                clearTimeout(timer);
                resolve(result || {});
            };
            try {
                window.CartoonWatch.request(action, JSON.stringify(payload || {}), id);
            } catch (error) {
                clearTimeout(timer);
                delete callbacks[id];
                reject(error);
            }
        });
    }
    window.onNativeResult = function(id, result) {
        var callback = callbacks[id];
        if (!callback) return;
        delete callbacks[id];
        try {
            callback(typeof result === "string" ? JSON.parse(result) : result);
        } catch (error) {
            callback({
                error: "The source returned an unreadable response."
            });
        }
    };
    function adoptState(data) {
        if (!data || typeof data !== "object") return;
        state.favorites = (Array.isArray(data.favorites) ? data.favorites : []).map(normalizeItem).filter(Boolean);
        state.history = (Array.isArray(data.history) ? data.history : []).map(normalizeItem).filter(Boolean);
        state.settings = Object.assign({
            provider: currentProvider,
            adBlock: true
        }, data.settings || {});
        state.settings.provider = "wco";
    }
    function saveState() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function() {
            request("saveState", state).catch(function() {
                toast("Could not save your watch list.");
            });
        }, 120);
    }
    function toast(message) {
        clearTimeout(toastTimer);
        var node = document.getElementById("toast");
        node.textContent = message;
        node.classList.add("visible");
        toastTimer = setTimeout(function() {
            node.classList.remove("visible");
        }, 3200);
    }
    function sourceButton(id, label, url) {
        return button(label || "Open source", "button secondary", function() {
            openSource(id, url);
        }, "open");
    }
    function normalizedTitle(title) {
        return String(title || "").replace(/\s*[-–—:]?\s*(?:season\s*\d+[\s:,-]*)?(?:episode|ep\.?)\s*\d+.*$/i, "").replace(/\s+(?:season\s*\d+|s\d+\s*e\d+.*)\s*$/i, "").replace(/\s+(?:english\s+)?(?:dubbed|subbed|dub|sub)\s*$/i, "").trim();
    }
    function searchAlternative(id, title) {
        if (id !== "wco") {
            openSource(id);
            return;
        }
        currentProvider = "wco";
        state.settings.provider = currentProvider;
        query = normalizedTitle(title);
        searchResults = [];
        searchPage = null;
        searchOffset = 0;
        searchCategory = "all";
        saveState();
        renderStatus();
        setRoute("search", true);
    }
    window.searchAlternative = searchAlternative;
    function openSource(id, url) {
        request("openSource", {
            provider: id || currentProvider,
            url: safeUrl(url) || provider(id || currentProvider).url,
            title: provider(id || currentProvider).fullName + " browser"
        }).then(function(data) {
            if (data.error) toast(data.error);
        }).catch(function(error) {
            toast(error.message);
        });
    }
    function renderStatus() {
        document.getElementById("footer-status").textContent = (state.settings.adBlock ? "Ad protection on" : "Ad protection off") + " · WCO";
    }
    function setRoute(next, focus, restoreGenre) {
        if (detailOpen) closeDetails(false);
        route = next;
        loadIndex++;
        document.querySelectorAll(".nav-button").forEach(function(node) {
            var active = node.getAttribute("data-route") === (route === "genre" ? "home" : route);
            node.classList.toggle("active", active);
            if (active) node.setAttribute("aria-current", "page"); else node.removeAttribute("aria-current");
        });
        if (next === "genre") { var scrollBehavior = main.style.scrollBehavior; main.style.scrollBehavior = "auto"; main.scrollTop = 0; main.style.scrollBehavior = scrollBehavior; } else main.scrollTop = 0;
        if (next === "home" && restoreGenre) {
            renderHome({ items: catalog });
            var origin = genreDomains[genreDomain], behavior = main.style.scrollBehavior; main.style.scrollBehavior = "auto"; main.scrollTop = origin.homeScroll;
            origin.viewAll.focus({ preventScroll: true }); main.scrollTop += origin.viewAll.getBoundingClientRect().top - origin.homeTop; main.style.scrollBehavior = behavior;
            loadTrending(loadIndex); loadGenres();
        } else if (next === "home") loadHome(); else if (next === "genre") renderGenre(); else if (next === "search") renderSearch(); else if (next === "list") renderList(); else if (next === "settings") renderSettings();
        if (focus && !restoreGenre) { var focusToken = loadIndex, focusOrigin = document.activeElement; setTimeout(function() { if (focusToken === loadIndex && route === next && !detailOpen && document.activeElement === focusOrigin) focusContent(); }, 40); }
    }
    function focusContent() {
        var first = content.querySelector("input,button,select");
        if (first) first.focus();
    }
    function intro(title, description) {
        var node = el("div", "section-intro");
        node.appendChild(el("h1", "", title));
        if (description) node.appendChild(el("p", "", description));
        return node;
    }
    function loading(target, label) {
        target.textContent = "";
        var hero = el("div", "loading-hero");
        var message = el("span", "loading-label");
        message.appendChild(el("i", "spinner"));
        message.appendChild(document.createTextNode(label || "Finding your next watch…"));
        hero.appendChild(message);
        target.appendChild(hero);
        var row = el("div", "cards-row");
        for (var i = 0; i < 7; i++) row.appendChild(el("div", "loading-card"));
        target.appendChild(row);
    }
    function emptyBox(title, description, iconName, actions, error) {
        var box = el("div", "empty");
        var mark = el("div", "empty-icon");
        mark.appendChild(icon(iconName || "screen"));
        box.appendChild(mark);
        var copy = el("div", "empty-copy");
        copy.appendChild(el("h2", "", title));
        copy.appendChild(el("p", "", description));
        if (actions && actions.length) {
            var actionRow = el("div", "actions");
            actions.forEach(function(item) {
                actionRow.appendChild(item);
            });
            copy.appendChild(actionRow);
        }
        if (error) copy.appendChild(el("div", "error-detail", String(error).slice(0, 260)));
        box.appendChild(copy);
        return box;
    }
    function rowHeading(title, count, action) {
        var row = el("div", "row-head");
        row.appendChild(el("h2", "", title));
        if (action) row.appendChild(action); else if (count !== undefined) row.appendChild(el("span", "meta", count + (count === 1 ? " TITLE" : " TITLES")));
        return row;
    }
    function hasFavorite(item) {
        return state.favorites.some(function(entry) {
            return entry.url === item.url && entry.provider === item.provider;
        });
    }
    function toggleFavorite(item, targetButton) {
        var exists = hasFavorite(item);
        if (exists) state.favorites = state.favorites.filter(function(entry) {
            return entry.url !== item.url || entry.provider !== item.provider;
        }); else state.favorites.unshift({
            title: item.title,
            url: item.url,
            image: item.image || "",
            provider: item.provider,
            kind: item.kind || "series",
            description: item.description || "",
            genres: item.genres || [],
            addedAt: Date.now()
        });
        saveState();
        if (targetButton) updateFavoriteButton(targetButton, item);
        toast(exists ? "Removed from My List" : "Added to My List");
        if (route === "list" && !detailOpen) renderList();
    }
    function updateFavoriteButton(node, item) {
        var exists = hasFavorite(item);
        node.textContent = "";
        node.appendChild(icon(exists ? "check" : "plus"));
        node.appendChild(el("span", "", exists ? "In My List" : "My List"));
        node.setAttribute("aria-pressed", String(exists));
    }
    function favoriteButton(item) {
        var node = button("", "button secondary", function() {
            toggleFavorite(item, node);
        });
        updateFavoriteButton(node, item);
        return node;
    }
    function addImage(holder, item, className, variant) {
        var fallback = el("div", "card-art", "cw");
        holder.appendChild(fallback);
        var entry={holder:holder,item:item,fallback:fallback,className:className || "",variant:variant || "poster",hero:className === "hero-art",visible:false,done:false,next:0,attempts:0};
        artworkEntries.push(entry);
        if(++artworkAdds%64===0){clearTimeout(artworkPruneTimer);artworkPruneTimer=setTimeout(pruneArtwork,0);}
        if(!artworkObserver && window.IntersectionObserver)artworkObserver=new IntersectionObserver(function(changes){changes.forEach(function(change){var record=change.target.__cwArtwork;if(record){record.visible=change.isIntersecting;if(record.visible)scheduleArtwork();}});},{rootMargin:"180px"});
        holder.__cwArtwork=entry;
        if(artworkObserver){artworkObserver.unobserve(holder);artworkObserver.observe(holder);}else {entry.visible=true;scheduleArtwork();}
        return entry;
    }
    var artworkEntries=[],artworkCache=new Map(),artworkObserver,artworkTimer,artworkPruneTimer,artworkBusy=false,artworkGeneration=0,artworkAdds=0;
    function pruneArtwork() {artworkEntries=artworkEntries.filter(function(entry){if(document.contains(entry.holder)&&entry.holder.__cwArtwork===entry)return true;if(artworkObserver&&entry.holder.__cwArtwork===entry)artworkObserver.unobserve(entry.holder);return false;});}
    function scheduleArtwork(delay) {clearTimeout(artworkTimer);artworkTimer=setTimeout(loadArtwork,delay || 40);}
    function artworkKey(url,variant) {return (variant || "poster") + "|" + url;}
    function artworkSource(entry) {return String(entry.item[entry.variant==="backdrop"?"backdrop":"image"] || "");}
    function heroArtMode(entry,variant) {
        if(!entry.hero)return;
        var hero=entry.holder.closest(".hero");if(hero)hero.setAttribute("data-artwork-variant",variant);
    }
    function posterFallback(entry) {
        if(!entry.hero || entry.variant!=="backdrop")return false;
        entry.variant="poster";entry.done=false;entry.next=0;entry.attempts=0;
        if(entry.image && entry.image.__cwVariant!=="poster"){entry.image.remove();entry.image=null;}
        heroArtMode(entry,"poster");scheduleArtwork();return true;
    }
    function paintArtwork(entry,value) {
        var src=imageUrl(value.image);
        if(!src){if(posterFallback(entry))return;if(entry.image)entry.image.remove();entry.image=null;entry.fallback.hidden=false;return;}
        var variant=value.variant==="backdrop"?"backdrop":"poster";
        if(entry.image && entry.image.src===src){if(entry.image.complete && entry.image.naturalWidth)heroArtMode(entry,variant);return;}
        if(!entry.image){
            var image=el("img",entry.className);image.alt="";image.loading="lazy";image.decoding="async";image.referrerPolicy="no-referrer";
            image.addEventListener("load",function(){entry.fallback.hidden=true;heroArtMode(entry,image.__cwVariant);});
            image.addEventListener("error",function(){image.remove();entry.image=null;entry.fallback.hidden=false;artworkCache.delete(artworkKey(entry.item.url,entry.variant));if(posterFallback(entry))return;if(entry.attempts++<1){entry.done=false;entry.next=Date.now()+1000;scheduleArtwork(1000);}});
            entry.image=image;entry.holder.appendChild(image);
        }
        entry.image.__cwVariant=variant;
        entry.image.src=src;
        if(value.imageSource)entry.holder.setAttribute("data-artwork-source",value.imageSource);
    }
    function rememberArtwork(key,value,source) {
        artworkCache.delete(key);artworkCache.set(key,{value:value,source:source,expires:Date.now()+(value.image?300000:600000)});
        while(artworkCache.size>160)artworkCache.delete(artworkCache.keys().next().value);
        artworkEntries.forEach(function(entry){if(artworkKey(entry.item.url,entry.variant)===key&&artworkSource(entry)===source){entry.done=true;paintArtwork(entry,value);}});
    }
    function loadArtwork() {
        pruneArtwork();
        if(artworkBusy || document.hidden)return;
        var now=Date.now(),selected=[],seen=new Map(),next=Infinity;
        artworkEntries.forEach(function(entry){
            if(entry.done || !entry.visible)return;
            var key=artworkKey(entry.item.url,entry.variant),cached=artworkCache.get(key);
            if(cached && cached.expires>now && cached.source===artworkSource(entry)){entry.done=true;paintArtwork(entry,cached.value);return;}
            if(entry.next>now){next=Math.min(next,entry.next);return;}
            if(selected.length<12 && !seen.has(key)){var record={item:entry.item,variant:entry.variant,key:key,source:artworkSource(entry)};selected.push(record);seen.set(key,record);}
        });
        if(!selected.length){if(isFinite(next))scheduleArtwork(Math.max(40,next-now));return;}
        var generation=artworkGeneration;artworkBusy=true;
        request("artwork",{items:selected.map(function(record){var item=record.item,value={},fields=["url","title","kind","seriesUrl","image","imageSource","imageSourceUrl","imageAttribution"];if(record.variant==="backdrop"){value.variant="backdrop";fields=fields.concat(["backdrop","backdropSource","backdropSourceUrl","backdropAttribution"]);}fields.forEach(function(key){if(item[key]!==undefined)value[key]=item[key];});return value;})}).then(function(data){
            if(generation!==artworkGeneration)return;
            var found=new Set();
            (Array.isArray(data.items)?data.items:[]).forEach(function(value){var key=artworkKey(value.url,value.variant),record=seen.get(key);if(record){found.add(key);rememberArtwork(key,value,record.source);}});
            var pending=new Set(),legacyPending=new Set(),delay=Math.max(500,Math.min(3000,Number(data.retryAfter)||1000));
            (Array.isArray(data.pending)?data.pending:[]).forEach(function(value){if(typeof value==="string")legacyPending.add(value);else if(value&&value.url)pending.add(artworkKey(value.url,value.variant));});
            selected.forEach(function(record){if(found.has(record.key))return;if(pending.has(record.key)||legacyPending.has(record.item.url)){artworkEntries.forEach(function(entry){if(artworkKey(entry.item.url,entry.variant)===record.key)entry.next=Date.now()+delay;});}else rememberArtwork(record.key,{image:"",variant:record.variant},record.source);});
        }).catch(function(){if(generation===artworkGeneration)selected.forEach(function(record){rememberArtwork(record.key,{image:"",variant:record.variant},record.source);});}).then(function(){artworkBusy=false;scheduleArtwork(80);});
    }
    window.refreshThumbnails=function(){artworkGeneration++;artworkCache.clear();artworkEntries.forEach(function(entry){entry.done=false;entry.next=0;if(entry.hero)entry.variant="backdrop";});scheduleArtwork();};
    document.addEventListener("visibilitychange",function(){if(!document.hidden){scheduleArtwork();if(route==="home"&&document.getElementById("home-feature"))loadTrending(loadIndex);if(route==="home"||route==="genre")loadGenres();}});
    function timeText(seconds) {
        var minutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
        return minutes >= 60 ? Math.floor(minutes / 60) + "h " + minutes % 60 + "m" : minutes + " min";
    }
    function card(item, history) {
        var node = button("", "card " + (history || item.kind === "episode" ? "episode-card" : "poster-card"), function() {
            if (history) play(item, item); else showDetails(item);
        });
        node.setAttribute("aria-label", (history ? "Continue " : "Explore ") + item.title);
        var art = el("div", "card-image");
        addImage(art, item);
        art.appendChild(el("span", "card-tag", history ? "CONTINUE WATCHING" : item.kind || (/\bepisode\b/i.test(item.title) ? "Episode" : "Series")));
        var playMark = el("span", "card-play");
        playMark.appendChild(icon("play"));
        art.appendChild(playMark);
        var seconds = Number(item.positionSeconds || item.seconds || item.currentTime || item.position || 0);
        var duration = Number(item.durationSeconds || item.duration || 0);
        if (history && seconds > 0 && duration > 0) {
            var progress = el("span", "card-progress");
            var bar = el("span");
            bar.style.width = Math.min(100, seconds / duration * 100) + "%";
            progress.appendChild(bar);
            art.appendChild(progress);
        }
        node.appendChild(art);
        node.appendChild(el("div", "card-title", item.title));
        node.appendChild(el("div", "card-subtitle", provider(item.provider).name + (history && seconds > 0 ? " · " + timeText(seconds) + " watched" : item.kind ? " · " + item.kind : " · Explore episodes")));
        return node;
    }
    function shelf(title, items, history, action) {
        var root = el("section", "shelf");
        root.appendChild(rowHeading(title, items.length, action));
        var row = el("div", "cards-row");
        items.forEach(function(item) {
            row.appendChild(card(item, history));
        });
        root.appendChild(row);
        return root;
    }
    function browseCatalog() {
        query = ""; searchPage = null; searchOffset = 0; searchCategory = "all"; setRoute("search", true);
    }
    function homeFeatured() {
        if (trendingData.items.length) return trendingData.items[0];
        var saved = state.favorites[0] || state.history.filter(function(item) { return safeUrl(item.seriesUrl); })[0];
        return saved ? normalizeItem(Object.assign({}, saved, { title: saved.seriesTitle || saved.title, url: saved.seriesUrl || saved.url, kind: saved.kind === "episode" ? "series" : saved.kind })) : null;
    }
    function paintHero(root, item, ranked) {
        root.__cwFeatured = item;
        root.querySelector(".eyebrow").textContent = ranked ? "TRENDING THIS WEEK · WCO" : item ? "FROM YOUR LIST · READY TO EXPLORE" : "YOUR NEXT GOOD WATCH";
        root.querySelector("h1").textContent = item ? item.title : "Find your next favorite.";
        root.querySelector("p").textContent = item ? item.description || "Explore the episodes, add it to your list, and settle in for a good watch." : "See what's trending in anime, or find a favorite in the full WCO catalog.";
        root.querySelector(".primary span").textContent = item ? item.kind === "movie" ? "View movie" : "Explore episodes" : "Find a show";
        var favorite = root.querySelector(".secondary"); favorite.hidden = !item;
        if (item) updateFavoriteButton(favorite, item);
        var holder = root.querySelector(".hero-art-holder"), identity = item ? [item.url,item.image || "",item.backdrop || ""].join("|") : "";
        if (holder.__cwIdentity !== identity) {
            holder.__cwIdentity = identity; holder.textContent = ""; root.removeAttribute("data-artwork-variant");
            if (item) addImage(holder, item, "hero-art", "backdrop");
            clearTimeout(artworkPruneTimer); artworkPruneTimer = setTimeout(pruneArtwork, 0); scheduleArtwork();
        }
    }
    function hero(item, ranked) {
        var root = el("section", "hero");
        root.id = "home-feature";
        root.appendChild(el("div", "hero-geometry"));
        root.appendChild(el("div", "hero-art-holder"));
        root.appendChild(el("div", "hero-shade"));
        var copy = el("div", "hero-copy");
        copy.appendChild(el("span", "eyebrow"));
        copy.appendChild(el("h1"));
        copy.appendChild(el("p"));
        var actions = el("div", "actions");
        actions.appendChild(button("Find a show", "button primary", function() {
            if (root.__cwFeatured) showDetails(root.__cwFeatured); else browseCatalog();
        }, "play"));
        var favorite = button("", "button secondary", function() { if (root.__cwFeatured) toggleFavorite(root.__cwFeatured, favorite); });
        actions.appendChild(favorite);
        copy.appendChild(actions);
        root.appendChild(copy);
        root.appendChild(el("span", "hero-label", "A WORLD WORTH WATCHING"));
        paintHero(root, item, ranked);
        return root;
    }
    function trendingShelf() {
        if (!trendingData.items.length) return el("p", "trending-status", trendingLoaded ? "Weekly anime trends are unavailable right now. The WCO catalog is ready to browse." : "Loading this week's anime trends…");
        var root = shelf("Trending this week", trendingData.items, false), byline = "AniList community activity";
        root.classList.add("trending-shelf");
        var start = Date.parse(trendingData.periodStart), end = Date.parse(trendingData.periodEnd) - 1;
        if (isFinite(start) && isFinite(end) && end >= start) {
            var format = { month: "short", day: "numeric", timeZone: "UTC" };
            byline += " · " + new Date(start).toLocaleDateString(undefined, format) + "–" + new Date(end).toLocaleDateString(undefined, format);
        }
        if (trendingData.stale) byline += " · Cached ranking";
        root.insertBefore(el("p", "trending-meta", byline), root.querySelector(".cards-row"));
        root.querySelectorAll(".card-image").forEach(function(node, index) {
            var rank = Number(trendingData.items[index].trendRank);
            node.appendChild(el("span", "trend-rank", "#" + (isFinite(rank) && rank > 0 && rank <= 1000 ? Math.floor(rank) : index + 1)));
        });
        return root;
    }
    function homeAnchor() {
        var active = document.activeElement, anchored = content.contains(active), behavior = main.style.scrollBehavior;
        main.style.scrollBehavior = "auto"; main.scrollTop = main.scrollTop;
        var top = anchored ? active.getBoundingClientRect().top : 0, scroll = main.scrollTop;
        return function() {
            if (anchored && document.contains(active)) main.scrollTop += active.getBoundingClientRect().top - top; else main.scrollTop = scroll;
            main.style.scrollBehavior = behavior;
        };
    }
    function paintTrending() {
        var feature = document.getElementById("home-feature"), slot = document.getElementById("home-trending");
        if (!feature || !slot || route !== "home" || detailOpen) { homeTrendingDirty = true; return; }
        var restore = homeAnchor(), active = document.activeElement, item = homeFeatured();
        homeTrendingDirty = false;
        if (feature.contains(active) && (feature.__cwFeatured && feature.__cwFeatured.url || "") !== (item && item.url || "")) homeTrendingDirty = true;
        else paintHero(feature, item, !!trendingData.items.length);
        if (slot.__cwVersion !== trendingVersion) {
            if (slot.contains(active)) homeTrendingDirty = true;
            else { slot.textContent = ""; slot.appendChild(trendingShelf()); slot.__cwVersion = trendingVersion; }
        }
        restore();
    }
    function loadTrending(token) {
        if (trendingLoaded && Date.now() < trendingNext) return;
        if (!trendingPending) trendingPending = request("trending", {}).catch(function() { return { items: [], available: false }; }).then(function(data) { trendingPending = null; return data; });
        trendingPending.then(function(data) {
            if (token !== loadIndex || route !== "home") return;
            var items = feedItems(data);
            var next = Object.assign({}, data, { items: items }), changed = !trendingLoaded || JSON.stringify(next) !== JSON.stringify(trendingData);
            trendingData = next; trendingLoaded = true;
            trendingNext = Date.now() + (items.length && !data.stale ? 300000 : 60000);
            if (changed) { trendingVersion++; if (detailOpen) homeTrendingDirty = true; else paintTrending(); }
        });
    }
    function genreLabel(type) {
        var state = genreDomains[type], category = discoveryCategories.filter(function(value) { return value.key === state.key && value.type === type; })[0];
        return category ? category.label : type === "anime" ? "Isekai" : "Cartoon essentials";
    }
    function feedItems(data, limit) {
        return data.available === false ? [] : itemsFrom(data).filter(function(item) { return /^https:\/\/(?:www\.)?(?:wco\.tv|wcostream\.tv)\//i.test(item.url); }).slice(0, limit || 20);
    }
    function genreResults(type, grid) {
        var root = el("div"), data = genreDomains[type].data, label = genreLabel(type), byline = type === "anime" ? "All-time popular · " + label + " · AniList list popularity" : "Community ratings · " + label + " · TVmaze";
        var snapshot = Date.parse(data.snapshotAt);
        if (type === "cartoons" && isFinite(snapshot)) byline += " · Snapshot " + new Date(snapshot).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
        root.appendChild(el("p", "trending-meta", byline + (data.stale ? " · Cached ranking" : "") + (grid && data.items.length ? " · " + data.items.length + " available WCO matches" : "")));
        if (!data.items.length) {
            root.appendChild(el("p", "trending-status", data.available === false ? label + " rankings are unavailable right now." : "Loading " + label.toLowerCase() + "…"));
            return root;
        }
        var row = el("div", grid ? "grid genre-grid" : "cards-row");
        data.items.forEach(function(item, index) {
            var node = card(item, false), rank = Number(item.trendRank);
            node.querySelector(".card-image").appendChild(el("span", "trend-rank", "#" + (isFinite(rank) && rank > 0 && rank <= 1000 ? Math.floor(rank) : index + 1)));
            row.appendChild(node);
        });
        root.appendChild(row);
        return root;
    }
    function genreSelect(type) {
        var select = el("select"), state = genreDomains[type];
        select.setAttribute("aria-label", type === "anime" ? "Anime category" : "Cartoon collection");
        discoveryCategories.filter(function(value) { return value.type === type; }).forEach(function(value) { var option = el("option", "", value.label); option.value = value.key; select.appendChild(option); });
        select.value = state.key;
        select.addEventListener("change", function() {
            state.key = select.value; state.data = state.cache[state.key] ? state.cache[state.key].data : { items: [] }; state.version++;
            select.focus(); paintGenre(type); loadGenre(type);
        });
        return select;
    }
    function genreSection(type) {
        var root = el("section", "shelf genre-shelf"), controls = el("div", "genre-controls"), state = genreDomains[type];
        root.setAttribute("data-discovery-domain", type); controls.appendChild(genreSelect(type));
        if (!state.viewAll) {
            state.viewAll = button("View all", "text-button", function() {
                genreDomain = type; state.homeScroll = main.scrollTop; state.homeTop = state.viewAll.getBoundingClientRect().top; setRoute("genre", true);
            });
            state.viewAll.id = type === "anime" ? "genre-view-all" : "cartoon-view-all";
        }
        controls.appendChild(state.viewAll);
        root.appendChild(rowHeading(type === "anime" ? "Anime categories" : "Cartoon collections", undefined, controls));
        var results = el("div"); results.id = type === "anime" ? "home-genre-results" : "home-cartoon-results"; results.__cwVersion = state.version; results.appendChild(genreResults(type)); root.appendChild(results); state.dirty = false;
        return root;
    }
    function renderGenre() {
        content.textContent = "";
        var title = intro(genreLabel(genreDomain) + (genreDomain === "anime" ? " anime" : ""), genreDomain === "anime" ? "Explore the top available WCO matches, ranked by AniList community list popularity." : "A curated WCO cartoon collection, ordered by TVmaze community ratings."); title.id = "genre-intro"; content.appendChild(title);
        var toolbar = el("div", "toolbar genre-toolbar");
        toolbar.appendChild(button("Back to Home", "button secondary", function() { setRoute("home", false, true); }, "back"));
        toolbar.appendChild(genreSelect(genreDomain)); content.appendChild(toolbar);
        var state = genreDomains[genreDomain], results = el("div"); results.id = "genre-grid-results"; results.__cwVersion = state.version; results.appendChild(genreResults(genreDomain, true)); content.appendChild(results); state.dirty = false;
        loadGenre(genreDomain);
    }
    function paintGenre(type) {
        var state = genreDomains[type], slot = document.getElementById(route === "genre" ? "genre-grid-results" : type === "anime" ? "home-genre-results" : "home-cartoon-results");
        if (!slot || !genreVisible(type) || detailOpen || slot.contains(document.activeElement)) { state.dirty = true; return; }
        state.dirty = false;
        if (slot.__cwVersion === state.version) return;
        var restore = homeAnchor();
        slot.textContent = ""; slot.appendChild(genreResults(type, route === "genre")); slot.__cwVersion = state.version;
        if (route === "genre") document.querySelector("#genre-intro h1").textContent = genreLabel(type) + (type === "anime" ? " anime" : "");
        restore();
        clearTimeout(artworkPruneTimer); artworkPruneTimer = setTimeout(pruneArtwork, 0); scheduleArtwork();
    }
    function genreVisible(type) { return route === "home" || route === "genre" && genreDomain === type; }
    function paintGenres() { Object.keys(genreDomains).forEach(function(type) { if (genreDomains[type].dirty && genreVisible(type)) paintGenre(type); }); }
    function loadGenres() { if (route === "home") { loadGenre("cartoons"); loadGenre("anime"); } else if (route === "genre") loadGenre(genreDomain); }
    function loadGenre(type) {
        if (!genreVisible(type)) return;
        var state = genreDomains[type], key = state.key, cached = state.cache[key];
        if (cached && Date.now() < cached.next) {
            if (state.data !== cached.data) { state.data = cached.data; state.version++; paintGenre(type); }
            return;
        }
        if (genrePending) { genreQueued[type] = true; return; }
        genrePending = { type: type, key: key };
        request("trending", { genre: key }).catch(function() { return { items: [], available: false }; }).then(function(data) {
            genrePending = null;
            var items = data.genre === key && data.type === type && data.metric === (type === "anime" ? "popularity" : "rating") ? feedItems(data, 50) : []; data = Object.assign({}, data, { items: items, available: !!items.length });
            state.cache[key] = { data: data, next: Date.now() + (data.items.length && !data.stale ? 300000 : 60000) };
            if (state.key === key) { var changed = JSON.stringify(state.data) !== JSON.stringify(data); state.data = data; if (changed) { state.version++; if (detailOpen || !genreVisible(type)) state.dirty = true; else paintGenre(type); } }
            else if (genreVisible(type)) genreQueued[type] = true;
            Object.keys(genreQueued).forEach(function(queued) { delete genreQueued[queued]; loadGenre(queued); });
        });
    }
    function discoveryShortcuts() {
        var root = el("div", "discovery-shortcuts");
        [["Anime", "Anime category"], ["Cartoons", "Cartoon collection"]].forEach(function(value) { root.appendChild(button(value[0], "button secondary", function() { document.querySelector('[aria-label="' + value[1] + '"]').focus(); })); });
        root.appendChild(button("Movies", "button secondary", function() { query = ""; searchPage = null; searchOffset = 0; searchCategory = "Movies"; setRoute("search", true); }));
        return root;
    }
    function renderHome(data) {
        content.textContent = "";
        content.appendChild(discoveryShortcuts());
        if (catalog.length) {
            content.appendChild(hero(homeFeatured(), !!trendingData.items.length));
        } else {
            var nativeMessage = nativeAvailable() ? "The catalog is still getting ready. Try again in a moment." : "Install Cartoon Watch on your Fire TV to browse its WCO catalog and play videos.";
            var homeAlternatives = [ button("Try again", "button primary", loadHome, "refresh"), sourceButton("wco") ];
            content.appendChild(emptyBox(nativeAvailable() ? "This source needs a moment." : "Your couch. Your cartoons.", nativeMessage, "screen", homeAlternatives, data && data.error));
        }
        if (state.history.length) content.appendChild(shelf("Recently watched", state.history.slice(0, 16), true));
        var trendingSlot = el("div"); trendingSlot.id = "home-trending"; content.appendChild(trendingSlot); homeTrendingDirty = false; paintTrending();
        content.appendChild(genreSection("anime")); content.appendChild(genreSection("cartoons"));
        if (catalog.length) {
            var browse = button("Browse all titles", "text-button", browseCatalog, "search");
            content.appendChild(shelf("From the WCO catalog", catalog.slice(0, 30), false, browse));
            if (catalog.length > 30) content.appendChild(shelf("More to explore", catalog.slice(30, pageSize), false));
        }
        if (state.favorites.length) content.appendChild(shelf("Your watch list", state.favorites.slice(0, 16), false, button("View My List", "text-button", function() {
            setRoute("list", true);
        }, "list")));
        if (!catalog.length) {
            content.appendChild(el("p", "source-unavailable", "Playback fallbacks are selected automatically when a WCO video cannot start."));
        }
        var last = el("div", "source-unavailable", "Other sources are tried automatically if playback stalls. Resume and intro skipping are available where the player supports them.");
        content.appendChild(last);
    }
    function loadHome() {
        var token = ++loadIndex;
        var id = currentProvider;
        loading(content, "Opening the WCO catalog…");
        loadTrending(token); loadGenres();
        request("home", {
            provider: id
        }).then(function(data) {
            if (token !== loadIndex || route !== "home") return;
            catalog = itemsFrom(data);
            if (data.indexed || data.total !== undefined) {
                catalogInfo = Object.assign({}, catalogInfo, data, {
                    items: undefined
                });
                renderStatus();
            }
            renderHome(data);
        }).catch(function(error) {
            if (token !== loadIndex || route !== "home") return;
            catalog = [];
            renderHome({
                error: error.message
            });
        });
    }
    function makeSort(value, handler, episode) {
        var select = el("select");
        select.setAttribute("aria-label", episode ? "Episode order" : "Sort titles");
        var values = episode ? [ [ "source", "Source order" ], [ "newest", "Newest first" ], [ "oldest", "Oldest first" ] ] : [ [ "recent", "Source order" ], [ "az", "Title: A–Z" ], [ "za", "Title: Z–A" ] ];
        values.forEach(function(entry) {
            var option = el("option", "", entry[1]);
            option.value = entry[0];
            select.appendChild(option);
        });
        select.value = value;
        select.addEventListener("change", function() {
            handler(select.value);
        });
        return select;
    }
    function sorted(items, mode) {
        var result = items.slice();
        if (mode === "az" || mode === "za") result.sort(function(a, b) {
            return a.title.localeCompare(b.title, undefined, {
                numeric: true,
                sensitivity: "base"
            }) * (mode === "za" ? -1 : 1);
        });
        return result;
    }
    function renderGrid(root, items, history) {
        var grid = el("div", "grid");
        items.forEach(function(item) {
            grid.appendChild(card(item, history));
        });
        root.appendChild(grid);
    }
    function searchForm() {
        var form = el("form", "search-form");
        var field = el("div", "search-field");
        field.appendChild(icon("search"));
        var input = el("input");
        input.type = "search";
        input.id = "search-input";
        input.placeholder = "Find a show, movie, or episode";
        input.value = query;
        input.autocomplete = "off";
        input.maxLength = 180;
        input.setAttribute("aria-label", "Search WCO catalog");
        field.appendChild(input);
        form.appendChild(field);
        var submit = button("Search", "button primary", null, "search");
        submit.type = "submit";
        form.appendChild(submit);
        form.addEventListener("submit", function(event) {
            event.preventDefault();
            input.blur();
            runSearch(input.value.trim());
        });
        return form;
    }
    function renderSearch() {
        content.textContent = "";
        content.appendChild(intro("The full WCO catalog.", (catalogInfo.total ? catalogInfo.total.toLocaleString() + " indexed titles. " : "") + "Search a title or browse by category."));
        var toolbar = el("div", "toolbar");
        toolbar.appendChild(searchForm());
        content.appendChild(toolbar);
        var filters = el("div", "catalog-filters");
        var category = el("select");
        category.id = "catalog-category";
        category.setAttribute("aria-label", "Catalog category");
        [ [ "all", "All categories" ] ].concat(catalogInfo.categories.map(function(value) {
            return [ value, value ];
        })).forEach(function(entry) {
            var option = el("option", "", entry[1]);
            option.value = entry[0];
            category.appendChild(option);
        });
        category.value = searchCategory;
        category.addEventListener("change", function() {
            searchCategory = category.value;
            runSearch(query);
        });
        filters.appendChild(category);
        filters.appendChild(makeSort(searchOrder === "source" ? "recent" : searchOrder, function(value) {
            searchOrder = value === "recent" ? "source" : value;
            runSearch(query);
        }));
        filters.appendChild(el("span", "catalog-filter-note", "Automatic playback fallbacks"));
        content.appendChild(filters);
        var results = el("div");
        results.id = "search-results";
        content.appendChild(results);
        if (searchPage) renderSearchResults(results, searchPage); else runSearch(query, true, searchOffset);
    }
    function renderSearchResults(root, data) {
        root.textContent = "";
        if (!searchResults.length) {
            root.appendChild(emptyBox(data.error ? "The catalog could not load." : "No matches this time.", "Try fewer words, another spelling, or a different category.", "search", [ button("Browse all titles", "button secondary", function() {
                query = "";
                searchCategory = "all";
                searchPage = null;
                searchOffset = 0;
                renderSearch();
            }, "search") ], data.error));
            return;
        }
        var total = Number(data.total) || searchResults.length;
        var offset = Math.max(0, Number(data.offset) || 0);
        var filter = el("div", "filter-bar");
        filter.appendChild(el("p", "catalog-result-count", (offset + 1).toLocaleString() + "–" + (offset + searchResults.length).toLocaleString() + " of " + total.toLocaleString() + (query ? " matching “" + query + "”" : " titles")));
        root.appendChild(filter);
        renderGrid(root, searchResults.slice(0, pageSize), false);
        if (offset || data.hasMore || offset + searchResults.length < total) {
            var pages = el("div", "catalog-pager");
            var previous = button("Previous", "button secondary", function() {
                runSearch(query, false, Math.max(0, offset - pageSize));
            }, "back");
            previous.id = "catalog-previous";
            previous.disabled = offset === 0;
            pages.appendChild(previous);
            pages.appendChild(el("span", "", "Page " + (Math.floor(offset / pageSize) + 1) + " of " + Math.ceil(total / pageSize)));
            var next = button("Next", "button secondary", function() {
                runSearch(query, false, offset + pageSize);
            });
            next.id = "catalog-next";
            next.disabled = !(data.hasMore || offset + searchResults.length < total);
            pages.appendChild(next);
            root.appendChild(pages);
        }
    }
    function runSearch(value, fromRender, offset) {
        query = String(value || "").trim();
        searchOffset = Math.max(0, Number(offset) || 0);
        searchResults = [];
        searchPage = null;
        if (!fromRender) {
            var input = document.getElementById("search-input");
            if (input) input.value = query;
        }
        var root = document.getElementById("search-results");
        if (!root) return;
        var token = ++loadIndex;
        loading(root, query ? "Searching the WCO catalog…" : "Opening the full catalog…");
        request("catalog", {
            query: query,
            category: searchCategory,
            sort: searchOrder,
            offset: searchOffset,
            limit: pageSize
        }).then(function(data) {
            if (token !== loadIndex || route !== "search") return;
            searchResults = itemsFrom(data).slice(0, pageSize);
            searchPage = data;
            renderSearchResults(root, data);
            var first = root.querySelector("button.card");
            if (first && !fromRender) first.focus();
        }).catch(function(error) {
            if (token !== loadIndex || route !== "search") return;
            renderSearchResults(root, {
                error: error.message
            });
        });
    }
    function renderList() {
        content.textContent = "";
        content.appendChild(intro("Good things, saved.", "Your favorites from every source, all in one place. Your list stays on this TV."));
        if (!state.favorites.length) {
            content.appendChild(emptyBox("Make yourself a watch list.", "Open a title and choose My List. It will be waiting here whenever you are.", "list", [ button("Explore titles", "button primary", function() {
                setRoute("home", true);
            }, "home") ]));
            return;
        }
        var filter = el("div", "filter-bar");
        filter.appendChild(el("p", "", state.favorites.length + " saved " + (state.favorites.length === 1 ? "title" : "titles")));
        filter.appendChild(makeSort(listSort, function(value) {
            listSort = value;
            renderList();
        }));
        content.appendChild(filter);
        renderGrid(content, sorted(state.favorites, listSort), false);
    }
    function settingRow(title, description, control) {
        var row = el("div", "setting-row");
        var copy = el("div");
        copy.appendChild(el("h2", "", title));
        copy.appendChild(el("p", "", description));
        row.appendChild(copy);
        row.appendChild(control);
        return row;
    }
    function renderSettings() {
        content.textContent = "";
        content.appendChild(intro("A better seat in the house.", "A few small settings for a more comfortable watch."));
        var panel = el("div", "settings-panel");
        var toggle = button("", "toggle" + (state.settings.adBlock ? " on" : ""), function() {
            state.settings.adBlock = !state.settings.adBlock;
            toggle.classList.toggle("on", !!state.settings.adBlock);
            toggle.setAttribute("aria-checked", String(!!state.settings.adBlock));
            request("settings", {
                adBlock: !!state.settings.adBlock
            }).then(function(data) {
                if (data.error) toast(data.error);
            }).catch(function(error) {
                toast(error.message);
            });
            saveState();
            renderStatus();
            toast(state.settings.adBlock ? "Ad protection enabled" : "Ad protection disabled for troubleshooting");
        });
        toggle.setAttribute("role", "switch");
        toggle.setAttribute("aria-label", "Ad protection");
        toggle.setAttribute("aria-checked", String(!!state.settings.adBlock));
        panel.appendChild(settingRow("Ad protection", "Reduce known ad and tracking requests. If a video will not play, try turning this off and reopening the player.", toggle));
        var sourceSelect = el("select");
        sourceSelect.setAttribute("aria-label", "Source browser");
        PROVIDERS.forEach(function(item) {
            var option = el("option", "", item.name);
            option.value = item.id;
            sourceSelect.appendChild(option);
        });
        sourceSelect.value = state.settings.browserProvider || "wco";
        sourceSelect.addEventListener("change", function() {
            state.settings.browserProvider = sourceSelect.value;
            saveState();
        });
        panel.appendChild(settingRow("Playback fallbacks", "WCO is the catalog. Other sources are tried automatically when its video cannot play.", sourceSelect));
        var clear = button("Clear history", "button secondary", function() {
            state.history = [];
            window.refreshThumbnails();
            request("clearHistory",{}).catch(function(){toast("Could not clear the saved episode images.");});
            saveState();
            historyDirty = true;
            toast("Watch history cleared on this TV");
        }, "refresh");
        panel.appendChild(settingRow("Watch history", "Recently opened episodes and available playback progress are stored on this TV.", clear));
        panel.appendChild(settingRow("Thumbnails", "Small series covers. Watched episodes use a private snapshot saved on pause or exit; missing captures use the series cover.", el("span","setting-value","Low resolution")));
        var credits=el("div","artwork-credits");credits.hidden=true;
        var creditsButton=button("View credits","button secondary",function(){credits.hidden=!credits.hidden;creditsButton.setAttribute("aria-expanded",String(!credits.hidden));});
        creditsButton.setAttribute("aria-expanded","false");
        panel.appendChild(settingRow("Artwork credits", "TVmaze and anime-offline-database provide cover metadata. Artwork belongs to its original owners.",creditsButton));
        ["TVmaze: https://www.tvmaze.com/api","TVmaze data: CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/","anime-offline-database: https://github.com/cedya77/anime-offline-database — continuation of https://github.com/manami-project/anime-offline-database","Adapted anime artwork mappings: ODbL 1.0 — https://opendatacommons.org/licenses/odbl/1.0/ ; DbCL 1.0 — https://opendatacommons.org/licenses/dbcl/1.0/","Episode snapshots remain private on this device."].forEach(function(line){credits.appendChild(el("p","",line));});
        panel.appendChild(credits);
        panel.appendChild(settingRow("Source browser", "Open the selected original website when needed.", button("Open browser", "button secondary", function() {
            openSource(sourceSelect.value);
        }, "open")));
        panel.appendChild(settingRow("Cartoon Watch", "Built for Fire TV. No Cartoon Watch account is required.", el("span", "setting-value", "Version 0.4.0")));
        content.appendChild(panel);
        content.appendChild(el("p", "settings-note", "Cartoon Watch is an independent browser and catalog interface. Availability, ads, playback, and any access requirements are controlled by each source. Progress is saved when the embedded player makes it available."));
    }
    function showDetails(item) {
        item = normalizeItem(item);
        if (!item) {
            toast("This source link is not supported.");
            return;
        }
        returnFocus = document.activeElement;
        detailOpen = true;
        currentDetail = item;
        detailLayer.hidden = false;
        detailLayer.scrollTop = 0;
        var token = ++detailIndex;
        renderDetailLoading(item);
        return request("details", {
            provider: item.provider,
            url: item.url
        }).then(function(data) {
            if (token !== detailIndex || !detailOpen) return;
            var normalized = normalizeItem(Object.assign({}, item, data, {
                title: data.title || item.title,
                image: item.image || data.image,
                description: data.description || item.description,
                url: item.url,
                provider: item.provider,
                kind: item.kind === "movie" ? "movie" : data.kind || item.kind
            }));
            if (!normalized) return;
            normalized.episodes = (Array.isArray(data.episodes) ? data.episodes : []).map(function(episode) {
                return normalizeItem(Object.assign({}, episode, {
                    provider: item.provider,
                    kind:"episode",
                    seriesTitle:normalized.title,
                    seriesUrl:normalized.url,
                    image:normalized.image,
                    imageSource:normalized.imageSource || (normalized.image?"WCO":""),
                    imageSourceUrl:normalized.imageSourceUrl || normalized.url,
                    imageAttribution:normalized.imageAttribution || "Artwork provided by WCO"
                }));
            }).filter(Boolean);
            normalized.genres = Array.isArray(data.genres) ? data.genres : [];
            normalized.error = data.error;
            currentDetail = normalized;
            renderDetail(normalized);
            return normalized;
        }).catch(function(error) {
            if (token !== detailIndex || !detailOpen) return;
            currentDetail = Object.assign({}, item, {
                episodes: [],
                error: error.message
            });
            renderDetail(currentDetail);
            return currentDetail;
        });
    }
    function detailTopbar(item) {
        var top = el("div", "detail-topbar");
        top.appendChild(button("Back to browsing", "text-button", function() {
            closeDetails(true);
        }, "back"));
        top.appendChild(el("span", "detail-source", provider(item.provider).name));
        return top;
    }
    function renderDetailLoading(item) {
        detailLayer.textContent = "";
        detailLayer.appendChild(detailTopbar(item));
        var target = el("div");
        loading(target, "Finding episodes…");
        detailLayer.appendChild(target);
        detailLayer.querySelector("button").focus();
    }
    function renderDetail(item) {
        detailLayer.textContent = "";
        detailLayer.appendChild(detailTopbar(item));
        var introNode = el("div", "detail-intro");
        var art = el("div", "detail-poster");
        addImage(art, item);
        introNode.appendChild(art);
        var copy = el("div", "detail-info");
        copy.appendChild(el("div", "eyebrow", "YOUR NEXT GOOD WATCH"));
        copy.appendChild(el("h1", "", item.title));
        if (item.genres && item.genres.length) {
            var genres = el("div", "genre-list");
            item.genres.slice(0, 9).forEach(function(genre) {
                genres.appendChild(el("span", "", genre));
            });
            copy.appendChild(genres);
        }
        if (item.description) copy.appendChild(el("p", "", item.description)); else copy.appendChild(el("p", "", item.kind === "movie" ? "Start the movie, or explore its source page." : "Choose an episode below, or open the source page to explore this title."));
        var actions = el("div", "actions");
        actions.appendChild(button(item.kind === "movie" ? "Watch movie" : item.episodes && item.episodes.length ? "Choose an episode" : "Open player", "button primary", function() {
            if (item.kind === "movie") play(item, item); else if (item.episodes && item.episodes.length) {
                var episode = detailLayer.querySelector(".episode");
                if (episode) episode.focus();
            } else play(item, item);
        }, "play"));
        actions.appendChild(favoriteButton(item));
        actions.appendChild(button("Source page", "button secondary", function() {
            openSource(item.provider, item.url);
        }, "open"));
        copy.appendChild(actions);
        introNode.appendChild(copy);
        detailLayer.appendChild(introNode);
        if (item.error) detailLayer.appendChild(el("p", "inline-note", "The source did not provide a complete episode list. The source browser may still work. " + String(item.error).slice(0, 160)));
        if (item.kind !== "movie" && item.episodes && item.episodes.length) renderEpisodes(item); else if (item.kind !== "movie") detailLayer.appendChild(emptyBox("Open this title’s player.", "The episode list could not load. Playback will use an automatic fallback if the WCO player cannot start.", "screen", [ button("Open player", "button primary", function() {
            play(item, item);
        }, "play") ]));
        var first = detailLayer.querySelector(".detail-info .button");
        if (first) first.focus();
    }
    function renderEpisodes(item) {
        var head = rowHeading("Episodes", item.episodes.length);
        head.classList.add("episodes-head");
        var tools = el("div", "episode-toolbar");
        var field = el("div", "search-field");
        field.appendChild(icon("search"));
        var input = el("input");
        input.type = "search";
        input.placeholder = "Find an episode";
        input.setAttribute("aria-label", "Filter episodes");
        field.appendChild(input);
        tools.appendChild(field);
        var order = "source";
        var sortSelect = makeSort(order, function(value) {
            order = value;
            draw();
        }, true);
        tools.appendChild(sortSelect);
        head.lastChild.remove();
        head.appendChild(tools);
        detailLayer.appendChild(head);
        var count = el("div", "result-counter");
        detailLayer.appendChild(count);
        var grid = el("div", "episodes-grid");
        detailLayer.appendChild(grid);
        function draw() {
            grid.textContent = "";
            var needle = input.value.toLowerCase().trim();
            var episodes = item.episodes.filter(function(episode) {
                return episode.title.toLowerCase().indexOf(needle) >= 0;
            });
            if (order !== "source") episodes = episodes.slice().sort(function(a, b) {
                return a.title.localeCompare(b.title, undefined, {
                    numeric: true,
                    sensitivity: "base"
                }) * (order === "newest" ? -1 : 1);
            });
            count.textContent = episodes.length + (episodes.length === 1 ? " episode" : " episodes") + (needle ? " matching “" + input.value + "”" : " available");
            episodes.forEach(function(episode, index) {
                var node = button("", "episode", function() {
                    play(episode, item);
                });
                var match = episode.title.match(/(?:episode|\bep\.?|\be)\s*(\d+(?:\.\d+)?)/i);
                var art=el("span","episode-art");addImage(art,episode);node.appendChild(art);
                node.appendChild(el("span", "episode-number", match ? match[1] : (index < 9 ? "0" : "") + String(index + 1)));
                node.appendChild(el("span", "episode-label", episode.title));
                node.appendChild(icon("play"));
                grid.appendChild(node);
            });
            if (!episodes.length) grid.appendChild(el("p", "source-unavailable", "No episodes match this filter."));
        }
        input.addEventListener("input", draw);
        draw();
    }
    function closeDetails(restore) {
        detailOpen = false;
        detailIndex++;
        currentDetail = null;
        detailLayer.hidden = true;
        detailLayer.textContent = "";
        if (route === "home" && historyDirty) {
            historyDirty = false;
            renderHome({
                items: catalog
            });
        }
        if (route === "list") renderList();
        if (restore) {
            if (returnFocus && document.contains(returnFocus)) returnFocus.focus(); else focusContent();
            if (route === "home" && homeTrendingDirty) paintTrending();
            if (route === "home" || route === "genre") paintGenres();
        }
    }
    function play(episode, series) {
        var item = normalizeItem(episode);
        if (!item) {
            toast("This player link is not supported.");
            return;
        }
        var old = state.history.filter(function(entry) {
            return entry.url === item.url && entry.provider === item.provider;
        })[0] || {};
        var payload = Object.assign({}, item, {
            seriesTitle: series.seriesTitle || series.title || item.title,
            seriesUrl: safeUrl(series.seriesUrl || series.url || item.url),
            image: item.image || series.image || "",
            resumeSeconds: Number(old.positionSeconds || old.seconds || old.currentTime || old.position || 0)
        });
        recordPlayback(Object.assign({}, old, payload, {
            watchedAt: Date.now()
        }));
        return request("play", payload).then(function(data) {
            if (data.error) toast(data.error);
            return data;
        }).catch(function(error) {
            toast(error.message);
        });
    }
    function recordPlayback(value) {
        try {
            var input = typeof value === "string" ? JSON.parse(value) : value;
            var item = normalizeItem(input);
            if (!item) return;
            var previous = state.history.filter(function(entry) {
                return entry.url === item.url && entry.provider === item.provider;
            })[0] || {};
            var updated = Object.assign({}, previous, item, {
                watchedAt: Number(item.watchedAt || Date.now())
            });
            state.history = state.history.filter(function(entry) {
                return entry.url !== item.url || entry.provider !== item.provider;
            });
            state.history.unshift(updated);
            state.history = state.history.slice(0, 80);
            historyDirty = true;
            saveState();
            if (!detailOpen && route === "home" && !document.hidden) {
                renderHome({
                    items: catalog
                });
                historyDirty = false;
            }
        } catch (error) {}
    }
    window.recordPlayback = recordPlayback;
    window.onPlaybackProgress = recordPlayback;
    function voiceTitleKey(value) {
        return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\((?:19|20)\d{2}\)/g, "").replace(/\b(?:english\s+)?(?:dubbed|subbed|sub|dub)\b/gi, "").toLowerCase().replace(/[\s.,:;!?\x22'()[\]{}\/\\+&_–—-]+/g, " ").trim();
    }
    function voiceEpisodeNumber(item) {
        if (item.number!==undefined && isFinite(Number(item.number))) return Number(item.number);
        var value=(item.title || "")+" "+(item.url || ""), match=value.match(/(?:episode|\bep\.?)[\s._-]*(\d+(?:\.\d+)?)/i);
        if (!match) match=value.match(/\/(\d+)-(\d+)(?:\/|$)/);
        return match?Number(match[2] || match[1]):null;
    }
    function voiceSeason(item) {
        var value=String(item.season || ""), match=value.match(/^(?:s)?(\d+)$/i);
        if (match) return Number(match[1]);
        match=((item.title || "")+" "+(item.url || "")).match(/(?:season|\bs)[\s._-]*(\d+)/i);
        if (!match) match=String(item.url || "").match(/\/(\d+)-\d+(?:\/|$)/);
        return match?Number(match[1]):null;
    }
    function voicePickEpisode(detail,command) {
        if (!detail || !Array.isArray(detail.episodes)) throw new Error("Open a show before choosing an episode.");
        var matches=detail.episodes.filter(function(item){return voiceEpisodeNumber(item)===Number(command.episode) && (command.season===null || voiceSeason(item)===Number(command.season) || voiceSeason(item)===null && Number(command.season)===1);});
        if (matches.length!==1) throw new Error(matches.length?"Say the season and episode so I can choose the right one.":"That episode is not in this show's current list.");
        return play(matches[0],detail).then(function(){return {ok:true,action:"play",title:detail.title,episode:Number(command.episode)};});
    }
    function voiceCatalog(command) {
        if (detailOpen) closeDetails(false);
        query=command.query===undefined?query:command.query;
        searchCategory=command.category || searchCategory;
        searchOrder=command.sort || searchOrder;searchOffset=0;
        setRoute("search",true);
        return {ok:true,action:"catalog",query:query,category:searchCategory,sort:searchOrder};
    }
    function voiceExecute(value) {
        var command=typeof value==="string"?window.CartoonVoice.parse(value):value;
        if (!command || command.action==="unknown") throw new Error("Try show cartoons, search for Naruto, play episode three, or skip intro.");
        if (command.action==="catalog" || command.action==="sort") return voiceCatalog(command);
        if (command.action==="home") {if(detailOpen)closeDetails(false);setRoute("home",true);return {ok:true,action:"home"};}
        if (command.action==="back") return {ok:window.handleBack(),action:"back"};
        if (command.action==="control") return request("control",command).then(function(result){if(result.error)throw new Error(result.error);return {ok:true,action:"control",command:command.command};});
        if (command.action==="episode") return voicePickEpisode(currentDetail,command);
        if (command.action==="title") {
            return request("catalog",{query:command.title.replace(/\((?:19|20)\d{2}\)/g, "").trim(),category:"all",sort:"az",offset:0,limit:60}).then(function(data){
                if(data.error)throw new Error(data.error);
                var target=voiceTitleKey(command.title), year=command.title.match(/\((19\d{2}|20\d{2})\)/);
                var choices=itemsFrom(data).filter(function(item){var itemYear=item.title.match(/\((19\d{2}|20\d{2})\)/);return voiceTitleKey(item.title)===target && !(year && itemYear && year[1]!==itemYear[1]);});
                if(choices.length!==1){voiceCatalog({query:command.title,category:"all"});throw new Error(choices.length?"More than one title matches. Choose the correct one on the TV.":"I could not find that exact title. Choose from the search results.");}
                return showDetails(choices[0]).then(function(detail){
                    if(!detail || detail.error)throw new Error("The show's episode list could not load.");
                    if(command.episode!==null)return voicePickEpisode(detail,command);
                    if(detail.kind==="movie")return play(detail,detail).then(function(){return {ok:true,action:"play",title:detail.title};});
                    return {ok:true,action:"details",title:detail.title};
                });
            });
        }
        throw new Error("That command is not available.");
    }
    var voiceQueue=Promise.resolve();
    window.runVoiceCommand=function(value){
        var run=function(){return Promise.resolve().then(function(){return voiceExecute(value);}).catch(function(error){toast(error.message);return {ok:false,error:error.message};});};
        voiceQueue=voiceQueue.then(run,run);return voiceQueue;
    };
    window.refreshState = function() {
        request("getState", {}).then(function(data) {
            adoptState(data);
            renderStatus();
            if (!detailOpen) {
                if (route === "home") {
                    renderHome({ items: catalog }); loadTrending(loadIndex); loadGenres();
                } else if (route === "genre") loadGenres(); else if (route === "list") renderList();
            }
        }).catch(function() {});
    };
    window.handleBack = function() {
        if (detailOpen) {
            closeDetails(true);
            return true;
        }
        if (route === "genre") {
            setRoute("home", false, true);
            return true;
        }
        if (route !== "home") {
            setRoute("home", true);
            return true;
        }
        var focused = document.activeElement;
        if (focused && !focused.classList.contains("nav-button")) {
            var homeNav = document.querySelector('[data-route="home"]');
            homeNav.focus();
            main.scrollTop = 0;
            return true;
        }
        return false;
    };
    function focusableElements() {
        var scope = detailOpen ? detailLayer : document;
        return Array.prototype.slice.call(scope.querySelectorAll('button,input,select,a[href],[tabindex="0"]')).filter(function(node) {
            return !node.disabled && !node.hidden && node.getClientRects().length && getComputedStyle(node).visibility !== "hidden";
        });
    }
    function moveFocus(direction) {
        var nodes = focusableElements();
        if (!nodes.length) return;
        var focused = document.activeElement;
        if (nodes.indexOf(focused) < 0) {
            nodes[0].focus();
            return;
        }
        var current = focused.getBoundingClientRect();
        var cx = current.left + current.width / 2;
        var cy = current.top + current.height / 2;
        var horizontal = direction === "ArrowLeft" || direction === "ArrowRight";
        var positive = direction === "ArrowRight" || direction === "ArrowDown";
        var best = null;
        var bestScore = Infinity;
        nodes.forEach(function(node) {
            if (node === focused) return;
            var rect = node.getBoundingClientRect();
            var dx = rect.left + rect.width / 2 - cx;
            var dy = rect.top + rect.height / 2 - cy;
            var primary = horizontal ? dx : dy;
            var secondary = horizontal ? dy : dx;
            if ((positive ? primary : -primary) < 2) return;
            var overlap = horizontal ? rect.top < current.bottom - 2 && rect.bottom > current.top + 2 : rect.left < current.right - 2 && rect.right > current.left + 2;
            var score = Math.abs(primary) + Math.abs(secondary) * (overlap ? .4 : 2.7) + (overlap ? 0 : 75);
            if (score < bestScore) {
                best = node;
                bestScore = score;
            }
        });
        if (best) {
            best.focus();
            keepVisible(best);
        }
    }
    function keepVisible(node) {
        try {
            node.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
                inline: "nearest"
            });
        } catch (error) {
            node.scrollIntoView(false);
        }
    }
    document.addEventListener("keydown", function(event) {
        var key = event.key;
        var focused = document.activeElement;
        var editing = focused && focused.tagName === "INPUT";
        if (key === "Escape" || key === "BrowserBack" || key === "Backspace" && !editing) {
            event.preventDefault();
            if (!window.handleBack()) request("exit", {});
            return;
        }
        if (/^Arrow(Left|Right|Up|Down)$/.test(key)) {
            if (focused && focused.tagName === "SELECT") return;
            if (editing && (key === "ArrowLeft" || key === "ArrowRight")) return;
            event.preventDefault();
            moveFocus(key);
        }
        if ((key === "MediaPlayPause" || key === "PlayPause") && detailOpen && currentDetail && currentDetail.episodes && currentDetail.episodes.length) {
            event.preventDefault();
            play(currentDetail.episodes[0], currentDetail);
        }
    });
    document.addEventListener("focusin", function(event) {
        keepVisible(event.target);
        if (homeTrendingDirty && route === "home" && !detailOpen) paintTrending();
        if ((route === "home" || route === "genre") && !detailOpen) paintGenres();
    });
    document.querySelectorAll(".nav-button").forEach(function(node) {
        node.addEventListener("click", function() {
            setRoute(node.getAttribute("data-route"), true);
        });
    });
    setInterval(function() { if (route === "home" && !document.hidden && !detailOpen) { loadTrending(loadIndex); loadGenres(); } }, 3600000);
    renderStatus();
    loading(content, "Making room on the couch…");
    request("getState", {}).then(function(data) {
        adoptState(data);
        currentProvider = "wco";
        renderStatus();
        setRoute("home", false);
        document.querySelector('[data-route="home"]').focus();
        request("ready",{}).catch(function(){});
    }).catch(function() {
        setRoute("home", false);
        request("ready",{}).catch(function(){});
    });
})();

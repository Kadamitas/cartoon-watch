(function() {
    "use strict";
    if(window.__cwQuality)return;
    window.__cwQuality=true;
    var applied=new WeakMap(),bound=new WeakSet(),timer,requestedHeight=0,api="",lastReport="";
    function height(value) {
        var number=Number(value.height),label=String(value.label || value.text || "");
        if(/auto|adaptive|premium|subscribe|\bvip\b|paid/i.test(label))return 0;
        if(number>0&&number<=8640)return number;
        var match=label.match(/(?:^|\D)(\d{3,4})\s*[pi](?:\b|\d)/i)||label.match(/\d{3,5}\s*[x×]\s*(\d{3,4})/i)||label.match(/^\s*(\d{3,4})\s*$/);
        if(match)return Math.min(8640,Number(match[1]));
        return /^\s*8k\s*$/i.test(label)?4320:/^\s*(?:4k|uhd|uhd\s*\(4k\))\s*$/i.test(label)?2160:/^\s*(?:fhd|full\s*hd)\s*$/i.test(label)?1080:/^\s*hd\s*$/i.test(label)?720:0;
    }
    function best(levels) {
        var result=null;
        for(var i=0;levels&&i<levels.length&&i<64;i++) {
            var level=levels[i];if(!level||level.disabled||level.available===false||/auto|adaptive|premium|subscribe|\bvip\b|paid/i.test(String(level.label || level.text || "")))continue;
            var h=height(level),rate=Math.max(0,Number(level.bitrate || level.bandwidth)||0);
            if(!h&&!rate)continue;
            if(!result||h>result.height||h===result.height&&rate>result.bitrate)result={index:i,height:h,bitrate:rate};
        }
        return result;
    }
    function visible(node) {
        if(!node)return true;
        var rect=node.getBoundingClientRect(),style=getComputedStyle(node);
        return rect.width>=160&&rect.height>=90&&style.display!=="none"&&style.visibility!=="hidden"&&!node.closest(".jw-flag-ads,.vjs-ad-playing,.ad-container,.advertisement");
    }
    function once(owner,events) {
        if(!owner||bound.has(owner)||typeof owner.on!=="function")return;
        bound.add(owner);events.forEach(function(event){if(event)try{owner.on(event,schedule);}catch(_) {}});
    }
    function select(owner,levels,current,setter,name) {
        var value=best(levels);if(!value)return false;
        var signature=value.index+":"+value.height+":"+value.bitrate+":"+levels.length;
        if(value.height>=requestedHeight){requestedHeight=value.height;api=name;}
        if(current===value.index||applied.get(owner)===signature)return false;
        setter(value.index);applied.set(owner,signature);return true;
    }
    function jw() {
        if(typeof window.jwplayer!=="function")return false;
        var changed=false,players=[],nodes=document.querySelectorAll(".jwplayer");
        for(var i=0;i<nodes.length&&i<6;i++)if(nodes[i].id&&visible(nodes[i]))players.push(window.jwplayer(nodes[i].id));
        if(!players.length)players.push(window.jwplayer());
        players.forEach(function(player){try {
            if(!player||typeof player.getQualityLevels!=="function"||typeof player.setCurrentQuality!=="function"||typeof player.getContainer==="function"&&!visible(player.getContainer()))return;
            once(player,["ready","levels"]);
            changed=select(player,player.getQualityLevels(),typeof player.getCurrentQuality==="function"?player.getCurrentQuality():-1,function(index){player.setCurrentQuality(index);},"JW Player")||changed;
        }catch(_) {}});
        return changed;
    }
    function hls() {
        var values=[],changed=false;
        function add(value){if(value&&values.indexOf(value)<0)values.push(value);}
        try{add(window.hls);}catch(_) {}
        try{add(window.hlsPlayer);}catch(_) {}
        try{add(window.player&&window.player.hls);add(window.player&&window.player._hls);}catch(_) {}
        var videos=document.querySelectorAll("video");
        for(var i=0;i<videos.length&&i<6;i++){add(videos[i].hls);add(videos[i]._hls);}
        values.forEach(function(player){try {
            if(!Array.isArray(player.levels)||!("loadLevel" in player)||player.media&&!visible(player.media))return;
            var events=window.Hls&&window.Hls.Events||{};once(player,[events.MANIFEST_PARSED,events.LEVELS_UPDATED]);
            changed=select(player,player.levels,player.loadLevel,function(index){player.loadLevel=index;},"HLS")||changed;
        }catch(_) {}});
        return changed;
    }
    function videojs() {
        var library=window.videojs;if(!library)return false;
        var registry=typeof library.getPlayers==="function"?library.getPlayers():null,players=registry?Object.keys(registry).slice(0,6).map(function(key){return registry[key];}):typeof library.getAllPlayers==="function"?library.getAllPlayers().slice(0,6):[],changed=false;
        players.forEach(function(player){try {
            if(!player||typeof player.qualityLevels!=="function"||typeof player.el==="function"&&!visible(player.el()))return;
            var levels=player.qualityLevels(),value=best(levels);once(levels,["addqualitylevel"]);if(!value||typeof levels[value.index].enabled!=="boolean")return;
            var signature=value.index+":"+value.height+":"+value.bitrate+":"+levels.length;
            if(value.height>=requestedHeight){requestedHeight=value.height;api="Video.js";}
            if(applied.get(player)===signature)return;
            if(!levels[value.index].enabled){levels[value.index].enabled=true;changed=true;}
            if(!levels[value.index].enabled)return;
            for(var i=0;i<levels.length;i++)if(i!==value.index&&levels[i].enabled){levels[i].enabled=false;changed=true;}
            applied.set(player,signature);
        }catch(_) {}});
        return changed;
    }
    function controls() {
        var nodes=document.querySelectorAll("select"),changed=false;
        for(var i=0;i<nodes.length&&i<16;i++)try {
            var node=nodes[i],label=[node.id,node.name,node.className,node.getAttribute("aria-label")].join(" "),rect=node.getBoundingClientRect();
            if(node.disabled||!/quality|resolution/i.test(label)||!rect.width||!rect.height)continue;
            var levels=Array.prototype.map.call(node.options,function(option){return {label:option.textContent,disabled:option.disabled||option.getAttribute("data-premium")==="true"};});
            changed=select(node,levels,node.selectedIndex,function(index){node.selectedIndex=index;node.dispatchEvent(new Event("change",{bubbles:true}));},"Site quality control")||changed;
        }catch(_) {}
        return changed;
    }
    function info() {
        var result={requestedHeight:requestedHeight,decodedWidth:0,decodedHeight:0,api:api},videos=document.querySelectorAll("video"),area=0;
        for(var i=0;i<videos.length&&i<8;i++){var video=videos[i];if(!visible(video))continue;var size=video.clientWidth*video.clientHeight;if(size>=area&&video.videoWidth>0&&video.videoHeight>0){area=size;result.decodedWidth=video.videoWidth;result.decodedHeight=video.videoHeight;}}
        return result;
    }
    window.CWQualityInfo=info;
    window.CWBestQuality=function() {
        var changed=false;requestedHeight=0;api="";
        [jw,hls,videojs,controls].forEach(function(apply){try{changed=apply()||changed;}catch(_) {}});
        var result=info(),signature=result.decodedWidth+"x"+result.decodedHeight;
        if(result.decodedWidth&&signature!==lastReport)try{if(window.PlayerEvents&&typeof window.PlayerEvents.quality==="function"){window.PlayerEvents.quality(String((window.CW_CONFIG||{}).session||""),result.decodedWidth,result.decodedHeight);lastReport=signature;}}catch(_) {}
        result.changed=changed;return result;
    };
    function schedule(){clearTimeout(timer);timer=setTimeout(window.CWBestQuality,100);}
    [0,750,2000,4500,9000,15000].forEach(function(delay){setTimeout(schedule,delay);});
    document.addEventListener("loadedmetadata",schedule,true);
    document.addEventListener("resize",schedule,true);
    document.addEventListener("DOMContentLoaded",schedule,{once:true});
})();

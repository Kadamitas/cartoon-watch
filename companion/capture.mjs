import {publicMediaURL,protectedPlaylist,HttpError,boundedText} from './runtime.mjs';

export async function probeIntro(frame,src,duration){
  let timer;
  try{return await Promise.race([frame.evaluate(async({src,duration})=>{
    const video=[...document.querySelectorAll('video')].find(value=>(value.currentSrc||value.src)===src);if(!video)return null;
    const controls=[...document.querySelectorAll('button,a,[role="button"],.skip-intro,.skip-opening,#skip-intro')].filter(node=>{
      const labels=[node.getAttribute('aria-label'),node.getAttribute('title'),node.textContent].filter(Boolean),rect=node.getBoundingClientRect(),style=getComputedStyle(node);
      return labels.some(label=>/^skip\s+(?:the\s+)?(?:intro|opening)$/i.test(label.trim()))&&!labels.some(label=>/subscribe|premium|advert|payment/i.test(label))&&!node.disabled&&node.getAttribute('aria-disabled')!=='true'&&rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0&&(!node.href||new URL(node.href,location.href).origin===location.origin);
    });
    if(controls.length!==1||typeof window.CWSkipIntro!=='function')return null;
    const before=video.currentTime,paused=video.paused;let range=null;
    try{
      video.pause();if(!window.CWSkipIntro())return null;const end=performance.now()+650;
      while(performance.now()<end){const target=video.currentTime;if((video.currentSrc||video.src)!==src||video.error)break;if(Number.isFinite(target)&&target-before>2&&target<duration){range=[before,target];break;}await new Promise(resolve=>setTimeout(resolve,35));}
    }finally{
      if((video.currentSrc||video.src)===src&&!video.error){video.currentTime=before;if(paused)video.pause();else await Promise.race([Promise.resolve(video.play()).catch(()=>{}),new Promise(resolve=>setTimeout(resolve,100))]);}
    }
    return range;
  },{src,duration}),new Promise(resolve=>timer=setTimeout(()=>resolve(null),950))]);}catch{return null;}finally{clearTimeout(timer);}
}

export function createCapture({browserInstance,publicHtml,scripts,blocked,media,timeout=22000}){
  return async function capture(item,base,budget=45000){
    const instance=await browserInstance(),context=await instance.newContext({viewport:{width:1280,height:720},userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'});
    const candidates=[],progress=new Map(),deadline=Date.now()+budget,timer=setTimeout(()=>context.close().catch(()=>{}),budget);let selectedVideo=null,intro=null;
    const boot=`window.CW_CONFIG={session:'companion',adBlock:true,autoPlay:true,crossFrame:true,resumeSeconds:${Math.max(0,Number(item.resumeSeconds)||0)}};window.PlayerEvents={report:function(){},promotionClosed:function(){},introSkipped:function(){}};${scripts[0]}${scripts[1]}(function(){function boot(){${scripts[2]}}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot()})();`;
    await context.addInitScript(boot);
    await context.route('**/*',route=>blocked(route.request().url())?route.abort():route.continue());
    const page=await context.newPage();page.on('popup',popup=>popup.close().catch(()=>{}));
    page.on('response',response=>{
      const url=response.url(),type=(response.headers()['content-type']||'').toLowerCase();if(blocked(url)||!(/\.m3u8(?:[?#]|$)|\.mp4(?:[?#]|$)/i.test(url)||/mpegurl|video\/mp4/.test(type)))return;
      const request=response.request();let frame;try{frame=request.frame();}catch{return;}
      let initial=request;while(initial.redirectedFrom())initial=initial.redirectedFrom();
      candidates.push({url,initial:initial.url(),headers:request.headers(),type,frame});if(candidates.length>64)candidates.shift();
    });
    try{
      const html=await publicHtml(item.url).catch(()=>null);if(html)await page.route(item.url,route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html.html}));
      await page.goto(item.url,{waitUntil:'domcontentloaded',timeout:Math.max(1000,Math.min(20000,deadline-Date.now()))});const end=Math.min(deadline,Date.now()+timeout);
      while(Date.now()<end&&!selectedVideo){
        for(const frame of page.frames())try{
          if(frame!==page.mainFrame()){const element=await frame.frameElement(),rect=await element.boundingBox();await element.dispose();if(!rect||rect.width<160||rect.height<90)continue;}
          const state=await frame.evaluate(()=>{
            const videos=[...document.querySelectorAll('video')].filter(video=>{const rect=video.getBoundingClientRect(),style=getComputedStyle(video);return rect.width>=160&&rect.height>=90&&style.visibility!=='hidden'&&style.display!=='none'&&Number(style.opacity)>0&&!video.loop&&!video.closest('.ad-container,.advertisement,.video-ad,.ima-ad-container,[data-ad="true"]');}).map(video=>({src:video.currentSrc||video.src,time:video.currentTime,duration:video.duration,paused:video.paused,error:!!video.error,played:video.played.length>0,ready:video.readyState,width:video.videoWidth,area:video.clientWidth*video.clientHeight,tracks:[...video.querySelectorAll('track[src]')].filter(track=>track.kind==='subtitles'||track.kind==='captions').map(track=>({url:track.src,language:track.srclang,label:track.label}))})).sort((a,b)=>b.area-a.area);
            const ad=!!document.querySelector('.jw-flag-ads,.vjs-ad-playing,.video-ads.ytp-ad-module:not(:empty)');return {video:ad?null:videos[0],intro:window.CW_SITE_SKIP_DATA?.intro||null};
          });
          if(state.intro)intro=state.intro;const video=state.video;if(!video||!isFinite(video.duration)||video.duration<=1||video.paused||video.error||!video.played||video.ready<2||!video.width)continue;
          const before=progress.get(frame);progress.set(frame,{src:video.src,time:video.time,duration:video.duration});
          if(before&&before.src===video.src&&Math.abs(before.duration-video.duration)<1&&video.time-before.time>.15&&candidates.some(candidate=>candidate.frame===frame))selectedVideo={...video,frame};
        }catch{}
        if(!selectedVideo)await new Promise(resolve=>setTimeout(resolve,400));
      }
      if(!selectedVideo)throw new HttpError(502,'This player did not start');
      const matches=candidates.filter(candidate=>candidate.frame===selectedVideo.frame&&(selectedVideo.src.startsWith('blob:')?/mpegurl/.test(candidate.type)||/\.m3u8(?:[?#]|$)/i.test(candidate.url):candidate.url===selectedVideo.src||candidate.initial===selectedVideo.src));let selected;
      for(const candidate of matches.slice(-4).reverse()){
        const headers={'user-agent':candidate.headers['user-agent']||'Mozilla/5.0',referer:candidate.headers.referer||item.url};if(candidate.headers.origin)headers.origin=candidate.headers.origin;
        const cookies=await context.cookies(candidate.url);if(cookies.length)headers.cookie=cookies.map(cookie=>cookie.name+'='+cookie.value).join('; ');
        const hls=/mpegurl/.test(candidate.type)||/\.m3u8(?:[?#]|$)/i.test(candidate.url),probe=await fetch(candidate.url,{headers:hls?headers:{...headers,range:'bytes=0-2047'},signal:AbortSignal.timeout(Math.max(1000,Math.min(10000,deadline-Date.now())))}).catch(()=>null);
        if(!probe||!probe.ok){await probe?.body?.cancel();continue;}
        if(hls){const text=await boundedText(probe);if(!text.trimStart().startsWith('#EXTM3U')||protectedPlaylist(text))continue;}else await probe.body?.cancel();
        selected={...candidate,headers,format:hls?'hls':'mp4'};break;
      }
      if(!selected)throw new HttpError(502,'No compatible public stream was available');
      const supplied=Array.isArray(intro)&&intro.length===2&&intro.every(Number.isFinite)&&intro[0]>=0&&intro[1]>intro[0]&&intro[1]<=selectedVideo.duration?intro:null;
      if(!supplied&&deadline-Date.now()>1200)intro=await probeIntro(selectedVideo.frame,selectedVideo.src,selectedVideo.duration);
      const session=media.create(item,selected,await context.cookies()),streamUrl=media.resource(session,selected.url,base,true),subtitles=[];
      for(const track of selectedVideo.tracks.slice(0,12))try{const url=media.resource(session,publicMediaURL(track.url),base),vtt=/\.vtt(?:[?#]|$)/i.test(track.url);subtitles.push({url,label:track.label||track.language||'Subtitles',language:track.language||'',format:vtt?'vtt':'auto',...(vtt?{srtUrl:url+'?format=srt'}:{})});}catch{}
      const range=Array.isArray(intro)&&intro.length===2&&intro.every(Number.isFinite)&&intro[0]>=0&&intro[1]>intro[0]&&intro[1]<=selectedVideo.duration?intro:null;
      return {id:session.id,title:item.title||item.seriesTitle,streamUrl,format:selected.format,duration:selectedVideo.duration,position:selectedVideo.time,source:item.provider,subtitles,...(range?{intro:range}:{})};
    }finally{clearTimeout(timer);await context.close();}
  };
}

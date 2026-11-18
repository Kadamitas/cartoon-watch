import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {once} from 'node:events';
import {createCompanion} from './service.mjs';
import {MediaStore,PlayQueue,vttToSrt,rewritePlaylist} from './runtime.mjs';
import {createCapture,probeIntro} from './capture.mjs';

const root=new URL('../',import.meta.url),catalog=JSON.parse(await fs.readFile(new URL('app/src/main/assets/catalog-index.json',root),'utf8'));
const bytes=Buffer.from(Array.from({length:64},(_,index)=>index)),vtt='WEBVTT\n\ncue-a\n00:01.000 --> 00:03.500 align:center\nA <b>caption</b> &amp; text\n';
let source,server,origin,base,media,clock=1000,detailCalls=0,hold=false,releases=[],seen=[],clip;
if(process.env.TEST_MEDIA_FILE)clip=await fs.readFile(process.env.TEST_MEDIA_FILE);
async function listen(value){value.listen(0,'127.0.0.1');await once(value,'listening');return `http://127.0.0.1:${value.address().port}`;}
const post=value=>fetch(base+'/api/play',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Naruto Episode 3',url:'https://www.wcostream.tv/naruto-episode-3-english-dubbed',...value})});

before(async()=>{
  source=http.createServer((request,response)=>{
    seen.push({url:request.url,headers:request.headers});const pathname=new URL(request.url,'http://fixture').pathname;
    if(pathname==='/master.m3u8'){response.setHeader('content-type','application/vnd.apple.mpegurl');response.end('#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="en",NAME="English",URI="captions.vtt"\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nchild.m3u8\n');return;}
    if(pathname==='/child.m3u8'){response.setHeader('content-type','application/vnd.apple.mpegurl');response.end(`#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-KEY:METHOD=AES-128,URI="http://localhost:${source.address().port}/key"\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST\n`);return;}
    if(pathname==='/protected.m3u8'){response.setHeader('content-type','application/vnd.apple.mpegurl');response.end('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\n');return;}
    if(pathname==='/redirect'){response.writeHead(302,{location:`http://localhost:${source.address().port}/redirected.mp4`});response.end();return;}
    if(pathname==='/captions.vtt'){response.setHeader('content-type','text/vtt');response.setHeader('access-control-allow-origin','*');response.end(vtt);return;}
    const data=pathname==='/short.mp4'&&clip?clip:bytes;response.setHeader('content-type',pathname.endsWith('.mp4')?'video/mp4':'application/octet-stream');response.setHeader('accept-ranges','bytes');response.setHeader('access-control-allow-origin','*');
    const range=request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),data.length-1):data.length-1;if(start>=data.length||start>end){response.writeHead(416,{'content-range':`bytes */${data.length}`});response.end();return;}response.writeHead(206,{'content-range':`bytes ${start}-${end}/${data.length}`,'content-length':end-start+1});response.end(data.subarray(start,end+1));}else{response.setHeader('content-length',data.length);response.end(data);}
  });
  origin=await listen(source);media=new MediaStore({now:()=>clock,ttl:1000});
  server=createCompanion({catalog,media,details:async url=>{detailCalls++;await new Promise(resolve=>setTimeout(resolve,30));return {title:'Naruto',url,episodes:[{title:'Episode 3',url:'https://www.wcostream.tv/naruto-episode-3-english-dubbed',number:3}]};},play:async(target,address)=>{if(hold)await new Promise(resolve=>releases.push(resolve));const hls=target.title==='HLS',session=media.create(target,{url:origin+(hls?'/master.m3u8':'/video.mp4'),format:hls?'hls':'mp4',headers:{referer:'https://player.example/watch',cookie:'fixture=private'}});return {id:session.id,title:target.title,format:session.format,streamUrl:media.resource(session,origin+(hls?'/master.m3u8':'/video.mp4'),address,true),subtitles:[]};}});
  base=await listen(server);
});
after(async()=>{server?.closeAllConnections();source?.closeAllConnections();await Promise.all([server&&new Promise(resolve=>server.close(resolve)),source&&new Promise(resolve=>source.close(resolve))]);});

test('indexed catalog filters, pages and preserves the public protocol',async()=>{
  assert.equal((await(await fetch(base+'/health')).json()).app,'Cartoon Watch');
  const first=await(await fetch(base+'/api/catalog?limit=60')).json(),next=await(await fetch(base+'/api/catalog?offset=60&limit=60')).json();
  assert.equal(first.total,16167);assert.equal(first.items.length,60);assert.equal(first.hasMore,true);assert.equal(first.items.some(item=>'key'in item),false);assert.equal(first.items.some(item=>next.items.some(other=>other.url===item.url)),false);
  const movies=await(await fetch(base+'/api/catalog?category=Movies')).json();assert.equal(movies.total,6079);assert.ok(movies.items.every(item=>item.categories.includes('Movies')));
  const anime=await(await fetch(base+'/api/catalog?q=NARUTO')).json();assert.ok(anime.items.some(item=>item.title==='Naruto'));
  const reverse=await(await fetch(base+'/api/catalog?sort=za&limit=1')).json();assert.equal(reverse.items[0].title,catalog.items.at(-1).title);
  const fractional=await(await fetch(base+'/api/catalog?offset=1.2&limit=1.9')).json();assert.equal(fractional.offset,1);assert.equal(fractional.items.length,1);
});

test('details requests coalesce, cache and reject a missing title',async()=>{
  const url=base+'/api/details?url='+encodeURIComponent('https://www.wcostream.tv/anime/naruto');const values=await Promise.all(Array.from({length:5},()=>fetch(url).then(response=>response.json())));assert.equal(detailCalls,1);assert.ok(values.every(value=>value.episodes[0].number===3));await fetch(url);assert.equal(detailCalls,1);assert.equal((await fetch(base+'/api/details')).status,400);
});

test('request parsing and the bounded play queue return useful status codes',async()=>{
  assert.equal((await fetch(base+'/api/play')).status,405);assert.equal((await fetch(base+'/api/play',{method:'POST',body:'{'})).status,400);assert.equal((await fetch(base+'/api/play',{method:'POST',body:'x'.repeat(17000)})).status,413);
  hold=true;const pending=[post({})];while(releases.length<1)await new Promise(resolve=>setTimeout(resolve,5));pending.push(post({}),post({}));await new Promise(resolve=>setTimeout(resolve,30));assert.equal((await post({})).status,429);hold=false;releases.shift()();const responses=await Promise.all(pending);assert.ok(responses.every(response=>response.status===200));
});

test('HLS manifests rewrite nested media, captions and keys through opaque addresses',async()=>{
  const playback=await(await post({title:'HLS'})).json(),master=await(await fetch(playback.streamUrl)).text();assert.ok(master.startsWith('#EXTM3U'));assert.equal(master.includes(origin),false);
  const captions=master.match(/URI="([^"]+)"/)[1],child=master.split('\n').find(line=>line.startsWith(base)),playlist=await(await fetch(child)).text(),key=playlist.match(/URI="([^"]+)"/)[1],segment=playlist.split('\n').find(line=>line.startsWith(base));
  assert.equal((await fetch(captions)).headers.get('content-type'),'text/vtt');assert.equal((await fetch(segment)).status,200);assert.equal((await fetch(key)).status,200);assert.equal(seen.findLast(value=>value.url==='/key').headers.cookie,undefined);assert.equal(seen.findLast(value=>value.url==='/segment.ts').headers.cookie,'fixture=private');
  const session=media.sessions.get(playback.id),protectedUrl=media.resource(session,origin+'/protected.m3u8',base);assert.equal((await fetch(protectedUrl)).status,422);
  assert.throws(()=>rewritePlaylist('#EXTM3U\nfile:///private\n',origin,value=>value),/Unsupported media/);
});

test('MP4 range, HEAD and unsatisfiable ranges preserve media semantics',async()=>{
  const playback=await(await post({})).json(),range=await fetch(playback.streamUrl,{headers:{range:'bytes=2-5'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 2-5/64');assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(2,6));
  const head=await fetch(playback.streamUrl,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'64');assert.equal((await head.text()).length,0);
  const invalid=await fetch(playback.streamUrl,{headers:{range:'bytes=100-200'}});assert.equal(invalid.status,416);assert.equal(invalid.headers.get('content-range'),'bytes */64');
  const session=media.sessions.get(playback.id),subtitle=media.resource(session,origin+'/captions.vtt',base),srt=await fetch(subtitle+'?format=srt');assert.match(srt.headers.get('content-type'),/subrip/);assert.equal(await srt.text(),'1\n00:00:01,000 --> 00:00:03,500\nA caption & text\n');assert.equal(vttToSrt(vtt),'1\n00:00:01,000 --> 00:00:03,500\nA caption & text\n');
  const redirected=media.resource(session,origin+'/redirect',base),followed=await fetch(redirected,{headers:{range:'bytes=4-7'}});assert.equal(followed.status,206);assert.deepEqual(Buffer.from(await followed.arrayBuffer()),bytes.subarray(4,8));assert.equal(seen.findLast(value=>value.url==='/redirected.mp4').headers.cookie,undefined);
});

test('active media refreshes inactivity expiry and old sessions/resources stay bounded',async()=>{
  const playback=await(await post({})).json();clock+=900;assert.equal((await fetch(playback.streamUrl)).status,200);clock+=900;assert.equal((await fetch(playback.streamUrl)).status,200);clock+=1100;assert.equal((await fetch(playback.streamUrl)).status,410);
  const bounded=new MediaStore({limit:2,resources:3});for(let index=0;index<5;index++)bounded.create({}, {url:origin+'/video.mp4'});assert.equal(bounded.sessions.size,2);const session=[...bounded.sessions.values()][0],initial=bounded.resource(session,origin+'/master.m3u8',base,true);for(let index=0;index<10;index++)bounded.resource(session,origin+'/segment-'+index,base);assert.equal(session.resources.size,3);assert.ok(session.resources.has(initial.split('/').at(-1)));
  const queue=new PlayQueue(1);let release;const task=queue.run(()=>new Promise(resolve=>release=resolve));assert.throws(()=>queue.run(()=>{}),/busy/);await new Promise(resolve=>setTimeout(resolve,0));release();await task;assert.equal(queue.pending,0);
});

test('an actually playing short visible video is captured and decoded again through the proxy',{skip:!clip},async()=>{
  const {chromium}=await import('playwright'),executablePath=process.env.BROWSER_EXECUTABLE||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined),browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});
  try{
    const scripts=await Promise.all(['aniwave-skips.js','frame-guard.js','player.js'].map(name=>fs.readFile(new URL('app/src/main/assets/'+name,root),'utf8'))),capture=createCapture({browserInstance:async()=>browser,publicHtml:async()=>({html:`<!doctype html><video style="display:none" autoplay muted loop src="${origin}/ad.mp4"></video><video width="640" height="360" autoplay muted controls src="${origin}/short.mp4"><track kind="subtitles" label="English" srclang="en" src="${origin}/captions.vtt"></video>`}),scripts,blocked:()=>false,media,timeout:7000});
    const playback=await capture({title:'Short clip fixture',url:origin+'/episode',provider:'fixture'},base,12000);assert.ok(playback.duration>1&&playback.duration<60);assert.ok(playback.position>.3);assert.equal('intro'in playback,false);assert.equal(playback.subtitles.length,1);assert.ok(playback.subtitles[0].srtUrl);assert.equal((await fetch(playback.subtitles[0].srtUrl)).status,200);
    const page=await browser.newPage();await page.setContent(`<video width="640" height="360" autoplay muted src="${playback.streamUrl}"></video>`);await page.waitForFunction(()=>document.querySelector('video').currentTime>.5);assert.ok(await page.$eval('video',video=>video.duration)<60);
    await page.addScriptTag({content:scripts[1]});await page.evaluate(()=>{const button=document.createElement('button');button.textContent='Skip intro';button.onclick=()=>document.querySelector('video').currentTime=7.75;document.body.appendChild(button);});
    const current=await page.$eval('video',video=>({src:video.currentSrc,duration:video.duration})),observed=await probeIntro(page.mainFrame(),current.src,current.duration);assert.equal(observed[1],7.75);assert.ok(observed[0]>.3);assert.ok(await page.$eval('video',video=>video.currentTime)<3);assert.equal(await page.$eval('video',video=>video.paused),false);
    await page.evaluate(()=>{const video=document.querySelector('video');video.pause();video.currentTime=1.25;document.querySelector('button').onclick=()=>video.currentTime=14.125;});const paused=await probeIntro(page.mainFrame(),current.src,current.duration);assert.deepEqual(paused,[1.25,14.125]);assert.equal(await page.$eval('video',video=>video.currentTime),1.25);assert.equal(await page.$eval('video',video=>video.paused),true);await page.close();
  }finally{await browser.close();}
});

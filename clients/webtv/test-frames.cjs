const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../companion/node_modules/playwright');
const project=path.resolve(__dirname,'../..'),media=process.env.TEST_MEDIA_FILE&&path.resolve(process.env.TEST_MEDIA_FILE);
if(!media||!fs.existsSync(media)){console.log('SKIP: set TEST_MEDIA_FILE to a playable local MP4');process.exit(0);}
const requests=[],episode='https://www.wcostream.tv/fixture-episode-3',series='https://www.wcostream.tv/anime/fixture-series';
let base;
const server=http.createServer((request,response)=>{
 const url=new URL(request.url,base||'http://localhost');
 const send=(status,type,body)=>{response.writeHead(status,{'content-type':type,'access-control-allow-origin':'*'});response.end(body);};
 if(url.pathname==='/bridge.js'){send(200,'application/javascript',fs.readFileSync(path.join(__dirname,'bridge.js')));return;}
 if(url.pathname==='/video.mp4'){
  const size=fs.statSync(media).size,range=(request.headers.range||'').match(/bytes=(\d+)-(\d*)/),start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),size-1):size-1;
  response.writeHead(range?206:200,{'content-type':'video/mp4','access-control-allow-origin':'*','accept-ranges':'bytes','content-length':end-start+1,...(range?{'content-range':`bytes ${start}-${end}/${size}`}:{})});fs.createReadStream(media,{start,end}).pipe(response);return;
 }
 if(request.method==='POST'){
  let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{requests.push({path:url.pathname,body});const payload=JSON.parse(body);if(url.pathname==='/api/play')send(200,'application/json',JSON.stringify({streamUrl:base+'/video.mp4',format:'mp4'}));else if(url.pathname==='/api/artwork')send(200,'application/json',JSON.stringify({items:payload.items.map(item=>({url:item.url,variant:item.variant||'poster',image:item.variant==='backdrop'?'https://s4.anilist.co/file/anilistcdn/media/anime/banner/21-test.jpg':'https://cdn.myanimelist.net/r/300x450/images/anime/1141/142503.jpg',imageSource:item.variant==='backdrop'?'AniList':'MyAnimeList'})),pending:[],retryAfter:1000}));else send(404,'application/json','{}');});return;
 }
 send(200,'text/html','<!doctype html><html><body><div class="topbar"></div><div id="content"></div><div id="detail" hidden></div><button data-route="home">Home</button><script>var callbacks={},next=0;window.onNativeResult=function(id,data){callbacks[id](JSON.parse(data));delete callbacks[id]};window.requestNative=function(action,payload){return new Promise(function(resolve){var id=String(++next);callbacks[id]=resolve;CartoonWatch.request(action,JSON.stringify(payload||{}),id)})};</script><script src="/bridge.js"></script></body></html>');
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',executablePath=process.env.PLAYWRIGHT_EXECUTABLE_PATH||(process.platform==='win32'&&fs.existsSync(edge)?edge:undefined);
 const browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const context=await browser.newContext();await context.addInitScript(service=>{localStorage.setItem('cartoonWatchService',service);},base);const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(base);
  const play={url:episode,title:'Episode 3',kind:'episode',seriesTitle:'Fixture series',seriesUrl:series,image:'data:image/jpeg;base64,AAAA'};
  await page.evaluate(payload=>requestNative('play',payload),play);await page.waitForFunction(()=>{const video=document.querySelector('video');return !video.paused&&video.currentTime>.35;});await page.locator('video').evaluate(video=>video.pause());
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cartoonWatchEpisodeFrames')||'[]').length===1);
  const paused=await page.evaluate(url=>requestNative('artwork',{items:[{url,kind:'episode'}]}),episode);assert(paused.items[0].resumeFrame);assert.match(paused.items[0].image,/^data:image\/jpeg;base64,/);
  const backdrop=await page.evaluate(value=>requestNative('artwork',{items:[{url:value.episode,kind:'episode',seriesUrl:value.series,variant:'backdrop',backdrop:'data:image/jpeg;base64,AAAA'}]}),{episode,series});assert.equal(backdrop.items[0].resumeFrame,false);assert.equal(backdrop.items[0].variant,'backdrop');assert.match(backdrop.items[0].image,/\/banner\//);
  const decoded=await page.evaluate(async source=>{const image=new Image();image.src=source;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);const pixels=context.getImageData(0,0,image.width,image.height).data;let low=255,high=0;for(let i=0;i<pixels.length;i+=4){low=Math.min(low,pixels[i]);high=Math.max(high,pixels[i]);}return {width:image.width,height:image.height,variation:high-low};},paused.items[0].image);assert.equal(decoded.width,192);assert.equal(decoded.height,108);assert(decoded.variation>20);
  await page.locator('video').evaluate(video=>video.play());await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cartoonWatchEpisodeFrames')||'[]').length===0);
  const whilePlaying=await page.evaluate(url=>requestNative('artwork',{items:[{url,kind:'episode',seriesUrl: 'https://www.wcostream.tv/anime/fixture-series'}]}),episode);assert.equal(whilePlaying.items[0].resumeFrame,false);assert.match(whilePlaying.items[0].image,/^https:/);
  await page.locator('[data-command="back"]').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cartoonWatchEpisodeFrames')||'[]').length===1);
  const afterClose=await page.evaluate(url=>requestNative('artwork',{items:[{url,kind:'episode'}]}),episode);assert(afterClose.items[0].resumeFrame);
  const staticSeries=await page.evaluate(url=>requestNative('artwork',{items:[{url,kind:'series'}]}),series);assert.equal(staticSeries.items[0].resumeFrame,false);
  await page.evaluate(image=>{const list=Array.from({length:65},(_,i)=>({url:'https://www.wcostream.tv/fixture-episode-'+i,image}));localStorage.setItem('cartoonWatchEpisodeFrames',JSON.stringify(list));},paused.items[0].image);
  await page.evaluate(payload=>requestNative('play',payload),play);await page.waitForFunction(()=>{const video=document.querySelector('video');return !video.paused&&video.currentTime>.35;});await page.locator('video').evaluate(video=>video.pause());
  const bounds=await page.evaluate(()=>({count:JSON.parse(localStorage.getItem('cartoonWatchEpisodeFrames')).length,bytes:localStorage.getItem('cartoonWatchEpisodeFrames').length}));assert(bounds.count<=64);assert(bounds.bytes<=1048576);
  await page.evaluate(()=>{window.originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='cartoonWatchEpisodeFrames')throw new DOMException('quota','QuotaExceededError');return originalStorageSet.call(this,key,value);};});await page.locator('video').evaluate(video=>video.play());await page.waitForFunction(()=>!localStorage.getItem('cartoonWatchEpisodeFrames'));
  await page.evaluate(()=>{Storage.prototype.setItem=window.originalStorageSet;});await page.locator('[data-command="back"]').click();await page.evaluate(()=>{const value=JSON.parse(localStorage.getItem('cartoonWatchTVState'));value.favorites=[{url:'keep-favorite'}];localStorage.setItem('cartoonWatchTVState',JSON.stringify(value));});await page.evaluate(()=>requestNative('clearHistory'));
  const cleared=await page.evaluate(()=>({state:JSON.parse(localStorage.getItem('cartoonWatchTVState')),frames:localStorage.getItem('cartoonWatchEpisodeFrames')}));assert.equal(cleared.state.history.length,0);assert.equal(cleared.state.favorites.length,1);assert.equal(cleared.frames,null);assert.equal(errors.length,0);assert(requests.filter(item=>item.path==='/api/play'||item.path==='/api/artwork').every(item=>!item.body.includes('data:image/')));
  const result={success:true,mediaFixture:'actual local MP4 decoded by browser',pausedFrame:decoded,normalCloseCaptured:true,oldFrameInvalidatedDuringPlayback:true,seriesCoverPreserved:true,bounds,quotaFallback:true,historyClearPreservesFavorites:true,privateFrameUpload:false,errors};const directory=path.join(project,'work','webtv-frame-test');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

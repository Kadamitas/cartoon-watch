const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../companion/node_modules/playwright');
const root=path.resolve(__dirname,'..'),assets=path.join(root,'app/src/main/assets');
const index=JSON.parse(fs.readFileSync(path.join(assets,'catalog-index.json'),'utf8'));
const details=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/naruto-details.json'),'utf8'));
const series=index.items.find(item=>item.title==='Naruto'),episode3=details.episodes.find(item=>item.title==='Episode 3 English Dubbed'),episode4=details.episodes.find(item=>item.title==='Episode 4 English Dubbed');
assert(series&&episode3&&episode4,'The real catalog/detail fixtures must contain Naruto episodes3/4');
const output=path.join(root,'work','artwork-ui');fs.mkdirSync(output,{recursive:true});
function catalog(args={}){
 const query=String(args.query||'').toLowerCase(),category=args.category||'all';
 let items=index.items.filter(item=>(!query||item.title.toLowerCase().includes(query))&&(category==='all'||item.categories.includes(category)));
 items.sort((a,b)=>a.title.localeCompare(b.title,undefined,{sensitivity:'base'})*(args.sort==='za'?-1:1));
 const offset=Math.max(0,Number(args.offset)||0),limit=Math.min(60,Number(args.limit)||60);
 return {items:items.slice(offset,offset+limit),total:items.length,offset,limit,hasMore:offset+limit<items.length,categories:index.coverage.map(item=>item.category),indexed:true,version:index.version,generatedAt:index.generatedAt};
}
async function until(test){for(let attempt=0;attempt<100;attempt++){if(test())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Native fixture did not reach the expected state');}
(async()=>{
 const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',executablePath=process.env.PLAYWRIGHT_EXECUTABLE_PATH||(process.platform==='win32'&&fs.existsSync(edge)?edge:undefined);
 const browser=await chromium.launch({headless:true,executablePath});const results=[];
 try{
  for(const width of [960,1920]){
   const context=await browser.newContext({viewport:{width,height:width===960?540:1080}}),requests=[],errors=[],remoteImages=[];
   let state={favorites:[series],history:[{...episode3,kind:'episode',seriesTitle:series.title,seriesUrl:series.url,currentTime:120,duration:1402,watchedAt:1700000000000}],settings:{provider:'wco',adBlock:true}};
   let images,holdNext=false,releaseHeld=null;const frames=new Map();
   await context.exposeBinding('fixtureNative',async(_,action,args)=>{
    requests.push({action,args});
    if(action==='getState')return state;
    if(action==='saveState'){state=JSON.parse(JSON.stringify(args));return {ok:true};}
    if(action==='clearHistory'){frames.clear();state.history=[];return {ok:true};}
    if(action==='home'||action==='catalog')return catalog(args);
    if(action==='details')return details;
    if(action==='artwork'){
     const items=args.items.map(item=>({url:item.url,image:item.kind==='episode'&&frames.get(item.url)||images.cover,imageSource:item.kind==='episode'&&frames.has(item.url)?'Resume frame':'Fixture cover',resumeFrame:item.kind==='episode'&&frames.has(item.url)}));
     if(holdNext&&args.items.some(item=>item.url===episode3.url)){holdNext=false;await new Promise(resolve=>{releaseHeld=resolve;});}
     return {items,pending:[],retryAfter:1000};
    }
    return {ok:true};
   });
   await context.addInitScript(()=>{window.CartoonWatch={request(action,input,id){window.fixtureNative(action,JSON.parse(input||'{}')).then(value=>window.onNativeResult(id,JSON.stringify(value)));}};});
   await context.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.hostname!=='app.cartoonwatch.test'){if(request.resourceType()==='image')remoteImages.push(request.url());return route.abort();}
    const name=url.pathname.slice(1)||'index.html';if(!['index.html','app.js','app.css','brand.svg'].includes(name))return route.abort();
    return route.fulfill({contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html',body:fs.readFileSync(path.join(assets,name))});
   });
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   images=await page.evaluate(()=>{
    function jpeg(width,height,background,mark){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');context.fillStyle=background;context.fillRect(0,0,width,height);context.fillStyle=mark;context.fillRect(width/4,height/4,width/2,height/2);return canvas.toDataURL('image/jpeg',.55);}
    return {cover:jpeg(160,225,'#123a78','#9ad7ff'),frame:jpeg(192,108,'#992211','#ffcc55'),replacement:jpeg(192,108,'#125522','#aaffbb'),stale:jpeg(192,108,'#331166','#cc99ff')};
   });frames.set(episode3.url,images.frame);
   await page.goto('https://app.cartoonwatch.test/');await page.getByRole('button',{name:'Browse full catalog',exact:true}).waitFor();
   const homeCover=page.locator('.hero img');await homeCover.waitFor();await page.waitForFunction(()=>document.querySelector('.hero img')?.naturalWidth>0);assert.equal(await homeCover.getAttribute('src'),images.cover);
   const recent=page.locator('.shelf').filter({has:page.locator('h2',{hasText:'Recently watched'})}).locator('.card').first();await recent.scrollIntoViewIfNeeded();await recent.locator('img').waitFor();assert.equal(await recent.locator('img').getAttribute('src'),images.frame);
   assert(requests.filter(request=>request.action==='artwork').every(request=>request.args.items.length<=12));
   await page.locator('[data-route="list"]').click();const favorite=page.locator('.grid .card').filter({has:page.locator('.card-title',{hasText:/^Naruto$/})});await favorite.waitFor();await favorite.click();
   await page.getByLabel('Filter episodes').waitFor();await page.waitForFunction(()=>document.querySelector('.detail-poster img')?.naturalWidth>0);assert.equal(await page.locator('.detail-poster img').getAttribute('src'),images.cover);
   const filter=page.getByLabel('Filter episodes');await filter.fill('Episode 3 English Dubbed');await page.waitForFunction(()=>document.querySelectorAll('.episode').length===1);const ep=page.locator('.episode');await ep.scrollIntoViewIfNeeded();await ep.locator('img').waitFor();assert.equal(await ep.locator('img').getAttribute('src'),images.frame);
   await filter.fill('Episode 4 English Dubbed');await page.waitForFunction(()=>document.querySelector('.episode-label')?.textContent==='Episode 4 English Dubbed');await page.locator('.episode').scrollIntoViewIfNeeded();await page.locator('.episode img').waitFor();assert.equal(await page.locator('.episode img').getAttribute('src'),images.cover);assert.equal(await page.locator('.detail-poster img').getAttribute('src'),images.cover);
   await filter.fill('Episode 3 English Dubbed');await page.locator('.episode').scrollIntoViewIfNeeded();await page.waitForFunction(expected=>document.querySelector('.episode img')?.getAttribute('src')===expected,images.frame);
   await page.evaluate(()=>{window.artworkMutations=[];new MutationObserver(changes=>changes.forEach(change=>{if(change.type==='attributes'&&change.attributeName==='src'&&change.target.closest('.episode'))window.artworkMutations.push(change.target.getAttribute('src'));})).observe(document.getElementById('detail'),{subtree:true,attributes:true,attributeFilter:['src']});});
   frames.set(episode3.url,images.stale);holdNext=true;await page.evaluate(()=>window.refreshThumbnails());await until(()=>!!releaseHeld);frames.set(episode3.url,images.replacement);await page.evaluate(()=>window.refreshThumbnails());releaseHeld();
   await page.waitForFunction(expected=>document.querySelector('.episode img')?.getAttribute('src')===expected,images.replacement);assert(!(await page.evaluate(()=>window.artworkMutations)).includes(images.stale));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('#detail').evaluate(node=>node.scrollWidth>node.clientWidth),false);
   await page.screenshot({path:path.join(output,`episodes-${width}.png`)});
   await page.evaluate(()=>window.handleBack());await page.locator('[data-route="settings"]').click();await page.getByRole('button',{name:'Clear history',exact:true}).click();await until(()=>requests.some(request=>request.action==='clearHistory'));await until(()=>state.history.length===0);assert.equal(frames.size,0);assert.equal(state.favorites.length,1);
   await page.locator('[data-route="home"]').click();await page.getByRole('button',{name:'Browse full catalog',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.hero img')?.naturalWidth>0);assert.equal(await page.locator('.hero img').getAttribute('src'),images.cover);assert.equal(await page.locator('.shelf h2').filter({hasText:/^Recently watched$/}).count(),0);
   await page.locator('[data-route="list"]').click();await page.locator('.grid .card').filter({has:page.locator('.card-title',{hasText:/^Naruto$/})}).click();await page.getByLabel('Filter episodes').fill('Episode 3 English Dubbed');await page.locator('.episode').scrollIntoViewIfNeeded();await page.waitForFunction(expected=>document.querySelector('.episode img')?.getAttribute('src')===expected,images.cover);
   const artwork=requests.filter(request=>request.action==='artwork'),unique=new Set(artwork.flatMap(request=>request.args.items.map(item=>item.url)));assert(artwork.every(request=>request.args.items.length<=12));assert(artwork.every(request=>Buffer.byteLength(JSON.stringify(request.args))<=16384));assert(artwork.every(request=>request.args.items.every(item=>!Object.prototype.hasOwnProperty.call(item,'episodes'))));assert(unique.size<160,'Artwork must remain viewport-driven rather than requesting the full catalog');assert.equal(remoteImages.length,0);assert.equal(errors.length,0);
   await page.evaluate(()=>window.handleBack());await page.locator('[data-route="home"]').click();await page.screenshot({path:path.join(output,`home-${width}.png`)});
   results.push({width,catalog:index.items.length,fixture:'real catalog/Naruto details with generated small cover and episode JPEGs',homeCover:true,historyFrame:true,seriesPosterStatic:true,episode3Frame:true,episode4CoverFallback:true,clearedEpisodeCoverFallback:true,refreshRejectsStaleFrame:true,historyClearPreservesFavoritesAndCovers:true,maximumBatch:Math.max(...artwork.map(request=>request.args.items.length)),artworkCalls:artwork.length,uniqueArtworkItems:unique.size,directRemoteImageLoads:remoteImages.length,overflow:false,errors});await context.close();
  }
 }finally{await browser.close();}
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});

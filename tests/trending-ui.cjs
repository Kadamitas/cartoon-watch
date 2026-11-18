const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../companion/node_modules/playwright');
const root=path.resolve(__dirname,'..'),assets=path.join(root,'app/src/main/assets'),index=JSON.parse(fs.readFileSync(path.join(assets,'catalog-index.json'),'utf8'));
const find=title=>index.items.find(item=>item.title===title),jjk=find('Jujutsu Kaisen'),naruto=find('Naruto'),baki=find('Baki (2018)'),comedy=find("KonoSuba: God's Blessing on this Wonderful World!"),isekai=find('Re:ZERO -Starting Life in Another World-'),titans=find('Teen Titans'),avatar=find('Avatar The Last Airbender Book 1 Water'),scooby=find('A Pup Named Scooby-Doo'),family=find('Family Guy'),south=find('South Park');
assert(jjk&&naruto&&baki&&comedy&&isekai&&titans&&avatar&&scooby&&family&&south);
const registry=JSON.parse(fs.readFileSync(path.join(assets,'discovery-categories.json'),'utf8')).categories;
const output=path.join(root,'work','trending-ui');fs.mkdirSync(output,{recursive:true});
const feed=(items,extra={})=>({items:items.map((item,i)=>({...item,trendRank:i+1})),available:true,source:'AniList',periodStart:'2026-11-11T00:00:00Z',periodEnd:'2026-11-18T00:00:00Z',updatedAt:'2026-11-18T03:00:00Z',stale:false,...extra});
const animeFeed=(items,key)=>feed(items,{genre:key,type:'anime',metric:'popularity'});
const cartoonFeed=key=>feed(key==='cartoon-adult'?[family,south]:key==='cartoon-mysteries'?[scooby]:[titans,avatar,scooby],{genre:key,type:'cartoons',metric:'rating',source:'TVmaze',snapshotAt:'2026-11-18T00:00:00Z'});
const until=async test=>{for(let i=0;i<100;i++){if(test())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Feed fixture did not reach expected state');};
function catalog(args={}){
 const query=String(args.query||'').toLowerCase(),category=args.category||'all';let items=index.items.filter(item=>(!query||item.title.toLowerCase().includes(query))&&(category==='all'||item.categories.includes(category)));
 items.sort((a,b)=>a.title.localeCompare(b.title,undefined,{sensitivity:'base'})*(args.sort==='za'?-1:1));const offset=Number(args.offset)||0,limit=Math.min(60,Number(args.limit)||60);
 return {items:items.slice(offset,offset+limit),total:items.length,indexed:true,offset,limit,hasMore:offset+limit<items.length,categories:index.coverage.map(item=>item.category)};
}
async function fixture(browser,width=960,options={}){
 const context=await browser.newContext({viewport:{width,height:width===640?360:width===960?540:1080}}),requests=[],weekly=[],genres={},errors=[];
 const stats={activeGenres:0,maximumGenres:0};
 let state={favorites:[],history:[],settings:{provider:'wco',adBlock:true}};
 await context.exposeBinding('fixtureNative',async(_,action,args)=>{
  requests.push({action,args});
  if(action==='getState')return state;
  if(action==='saveState'){state=args;return {ok:true};}
  if(action==='home'||action==='catalog')return catalog(args);
  if(action==='artwork')return {items:[],pending:[]};
  if(action==='trending'){
   if(args.genre?.startsWith('cartoon-')&&!options.holdCartoons?.includes(args.genre))return cartoonFeed(args.genre);
   if(options.autoFeeds)return args.genre?animeFeed([isekai,naruto],args.genre):feed([jjk,naruto]);
   return new Promise(resolve=>{if(args.genre){stats.activeGenres++;stats.maximumGenres=Math.max(stats.maximumGenres,stats.activeGenres);(genres[args.genre]||=[]).push(value=>{stats.activeGenres--;resolve(value);});}else weekly.push(resolve);});
  }
  if(action==='details'){const item=index.items.find(item=>item.url===args.url);return {...item,description:'Catalog detail fixture',episodes:[]};}
  return {ok:true};
 });
 await context.addInitScript(()=>{window.CartoonWatch={request(action,input,id){window.fixtureNative(action,JSON.parse(input||'{}')).then(value=>window.onNativeResult(id,JSON.stringify(value)));}};});
 await context.route('https://app.cartoonwatch.test/**',route=>{const name=new URL(route.request().url()).pathname.slice(1)||'index.html';if(!['index.html','app.js','app.css','brand.svg','discovery.js'].includes(name))return route.abort();return route.fulfill({contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html',body:fs.readFileSync(path.join(assets,name))});});
 const page=await context.newPage();if(options.clock)await page.clock.install({time:new Date('2026-11-18T03:00:00Z')});page.on('pageerror',error=>errors.push(error.message));await page.goto('https://app.cartoonwatch.test/');await page.locator('.discovery-shortcuts').waitFor();if(options.autoFeeds){await page.locator('.trending-shelf .card').first().waitFor();await page.locator('#home-genre-results .card').first().waitFor();}else await until(()=>weekly.length&&genres.isekai?.length);
 return {page,context,requests,weekly,genres,errors,stats};
}
(async()=>{
 const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||(process.platform==='win32'&&fs.existsSync(edge)?edge:undefined)}),results=[];
 try{
  for(const width of [640,960,1920]){
   const f=await fixture(browser,width),{page}=f;
   assert.equal(await page.locator('.hero h1').innerText(),'Find your next favorite.');
   assert.equal(await page.getByLabel('Anime category').inputValue(),'isekai');
   assert.equal(await page.getByLabel('Cartoon collection').inputValue(),'cartoon-essentials');
   assert.deepEqual(await page.getByLabel('Anime category').locator('option').evaluateAll(nodes=>nodes.map(node=>node.value)),registry.filter(item=>item.type==='anime').map(item=>item.key));
   assert.deepEqual(await page.getByLabel('Cartoon collection').locator('option').evaluateAll(nodes=>nodes.map(node=>node.value)),registry.filter(item=>item.type==='cartoons').map(item=>item.key));
   assert.equal(await page.getByLabel('Anime category').locator('option[value="comedy"]').count(),0);
   const original=page.locator('.shelf').filter({has:page.getByRole('heading',{name:'From the WCO catalog',exact:true})}).locator('.card').first();
   await original.focus();await page.waitForTimeout(650);const top=await original.evaluate(node=>{window.fixtureAnchor=node;window.fixturePrimary=document.querySelector('.hero .primary');return node.getBoundingClientRect().top;});
   const extra=index.items.filter(item=>item.kind==='series'&&![jjk.url,naruto.url,baki.url].includes(item.url)).slice(0,55);
   f.weekly.shift()(feed([jjk,{...jjk,title:'Invalid fallback source',provider:'aniwave',url:'https://aniwave.gr/watch/invalid'},naruto,jjk,...extra],{stale:true}));
   await page.locator('.trending-shelf').waitFor();assert.equal(await page.locator('.trending-shelf .card').count(),20);
   assert.equal(await page.locator('.trending-shelf .card-title').filter({hasText:'Invalid fallback source'}).count(),0);
   assert.match(await page.locator('.trending-meta').first().innerText(),/AniList community activity.*Nov 11.*Nov 17.*Cached ranking/);
   assert.equal(await page.locator('.hero h1').innerText(),jjk.title);
   assert.equal(await page.evaluate(()=>document.activeElement===window.fixtureAnchor&&document.querySelector('.hero .primary')===window.fixturePrimary),true);
   assert(Math.abs(await original.evaluate(node=>node.getBoundingClientRect().top)-top)<3,'Feed insertion shifted the focused catalog card');
   const selector=page.getByLabel('Anime category');await selector.evaluate(node=>window.fixtureGenre=node);await selector.selectOption('rom-com');
   assert.match(await page.locator('#home-genre-results').innerText(),/All-time popular · Rom-Com/);assert.equal(f.genres['rom-com'],undefined);
   f.genres.isekai.shift()(animeFeed([isekai],'isekai'));
   await until(()=>f.genres['rom-com']?.length);assert.equal(await page.locator('#home-genre-results .card').count(),0);
   f.genres['rom-com'].shift()(animeFeed([comedy],'rom-com'));await page.waitForFunction(()=>document.querySelector('#home-genre-results .card-title')?.textContent.includes('KonoSuba'));
   assert.equal(await page.evaluate(()=>document.querySelector('[aria-label="Anime category"]')===window.fixtureGenre),true);
   await page.locator('#home-genre-results .card').click();assert.equal(f.requests.filter(r=>r.action==='details').at(-1).args.url,comedy.url);await page.evaluate(()=>window.handleBack());
   await selector.selectOption('fighting');await until(()=>f.genres.fighting?.length);const fighting=extra.slice();fighting.splice(42,0,baki);f.genres.fighting.shift()(animeFeed(fighting,'fighting'));await page.waitForFunction(()=>document.querySelectorAll('#home-genre-results .card').length===50);
   const beforeBaki=page.locator('#home-genre-results .card').nth(41);await beforeBaki.focus();await page.keyboard.press('ArrowRight');
   assert.equal(await page.evaluate(()=>document.activeElement.querySelector('.card-title')?.textContent),baki.title);await page.keyboard.press('Enter');
   assert.equal(f.requests.filter(r=>r.action==='details').at(-1).args.url,baki.url);await page.evaluate(()=>window.handleBack());
   assert.equal(await page.evaluate(()=>document.activeElement.querySelector('.card-title')?.textContent),baki.title);
   const viewAll=page.locator('#genre-view-all');await viewAll.focus();await page.waitForTimeout(650);
   const homePosition=await viewAll.evaluate(node=>{window.fixtureViewAll=node;return node.getBoundingClientRect().top;});await viewAll.click();
   await page.locator('.genre-grid').waitFor();await page.waitForTimeout(80);assert.equal(await page.locator('.genre-grid .card').count(),50);assert.equal(await page.locator('#genre-intro h1').innerText(),'Fighting anime');
   assert.equal(await page.locator('main').evaluate(node=>node.scrollTop),0);
   assert.match(await page.locator('#genre-grid-results .trending-meta').innerText(),/All-time popular · Fighting.*50 available WCO matches/);
   await page.screenshot({path:path.join(output,`genre-grid-${width}.png`)});
   const columns=await page.locator('.genre-grid').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length);await page.locator('.genre-grid .card').nth(42-columns).focus();await page.keyboard.press('ArrowDown');
   assert.equal(await page.evaluate(()=>document.activeElement.querySelector('.card-title')?.textContent),baki.title);await page.keyboard.press('Enter');assert.equal(f.requests.filter(r=>r.action==='details').at(-1).args.url,baki.url);await page.locator('#detail').getByRole('button',{name:'My List',exact:true}).click();
   await page.evaluate(()=>window.handleBack());assert.equal(await page.locator('.genre-grid .card').count(),50);assert.equal(await page.evaluate(()=>document.activeElement.querySelector('.card-title')?.textContent),baki.title);
   await page.getByLabel('Anime category').selectOption('rom-com');assert.equal(await page.locator('.genre-grid .card').count(),1);assert.equal(await page.locator('#genre-intro h1').innerText(),'Rom-Com anime');
   await page.locator('.genre-grid .card').click();assert.equal(f.requests.filter(r=>r.action==='details').at(-1).args.url,comedy.url);await page.evaluate(()=>window.handleBack());
   await page.evaluate(()=>window.handleBack());assert.equal(await page.evaluate(()=>document.activeElement===window.fixtureViewAll),true);assert.equal(await page.getByLabel('Anime category').inputValue(),'rom-com');
   assert.equal(await page.locator('.shelf').filter({has:page.getByRole('heading',{name:'Your watch list',exact:true})}).locator('.card-title').innerText(),baki.title);
   assert(Math.abs(await viewAll.evaluate(node=>node.getBoundingClientRect().top)-homePosition)<3,'Genre grid Back shifted the Home View All control');
   await viewAll.click();await page.locator('.genre-grid').waitFor();await page.getByRole('button',{name:'Back to Home',exact:true}).click();assert.equal(await page.evaluate(()=>document.activeElement===window.fixtureViewAll),true);
   await page.locator('.hero .primary').click();assert.equal(f.requests.filter(r=>r.action==='details').at(-1).args.url,jjk.url);await page.evaluate(()=>window.handleBack());
   await page.getByRole('button',{name:'Cartoons',exact:true}).click();assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Cartoon collection');
   await page.getByLabel('Cartoon collection').selectOption('cartoon-adult');await page.waitForFunction(()=>document.querySelector('#home-cartoon-results .card-title')?.textContent==='Family Guy');
   assert.match(await page.locator('#home-cartoon-results .trending-meta').innerText(),/Community ratings · Adult animation · TVmaze · Snapshot Nov 18, 2026/);assert(!/AniList/.test(await page.locator('#home-cartoon-results .trending-meta').innerText()));
   assert.equal(await page.getByLabel('Anime category').inputValue(),'rom-com');const cartoonAll=page.locator('#cartoon-view-all');await cartoonAll.focus();await page.waitForTimeout(650);await cartoonAll.evaluate(node=>window.fixtureCartoonAll=node);await cartoonAll.click();await page.locator('.genre-grid').waitFor();
   assert.equal(await page.locator('#genre-intro h1').innerText(),'Adult animation');await page.locator('.genre-grid .card').filter({has:page.locator('.card-title',{hasText:/^South Park$/})}).click();assert.equal(f.requests.filter(r=>r.action==='details').at(-1).args.url,south.url);await page.evaluate(()=>window.handleBack());
   await page.getByLabel('Cartoon collection').selectOption('cartoon-mysteries');await page.waitForFunction(()=>document.querySelector('.genre-grid .card-title')?.textContent==='A Pup Named Scooby-Doo');await page.locator('.genre-grid .card').click();assert.equal(f.requests.filter(r=>r.action==='details').at(-1).args.url,scooby.url);await page.evaluate(()=>window.handleBack());await page.evaluate(()=>window.handleBack());
   assert.equal(await page.evaluate(()=>document.activeElement===window.fixtureCartoonAll),true);assert.equal(await page.getByLabel('Anime category').inputValue(),'rom-com');
   await page.getByRole('button',{name:'Anime',exact:true}).click();assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Anime category');await page.getByRole('button',{name:'Movies',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.grid .card').length===60);assert.equal(await page.getByLabel('Catalog category').inputValue(),'Movies');assert.equal(await page.locator('.grid .card-tag').evaluateAll(nodes=>nodes.every(node=>node.textContent==='movie')),true);await page.locator('[data-route="home"]').click();await page.locator('#home-cartoon-results').waitFor();
   assert.equal(f.requests.filter(r=>r.action==='trending'&&r.args.genre==='fighting').length,1);
   assert(f.requests.filter(r=>r.action==='artwork').every(r=>r.args.items.length<=12));
   assert(f.requests.filter(r=>r.action==='trending').every(r=>Object.keys(r.args).every(key=>key==='genre')));
   assert.equal(f.stats.maximumGenres,1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(f.errors,[]);
   await page.getByRole('button',{name:'Search',exact:true}).focus();await page.evaluate(()=>{const main=document.querySelector('main');main.style.scrollBehavior='auto';main.scrollTop=0;});await page.screenshot({path:path.join(output,`trending-${width}.png`)});
   results.push({width,weeklyLimit:20,genreLimit:50,animeCategories:20,cartoonCollections:8,bakiRank:43,neutralFallback:true,focusAndScrollPreserved:true,heroAndGenreOpenWco:true,outdatedGenreDiscarded:true,genreGridBackAndFocus:true,gridDpadToBaki:true,cartoonRatingSourceAndSnapshot:true,cartoonDetailsAndBack:true,contentShortcuts:true,overflow:false,errors:f.errors});await f.context.close();
  }
  const deferred=await fixture(browser),p=deferred.page;await p.locator('.hero .primary').focus();await p.locator('.hero .primary').evaluate(node=>window.originalPrimary=node);
  deferred.weekly.shift()(feed([jjk]));await p.locator('.trending-shelf').waitFor();assert.equal(await p.locator('.hero h1').innerText(),'Find your next favorite.');assert.equal(await p.evaluate(()=>document.activeElement===window.originalPrimary),true);
  await p.getByRole('button',{name:'Search',exact:true}).focus();assert.equal(await p.locator('.hero h1').innerText(),jjk.title);await deferred.context.close();
  const detail=await fixture(browser),d=detail.page;await d.locator('.shelf').filter({has:d.getByRole('heading',{name:'From the WCO catalog',exact:true})}).locator('.card').first().click();
  await d.locator('#detail .detail-info h1').waitFor();const title=await d.locator('#detail .detail-info h1').innerText();detail.weekly.shift()(feed([jjk]));await d.waitForTimeout(100);
  assert.equal(await d.locator('.hero h1').innerText(),'Find your next favorite.');assert.equal(await d.locator('#detail .detail-info h1').innerText(),title);await d.evaluate(()=>window.handleBack());
  assert.equal(await d.locator('.hero h1').innerText(),jjk.title);assert.equal(await d.evaluate(()=>document.activeElement.querySelector('.card-title')?.textContent),title);await detail.context.close();
  const stale=await fixture(browser),s=stale.page;await s.getByRole('button',{name:'Search',exact:true}).click();await s.locator('#search-input').fill('Naruto');await s.locator('.search-form').evaluate(form=>form.requestSubmit());
  await s.waitForFunction(()=>document.querySelector('.grid .card-title')?.textContent.includes('Naruto'));stale.weekly.shift()(feed([jjk]));await s.waitForTimeout(100);
  assert.equal(await s.locator('#search-input').inputValue(),'Naruto');assert.equal(await s.locator('.trending-shelf').count(),0);assert.equal(await s.locator('.grid .card-title').evaluateAll(nodes=>nodes.every(node=>/naruto/i.test(node.textContent))),true);
  await s.locator('[data-route="home"]').click();await until(()=>stale.weekly.length);stale.weekly.shift()(feed([naruto]));await s.waitForFunction(()=>document.querySelector('.hero h1')?.textContent==='Naruto');assert.deepEqual(stale.errors,[]);await stale.context.close();
  const grid=await fixture(browser),g=grid.page;await g.locator('#genre-view-all').click();await g.locator('#genre-grid-results').waitFor();await g.getByLabel('Anime category').selectOption('rom-com');
  grid.weekly.shift()(feed([jjk]));grid.genres.isekai.shift()(animeFeed([isekai],'isekai'));await until(()=>grid.genres['rom-com']?.length);
  assert.equal(await g.locator('.genre-grid .card').count(),0);assert.equal(await g.locator('.hero').count(),0);await g.getByLabel('Anime category').selectOption('sports');
  grid.genres['rom-com'].shift()(animeFeed([comedy],'rom-com'));await until(()=>grid.genres.sports?.length);assert.equal(await g.locator('.genre-grid .card').count(),0);
  await g.locator('[data-route="search"]').click();await g.locator('#search-input').fill('Naruto');await g.locator('.search-form').evaluate(form=>form.requestSubmit());
  grid.genres.sports.shift()(animeFeed([naruto],'sports'));await g.waitForTimeout(100);assert.equal(await g.locator('#search-input').inputValue(),'Naruto');assert.equal(await g.locator('#genre-grid-results').count(),0);
  await g.locator('[data-route="home"]').click();await g.locator('#genre-view-all').waitFor();await g.locator('#genre-view-all').click();await g.locator('.genre-grid .card').waitFor();assert.equal(await g.locator('#genre-intro h1').innerText(),'Sports & Competition anime');
  assert.equal(grid.requests.filter(r=>r.action==='trending'&&r.args.genre==='sports').length,1);assert.deepEqual(grid.errors,[]);await grid.context.close();
  const cross=await fixture(browser,960,{holdCartoons:['cartoon-adult']}),c=cross.page;
  await c.getByLabel('Anime category').selectOption('slice-of-life');await c.getByLabel('Cartoon collection').selectOption('cartoon-adult');cross.genres.isekai.shift()(animeFeed([isekai],'isekai'));await until(()=>cross.genres['slice-of-life']?.length);
  cross.genres['slice-of-life'].shift()(animeFeed([naruto],'slice-of-life'));await until(()=>cross.genres['cartoon-adult']?.length);await c.getByLabel('Cartoon collection').selectOption('cartoon-mysteries');await c.getByLabel('Anime category').selectOption('fighting');
  cross.genres['cartoon-adult'].shift()(cartoonFeed('cartoon-adult'));await until(()=>cross.genres.fighting?.length);await c.waitForFunction(()=>document.querySelector('#home-cartoon-results .card-title')?.textContent==='A Pup Named Scooby-Doo');
  cross.genres.fighting.shift()(feed([family],{genre:'fighting',type:'cartoons',metric:'rating',source:'TVmaze'}));await c.waitForFunction(()=>document.querySelector('#home-genre-results .trending-status')?.textContent.includes('unavailable'));
  assert.equal(await c.locator('#home-genre-results .card').count(),0);assert.equal(await c.getByLabel('Cartoon collection').inputValue(),'cartoon-mysteries');assert.equal(await c.locator('#home-cartoon-results .card-title').innerText(),scooby.title);
  await c.getByLabel('Anime category').selectOption('isekai');assert.equal(await c.locator('#home-genre-results .card-title').innerText(),isekai.title);assert.equal(cross.requests.filter(r=>r.action==='trending'&&r.args.genre==='isekai').length,1);assert.equal(cross.stats.maximumGenres,1);assert.deepEqual(cross.errors,[]);await cross.context.close();
  const timer=await fixture(browser,960,{autoFeeds:true,clock:true}),t=timer.page,reads=()=>timer.requests.filter(r=>r.action==='trending').length;await t.clock.pauseAt(new Date('2026-11-18T03:00:05Z'));
  const initialReads=reads();await t.locator('.trending-shelf .card').first().focus();await t.evaluate(()=>{window.timerNodes=[document.querySelector('.hero .primary'),document.querySelector('.trending-shelf .card'),document.querySelector('#home-genre-results .card'),document.querySelector('#home-cartoon-results .card')];window.timerFocus=document.activeElement;});
  await t.clock.fastForward(15*60000);assert.equal(reads(),initialReads);await t.clock.fastForward(45*60000);await until(()=>reads()===initialReads+3);await t.waitForTimeout(30);
  assert.equal(await t.evaluate(()=>document.activeElement===window.timerFocus&&[document.querySelector('.hero .primary'),document.querySelector('.trending-shelf .card'),document.querySelector('#home-genre-results .card'),document.querySelector('#home-cartoon-results .card')].every((node,i)=>node===window.timerNodes[i])),true);
  await t.getByRole('button',{name:'Search',exact:true}).click();const searchReads=reads();await t.clock.fastForward(2*3600000);assert.equal(reads(),searchReads);
  await t.locator('[data-route="home"]').click();await t.locator('.trending-shelf .card').first().waitFor();await until(()=>reads()===searchReads+3);await t.locator('.trending-shelf .card').first().click();const detailReads=reads();await t.clock.fastForward(3600000);assert.equal(reads(),detailReads);await t.evaluate(()=>window.handleBack());
  await t.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:true}));await t.clock.fastForward(3600000);assert.equal(reads(),detailReads);
  await t.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await until(()=>reads()===detailReads+3);assert.deepEqual(timer.errors,[]);await timer.context.close();
  results.push({deferredHeroFocus:true,deferredDetailsUpdate:true,staleHomeDiscarded:true,genrePayloadsExcludeHistory:true,genreGridAsyncStaleDiscarded:true,genreGridCacheAfterSearch:true,independentAnimeCartoonSelections:true,cartoonLateReplyDiscarded:true,rankingMetricMismatchRejected:true,maximumGenreRequests:1,noFifteenMinutePolling:true,hourlyHomeCacheChecks:true,identicalRefreshPreservesNodesAndFocus:true,noSearchDetailsOrBackgroundPolling:true,refreshOnForeground:true});fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

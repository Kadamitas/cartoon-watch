import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {TrendingStore,matcher,ranked} from './trending.mjs';
import {createCompanion} from './service.mjs';

const catalog=JSON.parse(await fs.readFile(new URL('../app/src/main/assets/catalog-index.json',import.meta.url),'utf8'));
const now=Date.parse('2026-11-18T12:00:00Z'),end=Date.parse('2026-11-18T00:00:00Z')/1000,match=matcher(catalog);
const media=(id,idMal,title,extra={})=>({id,idMal,title:{english:title},type:'ANIME',format:'TV',status:'FINISHED',isAdult:false,...extra});
const jjk=media(113415,40748,'Jujutsu Kaisen'),baki=media(97888,34443,'BAKI'),naruto=media(20,20,'Naruto');
const days=(score,count=7)=>Array.from({length:count},(_,i)=>({date:end-(i+1)*86400,trending:score}));
const weekly={data:{Page:{mediaTrends:[{media:{...jjk,trends:{nodes:[{date:end,trending:1000000},...days(10)]}}},{media:{...naruto,trends:{nodes:days(60,1)}}},{media:{...jjk,trends:{nodes:days(10)}}}]}}};
const queries={weekly:'query WeeklyTrend($since:Int!,$until:Int!){Page{mediaTrends{mediaId}}}',genre:'query GenrePopular($genre:String,$tag:String){Page{media{id}}}'};
const answer=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

test('weekly ranking sums completed UTC days once and rejects current-day spikes',()=>{
  const items=ranked(weekly.data,match,'',now);assert.deepEqual(items.map(item=>item.title),['Jujutsu Kaisen','Naruto']);assert.deepEqual(items.map(item=>item.trendRank),[1,2]);assert.ok(items.every(item=>item.provider==='wcostream'));assert.throws(()=>ranked({},match,'',now));
});

test('exact WCO matches, guarded season families, and unrelated prequels stay distinct',()=>{
  assert.match(match(baki).url,/\/anime\/baki-2018$/);assert.equal(match(media(1,0,'Jujutsu Kaisen')).url,match(jjk).url);
  const season=media(999999,999999,'JUJUTSU KAISEN: The Culling Game Part 1',{relations:{edges:[{relationType:'PREQUEL',node:media(145064,51009,'JUJUTSU KAISEN Season 2')}]}});
  assert.equal(match(season).url,match(jjk).url);
  assert.equal(match(media(888888,888888,'Monsters',{relations:{edges:[{relationType:'PREQUEL',node:media(21,21,'One Piece')}]}})),null);
  assert.equal(match({...jjk,isAdult:true}),null);assert.equal(match({...jjk,status:'NOT_YET_RELEASED'}),null);assert.equal(match({...jjk,format:'MOVIE'}),null);
  assert.equal(match(media(999998,999998,'Jujutsu Kaisen')),null);
  const ambiguous=matcher({items:[{...match(jjk),title:'Shared Name',imageSourceUrl:'',url:'https://www.wcostream.tv/anime/shared-1'},{...match(naruto),title:'Shared Name',imageSourceUrl:'',url:'https://www.wcostream.tv/anime/shared-2'}]});assert.equal(ambiguous(media(10,0,'Shared Name')),null);
});

test('Baki remains available beyond20 genre results and duplicate containers keep their strongest season',()=>{
  const rows=Array.from({length:35},(_,i)=>media(i+1,10000+i,'Fixture '+i,{popularity:1000-i}));rows.push({...baki,popularity:1});
  const fake=value=>value.id===baki.id?match(baki):{...match(naruto),url:'https://www.wcostream.tv/anime/fixture-'+value.id,title:'Fixture '+value.id};
  const items=ranked({Page:{media:rows}},fake,'fighting',now);assert.equal(items.length,36);assert.match(items.at(-1).url,/baki-2018$/);
  const duplicates=ranked({Page:{media:[{...jjk,popularity:10},{...jjk,id:2,popularity:30}]}},match,'action',now);assert.equal(duplicates.length,1);assert.equal(duplicates[0].trendRank,1);
});

test('feed calls coalesce, cache privately, and send no viewing data',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cw-trends-')),cacheFile=path.join(folder,'feed.json');let calls=0,received;
  const fetcher=async(url,options)=>{calls++;received={url,body:JSON.parse(options.body)};await new Promise(resolve=>setTimeout(resolve,20));return answer(weekly);};
  const store=new TrendingStore({catalog,queries,cacheFile,now:()=>now,fetcher});
  try{
    const values=await Promise.all(Array.from({length:5},()=>store.lookup()));assert.equal(calls,1);assert.ok(values.every(value=>value.items.length===2&&!value.stale));
    assert.equal(received.url,'https://graphql.anilist.co');assert.deepEqual(Object.keys(received.body).sort(),['query','variables']);assert.deepEqual(received.body.variables,{since:end-7*86400-1,until:end});
    values[0].items.length=0;assert.equal((await store.lookup()).items.length,2);assert.equal(calls,1);
    const reopened=new TrendingStore({catalog,queries,cacheFile,now:()=>now,fetcher});assert.equal((await reopened.lookup()).items.length,2);assert.equal(calls,1);reopened.close();
    const saved=JSON.parse(await fs.readFile(cacheFile,'utf8'));assert.ok(Buffer.byteLength(JSON.stringify(saved))<=128*1024);assert.equal(saved.entries.length,1);assert.equal('data'in saved.entries[0][1],false);
  }finally{store.close();await fs.rm(cacheFile,{force:true});await fs.rm(cacheFile+'.tmp',{force:true});await fs.rmdir(folder);}
});

test('rate limits preserve dated stale results and suppress repeated failed requests',async()=>{
  let clock=now,calls=0;const store=new TrendingStore({catalog,queries,now:()=>clock,fetcher:async()=>{calls++;return calls===1?answer(weekly):new Response('',{status:429,headers:{'retry-after':'1800'}});}});
  try{
    const first=await store.lookup();clock+=24*3600000+1;const stale=await store.lookup();assert.equal(stale.stale,true);assert.equal(stale.updatedAt,first.updatedAt);assert.equal(stale.retryAfter,1800);
    await store.lookup('fighting');await store.lookup();assert.equal(calls,2);clock=now+8*86400000;assert.equal((await store.lookup()).available,false);assert.equal((await store.lookup()).items.length,0);
    await assert.rejects(store.lookup('not-a-genre'),/available discovery category/);
  }finally{store.close();}
});

test('malformed or oversized feeds retain cached data and different genre queues stay bounded',async()=>{
  let calls=0;const store=new TrendingStore({catalog,queries,now:()=>now,fetcher:async()=>{calls++;return new Response('x'.repeat(512*1024+1));}});
  try{assert.equal((await store.lookup()).available,false);await store.lookup();assert.equal(calls,1);}finally{store.close();}
  let release;const blocked=new TrendingStore({catalog,queries,now:()=>now,fetcher:async()=>{await new Promise(resolve=>release=resolve);return answer({data:{Page:{media:[{...baki,popularity:100}]}}});}});
  const waiting=['fighting','isekai','mecha','seinen','rom-com'].map(genre=>blocked.lookup(genre));while(!release)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(blocked.pending.size,5);assert.equal((await blocked.lookup('shoujo')).available,false);blocked.close();release();await Promise.all(waiting);
});

test('refreshed weeks roll forward, rate-limit cooldown survives restart, and cache writes stay bounded',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cw-trend-roll-')),cacheFile=path.join(folder,'feed.json');let clock=now,calls=0;
  const fetcher=async()=>{calls++;return calls<=2?answer(weekly):new Response('',{status:429,headers:{'retry-after':'3600'}});};
  const store=new TrendingStore({catalog,queries,cacheFile,now:()=>clock,fetcher});
  try{
    const first=await store.lookup();clock+=86400000;const next=await store.lookup();assert.notEqual(next.periodEnd,first.periodEnd);assert.equal(Date.parse(next.periodEnd)-Date.parse(first.periodEnd),86400000);
    clock+=24*3600000+1;await store.lookup();assert.equal(calls,3);
    const reopened=new TrendingStore({catalog,queries,cacheFile,now:()=>clock,fetcher});assert.equal((await reopened.lookup()).stale,true);await reopened.lookup('fighting');assert.equal(calls,3);reopened.close();
    store.cache.clear();store.cache.set('fighting',{at:clock,result:{items:[],padding:'x'.repeat(140000)}});await store.save();assert.ok((await fs.stat(cacheFile)).size<=128*1024);assert.equal(store.cache.size,0);
  }finally{store.close();await fs.rm(cacheFile,{force:true});await fs.rm(cacheFile+'.tmp',{force:true});await fs.rmdir(folder);}
});

test('companion endpoint uses the selected genre and rejects invalid requests',async()=>{
  const store=new TrendingStore({catalog,queries,now:()=>now,fetcher:async()=>answer({data:{Page:{media:[{...baki,popularity:100}]}}})});
  const server=createCompanion({catalog,trending:store});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  try{const result=await(await fetch(base+'/api/trending?genre=fighting')).json();assert.match(result.items[0].url,/baki-2018$/);assert.equal(result.genreLabel,'Fighting');assert.equal(result.metric,'popularity');assert.equal((await fetch(base+'/api/trending?genre=unknown')).status,400);assert.equal((await fetch(base+'/api/trending',{method:'POST'})).status,405);}finally{store.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('anime categories use actual Isekai, Mecha, and combined Rom-Com filters',async()=>{
  const sent=[],store=new TrendingStore({catalog,queries,now:()=>now,fetcher:async(url,options)=>{sent.push(JSON.parse(options.body).variables);return answer({data:{Page:{media:[{...baki,popularity:100}]}}});}});
  try{for(const category of ['isekai','mecha','rom-com'])assert.equal((await store.lookup(category)).type,'anime');assert.deepEqual(sent,[{genre:null,tag:'Isekai',genres:null,tagRank:70},{genre:'Mecha',tag:null,genres:null,tagRank:null},{genre:null,tag:null,genres:['Romance','Comedy'],tagRank:null}]);}finally{store.close();}
});

test('daily refresh is live metadata and missing covers use trusted larger AniList artwork',async()=>{
  let clock=now,calls=0;const store=new TrendingStore({catalog,queries,now:()=>clock,fetcher:async()=>{calls++;return answer(weekly);}});
  try{await store.lookup();clock+=23*3600000;await store.lookup();assert.equal(calls,1);clock+=2*3600000;await store.lookup();assert.equal(calls,2);}finally{store.close();}
  const image='https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21-test.jpg',input={Page:{media:[{...naruto,popularity:100,coverImage:{large:image}}]}};
  const original={...match(naruto),image:''},missing=ranked(input,()=>original,'fighting',now)[0];assert.equal(missing.image,image);assert.equal(missing.url,original.url);assert.equal(missing.imageSource,'AniList');assert.equal(original.image,'');
  const known=match(jjk);assert.equal(ranked(input,()=>known,'fighting',now)[0].image,known.image);
  for(const bad of [image.replace('/large/','/extraLarge/'),image.replace('s4.anilist.co','evil.example'),image+'?key=private',image.replace('https:','http:')]){input.Page.media[0].coverImage.large=bad;assert.equal(ranked(input,()=>original,'fighting',now)[0].image,'');}
});

test('promotion banners stay separate from posters and supported season families keep their cover identity',()=>{
  const image='https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx113415-test.jpg',medium=image.replace('/large/','/medium/'),banner='https://s4.anilist.co/file/anilistcdn/media/anime/banner/113415-test.jpg',original={...match(jjk),image:medium,imageSource:'AniList',imageSourceUrl:'https://anilist.co/anime/113415'},local=matcher({items:[original]});
  const direct=ranked({Page:{media:[{...jjk,popularity:50,coverImage:{large:image,medium},bannerImage:banner}]}},local,'fighting',now)[0];assert.equal(direct.image,image);assert.equal(direct.backdrop,banner);assert.equal(direct.backdropSource,'AniList');assert.equal(direct.backdropSourceUrl,'https://anilist.co/anime/113415');assert.equal(original.image,medium);assert.equal(original.backdrop,undefined);
  const leaf=media(999999,999999,'JUJUTSU KAISEN: The Culling Game Part 1',{popularity:100,coverImage:{large:image},bannerImage:banner,relations:{edges:[{relationType:'PREQUEL',node:media(145064,51009,'JUJUTSU KAISEN Season 2')}]}});
  const family=ranked({Page:{media:[leaf]}},local,'fighting',now)[0];assert.equal(local.details(leaf).direct,false);assert.equal(family.image,medium);assert.equal(family.backdrop,banner);assert.equal(family.url,original.url);
  const known=match(jjk),kept=ranked({Page:{media:[{...jjk,popularity:50,coverImage:{large:image},bannerImage:banner}]}},matcher({items:[known]}),'fighting',now)[0];assert.equal(kept.image,known.image);assert.equal(kept.backdrop,banner);
  for(const bad of [image,banner+'?key=private',banner.replace('s4.anilist.co','example.invalid'),banner.replace('.jpg','.svg')]){const result=ranked({Page:{media:[{...jjk,popularity:50,bannerImage:bad}]}},local,'fighting',now)[0];assert.equal(result.backdrop,undefined);}
});

test('artwork query version invalidates old metadata caches',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cw-trend-art-')),cacheFile=path.join(folder,'feed.json');let calls=0;
  await fs.writeFile(cacheFile,JSON.stringify({version:'4:'+catalog.version,entries:[['',{at:now,result:{items:[match(jjk)],available:true}}]]}));
  const store=new TrendingStore({catalog,queries,cacheFile,now:()=>now,fetcher:async()=>{calls++;return answer(weekly);}});
  try{assert.equal((await store.lookup()).items.length,2);assert.equal(calls,1);assert.equal(JSON.parse(await fs.readFile(cacheFile,'utf8')).version,'5:'+catalog.version);}finally{store.close();await fs.rm(cacheFile,{force:true});await fs.rm(cacheFile+'.tmp',{force:true});await fs.rmdir(folder);}
});

test('cartoon collections stay WCO-only, use snapshot ratings, and work without an anime API call',async()=>{
  const family=catalog.items.find(item=>item.title==='Family Guy'&&item.kind==='series'),south=catalog.items.find(item=>item.title==='South Park'&&item.kind==='series');assert.ok(family&&south);
  const snapshot={version:1,updatedAt:'2026-11-17T00:00:00Z',collections:{'cartoon-adult':[{url:family.url,rating:7.3},{url:south.url,rating:8.7},{url:match(baki).url,rating:10},{url:'https://invalid.example/show',rating:10}]}};
  let calls=0;const store=new TrendingStore({catalog,queries,cartoons:snapshot,now:()=>now+30*86400000,fetcher:async()=>{calls++;throw Error('Offline');}});
  try{await store.lookup();const result=await store.lookup('cartoon-adult');assert.equal(calls,1);assert.deepEqual(result.items.map(item=>item.title),['South Park','Family Guy']);assert.equal(result.type,'cartoons');assert.equal(result.metric,'rating');assert.equal(result.source,'TVmaze');assert.equal(result.snapshotAt,snapshot.updatedAt);assert.equal(result.stale,false);assert.equal(result.items[0].trendRating,8.7);result.items.pop();assert.equal((await store.lookup('cartoon-adult')).items.length,2);}finally{store.close();}
});

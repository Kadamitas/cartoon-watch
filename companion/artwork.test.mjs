import test from 'node:test';
import assert from 'node:assert/strict';
import {ArtworkStore,artworkURL,imageDimensions,smallImage} from './artwork.mjs';
import {createCompanion} from './service.mjs';

const title='https://www.wcostream.tv/anime/naruto',episode='https://www.wcostream.tv/naruto-episode-3-english-dubbed';
const poster='https://cdn.myanimelist.net/images/anime/1141/142503.jpg';
const catalog={items:[{title:'Naruto',url:title,kind:'series',image:poster,imageSource:'MyAnimeList',imageSourceUrl:'https://myanimelist.net/anime/20',imageAttribution:'Cover art via MyAnimeList'}],coverage:[{category:'Dubbed anime'}]};
const wait=async predicate=>{for(let i=0;i<50;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Artwork work did not settle');};

test('bulk series covers use small URLs, provenance and parent-only episode routing',()=>{
  let calls=0;const store=new ArtworkStore({catalog,resolve:async()=>{calls++;throw Error();}});
  const result=store.lookup([{url:title,kind:'series'},{url:episode,kind:'episode',seriesUrl:title},{url:episode+'-other',kind:'episode'}]);
  assert.equal(result.pending.length,0);assert.equal(calls,0);assert.match(result.items[0].image,/\/r\/160x225\/images\/anime\//);assert.equal(result.items[0].imageSource,'MyAnimeList');assert.equal(result.items[1].url,episode);assert.equal(result.items[1].image,result.items[0].image);assert.equal(result.items[2].image,'');
  assert.match(artworkURL('https://static.tvmaze.com/uploads/images/original_untouched/1/2.jpg'),/medium_portrait/);store.close();
});

test('missing series work coalesces and failures are negatively cached',async()=>{
  let calls=0,release;const url='https://www.wcostream.tv/anime/another';
  const store=new ArtworkStore({catalog:{items:[]},verify:async()=>true,resolve:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});
  assert.deepEqual(store.lookup([{url}]).pending,[url]);store.lookup([{url}]);await wait(()=>!!release);assert.equal(calls,1);
  release({image:'https://images.wcostream.com/catimg/123.jpg'});await wait(()=>store.pending.size===0);
  const resolved=store.lookup([{url}]).items[0];assert.equal(resolved.imageSource,'WCO');assert.equal(resolved.imageSourceUrl,url);assert.equal(resolved.url,url);store.close();
  const failed=new ArtworkStore({catalog:{items:[]},resolve:async()=>{calls++;throw Error('offline');}});failed.lookup([{url}]);await wait(()=>failed.pending.size===0);const before=calls;assert.equal(failed.lookup([{url}]).items[0].image,'');assert.equal(calls,before);failed.close();
});

test('artwork work is bounded while an unavailable provider is slow',()=>{
  const store=new ArtworkStore({catalog:{items:[]},resolve:()=>new Promise(()=>{})});
  for(let offset=0;offset<60;offset+=12)store.lookup(Array.from({length:12},(_,i)=>({url:'https://www.wcostream.tv/anime/title-'+(i+offset)})));
  assert(store.active<=2);assert(store.queue.length<=24);assert(store.pending.size<=26);store.close();assert.equal(store.queue.length,0);
});

test('other image hosts are probed for actual pixel and download limits',async()=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aaf0AAAAASUVORK5CYII=','base64');
  assert.deepEqual(imageDimensions(png),[1,1]);assert.equal(imageDimensions(Buffer.from([255,216,255,255,255,255,255])),null);
  const fetcher=async()=>new Response(png,{headers:{'content-type':'image/png'}});
  assert.equal(await smallImage('https://images.wcostream.com/catimg/test.png',fetcher),true);
  const huge=Buffer.from(png);huge.writeUInt32BE(1024,16);assert.equal(await smallImage('https://images.wcostream.com/catimg/test.png',async()=>new Response(huge,{headers:{'content-type':'image/png'}})),false);
  assert.equal(await smallImage('https://images.wcostream.com/catimg/test.png',async()=>new Response(png,{headers:{'content-type':'image/png','content-length':'600000'}})),false);
  assert.equal(await smallImage('https://cdn.myanimelist.net.evil.invalid/art.jpg',()=>{throw Error('must not fetch');}),false);
});

test('LAN artwork endpoint preserves the bounded bridge protocol',async t=>{
  const artwork=new ArtworkStore({catalog,resolve:async()=>{throw Error('not needed');}});
  const server=createCompanion({catalog,artwork,details:async()=>({}),play:async()=>({}),media:{proxy:async()=>{}}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{artwork.close();server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port;
  const result=await fetch(base+'/api/artwork',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items:[{url:title,kind:'series'}]})});assert.equal(result.status,200);const data=await result.json();assert.equal(data.items[0].url,title);assert.equal(data.pending.length,0);
  const oversized=await fetch(base+'/api/artwork',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items:Array(13).fill({url:title})})});assert.equal(oversized.status,400);await oversized.json();
  const wrongMethod=await fetch(base+'/api/artwork');assert.equal(wrongMethod.status,405);await wrongMethod.json();
});

import fs from 'node:fs/promises';
import path from 'node:path';

const registry=JSON.parse(await fs.readFile(new URL('../app/src/main/assets/discovery-categories.json',import.meta.url),'utf8'));
export const CATEGORIES=Object.fromEntries(registry.categories.map(row=>[row.key,row]));
const ttl=86400000,maxAge=7*86400000,maxBytes=512*1024,cacheBytes=128*1024;
const key=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/ (?:english )?(?:dubbed|subbed|dub|sub)$/,'');
const season=/ (?:season|part|cour)(?: |$)/;
function family(value){let result=key(value);for(let i=0;i<3;i++)result=result.replace(/ (?:(?:season|part|cour) (?:[0-9]+|[ivx]+|one|two|three|four|five|six|seven|eight|nine|ten|final)|(?:[0-9]+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|final) season)$/,'').trim();return result;}
const mal=item=>Number(String(item?.imageSourceUrl||'').match(/^https?:\/\/(?:www\.)?myanimelist\.net\/anime\/(\d+)(?:[/?#]|$)/i)?.[1])||0;
const aliases=media=>[media?.title?.english,media?.title?.romaji,media?.title?.native,...(Array.isArray(media?.synonyms)?media.synonyms:[])].filter(value=>typeof value==='string'&&value.length<=300).map(key).filter(value=>value.length>=2).slice(0,24);
const valid=media=>media?.type==='ANIME'&&['TV','TV_SHORT','ONA'].includes(media.format)&&media.isAdult!==true&&media.status!=='NOT_YET_RELEASED';
function aniListImage(value,variant){
  try{const url=new URL(value),folder=variant==='backdrop'?'banner':'cover/(?:small|medium|large)';return url.protocol==='https:'&&url.hostname==='s4.anilist.co'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&url.href.length<=2048&&new RegExp('^/file/anilistcdn/media/anime/'+folder+'/[A-Za-z0-9._-]+\\.(?:jpe?g|png|webp)$').test(url.pathname)?url.href:'';}catch{return '';}
}
function cover(item,media,direct){
  const image=aniListImage(media.coverImage?.large,'poster')||aniListImage(media.coverImage?.medium,'poster'),backdrop=aniListImage(media.bannerImage,'backdrop'),result={...item},sourceUrl='https://anilist.co/anime/'+media.id;
  if(image&&(!item.image||direct&&item.imageSource==='AniList'&&aniListImage(item.image,'poster')&&/\/cover\/(?:small|medium)\//.test(item.image)))Object.assign(result,{image,imageSource:'AniList',imageSourceUrl:sourceUrl,imageAttribution:'Cover metadata from AniList; artwork belongs to its respective owners.'});
  if(backdrop)Object.assign(result,{backdrop,backdropSource:'AniList',backdropSourceUrl:sourceUrl,backdropAttribution:'Promotional artwork metadata from AniList; artwork belongs to its respective owners.'});
  return result;
}
function choose(items,identity=false){
  const unique=[...new Map(items.map(item=>[item.url,item])).values()];if(!unique.length||unique.length>8)return null;
  if(!identity&&unique.length>1){const ids=new Set(unique.map(mal));if(ids.size!==1||ids.has(0))return null;}
  return unique.sort((a,b)=>Number(b.categories?.includes('Dubbed anime'))-Number(a.categories?.includes('Dubbed anime'))||a.url.localeCompare(b.url))[0];
}
export function matcher(catalog){
  const ids=new Map(),titles=new Map();
  for(const item of catalog.items){
    if(item.kind!=='series'||!item.categories?.some(value=>value==='Dubbed anime'||value==='Subbed anime'))continue;
    for(const [map,id] of [[ids,mal(item)],[titles,key(item.title)]])if(id){if(!map.has(id))map.set(id,[]);map.get(id).push(item);}
  }
  const exact=(media,extra=[],generic=false)=>{
    let found=(ids.get(Number(media.idMal))||[]).filter(item=>!generic||!season.test(' '+key(item.title)));
    if(found.length)return choose(found,true);
    found=[...aliases(media),...extra].flatMap(value=>titles.get(value)||[]).filter(item=>(generic||!Number(media.idMal)||!mal(item)||mal(item)===Number(media.idMal))&&(!generic||!season.test(' '+key(item.title))));
    return choose(found);
  };
  const details=media=>{
    if(!valid(media))return null;const direct=exact(media);if(direct)return {item:direct,direct:true};
    const leaf=aliases(media),found=[];
    for(const edge of (media.relations?.edges||[]).slice(0,80)){
      const parent=edge.node;if(edge.relationType!=='PREQUEL'||!valid(parent))continue;
      const roots=aliases(parent).map(family).filter(value=>value.length>=4);
      if(!roots.some(root=>leaf.some(value=>value===root||value.startsWith(root+' '))))continue;
      const item=exact(parent,roots,true);if(item)found.push(item);
    }
    const unique=[...new Map(found.map(item=>[item.url,item])).values()];return unique.length===1?{item:unique[0],direct:false}:null;
  };
  const match=media=>details(media)?.item||null;match.details=details;return match;
}
export function ranked(data,match,genre,now){
  const until=Math.floor(now/86400000)*86400,since=until-7*86400,seen=new Set(),byURL=new Map();
  const raw=genre?data?.Page?.media:data?.Page?.mediaTrends;if(!Array.isArray(raw))throw Error('Invalid discovery response');
  const rows=genre?raw:raw.map(row=>row.media);
  for(const media of rows.slice(0,50)){
    if(!media||!Number.isInteger(media.id)||media.id<=0||seen.has(media.id))continue;seen.add(media.id);
    let score=0;
    if(genre)score=Number(media.popularity)||0;
    else{const days=new Set();for(const day of (media.trends?.nodes||[]).slice(0,8)){const date=Math.floor(day.date/86400)*86400;if(Number.isInteger(day.date)&&date>=since&&date<until&&!days.has(date)){days.add(date);score+=Math.min(1e9,Math.max(0,Number(day.trending)||0));}}}
    if(!Number.isFinite(score)||score<=0)continue;const matched=match.details?match.details(media):{item:match(media),direct:true};if(!matched?.item)continue;const item=cover(matched.item,media,matched.direct);
    const previous=byURL.get(item.url);if(!previous||score>previous.score||score===previous.score&&media.id<previous.id)byURL.set(item.url,{item,score,id:media.id,title:media.title?.english||media.title?.romaji||item.title});
  }
  return [...byURL.values()].sort((a,b)=>b.score-a.score||a.id-b.id).slice(0,genre?50:20).map(({item,title},index)=>({...item,trendRank:index+1,trendTitle:title}));
}
export class TrendingStore{
  constructor({catalog,queries,cacheFile,cartoons,now=Date.now,fetcher=fetch}){
    this.match=matcher(catalog);this.records=new Map(catalog.items.map(item=>[item.url,item]));this.cartoons=cartoons;this.cartoonCache=new Map();this.queries=queries;this.cacheFile=cacheFile;this.now=now;this.fetcher=fetcher;this.version='5:'+catalog.version;this.cache=new Map();this.pending=new Map();this.tail=Promise.resolve();this.retryAt=0;this.closed=false;this.loaded=this.load();
  }
  async load(){
    if(!this.cacheFile)return;
    try{const stat=await fs.stat(this.cacheFile);if(stat.size>cacheBytes)return;const saved=JSON.parse(await fs.readFile(this.cacheFile,'utf8'));if(saved.version!==this.version||!Array.isArray(saved.entries))return;
      this.retryAt=Math.min(this.now()+86400000,Math.max(0,Number(saved.retryAt)||0));
      for(const [id,value] of saved.entries.slice(-14))if((id===''||CATEGORIES[id]?.type==='anime')&&Number.isFinite(value.at)&&value.at<=this.now()&&this.now()-value.at<=maxAge&&Array.isArray(value.result?.items)&&value.result.items.length<=(id?50:20))this.cache.set(id,value);
    }catch{}
  }
  value(genre,stale=false){
    const saved=this.cache.get(genre),now=this.now(),valid=saved&&now>=saved.at&&now-saved.at<=maxAge;
    if(valid){this.cache.delete(genre);this.cache.set(genre,saved);return {...structuredClone(saved.result),stale:stale||now-saved.at>=ttl,retryAfter:Math.max(0,Math.ceil((this.retryAt-now)/1000))};}
    return this.empty(genre,now);
  }
  empty(genre,now=this.now()){
    const until=Math.floor(now/86400000)*86400000;
    return {items:[],source:'AniList',type:'anime',metric:genre?'popularity':'weeklyActivity',genre,genreLabel:genre?CATEGORIES[genre].label:'',periodStart:new Date(until-7*86400000).toISOString(),periodEnd:new Date(until).toISOString(),updatedAt:'',stale:false,available:false,retryAfter:Math.max(0,Math.ceil((this.retryAt-now)/1000))};
  }
  async cartoonFeed(genre){
    if(this.cartoonCache.has(genre))return structuredClone(this.cartoonCache.get(genre));
    if(!this.cartoons){try{const file=new URL('../app/src/main/assets/cartoon-discovery.json',import.meta.url);if((await fs.stat(file)).size>cacheBytes)throw Error('Snapshot too large');this.cartoons=JSON.parse(await fs.readFile(file,'utf8'));}catch{this.cartoons={collections:{}};}}
    const snapshot=this.cartoons,items=[],seen=new Set(),rows=snapshot.collections?.[genre];
    for(const entry of (Array.isArray(rows)?rows:[]).slice(0,50)){
      const item=this.records.get(entry.url);if(!item||item.kind!=='series'||!item.categories?.includes('Cartoons')||seen.has(item.url))continue;seen.add(item.url);
      const rating=typeof entry.rating==='number'&&Number.isFinite(entry.rating)&&entry.rating>=0&&entry.rating<=10?entry.rating:null,value={...item};if(rating!==null)value.trendRating=rating;items.push(value);
    }
    items.sort((a,b)=>(b.trendRating??-1)-(a.trendRating??-1)||(key(a.title)<key(b.title)?-1:key(a.title)>key(b.title)?1:a.url<b.url?-1:a.url>b.url?1:0));items.forEach((item,index)=>item.trendRank=index+1);
    const date=Number.isFinite(Date.parse(snapshot.updatedAt))?snapshot.updatedAt:'',result={items,source:'TVmaze',type:'cartoons',metric:'rating',genre,genreLabel:CATEGORIES[genre].label,snapshotAt:date,updatedAt:date,stale:false,available:items.length>0};this.cartoonCache.set(genre,result);return structuredClone(result);
  }
  async lookup(genre=''){
    if(typeof genre!=='string'||genre!==''&&!Object.hasOwn(CATEGORIES,genre)){const error=Error('Choose an available discovery category');error.status=400;throw error;}
    if(genre&&CATEGORIES[genre].type==='cartoons')return this.cartoonFeed(genre);
    await this.loaded;const saved=this.cache.get(genre);
    if(saved&&this.now()>=saved.at&&this.now()-saved.at<ttl)return this.value(genre);
    if(this.closed||this.now()<this.retryAt)return this.value(genre,true);
    if(this.pending.has(genre))return structuredClone(await this.pending.get(genre));
    if(this.pending.size>=5)return this.value(genre,true);
    const task=this.tail.then(()=>this.refresh(genre)).finally(()=>this.pending.delete(genre));this.pending.set(genre,task);this.tail=task.catch(()=>{});return structuredClone(await task);
  }
  async refresh(genre){
    if(this.closed||this.now()<this.retryAt)return this.value(genre,true);
    const now=this.now(),until=Math.floor(now/86400000)*86400,category=CATEGORIES[genre],variables=genre?{genre:category.genre||null,tag:category.tag||null,genres:category.genres||null,tagRank:category.tag?70:null}:{since:until-7*86400-1,until};
    this.controller=new AbortController();const timer=setTimeout(()=>this.controller?.abort(),12000);
    try{
      const response=await this.fetcher('https://graphql.anilist.co',{method:'POST',redirect:'error',headers:{'content-type':'application/json',accept:'application/json','user-agent':'CartoonWatch/0.5 (anime discovery)'},body:JSON.stringify({query:this.queries[genre?'genre':'weekly'],variables}),signal:this.controller.signal});
      if(!response.ok){const retry=response.headers.get('retry-after'),seconds=Number(retry)||Math.max(0,(Date.parse(retry)-now)/1000)||0;this.retryAt=now+Math.min(86400,Math.max(900,seconds))*1000;throw Error('Discovery temporarily unavailable');}
      const reader=response.body.getReader(),chunks=[];let size=0;
      try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw Error('Discovery response too large');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(body.errors?.length)throw Error('Discovery temporarily unavailable');
      const result=this.empty(genre,now);result.items=ranked(body.data,this.match,genre,now);result.updatedAt=new Date(now).toISOString();result.available=result.items.length>0;result.stale=false;result.retryAfter=0;
      this.cache.delete(genre);this.cache.set(genre,{at:now,result});await this.save();return structuredClone(result);
    }catch{this.retryAt=Math.max(this.retryAt,this.now()+900000);await this.save();return this.value(genre,true);}
    finally{clearTimeout(timer);this.controller=null;}
  }
  async save(){
    let body;
    for(;;){body=JSON.stringify({version:this.version,retryAt:this.retryAt,entries:[...this.cache]});if(this.cache.size>14||Buffer.byteLength(body)>cacheBytes)this.cache.delete(this.cache.keys().next().value);else break;}
    if(!this.cacheFile)return;
    try{await fs.mkdir(path.dirname(this.cacheFile),{recursive:true});await fs.writeFile(this.cacheFile+'.tmp',body);await fs.rename(this.cacheFile+'.tmp',this.cacheFile);}catch{}
  }
  close(){this.closed=true;this.controller?.abort();}
}

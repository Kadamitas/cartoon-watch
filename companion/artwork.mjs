const hosts=new Set(['static.tvmaze.com','cdn.myanimelist.net','cdn.anime-planet.com','cdn.anisearch.com','media.kitsu.app','s4.anilist.co','cdn.animenewsnetwork.com','cdn.anidb.net','simkl.in','u.livechart.me','upload.wikimedia.org','images.wcostream.com','www.wcostream.tv','wcostream.tv','www.wco.tv','wco.tv']);
const fields=['imageSource','imageSourceUrl','imageAttribution'];

export function titleURL(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.search&&/^(?:(?:www|m)\.)?(?:wco|wcostream)\.tv$/.test(url.hostname)&&url.pathname.length>1&&value.length<=2048?'https://www.wcostream.tv'+url.pathname:'';}catch{return '';}}
export function artworkURL(value){try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||value.length>2048||!hosts.has(url.hostname)||/no_pic/i.test(url.href))return '';if(url.hostname==='cdn.myanimelist.net')url.pathname=url.pathname.replace(/^(?:\/r\/\d+x\d+)?\/images\/anime\//,'/r/160x225/images/anime/');if(url.hostname==='static.tvmaze.com')url.pathname=url.pathname.replace('/uploads/images/original_untouched/','/uploads/images/medium_portrait/');return url.href;}catch{return '';}}
function knownSmall(value){const url=new URL(value);return url.hostname==='cdn.myanimelist.net'&&/^\/r\/160x225\/images\/anime\//.test(url.pathname)||url.hostname==='static.tvmaze.com'&&/^\/uploads\/images\/medium_portrait\//.test(url.pathname);}
function credit(value){const result={image:artworkURL(value.image)};for(const field of fields)result[field]=String(value[field]||'').slice(0,field==='imageSourceUrl'?2048:300);if(result.imageSourceUrl&&!/^https:\/\//.test(result.imageSourceUrl))result.imageSourceUrl='';return result;}

export function imageDimensions(bytes){
  if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
  if(bytes.length>=10&&/^GIF8[79]a$/.test(bytes.subarray(0,6).toString()))return [bytes.readUInt16LE(6),bytes.readUInt16LE(8)];
  if(bytes.length>=30&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){
    const type=bytes.toString('ascii',12,16);if(type==='VP8X')return [bytes.readUIntLE(24,3)+1,bytes.readUIntLE(27,3)+1];if(type==='VP8 ')return [bytes.readUInt16LE(26)&16383,bytes.readUInt16LE(28)&16383];if(type==='VP8L'&&bytes[20]===47){const value=bytes.readUInt32LE(21);return [(value&16383)+1,((value>>>14)&16383)+1];}
  }
  if(bytes[0]===255&&bytes[1]===216){let offset=2;while(offset+4<bytes.length){if(bytes[offset++]!==255)continue;while(bytes[offset]===255)offset++;if(offset+3>bytes.length)break;const marker=bytes[offset++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=7)return [bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3)];offset+=length;}}
  return null;
}

export async function smallImage(value,fetcher=fetch){
  let url=artworkURL(value);if(!url)return false;if(knownSmall(url))return true;
  const signal=AbortSignal.timeout(5000);
  for(let attempt=0;attempt<4;attempt++){
    const response=await fetcher(url,{redirect:'manual',signal,headers:{accept:'image/jpeg,image/png,image/webp','user-agent':'CartoonWatch/0.4 artwork'}});
    if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();url=location&&artworkURL(new URL(location,url).href);if(!url)return false;continue;}
    if(!response.ok||!/^image\//i.test(response.headers.get('content-type')||'')||Number(response.headers.get('content-length'))>524288){await response.body?.cancel();return false;}
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>524288)return false;chunks.push(Buffer.from(next.value));}}finally{await reader.cancel();}
    const dimensions=imageDimensions(Buffer.concat(chunks));return !!dimensions&&dimensions[0]>0&&dimensions[1]>0&&dimensions[0]<=240&&dimensions[1]<=360;
  }
  return false;
}

export class ArtworkStore{
  constructor({catalog,resolve,verify=smallImage}){this.records=new Map(catalog.items.filter(item=>item.kind!=='episode').map(item=>[titleURL(item.url),item]));this.resolve=resolve;this.verify=verify;this.cache=new Map();this.pending=new Set();this.queue=[];this.active=0;this.closed=false;}
  lookup(items){
    const found=[],pending=[],seen=new Set();
    for(const item of (Array.isArray(items)?items:[]).slice(0,12)){
      if(!item||typeof item.url!=='string'||seen.has(item.url))continue;seen.add(item.url);
      const output=item.url,target=titleURL(item.kind==='episode'?item.seriesUrl:item.url);
      if(!titleURL(output)||!target){found.push({url:output,image:''});continue;}
      const record=this.records.get(target)||{},input=artworkURL(item.image)?item:record,provided=credit(input),saved=this.cache.get(target);
      if(provided.image&&knownSmall(provided.image)){found.push({url:output,...provided});continue;}
      if(saved&&saved.expires>Date.now()&&(!provided.image||provided.image===saved.source)){found.push({url:output,...saved.value});continue;}
      if(!this.closed&&!this.pending.has(target)&&this.queue.length<24){this.pending.add(target);this.queue.push({target,provided});this.drain();}
      pending.push(output);
    }
    return {items:found,pending,retryAfter:1000};
  }
  drain(){
    while(!this.closed&&this.active<2&&this.queue.length){
      const {target,provided}=this.queue.shift();this.active++;
      Promise.resolve().then(async()=>{
        let value=provided;
        if(!value.image){const metadata=await this.resolve(target);value=credit({...metadata,imageSource:'WCO',imageSourceUrl:target,imageAttribution:'Artwork provided by WCO'});if(value.image&&!new URL(value.image).pathname.includes('/catimg/'))value.image='';}
        return value.image&&await this.verify(value.image)?value:{image:''};
      }).catch(()=>({image:''})).then(value=>{if(this.closed)return;this.cache.delete(target);this.cache.set(target,{source:provided.image,value,expires:Date.now()+(value.image?2592000000:86400000)});while(this.cache.size>1024)this.cache.delete(this.cache.keys().next().value);}).finally(()=>{this.pending.delete(target);this.active--;this.drain();});
    }
  }
  close(){this.closed=true;this.queue.length=0;this.pending.clear();this.cache.clear();}
}

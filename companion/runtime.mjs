import crypto from 'node:crypto';
import {Readable} from 'node:stream';

export class HttpError extends Error {
  constructor(status,message){super(message);this.status=status;}
}

export async function readBody(request,limit=16384){
  if(Number(request.headers['content-length'])>limit)throw new HttpError(413,'Request too large');
  const chunks=[];let size=0;
  for await(const chunk of request){size+=chunk.length;if(size>limit)throw new HttpError(413,'Request too large');chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw new HttpError(400,'Invalid JSON request');}
}

export function publicMediaURL(value,base){
  let url;try{url=new URL(value,base);}catch{throw new HttpError(422,'Invalid media address');}
  if(!/^https?:$/.test(url.protocol)||url.username||url.password)throw new HttpError(422,'Unsupported media address');return url.href;
}

export function protectedPlaylist(text){return /METHOD=SAMPLE-AES|KEYFORMAT="(?!identity")[^"]+"/i.test(text);}

export function rewritePlaylist(text,base,replace){
  text=text.replace(/^\uFEFF/,'');
  if(!text.trimStart().startsWith('#EXTM3U'))throw new HttpError(502,'The source returned an invalid playlist');
  if(protectedPlaylist(text))throw new HttpError(422,'This protected stream is unsupported');
  return text.split(/\r?\n/).map(line=>line.startsWith('#')?line.replace(/URI="([^"]+)"/g,(_,value)=>`URI="${replace(publicMediaURL(value,base))}"`):line.trim()?replace(publicMediaURL(line.trim(),base)):line).join('\n');
}

export function vttToSrt(text){
  const cues=[];
  for(const block of text.replace(/^\uFEFF/,'').replace(/\r/g,'').split(/\n\s*\n/)){
    const lines=block.split('\n'),index=lines.findIndex(line=>line.includes('-->'));if(index<0)continue;
    const times=lines[index].match(/((?:\d+:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}\.\d{3})/);if(!times)continue;
    const stamp=value=>(value.split(':').length===2?'00:':'')+value.replace('.',',');
    const value=lines.slice(index+1).join('\n').replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').trim();if(value)cues.push(`${cues.length+1}\n${stamp(times[1])} --> ${stamp(times[2])}\n${value}`);
  }
  if(!cues.length)throw new HttpError(422,'No compatible subtitle cues were supplied');return cues.join('\n\n')+'\n';
}

export async function boundedText(response,limit=4000000){
  const chunks=[];let length=0;
  for await(const chunk of response.body){length+=chunk.length;if(length>limit)throw new HttpError(502,'The source response is too large');chunks.push(chunk);}
  return Buffer.concat(chunks).toString('utf8');
}

export class MediaStore {
  constructor({now=Date.now,fetchImpl=fetch,limit=8,resources=8192,ttl=7200000}={}){this.now=now;this.fetch=fetchImpl;this.limit=limit;this.resourceLimit=resources;this.ttl=ttl;this.sessions=new Map();}
  prune(){for(const [id,session]of this.sessions)if(session.expires<this.now())this.sessions.delete(id);}
  create(item,selected,cookies=[]){
    this.prune();while(this.sessions.size>=this.limit)this.sessions.delete(this.sessions.keys().next().value);
    const session={id:crypto.randomBytes(18).toString('hex'),item,headers:selected.headers||{},origin:new URL(selected.url).origin,cookies,resources:new Map(),expires:this.now()+this.ttl,format:selected.format};this.sessions.set(session.id,session);return session;
  }
  resource(session,value,base,root=false){
    const url=publicMediaURL(value),id=crypto.createHash('sha256').update(url).digest('hex').slice(0,32),previous=session.resources.get(id);session.resources.delete(id);session.resources.set(id,{url,root:root||previous?.root});
    while(session.resources.size>this.resourceLimit){const expired=[...session.resources].find(([,entry])=>!entry.root);if(!expired)throw new HttpError(429,'Too many playback resources');session.resources.delete(expired[0]);}
    return `${base}/stream/${session.id}/${id}`;
  }
  headers(session,url){
    const result={...session.headers},target=new URL(url);if(target.origin!==session.origin)delete result.cookie;
    if(session.cookies.length){const cookies=session.cookies.filter(cookie=>{const domain=cookie.domain.replace(/^\./,''),scope=cookie.path||'/';return (target.hostname===domain||cookie.domain.startsWith('.')&&target.hostname.endsWith('.'+domain))&&(target.pathname===scope||target.pathname.startsWith(scope.endsWith('/')?scope:scope+'/'))&&(!cookie.secure||target.protocol==='https:')&&(cookie.expires<=0||cookie.expires*1000>this.now());});delete result.cookie;if(cookies.length)result.cookie=cookies.map(cookie=>cookie.name+'='+cookie.value).join('; ');}
    return result;
  }
  async upstream(session,url,range,signal){
    for(let attempt=0;attempt<5;attempt++){
      const headers=this.headers(session,url);if(range)headers.range=range;const response=await this.fetch(url,{headers,signal,redirect:'manual'});
      if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');await response.body?.cancel();if(!next)throw new HttpError(502,'The source returned an invalid redirect');url=publicMediaURL(next,url);continue;}return response;
    }
    throw new HttpError(502,'The source redirected too many times');
  }
  async proxy(request,response,match,base,format){
    this.prune();const session=this.sessions.get(match[1]),entry=session?.resources.get(match[2]);if(!entry)throw new HttpError(410,'Playback session expired');
    session.expires=this.now()+this.ttl;this.sessions.delete(session.id);this.sessions.set(session.id,session);
    const cancel=new AbortController();let timer=setTimeout(()=>cancel.abort(),45000);const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>cancel.abort(),45000);};response.once('close',()=>{clearTimeout(timer);cancel.abort();});
    let upstream;try{upstream=await this.upstream(session,entry.url,request.headers.range,cancel.signal);}catch(error){clearTimeout(timer);throw error;}touch();
    const type=upstream.headers.get('content-type')||'application/octet-stream';
    if(upstream.status===416){await upstream.body?.cancel();response.writeHead(416,{'content-range':upstream.headers.get('content-range')||'bytes */0'});response.end();return;}
    if(!upstream.ok){await upstream.body?.cancel();throw new HttpError(502,'The source stream is unavailable');}
    if(/mpegurl/i.test(type)||/\.m3u8(?:[?#]|$)/i.test(entry.url)){
      if(upstream.status===206&&request.headers.range){await upstream.body?.cancel();upstream=await this.upstream(session,entry.url,null,cancel.signal);}
      const text=rewritePlaylist(await boundedText(upstream),upstream.url||entry.url,url=>this.resource(session,url,base));response.writeHead(200,{'content-type':'application/vnd.apple.mpegurl','content-length':Buffer.byteLength(text),'cache-control':'no-store'});response.end(request.method==='HEAD'?undefined:text);return;
    }
    if(format==='srt'){
      const text=vttToSrt(await boundedText(upstream));response.writeHead(200,{'content-type':'application/x-subrip; charset=utf-8','content-length':Buffer.byteLength(text),'cache-control':'private, max-age=60'});response.end(request.method==='HEAD'?undefined:text);return;
    }
    const outgoing={'content-type':type,'cache-control':'private, max-age=30'};for(const name of ['content-length','content-range','accept-ranges'])if(upstream.headers.has(name))outgoing[name]=upstream.headers.get(name);
    response.writeHead(upstream.status,outgoing);if(request.method==='HEAD'){await upstream.body?.cancel();response.end();}else{const stream=Readable.fromWeb(upstream.body);stream.on('data',touch);stream.on('end',()=>clearTimeout(timer));stream.on('error',()=>{clearTimeout(timer);response.destroy();});response.on('close',()=>stream.destroy());stream.pipe(response);}
  }
}

export class PlayQueue {
  constructor(limit=3){this.limit=limit;this.pending=0;this.queue=Promise.resolve();}
  run(task){if(this.pending>=this.limit)throw new HttpError(429,'Playback is busy. Try again shortly');this.pending++;const result=this.queue.then(task);this.queue=result.catch(()=>{});return result.finally(()=>this.pending--);}
}

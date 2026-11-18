import http from 'node:http';
import {HttpError,PlayQueue,readBody} from './runtime.mjs';

const normalize=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function json(response,status,value){const body=JSON.stringify(value);response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','content-length':Buffer.byteLength(body)});response.end(body);}

export function createCompanion({catalog,details,play,media,queue=new PlayQueue()}){
  const records=catalog.items.map(item=>({...item,key:normalize(item.title)})),categories=catalog.coverage.map(item=>item.category),cached=new Map(),pending=new Map();
  async function cachedDetails(url){
    if(!url||url.length>2048)throw new HttpError(400,'A source title address is required');
    const value=cached.get(url);if(value&&value.expires>Date.now())return value.result;
    if(pending.has(url))return pending.get(url);if(pending.size>=6)throw new HttpError(429,'Episode lists are busy. Try again shortly');
    const task=details(url).then(result=>{cached.delete(url);cached.set(url,{result,expires:Date.now()+1800000});while(cached.size>64)cached.delete(cached.keys().next().value);return result;}).finally(()=>pending.delete(url));pending.set(url,task);return task;
  }
  const server=http.createServer(async(request,response)=>{
    response.setHeader('access-control-allow-origin','*');response.setHeader('access-control-allow-methods','GET,HEAD,POST,OPTIONS');response.setHeader('access-control-allow-headers','Content-Type,Range');response.setHeader('access-control-expose-headers','Content-Length,Content-Range,Accept-Ranges');
    if(request.method==='OPTIONS'){response.writeHead(204);response.end();return;}
    try{
      if(!request.headers.host||!/^[a-z\d.\-:[\]]+(?::\d+)?$/i.test(request.headers.host))throw new HttpError(400,'Invalid service address');
      const base=`http://${request.headers.host}`,url=new URL(request.url,base),method=request.method;
      const stream=url.pathname.match(/^\/stream\/([a-f0-9]{36})\/([a-f0-9]{32})$/);
      if(stream){if(!['GET','HEAD'].includes(method))throw new HttpError(405,'Method not allowed');await media.proxy(request,response,stream,base,url.searchParams.get('format'));return;}
      if(url.pathname==='/api/play'){
        if(method!=='POST')throw new HttpError(405,'Method not allowed');
        const target=await readBody(request);if(typeof target.url!=='string'||target.url.length>2048||typeof target.title!=='string'||target.title.length>400)throw new HttpError(400,'A title and source address are required');
        json(response,200,await queue.run(()=>{if(response.destroyed)throw new HttpError(499,'Playback request cancelled');return play(target,base);}));return;
      }
      if(method!=='GET')throw new HttpError(405,'Method not allowed');
      if(url.pathname==='/health'){json(response,200,{ok:true,app:'Cartoon Watch',version:'0.3.0'});return;}
      if(url.pathname==='/api/catalog'){
        const query=normalize(url.searchParams.get('q')).slice(0,200),category=url.searchParams.get('category')||'all',sort=url.searchParams.get('sort')||'az';
        const offset=Math.max(0,Math.min(1000000,Math.trunc(Number(url.searchParams.get('offset'))||0))),limit=Math.max(1,Math.min(120,Math.trunc(Number(url.searchParams.get('limit'))||60)));
        let list=records.filter(item=>(!query||item.key.includes(query))&&(category==='all'||item.categories.includes(category)));if(sort==='za')list=list.slice().reverse();
        const items=list.slice(offset,offset+limit).map(({key,...item})=>item);json(response,200,{items,total:list.length,offset,limit,hasMore:offset+items.length<list.length,categories,indexed:true,version:catalog.version,generatedAt:catalog.generatedAt});return;
      }
      if(url.pathname==='/api/details'){json(response,200,await cachedDetails(url.searchParams.get('url')));return;}
      json(response,404,{error:'Not found'});
    }catch(error){if(!response.headersSent&&!response.destroyed){if(error.status===429)response.setHeader('retry-after','5');json(response,error.status||503,{error:error.message||'The request could not be completed'});}else response.destroy();}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;return server;
}

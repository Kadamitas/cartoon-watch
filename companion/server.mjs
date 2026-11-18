import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright';
import {MediaStore,HttpError} from './runtime.mjs';
import {createCompanion} from './service.mjs';
import {createCapture} from './capture.mjs';
import {ArtworkStore} from './artwork.mjs';
import {TrendingStore} from './trending.mjs';

const run=promisify(execFile), root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const work=path.join(root,'work','companion'), assets=path.join(root,'app','src','main','assets');
await fs.mkdir(work,{recursive:true});
const catalog=JSON.parse(await fs.readFile(path.join(assets,'catalog-index.json'),'utf8'));
const providers=['wcostream','aniwave','kissanime','hdtoday'];
const domains=['wcostream.tv','wco.tv','aniwave.gr','kissanime.tv.in','hdtoday.one'];
const providerFor=value=>{let url;try{url=new URL(value);}catch{throw new HttpError(400,'Invalid source address');}const host=url.hostname.replace(/^(www|m)\./,'');if(!/^https?:$/.test(url.protocol)||url.username||url.password||url.port||!domains.includes(host))throw new HttpError(400,'Unsupported source');return host==='wco.tv'||host==='wcostream.tv'?'wcostream':host==='aniwave.gr'?'aniwave':host==='kissanime.tv.in'?'kissanime':'hdtoday';};
const scriptNames=['aniwave-skips.js','frame-guard.js','player.js'];
const scripts=await Promise.all(scriptNames.map(name=>fs.readFile(path.join(assets,name),'utf8')));
scripts[2]=await fs.readFile(path.join(assets,'quality.js'),'utf8')+scripts[2];
const nativeBlocker=await fs.readFile(path.join(root,'app','src','main','java','tv','cartoonwatch','app','AdBlocker.java'),'utf8');
const adHosts=[...nativeBlocker.split('Arrays.asList(')[1].split('));')[0].matchAll(/"([^"]+)"/g)].map(value=>value[1]);
const blocked=url=>{try{const u=new URL(url);return adHosts.some(host=>u.hostname===host||u.hostname.endsWith('.'+host))||(/(^|\.)wcostream\.com$/.test(u.hostname)&&u.pathname==='/inc/js/adblock-detector-wcostream.js');}catch{return false;}};
const media=new MediaStore();let bridge,browser;const children=new Set();
async function verified(url,name,hash){const destination=path.join(work,name);let bytes;try{bytes=await fs.readFile(destination);}catch{}if(!bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==hash){const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Dependency download failed');bytes=Buffer.from(await response.arrayBuffer());if(crypto.createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('Dependency checksum mismatch');await fs.writeFile(destination,bytes);}return destination;}
async function metadata(){
  if(bridge)return bridge;
  bridge=(async()=>{
    const jsoup=await verified('https://repo.maven.apache.org/maven2/org/jsoup/jsoup/1.18.3/jsoup-1.18.3.jar','jsoup.jar','5be1ccd3228ae5fd6eed1bd6d827bac2bc65b91c20e9957d16ea65f739f15302');
    const json=await verified('https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar','json.jar','3cf6cd6892e32e2b4c1c39e0f52f5248a2f5b37646fdfbb79a66b46b618414ed');
    const classes=path.join(work,'classes');await fs.mkdir(classes,{recursive:true});
    const sources=[path.join(root,'companion','MetadataServer.java'),...['CatalogRepository.java','PlaybackResolver.java'].map(name=>path.join(root,'app','src','main','java','tv','cartoonwatch','app',name))];
    await run('javac',['--release','8','-encoding','UTF-8','-cp',[jsoup,json].join(path.delimiter),'-d',classes,...sources],{windowsHide:true,timeout:20000});
    const process=spawn('java',['-cp',[classes,jsoup,json].join(path.delimiter),'MetadataServer'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    children.add(process);process.once('exit',()=>{children.delete(process);bridge=null;});process.stderr.resume();
    const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{process.kill();reject(Error('Metadata service did not start'));},15000);let output='';process.stdout.on('data',data=>{output+=data;const match=output.match(/METADATA_PORT=(\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}});process.once('error',error=>{clearTimeout(timer);reject(error);});process.once('exit',()=>{clearTimeout(timer);reject(Error('Metadata service stopped'));});});
    return {port,process};
  })().catch(error=>{bridge=null;throw error;});return bridge;
}
async function meta(action,payload){const {port}=await metadata();const response=await fetch(`http://127.0.0.1:${port}/request`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(45000)});return response.json();}
async function publicHtml(url){
  providerFor(url);const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3'),child=spawn(python,[path.join(root,'companion','fetch.py')],{windowsHide:true,stdio:['pipe','pipe','pipe']});children.add(child);child.stderr.resume();
  return new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>{child.kill();reject(Error('Source response timed out'));},18000);child.stdout.on('data',data=>{output+=data;if(output.length>7000000){child.kill();reject(Error('Source response too large'));}});child.on('error',error=>{clearTimeout(timer);children.delete(child);reject(error);});child.stdin.on('error',reject);child.on('close',code=>{clearTimeout(timer);children.delete(child);if(code)reject(Error('Source is temporarily unavailable'));else try{resolve(JSON.parse(output));}catch{reject(Error('Invalid source response'));}});child.stdin.end(JSON.stringify({url}));});
}
async function details(url){const provider=providerFor(url);let result=await meta('details',{provider,url});if(result.error){const loaded=await publicHtml(url);result=await meta('parse',{provider,url:loaded.url,html:loaded.html,action:'details'});}if(result.error)throw Error('Episode list is unavailable. Try again later.');return result;}
async function browserInstance(){if(!browser?.isConnected()){const candidates=[process.env.BROWSER_EXECUTABLE,...(process.platform==='win32'?['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe']:[])].filter(Boolean);let executablePath;for(const candidate of candidates)try{await fs.access(candidate);executablePath=candidate;break;}catch{}browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});}return browser;}
const capture=createCapture({browserInstance,publicHtml,scripts,blocked,media});
async function play(target,base){
  providerFor(target.url);const exclude=Array.isArray(target.exclude)?target.exclude:[],deadline=Date.now()+85000;
  for(const provider of providers){
    if(exclude.includes(provider)||deadline-Date.now()<3000)continue;let item;
    if(provider==='wcostream')item={...target,provider,url:target.url.replace(/^(https?:\/\/)(?:www\.|m\.)?wco\.tv\//,'$1www.wcostream.tv/')};
    else{const result=await meta('resolve',{provider,episode:target}).catch(()=>null);if(!result||result.error||result.missing)continue;item={...result,resumeSeconds:target.resumeSeconds};}
    if(deadline-Date.now()<3000)break;try{return await capture(item,base,Math.min(45000,deadline-Date.now()));}catch(error){console.log(`${provider}: ${error instanceof HttpError?error.message:'player unavailable'}`);}
  }
  throw new HttpError(502,'No compatible player could be started. Try again later.');
}
const artwork=new ArtworkStore({catalog,resolve:details});
const queries={weekly:await fs.readFile(path.join(assets,'trending-query.graphql'),'utf8'),genre:await fs.readFile(path.join(assets,'genre-query.graphql'),'utf8')};
const trending=new TrendingStore({catalog,queries,cacheFile:path.join(work,'discovery.json')});
const server=createCompanion({catalog,details,play,media,artwork,trending});
const port=Number(process.env.PORT)||8765;
server.listen(port,'0.0.0.0',()=>{console.log(`Cartoon Watch companion on port ${port}`);for(const network of Object.values(os.networkInterfaces()))for(const address of network||[])if(address.family==='IPv4'&&!address.internal)console.log(`TV service address: http://${address.address}:${port}`);});
async function stop(){server.close();artwork.close();trending.close();for(const child of children)child.kill();if(browser)await browser.close();if(bridge)try{(await bridge).process.kill();}catch{}process.exit();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);

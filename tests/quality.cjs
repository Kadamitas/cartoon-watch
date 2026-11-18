const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/quality.js'),'utf8');
let cases=0;
function create(overrides={}) {
  const timers=[],listeners={},video={clientWidth:640,clientHeight:360,videoWidth:1056,videoHeight:800,getBoundingClientRect(){return {width:640,height:360};},closest(){return null;}},document={querySelectorAll(selector){return selector==='video'?[video]:[];},addEventListener(name,handler){listeners[name]=handler;}};
  const context={WeakMap,WeakSet,Array,Object,Number,String,Math,Date,isFinite,setTimeout(fn,delay){timers.push({fn,delay});return timers.length;},clearTimeout(){},document,getComputedStyle(){return {display:'block',visibility:'visible'};},Event:class{constructor(type,options){this.type=type;Object.assign(this,options);}},...overrides};context.window=context;
  vm.runInNewContext(source,context);return {context,timers,listeners,video};
}
function test(name,run){run();cases++;console.log('PASS '+name);}
test('JW chooses UHD from real levels and does not relabel decoded video',()=>{
  let current=0;const calls=[],events={},player={getQualityLevels:()=>[{label:'Auto',height:2160},{label:'720p',height:720},{label:'UHD',height:2160,bitrate:12000000},{label:'1080p',height:1080}],getCurrentQuality:()=>current,setCurrentQuality(index){calls.push(index);current=index;},on(event,handler){events[event]=handler;}};
  const {context}=create({jwplayer:()=>player}),result=context.CWBestQuality();assert.equal(calls[0],2);assert.equal(result.requestedHeight,2160);assert.equal(result.decodedHeight,800);assert.equal(result.decodedWidth,1056);assert(result.changed);assert(!context.CWBestQuality().changed);assert.equal(calls.length,1);assert.deepEqual(Object.keys(events).sort(),['levels','ready']);
});
test('JW picks offered 720p and ignores premium or auto',()=>{
  let selected=-1;const player={getQualityLevels:()=>[{label:'Auto'},{label:'480p'},{label:'720p'},{label:'4K Premium',height:2160}],getCurrentQuality:()=>selected,setCurrentQuality(index){selected=index;}};const {context}=create({jwplayer:()=>player});context.CWBestQuality();assert.equal(selected,2);assert.equal(context.CWQualityInfo().requestedHeight,720);
});
test('JW supports explicit quality at index zero without inventing auto',()=>{
  let selected=-1;const {context}=create({jwplayer:()=>({getQualityLevels:()=>[{label:'1080p'},{label:'720p'}],getCurrentQuality:()=>selected,setCurrentQuality(index){selected=index;}})});context.CWBestQuality();assert.equal(selected,0);
});
test('HLS schedules highest level without flushing current video',()=>{
  let loadLevel=-1,writes=0;const player={levels:[{height:480,bitrate:1000000},{height:2160,bitrate:10000000},{height:1080,bitrate:8000000}],get loadLevel(){return loadLevel;},set loadLevel(value){loadLevel=value;writes++;},get currentLevel(){throw Error('do not flush the current frame');}}, {context}=create({hls:player});context.CWBestQuality();assert.equal(loadLevel,1);context.CWBestQuality();assert.equal(writes,1);
});
test('HLS breaks same-resolution ties by bitrate and discovers late levels',()=>{
  const player={levels:[],loadLevel:-1}, {context}=create({hlsPlayer:player});assert(!context.CWBestQuality().changed);player.levels=[{height:1080,bitrate:8000000},{height:1080,bitrate:12000000}];context.CWBestQuality();assert.equal(player.loadLevel,1);
});
test('Video.js enables only the highest offered representation',()=>{
  const levels=[{height:360,enabled:true},{height:2160,enabled:false},{height:1080,enabled:true}],player={qualityLevels:()=>levels}, {context}=create({videojs:{getPlayers:()=>({main:player})}});assert(context.CWBestQuality().changed);assert.deepEqual(levels.map(level=>level.enabled),[false,true,false]);assert(!context.CWBestQuality().changed);
});
test('Video.js does not disable lower levels when the highest cannot enable',()=>{
  const level={height:2160,get enabled(){return false;},set enabled(value){throw Error('unavailable');}},levels=[{height:720,enabled:true},level], {context}=create({videojs:{getAllPlayers:()=>[{qualityLevels:()=>levels}]}});assert.doesNotThrow(()=>context.CWBestQuality());assert.equal(levels[0].enabled,true);
});
test('Only a real quality select changes and emits one normal change event',()=>{
  const events=[],quality={id:'video-quality',selectedIndex:0,options:[{textContent:'Auto'},{textContent:'480p'},{textContent:'1080p60'},{textContent:'2160p Premium'}].map(value=>({...value,getAttribute:()=>null})),getAttribute:()=>null,getBoundingClientRect:()=>({width:120,height:40}),dispatchEvent(event){events.push(event);}},language={...quality,id:'language',selectedIndex:0}, {context}=create();context.document.querySelectorAll=selector=>selector==='select'?[quality,language]:[];context.CWBestQuality();assert.equal(quality.selectedIndex,2);assert.equal(language.selectedIndex,0);assert.equal(events.length,1);assert.equal(events[0].type,'change');context.CWBestQuality();assert.equal(events.length,1);
});
test('Missing and broken player APIs fail safely without media actions',()=>{
  const {context,video}=create({jwplayer(){throw Error('not ready');},hls:{get levels(){throw Error('not ready');}},videojs:{getPlayers(){throw Error('not ready');}}});video.play=video.pause=()=>{throw Error('must not alter transport');};assert.doesNotThrow(()=>context.CWBestQuality());assert.equal(context.CWQualityInfo().requestedHeight,0);
});
test('Discovery timers are bounded and injection is idempotent',()=>{
  const {context,timers,listeners}=create();assert.equal(timers.length,6);assert.deepEqual(timers.map(value=>value.delay),[0,750,2000,4500,9000,15000]);vm.runInNewContext(source,context);assert.equal(timers.length,6);assert.equal(typeof listeners.loadedmetadata,'function');assert.equal(typeof listeners.resize,'function');
});
test('Decoded quality reports real dimensions once per resolution',()=>{
  const calls=[],{context,video}=create({CW_CONFIG:{session:'17'},PlayerEvents:{quality(...values){calls.push(values);}}});context.CWBestQuality();context.CWBestQuality();assert.deepEqual(calls,[['17',1056,800]]);video.videoWidth=3840;video.videoHeight=2160;context.CWBestQuality();assert.deepEqual(calls[1],['17',3840,2160]);
});
console.log(JSON.stringify({cases,highestOffered:true,noFakeUHD:true,boundedDiscovery:true,transportPreserved:true}));

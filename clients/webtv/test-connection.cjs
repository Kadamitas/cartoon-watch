const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('../../companion/node_modules/playwright'),root=path.resolve(__dirname,'../..');
const staged=spawnSync(process.env.PYTHON||'python',['clients/webtv/package.py','--platform','all'],{cwd:root,encoding:'utf8'});assert.equal(staged.status,0,staged.stderr||staged.stdout);
let base,health=0;
const server=http.createServer((request,response)=>{
  const url=new URL(request.url,base||'http://localhost'),send=(type,body)=>{response.writeHead(200,{'content-type':type});response.end(body);};
  if(url.pathname==='/health'){health++;send('application/json',JSON.stringify({ok:true}));return;}
  if(url.pathname==='/api/trending'){send('application/json',JSON.stringify({items:[],source:'AniList',type:'anime',available:false,stale:false}));return;}
  if(url.pathname==='/api/catalog'){send('application/json',JSON.stringify({items:[],total:0,offset:0,limit:60,hasMore:false,categories:[],indexed:true}));return;}
  if(url.pathname.includes('$WEBAPIS/')){send('application/javascript','');return;}
  if(url.pathname==='/favicon.ico'){response.writeHead(204);response.end();return;}
  const match=url.pathname.match(/^\/(lg|samsung)\/([A-Za-z0-9.-]+)$/);
  if(!match){response.writeHead(404);response.end();return;}
  const file=path.join(root,'work','webtv',match[1],match[2]);if(!fs.existsSync(file)){response.writeHead(404);response.end();return;}
  send(match[2].endsWith('.js')?'application/javascript':match[2].endsWith('.css')?'text/css':match[2].endsWith('.svg')?'image/svg+xml':'text/html',fs.readFileSync(file));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
  const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',executablePath=process.env.PLAYWRIGHT_EXECUTABLE_PATH||(process.platform==='win32'&&fs.existsSync(edge)?edge:undefined),browser=await chromium.launch({headless:true,executablePath}),results=[];
  try{
    for(const platform of ['lg','samsung']){
      const context=await browser.newContext({viewport:{width:960,height:540}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(base+'/'+platform+'/index.html');await page.locator('#cw-tv-setup').waitFor({state:'visible'});
      assert.equal(await page.evaluate(()=>typeof window.CartoonWatch.request),'function');assert.equal(await page.locator('.topbar,header,#providers').count(),0);assert(await page.locator('#cw-tv-cancel').isDisabled());
      const before=health;await page.locator('#cw-tv-service').fill('javascript:alert(1)');await page.locator('#cw-tv-connect').click();assert.match(await page.locator('#cw-tv-connection').innerText(),/Enter an http or https/);assert.equal(health,before);
      await page.locator('#cw-tv-service').fill(base);await Promise.all([page.waitForEvent('load'),page.locator('#cw-tv-connect').click()]);assert.equal(await page.evaluate(()=>localStorage.getItem('cartoonWatchService')),base);assert(await page.locator('#cw-tv-setup').isHidden());await page.waitForTimeout(50);
      for(const [width,height] of [[640,360],[960,540],[1280,720],[1920,1080],[3840,2160]]){
        await page.setViewportSize({width,height});const content=await page.locator('#content').innerHTML(),button=page.locator('#cw-tv-connection-button');await button.focus();
        const bounds=await page.locator('.sidebar button').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return {left:box.left,top:box.top,right:box.right,bottom:box.bottom};}));for(const box of bounds){assert(box.left>=7&&box.top>=7&&box.right<=width-7&&box.bottom<=height-7,JSON.stringify({platform,width,height,box}));}
        await page.keyboard.press('Enter');await page.locator('#cw-tv-setup').waitFor({state:'visible'});assert.equal(await page.locator('#cw-tv-service').inputValue(),base);assert.equal(await page.evaluate(()=>document.activeElement.id),'cw-tv-service');assert(await page.locator('#cw-tv-cancel').isEnabled());
        await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.id),'cw-tv-connect');await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.id),'cw-tv-cancel');await page.keyboard.press('Enter');assert(await page.locator('#cw-tv-setup').isHidden());assert.equal(await page.evaluate(()=>document.activeElement.id),'cw-tv-connection-button');assert.equal(await page.locator('#content').innerHTML(),content);results.push({platform,width,height,connection:true,focusRestored:true,header:false});
      }
      assert.deepEqual(errors,[]);await context.close();
    }
    console.log(JSON.stringify({success:true,stagedClients:true,firstConnection:true,invalidAddressRejected:true,results},null,2));
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;server.closeAllConnections();server.close();});

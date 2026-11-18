const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const node=(file,name)=>{const xml=fs.readFileSync(path.join(root,'components',file),'utf8'),tag=xml.match(new RegExp('<[^>]+\\bid="'+name+'"[^>]*>'));assert(tag,'missing '+name);return Object.fromEntries([...tag[0].matchAll(/([A-Za-z]+)="([^"]*)"/g)].map(value=>[value[1],value[2]]));};
const pair=value=>JSON.parse(value),card=node('CatalogCard.xml','frame'),poster=node('CatalogCard.xml','poster'),title=node('CatalogCard.xml','title'),grid=node('CartoonWatch.xml','catalog'),status=node('CartoonWatch.xml','status');
const [width,height]=pair(grid.itemSize),[x,y]=pair(grid.translation),[gapX,gapY]=pair(grid.itemSpacing),[posterX,posterY]=pair(poster.translation),[titleX,titleY]=pair(title.translation);
assert.equal(poster.loadDisplayMode,'scaleToFit');assert(Number(poster.height)>Number(poster.width));assert.equal(Number(poster.width)/Number(poster.height),2/3);assert.equal(Number(card.width),width);assert.equal(Number(card.height),height);
assert(posterX>=4&&posterX+Number(poster.width)<=width-4&&posterY>=4);assert(posterY+Number(poster.height)<=titleY);assert(titleX>=4&&titleX+Number(title.width)<=width-4&&titleY+Number(title.height)<=height-4);assert(Number(title.numLines)>=2&&Number(title.height)>=48);
assert(x+(width+gapX)*Number(grid.numColumns)-gapX<=1860);assert(y+(height+gapY)*Number(grid.numRows)-gapY<=pair(status.translation)[1]-12);assert(pair(status.translation)[1]+Number(status.height)<=1040);
console.log('ROKU_LAYOUT_PASS: whole portrait covers, two-line titles and bounded grid');

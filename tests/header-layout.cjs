const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");

const {chromium: chromium} = require("../companion/node_modules/playwright");

const root = path.resolve(__dirname, ".."), assets = path.join(root, "app/src/main/assets"), catalog = JSON.parse(fs.readFileSync(path.join(assets, "catalog-index.json"), "utf8"));

const output = path.join(root, "work", "header-layout");

fs.mkdirSync(output, {
    recursive: true
});

function pageData(args = {}) {
    const query = String(args.query || "").toLowerCase(), category = args.category || "all";
    let items = catalog.items.filter(item => (!query || item.title.toLowerCase().includes(query)) && (category === "all" || item.categories.includes(category)));
    const offset = Number(args.offset) || 0, limit = Math.min(60, Number(args.limit) || 60);
    return {
        items: items.slice(offset, offset + limit),
        total: items.length,
        offset: offset,
        limit: limit,
        hasMore: offset + limit < items.length,
        categories: catalog.coverage.map(item => item.category),
        indexed: true
    };
}

(async () => {
    const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
    const browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH || (process.platform === "win32" && fs.existsSync(edge) ? edge : undefined)}), results = [];
    try {
        for (const viewport of [{width:640,height:360},{width:960,height:540},{width:1280,height:720},{width:1920,height:1080},{width:3840,height:2160}]) {
            const context = await browser.newContext({viewport}), errors = [];
            await context.exposeBinding("fixtureNative", async (_,action,args) => action === "getState" ? {favorites:[],history:[],settings:{provider:"wco",adBlock:true}} : action === "home" || action === "catalog" ? pageData(args) : {items:[],available:false});
            await context.addInitScript(() => {window.CartoonWatch={request(action,input,id){window.fixtureNative(action,JSON.parse(input || "{}")).then(value=>window.onNativeResult(id,JSON.stringify(value)));}};});
            await context.route("https://app.cartoonwatch.test/**", route => {
                const name = new URL(route.request().url()).pathname.slice(1) || "index.html";
                if (!["index.html","app.js","app.css","brand.svg","discovery.js"].includes(name)) return route.abort();
                return route.fulfill({contentType:name.endsWith(".js")?"application/javascript":name.endsWith(".css")?"text/css":name.endsWith(".svg")?"image/svg+xml":"text/html",body:fs.readFileSync(path.join(assets,name))});
            });
            const page = await context.newPage(); page.on("pageerror",error=>errors.push(error.message));
            await page.goto("https://app.cartoonwatch.test/"); await page.locator(".discovery-shortcuts").waitFor();
            const samples = [], first = page.locator(".discovery-shortcuts button").first();
            const measure = async label => {
                await page.waitForTimeout(550);
                const value = await page.evaluate(label => {
                    const node = document.activeElement, rect = node.getBoundingClientRect(), settings = document.querySelector('[data-route="settings"]').getBoundingClientRect();
                    return {label,noHeader:!document.querySelector(".topbar,#providers,.catalog-summary"),headerHeight:getComputedStyle(document.querySelector("main")).getPropertyValue("--header-height").trim(),focused:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom},focusOutline:getComputedStyle(node).outlineStyle,settingsBottom:settings.bottom,overflow:document.documentElement.scrollWidth>innerWidth};
                },label);
                assert(value.noHeader && value.headerHeight === "0px", "Unexpected header " + viewport.width + " " + label);
                assert(!value.overflow, "Horizontal overflow " + viewport.width + " " + label);
                assert(value.focused.top >= 7 && value.focused.left >= 7 && value.focused.right <= (label === "resized-compact" ? 640 : viewport.width)-7 && value.focused.bottom <= (label === "resized-compact" ? 360 : viewport.height)-7, "Clipped content focus " + viewport.width + " " + label + " " + JSON.stringify(value.focused));
                assert(value.focusOutline !== "none", "Missing focus ring");
                assert(value.settingsBottom <= (label === "resized-compact" ? 360 : viewport.height)-7, "Clipped Settings control");
                return value;
            };
            await first.focus(); samples.push(await measure("initial-top-content"));
            await page.getByRole("button",{name:"Search",exact:true}).focus(); await page.evaluate(()=>{const main=document.querySelector("main");main.style.scrollBehavior="auto";main.scrollTop=main.scrollHeight;}); await first.focus(); samples.push(await measure("top-content-after-deep-scroll"));
            for (let i=0;i<2;i++) {await page.locator('[data-route="settings"]').click();await page.locator('[data-route="home"]').click();await page.locator(".discovery-shortcuts").waitFor();await first.focus();samples.push(await measure("return-home-"+i));}
            await page.getByRole("button",{name:"Search",exact:true}).click(); await page.waitForFunction(()=>document.querySelectorAll(".grid .card").length === 60); await page.locator(".grid .card").last().focus(); samples.push(await measure("last-catalog-card"));
            await page.locator("#search-input").focus(); samples.push(await measure("search-after-deep-grid"));
            for(const key of ["ArrowDown","ArrowLeft","ArrowRight","ArrowUp"]) await page.keyboard.press(key); samples.push(await measure("dpad-navigation"));
            await page.setViewportSize({width:640,height:360}); await page.locator("#search-input").focus(); await measure("resized-compact");
            await page.setViewportSize(viewport); await page.locator("#search-input").focus(); samples.push(await measure("resize-restored"));
            assert.deepEqual(errors,[]); await page.screenshot({path:path.join(output,"header-"+viewport.width+".png")});
            results.push({viewport,cases:samples.length,noHeader:true,minFocusTop:Math.min(...samples.map(sample=>sample.focused.top)),overflow:false,errors}); await context.close();
        }
    } finally {await browser.close();}
    fs.writeFileSync(path.join(output,"results.json"),JSON.stringify(results,null,2)); console.log(JSON.stringify(results,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});

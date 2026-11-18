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
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || (process.platform === "win32" && fs.existsSync(edge) ? edge : undefined)
    }), results = [];
    try {
        for (const viewport of [ {
            width: 640,
            height: 360
        }, {
            width: 960,
            height: 540
        }, {
            width: 1280,
            height: 720
        }, {
            width: 1920,
            height: 1080
        }, {
            width: 3840,
            height: 2160
        } ]) {
            const context = await browser.newContext({
                viewport: viewport
            }), errors = [];
            await context.exposeBinding("fixtureNative", async (_, action, args) => {
                if (action === "getState") return {
                    favorites: [],
                    history: [],
                    settings: {
                        provider: "wco",
                        adBlock: true
                    }
                };
                if (action === "catalog" || action === "home") return pageData(args);
                return {
                    ok: true
                };
            });
            await context.addInitScript(() => {
                window.CartoonWatch = {
                    request(action, input, id) {
                        window.fixtureNative(action, JSON.parse(input || "{}")).then(value => window.onNativeResult(id, JSON.stringify(value)));
                    }
                };
            });
            await context.route("https://app.cartoonwatch.test/**", route => {
                const name = new URL(route.request().url()).pathname.slice(1) || "index.html";
                if (![ "index.html", "app.js", "app.css" ].includes(name)) return route.abort();
                return route.fulfill({
                    contentType: name.endsWith(".js") ? "application/javascript" : name.endsWith(".css") ? "text/css" : "text/html",
                    body: fs.readFileSync(path.join(assets, name))
                });
            });
            const page = await context.newPage();
            page.on("pageerror", error => errors.push(error.message));
            await page.goto("https://app.cartoonwatch.test/");
            await page.getByRole("button", {
                name: "Browse full catalog",
                exact: true
            }).waitFor();
            const measure = async label => page.evaluate(label => {
                const bounds = node => {
                    const r = node.getBoundingClientRect();
                    return {
                        top: r.top,
                        left: r.left,
                        right: r.right,
                        bottom: r.bottom,
                        width: r.width,
                        height: r.height
                    };
                };
                const provider = document.querySelector("#providers button"), focus = document.activeElement, style = getComputedStyle(focus);
                return {
                    label: label,
                    header: bounds(document.querySelector(".topbar")),
                    wordmark: bounds(document.querySelector(".wordmark")),
                    provider: bounds(provider),
                    focus: bounds(focus),
                    focusRing: parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset),
                    scroll: document.querySelector("main").scrollTop,
                    overflow: document.documentElement.scrollWidth > innerWidth,
                    settings: bounds(document.querySelector('[data-route="settings"]'))
                };
            }, label);
            const samples = [];
            samples.push(await measure("initial"));
            await page.evaluate(() => {
                const main = document.querySelector("main");
                main.style.scrollBehavior = "auto";
                main.scrollTop = main.scrollHeight;
                document.querySelector("#providers button").focus({
                    preventScroll: true
                });
            });
            await page.waitForTimeout(600);
            samples.push(await measure("provider-after-scroll"));
            for (let i = 0; i < 2; i++) {
                await page.locator('[data-route="settings"]').click();
                await page.waitForTimeout(150);
                await page.locator('[data-route="home"]').click();
                await page.getByRole("button", {
                    name: "Browse full catalog",
                    exact: true
                }).waitFor();
                await page.waitForTimeout(250);
                samples.push(await measure("return-home-" + i));
            }
            await page.getByRole("button", {
                name: "Browse full catalog",
                exact: true
            }).click();
            await page.waitForFunction(() => document.querySelectorAll(".grid .card").length === 60);
            await page.waitForTimeout(180);
            await page.locator(".grid .card").last().focus();
            await page.waitForTimeout(500);
            samples.push(await measure("last-catalog-card"));
            await page.locator("#providers button").focus();
            await page.waitForTimeout(600);
            samples.push(await measure("provider-after-grid"));
            for (const key of [ "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp" ]) await page.keyboard.press(key);
            await page.waitForTimeout(350);
            samples.push(await measure("dpad-navigation"));
            await page.setViewportSize({
                width: 640,
                height: 360
            });
            await page.waitForTimeout(250);
            const resized = await measure("resized-compact");
            if (!process.argv.includes("--baseline")) {
                assert(resized.wordmark.top >= 0 && resized.provider.right <= 633, "Header did not fit after resize");
                assert(resized.settings.bottom <= 353, "Settings did not fit after resize");
            }
            await page.setViewportSize(viewport);
            await page.waitForTimeout(250);
            samples.push(await measure("resize-restored"));
            await page.screenshot({
                path: path.join(output, "header-" + viewport.width + ".png")
            });
            for (const sample of samples) {
                if (!process.argv.includes("--baseline")) {
                    assert(!sample.overflow, "Horizontal overflow " + viewport.width + " " + sample.label);
                    assert(sample.wordmark.top >= 0, "Clipped title " + viewport.width + " " + sample.label);
                    assert(sample.header.top >= 0, "Clipped header " + viewport.width + " " + sample.label);
                    assert(sample.provider.top >= 7, "Clipped provider focus ring " + viewport.width + " " + sample.label);
                    assert(sample.settings.bottom + 7 <= viewport.height, "Clipped Settings focus ring " + viewport.width + " " + sample.label);
                    if (sample.label === "last-catalog-card") assert(sample.focus.top >= sample.header.bottom, "Focused card is covered by header " + viewport.width);
                }
            }
            assert.equal(errors.length, 0);
            results.push({
                viewport: viewport,
                samples: samples,
                errors: errors
            });
            await context.close();
        }
        fs.writeFileSync(path.join(output, process.argv.includes("--baseline") ? "baseline.json" : "results.json"), JSON.stringify(results, null, 2));
        console.log(JSON.stringify(results.map(result => ({
            viewport: result.viewport,
            cases: result.samples.length,
            minTitleTop: Math.min(...result.samples.map(sample => sample.wordmark.top)),
            minHeaderTop: Math.min(...result.samples.map(sample => sample.header.top)),
            overflow: result.samples.some(sample => sample.overflow),
            errors: result.errors
        })), null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error.stack);
    process.exitCode = 1;
});

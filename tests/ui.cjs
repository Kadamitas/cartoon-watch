const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('../companion/node_modules/playwright');
const base = path.resolve(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(base, 'app/src/main/assets/catalog-index.json'), 'utf8'));
const details = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/naruto-details.json'), 'utf8'));
const tests = [];
const output = path.join(base, 'work', 'ui-validation');
fs.mkdirSync(output, {recursive:true});
function catalog(args = {}) {
  const query = String(args.query || '').toLowerCase();
  let items = index.items.filter(item => (!query || item.title.toLowerCase().includes(query)) && (!args.category || args.category === 'all' || item.categories.includes(args.category)));
  items.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) * (args.sort === 'za' ? -1 : 1));
  const total = items.length, offset = Math.max(0, Number(args.offset) || 0), limit = Math.min(60, Number(args.limit) || 60);
  return { items: items.slice(offset, offset + limit), total, offset, limit, hasMore: offset + limit < total, categories: index.coverage.map(c => c.category), indexed: true, version: index.version, generatedAt: index.generatedAt };
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {}) });
  for (const width of [960, 1920]) {
    const context = await browser.newContext({ viewport: { width, height: width === 960 ? 540 : 1080 } });
    let state = { favorites: [], history: [], settings: { provider: 'wco', adBlock: true } };
    const requests = [], errors = [];
    await context.exposeBinding('catalogNative', async (_, action, args) => {
      requests.push({ action, args });
      if (action === 'getState') return state;
      if (action === 'saveState') { state = args; return { ok: true }; }
      if (action === 'home') return catalog({ limit: 60 });
      if (action === 'catalog') {
        if (args.query === 'Naruto') await new Promise(resolve => setTimeout(resolve, 90));
        return catalog(args);
      }
      if (action === 'details') return details;
      if (action === 'play') return { ok: true };
      return { ok: true };
    });
    await context.addInitScript(() => {
      window.CartoonWatch = { request(action, input, id) { window.catalogNative(action, JSON.parse(input || '{}')).then(data => window.onNativeResult(id, JSON.stringify(data))); } };
    });
    await context.route('https://app.cartoonwatch.test/**', route => {
      const name = new URL(route.request().url()).pathname.slice(1) || 'index.html';
      if (!['index.html', 'app.js', 'app.css', 'brand.svg', 'discovery.js'].includes(name)) return route.abort();
      return route.fulfill({ contentType: name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html', body: fs.readFileSync(path.join(base, 'app/src/main/assets', name)) });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://app.cartoonwatch.test/');
    await page.locator('.discovery-shortcuts').waitFor();
    assert.equal(await page.locator('.brand-mark').evaluate(image => image.complete && image.naturalWidth > 0), true);
    assert.equal(await page.getByRole('button',{name:'Search',exact:true}).count(), 1);
    assert.equal(await page.locator('.topbar,#providers,.catalog-summary').count(),0);
    assert(!/indexed titles|16,167/.test(await page.locator('#content').innerText()));
    await page.getByRole('button',{name:'Search',exact:true}).click();
    await page.waitForFunction(() => document.querySelectorAll('.grid .card').length === 60);
    assert.match(await page.locator('.catalog-result-count').innerText(), new RegExp('1–60 of ' + index.items.length.toLocaleString('en-US')));
    const first = await page.locator('.grid .card-title').first().innerText();
    await page.locator('#catalog-next').click();
    await page.waitForFunction(() => document.querySelector('.catalog-result-count')?.textContent.startsWith('61–120'));
    assert.equal(await page.locator('.grid .card').count(), 60);
    assert.notEqual(await page.locator('.grid .card-title').first().innerText(), first);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('card')), true);
    await page.locator('#catalog-previous').click();
    await page.waitForFunction(() => document.querySelector('.catalog-result-count')?.textContent.startsWith('1–60'));
    const search = async value => { await page.locator('#search-input').fill(value); await page.locator('.search-form').evaluate(form => form.requestSubmit()); };
    await search('Naruto');
    await page.waitForFunction(() => document.querySelectorAll('.grid .card-title').length && Array.from(document.querySelectorAll('.grid .card-title')).every(n => /naruto/i.test(n.textContent)));
    await page.getByLabel('Catalog category').selectOption('Movies');
    await page.waitForFunction(() => document.querySelectorAll('.grid .card-tag').length && Array.from(document.querySelectorAll('.grid .card-tag')).every(n => n.textContent === 'movie'));
    await search('');
    await page.waitForFunction(total => document.querySelector('.catalog-result-count')?.textContent.includes('of '+total), catalog({category:'Movies'}).total.toLocaleString('en-US'));
    assert.equal(await page.locator('.grid .card').count(), 60);
    await page.getByLabel('Sort titles').selectOption('za');
    await page.waitForFunction(expected => document.querySelector('.grid .card-title')?.textContent === expected, catalog({ category: 'Movies', sort: 'za' }).items[0].title);
    await page.getByLabel('Catalog category').selectOption('all');
    await page.getByLabel('Sort titles').selectOption('az');
    await search('Naruto');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.grid .card-title')).some(n => n.textContent === 'Naruto'));
    const original = page.locator('.grid .card').filter({ has: page.locator('.card-title', { hasText: /^Naruto$/ }) });
    await original.click();
    await page.waitForFunction(count => document.querySelectorAll('.episode').length === count, details.episodes.length);
    assert.equal(await page.locator('.detail-info h1').innerText(), 'Naruto');
    await page.locator('.episode').filter({ hasText: /Episode 3 English Dubbed/ }).click();
    await page.waitForTimeout(30);
    const play = requests.findLast(r => r.action === 'play').args;
    assert.equal(play.seriesTitle, 'Naruto');
    assert.ok(play.url.includes('naruto-episode-3-english-dubbed'));
    await page.evaluate(() => window.handleBack());
    assert.equal(await page.evaluate(() => document.activeElement.querySelector('.card-title')?.textContent), 'Naruto');
    await search('Naruto');
    await search('Avatar');
    await page.waitForFunction(() => document.querySelectorAll('.grid .card-title').length && Array.from(document.querySelectorAll('.grid .card-title')).every(n => /avatar/i.test(n.textContent)));
    await page.waitForTimeout(140);
    assert.equal(await page.locator('.grid .card-title').evaluateAll(nodes => nodes.every(n => /avatar/i.test(n.textContent))), true);
    await page.locator('[data-route="home"]').click();
    await page.locator('.discovery-shortcuts').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(errors.length, 0);
    assert.ok(requests.filter(r => r.action === 'catalog').every(r => r.args.limit === 60));
    await page.screenshot({ path: path.join(output, `ui-index-${width}.png`) });
    tests.push({ width, total: index.items.length, pageLimit: 60, nativePagination: true, movies: catalog({category:'Movies'}).total, narutoEpisodes: details.episodes.length, episode3Play: true, restoredFocus: true, staleResponseDiscarded: true, overflow: false, errors });
    await context.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(output, 'ui-index-results.json'), JSON.stringify(tests, null, 2));
  console.log(JSON.stringify(tests, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });

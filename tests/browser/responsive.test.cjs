// AVIATOR_TEST_URL=http://127.0.0.1:8000 node --test tests/browser/responsive.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');

const base = process.env.AVIATOR_TEST_URL ?? 'http://127.0.0.1:8000';
const origin = { code: 'MOW', iata: 'SVO', all: true, name: 'Москва', from: 'Москвы' };

async function openPage(browser, viewport, touch, density = 1) {
  const page = await browser.newPage({ viewport, isMobile: touch, hasTouch: touch, deviceScaleFactor: density, reducedMotion: 'reduce' });
  await page.route('**/api/v1/origin', route => route.fulfill({ json: origin }));
  await page.route('**/api/v1/home?*', route => route.fulfill({ json: {
    origin, rows: [], offers: {}, notes: {}, usual: {}, received_at: new Date().toISOString(),
  } }));
  return page;
}

async function visit(page, path) {
  const response = await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  if (path === '/#fav') await page.waitForSelector('body.favorites-page');
  else assert.equal(response.status(), 200, path);
  if (path === '/credits.html') await page.locator('#credits li').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  const [viewport, documentWidth, contentWidth] = await page.evaluate(() => [
    innerWidth, document.documentElement.clientWidth, document.documentElement.scrollWidth,
  ]);
  assert.equal(viewport, page.viewportSize().width, path + ' расширилась');
  assert.ok(contentWidth <= documentWidth + 1, path + ' на ширине ' + viewport + ' прокручивается до ' + contentWidth);
}

async function rect(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  assert.ok(box?.width, selector);
  return box;
}

test('iPhone и один экран Duo: страницы, навигация, ввод без увеличения и доступный диалог', async t => {
  const safari = await webkit.launch(), chrome = await chromium.launch();
  t.after(() => Promise.all([safari.close(), chrome.close()]));
  for (const [browser, width, height, density] of [
    [safari, 320, 568, 2], [safari, 375, 667, 2], [safari, 390, 844, 3],
    [safari, 430, 932, 3], [safari, 844, 390, 3], [chrome, 540, 720, 2],
  ]) {
    const page = await openPage(browser, { width, height }, true, density);
    for (const url of ['/', '/#fav', '/trip.html', '/kuda/', '/about.html', '/credits.html',
      '/how-we-count.html', '/season/', '/season/compare/', '/season/KZN', '/city/', '/city/kazan']) {
      await visit(page, url);
    }
    const footer = page.locator('.footer nav a').last();
    await footer.scrollIntoViewIfNeeded();
    assert.ok((await footer.boundingBox()).height >= 44);
    await page.locator('[data-origin-pick]').first().click();
    const sheet = await rect(page, '#originSheet[open]');
    assert.ok(sheet.y >= -1 && sheet.y + sheet.height <= height + 1, JSON.stringify({ width, height, sheet }));
    const input = page.locator('#originFilter');
    await input.focus();
    assert.ok(await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16));
    await page.locator('#originSheet [data-close]').click();
    assert.equal(await page.locator('#originSheet').isVisible(), false);

    await visit(page, '/');
    const visibleLinks = await page.locator('.service-tabs [role=tab]').evaluateAll(links =>
      links.length === 4 && links.every(el => el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth));
    assert.ok(visibleLinks, 'Пункты шапки должны быть доступны без горизонтальной прокрутки');
    await page.locator('.hero-photo img').evaluate(img => img.decode());
    const images = await page.evaluate(() => performance.getEntriesByType('resource')
      .filter(entry => new URL(entry.name).pathname.startsWith('/photos/hero-')).map(entry => entry.name));
    assert.equal(images.length, 1);
    if (width === 390) assert.match(images[0], /hero-madeira-mobile-coast-1320\.avif$/);
    await page.close();
  }
});

test('широкий монитор: больше колонок для каталога и ограниченная ширина статьи и диалога', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const width of [1440, 1920, 2560]) {
    const page = await openPage(browser, { width, height: 1080 }, false);
    await visit(page, '/');
    const main = await rect(page, 'main');
    assert.ok(main.width > 1184 && main.width <= 1728);
    await visit(page, '/city/');
    const cards = await page.locator('.directory-list > li').evaluateAll(items => items.slice(0, 3).map(el => el.offsetTop));
    assert.equal(new Set(cards).size, 1);
    await visit(page, '/about.html');
    assert.ok((await rect(page, '.prose')).width <= 736);
    await visit(page, '/city/kazan');
    await page.locator('[data-origin-pick]').first().click();
    assert.ok((await rect(page, '#originSheet[open]')).width <= 680);
    await page.close();
  }
});

test('две панели Duo: поиск, результаты, статьи и диалог помещаются по сторонам сгиба', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const width = 1114, height = 720, edge = 540, gap = 34;
  const page = await openPage(browser, { width, height }, true);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, mobile: true, deviceScaleFactor: 1, devicePosture: { type: 'folded' },
    displayFeature: { orientation: 'vertical', offset: edge, maskLength: gap },
  });
  for (const [path, left, right] of [
    ['/', '#search', '#showcase'], ['/city/', '#citySearch', '#cityResults'],
    ['/season/', '.rating-filters', '.rating-slot'], ['/how-we-count.html', '.method-chapters', '.method-articles'],
    ['/about.html', '.page-head', '.prose'], ['/season/KZN', '.season-panel', '.season-facts'],
  ]) {
    await visit(page, path);
    await page.waitForFunction(() => matchMedia('(horizontal-viewport-segments: 2)').matches);
    const a = await rect(page, left), b = await rect(page, right);
    assert.ok(a.x + a.width <= edge && b.x >= edge + gap && b.x + b.width <= width, path);
  }
  await visit(page, '/city/kazan');
  await page.locator('[data-origin-pick]').first().click();
  assert.ok((await rect(page, '#originSheet[open]')).x >= edge + gap);
});

test('вырез и нижний индикатор оставляют ссылки внутри безопасной области', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await openPage(browser, { width: 844, height: 390 }, true);
  const cdp = await page.context().newCDPSession(page);
  await visit(page, '/city/');
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: 47, right: 47, bottom: 21 } });
  const link = await rect(page, '.brand');
  const footer = await page.locator('.footer').evaluate(el => getComputedStyle(el).paddingBottom);
  assert.ok(link.x >= 47 && parseFloat(footer) >= 21 + 32);
  const field = await rect(page, '.directory-search input');
  assert.ok(field.x >= 47 && field.x + field.width <= 844 - 47);
});

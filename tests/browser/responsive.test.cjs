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

test('Шапка одинакова на страницах сайта, вкладки сервисов находятся над поиском', async t => {
  for (const [engine, width] of [[chromium, 1440], [webkit, 390], [webkit, 320]]) {
    const browser = await engine.launch();
    t.after(() => browser.close());
    const page = await openPage(browser, { width, height: 850 }, width < 400);
    const header = page.locator('.site-header');
    const nav = header.getByRole('navigation', { name: 'Разделы сайта' });
    const links = nav.getByRole('link');
    const baseLinks = ['Билеты', 'Города', 'Избранное', 'Мои поездки', 'Как мы считаем'];
    const services = page.getByRole('tablist', { name: 'Что ищем' });
    const geometry = () => header.evaluate(el => [el, ...el.querySelectorAll('a')].map(link => {
      const { x, y, width, height } = link.getBoundingClientRect();
      return [x, y, width, height].map(Math.round);
    }));

    await visit(page, '/');
    assert.deepEqual(await links.allTextContents(), baseLinks);
    const expectedGeometry = await geometry();
    for (const [path, current] of [
      ['/city/', 'Города'], ['/city/kazan', 'Города'], ['/season/compare/', 'Города'],
      ['/trip.html', 'Мои поездки'], ['/how-we-count.html', 'Как мы считаем'],
      ['/about.html', null], ['/#fav', 'Избранное'], ['/', 'Билеты'],
    ]) {
      await visit(page, path);
      assert.deepEqual(await links.allTextContents(), baseLinks, path);
      assert.deepEqual(await geometry(), expectedGeometry, path);
      assert.deepEqual(await nav.locator('[aria-current]').allTextContents(), current ? [current] : [], path);
      assert.equal(await services.isVisible(), path === '/', path);
    }

    const expectedServices = await rect(page, '.service-tabs');
    for (const [name, panel] of [
      ['Жильё', '#panel-stays'], [/^Авто/, '#panel-cars'], ['Туры', '#panel-tours'], ['Авиабилеты', '#flight-service'],
    ]) {
      const tab = services.getByRole('tab', { name });
      await tab.click();
      assert.equal(await tab.getAttribute('aria-selected'), 'true');
      assert.deepEqual(await geometry(), expectedGeometry);
      const serviceBox = await rect(page, '.service-tabs');
      assert.deepEqual(serviceBox, expectedServices);
      assert.ok(serviceBox.y + serviceBox.height <= (await rect(page, panel)).y);
      const tabPositions = await services.getByRole('tab').evaluateAll(tabs => tabs.map(tab => {
        const { top, right } = tab.getBoundingClientRect();
        return [top, right];
      }));
      assert.equal(new Set(tabPositions.map(([top]) => top)).size, 1);
      assert.ok(tabPositions.every(([, right]) => right <= width));
    }

    const flights = services.getByRole('tab', { name: 'Авиабилеты' });
    await flights.press('ArrowRight');
    assert.equal(await services.getByRole('tab', { name: 'Жильё' }).getAttribute('aria-selected'), 'true');
    await nav.getByRole('link', { name: 'Избранное' }).click();
    await page.locator('#favoriteTitle').waitFor();
    assert.equal(await services.isVisible(), false);
    assert.equal(await page.locator('#panel-stays').isVisible(), false);
    await nav.getByRole('link', { name: 'Билеты' }).click();
    await services.waitFor();
    assert.deepEqual(await nav.locator('[aria-current]').allTextContents(), ['Билеты']);
  }
});

test('Поиск городов обновляет карточки на месте по городу, стране и коду аэропорта', async t => {
  for (const [engine, width] of [[chromium, 1280], [webkit, 320]]) {
    const browser = await engine.launch();
    t.after(() => browser.close());
    const page = await openPage(browser, { width, height: 720 }, width === 320);
    await visit(page, '/city/');
    const query = page.getByRole('searchbox');
    const results = page.locator('#cityResults');
    assert.equal(await page.getByRole('button', { name: 'Найти', exact: true }).count(), 0);
    await page.evaluate(() => { window.catalogPage = true; });
    for (const [value, code] of [['Казань', 'KZN'], ['ОАЭ', 'DXB'], ['SVO', 'MOW']]) {
      await query.fill(value);
      await page.waitForURL(url => url.searchParams.get('q') === value);
      await results.locator('[data-city="' + code + '"]').waitFor();
      assert.equal(await page.evaluate(() => window.catalogPage), true);
    }
    await query.press('Enter');
    await page.waitForFunction(() => document.activeElement?.dataset.city === 'MOW');

    const fallback = await browser.newPage({ javaScriptEnabled: false });
    await fallback.goto(base + '/city/');
    const fallbackQuery = fallback.getByRole('searchbox');
    await fallbackQuery.fill('Казань');
    await fallbackQuery.press('Enter');
    await fallback.waitForURL(url => url.searchParams.get('q') === 'Казань');
    await fallback.locator('#cityResults [data-city="KZN"]').waitFor();
  }
});

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
    assert.ok(visibleLinks, 'Вкладки поиска должны быть доступны без горизонтальной прокрутки');
    await page.locator('.hero-photo img').evaluate(img => img.decode());
    assert.equal(await page.locator('.sky-plane, .flyby-plane').count(), 0);
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

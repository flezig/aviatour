// Запуск с локальным сайтом и установленным Playwright: node --test tests/browser/destination.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');

test('выбор региона, города и аэропорта в одном поле «Куда»', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const base = process.env.AVIATOR_TEST_URL ?? 'http://127.0.0.1:8000';
  const airports = readFileSync(join(__dirname, '../../backend/app/airports.json'), 'utf8');
  await page.route('**/api/v1/airports', route => route.fulfill({ contentType: 'application/json', body: airports }));
  await page.route('**/api/v1/search/web?*', route => route.fulfill({ json: {
    offers: [], incomplete: false, warnings: [], received_at: new Date().toISOString(),
  } }));
  const searchRequest = () => page.waitForRequest(r => new URL(r.url()).pathname === '/api/v1/search/web');
  const input = page.locator('#pickerInput');
  const open = () => page.locator('[data-field="destination"]').click();
  async function submit() {
    const [request] = await Promise.all([searchRequest(), page.locator('#searchButton').click()]);
    const params = new URL(request.url()).searchParams;
    return ['region', 'to', 'tc'].map(key => params.get(key));
  }

  // Старая ссылка одновременно содержит регион и город.
  await Promise.all([searchRequest(), page.goto(base + '/?from=SVO&fc=MOW&budget=25000&region=russia&to=KZN')]);
  assert.match(await page.locator('#lineTo').innerText(), /Казань/);
  await open();
  await page.locator('[data-region="russia"]').click();
  await open();
  await input.fill('Стамбул');
  const istanbul = page.locator('#picker [data-city="IST"]');
  await istanbul.waitFor();
  await input.press('Escape');
  assert.deepEqual(await submit(), ['russia', null, null]);

  await open();
  await input.fill('Стамбул');
  const airport = await istanbul.getAttribute('data-iata');
  await istanbul.click();
  assert.equal(await page.locator('#searchButton').innerText(), 'Найти билеты');
  assert.deepEqual(await submit(), [null, airport, 'IST']);

  await open();
  await input.fill('SAW');
  await page.locator('[data-iata="SAW"]:not([data-city])').click();
  assert.deepEqual(await submit(), [null, 'SAW', null]);

  await open();
  await page.locator('[data-region="any"]').click();
  assert.equal(await page.locator('#searchButton').innerText(), 'Показать направления');
  assert.deepEqual(await submit(), [null, null, null]);
});

test('на телефоне страна и город Тунис различимы, ссылка восстанавливает выбор', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const base = process.env.AVIATOR_TEST_URL ?? 'http://127.0.0.1:8000';
  const airports = readFileSync(join(__dirname, '../../backend/app/airports.json'), 'utf8');
  await page.route('**/api/v1/airports', route => route.fulfill({ contentType: 'application/json', body: airports }));
  await page.route('**/api/v1/search/web?*', route => route.fulfill({ json: {
    offers: [], incomplete: false, warnings: [], received_at: new Date().toISOString(),
  } }));
  await page.goto(base);
  async function openDestination() {
    if (!await page.locator('#destinationPick').isVisible()) await page.locator('#searchSummary').click();
    await page.locator('#destinationPick').click();
  }
  await openDestination();
  const menu = page.locator('#picker');
  const input = menu.locator('#pickerInput');
  assert.equal(await input.evaluate(el => el === document.activeElement), false);
  await input.fill('Тунис');
  await menu.getByText('Страны и регионы', { exact: true }).waitFor();
  await menu.getByText('Города и аэропорты', { exact: true }).waitFor();
  const city = menu.locator('[data-iata="TUN"]').first();
  await city.waitFor();
  await menu.locator('[data-region="tunisia"]').click();
  const requested = page.waitForRequest(r => new URL(r.url()).pathname === '/api/v1/search/web');
  await page.locator('#searchButton').click();
  assert.equal(new URL((await requested).url()).searchParams.get('region'), 'tunisia');
  await page.reload();
  await openDestination();
  await menu.locator('[data-region="tunisia"][aria-current]').waitFor();
  await input.fill('Тунис');
  await city.click();
  assert.equal(await page.locator('#searchButton').innerText(), 'Найти билеты');
});

test('Таиланд и ОАЭ появляются по вводу, выбор восстанавливается по ссылке', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const base = process.env.AVIATOR_TEST_URL ?? 'http://127.0.0.1:8000';
  await page.route('**/api/v1/search/web?*', route => route.fulfill({ json: {
    offers: [], incomplete: false, warnings: [], received_at: new Date().toISOString(),
  } }));
  const menu = page.locator('#picker');
  const input = menu.locator('#pickerInput');
  const open = () => page.locator('[data-field="destination"]').click();
  const initial = ['any', 'russia', 'turkey', 'egypt', 'tunisia', 'europe', 'asia', 'usa'];
  const visibleScopes = () => menu.locator('[data-region]:visible').evaluateAll(rows => rows.map(row => row.dataset.region));
  await page.goto(base);
  for (const [scope, names] of [
    ['thailand', ['Таил', 'Тайланд', 'Thailand']],
    ['uae', ['ОАЭ', 'эмир', 'Объединённые Арабские Эмираты', 'UAE']],
  ]) {
    await open();
    assert.deepEqual(await visibleScopes(), initial);
    for (const name of names) {
      await input.fill(name);
      assert.deepEqual(await visibleScopes(), [scope]);
    }
    await input.fill('DXB');
    assert.deepEqual(await visibleScopes(), []);
    await menu.locator('[data-iata="DXB"]').first().waitFor();
    await input.fill(names[0]);
    await menu.locator('[data-region="' + scope + '"]').click();
    const requested = page.waitForRequest(r => new URL(r.url()).pathname === '/api/v1/search/web');
    await page.locator('#searchButton').click();
    assert.equal(new URL((await requested).url()).searchParams.get('region'), scope);
    await page.reload();
    await open();
    assert.deepEqual(await visibleScopes(), initial);
    await input.fill(names[0]);
    await menu.locator('[data-region="' + scope + '"][aria-current]').waitFor();
    await input.fill('');
    assert.deepEqual(await visibleScopes(), initial);
    await input.press('Escape');
  }
});

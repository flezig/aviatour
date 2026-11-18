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

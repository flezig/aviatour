const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');

const base = process.env.AVIATOR_TEST_URL ?? 'http://127.0.0.1:8000';
const origin = { code: 'MOW', iata: 'SVO', all: true, name: 'Москва', from: 'Москвы' };
const year = new Date().getFullYear() + 1;
function trip(id, city, code, day) {
  return {
    id, city, city_code: code, destination_airport: code, origin_airport: 'SVO',
    origin_city_code: 'MOW', origin_city: 'Москва', country: 'Россия', country_code: 'RU',
    origin_timezone: 'Europe/Moscow', destination_timezone: 'Europe/Moscow',
    departure_at: `${year}-06-${day}T09:30:00+03:00`, return_at: `${year}-06-28T18:00:00+03:00`,
    price_minor: Number(day) * 100000, duration_to: 100, duration_back: 100, transfers: 0, return_transfers: 0,
    airline: 'SU', flight_number: day, received_at: new Date().toISOString(),
  };
}
const pskov = trip('psk1', 'Псков', 'PKV', '10'), murmansk = trip('mur', 'Мурманск', 'MMK', '11');
const later = trip('psk2', 'Псков', 'PKV', '12'), ufa = trip('ufa', 'Уфа', 'UFA', '14');
const saved = ['Казань', 'Сочи', 'Омск', 'Пермь'].map((city, i) => trip('old' + i, city, ['KZN', 'AER', 'OMS', 'PEE'][i], '20'));
const home = {
  origin, received_at: pskov.received_at, usual: {}, notes: {},
  offers: Object.fromEntries([pskov, murmansk, later, ufa].map(o => [o.id, o])),
  rows: [
    { key: 'hot', title: 'Горячие билеты', kind: 'pass', items: ['psk1', 'mur', 'psk2'] },
    { key: 'weekend', title: 'На выходные', kind: 'stamp', items: ['ufa', 'mur', 'psk1'] },
  ],
};

for (const [engine, viewport] of [[chromium, { width: 1280, height: 800 }], [webkit, { width: 375, height: 812 }]]) {
  test(`два сердечка в одной ленте — ${engine.name()} ${viewport.width}`, async t => {
    const browser = await engine.launch();
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport });
    await context.route('**/api/v1/origin', route => route.fulfill({ json: origin }));
    await context.route('**/api/v1/home?*', route => route.fulfill({ json: home }));
    const page = await context.newPage();
    await page.addInitScript(list => {
      if (!localStorage.getItem('aviator.favorites')) localStorage.setItem('aviator.favorites', JSON.stringify(list));
    }, saved);
    await page.goto(base);
    const hot = page.locator('[data-feed="hot"]'), other = page.locator('[data-feed="weekend"]');
    const like = (row, id) => row.locator(`[data-fav="${id}"]`).click();
    const compare = hot.locator('[data-compare-row]'), sheet = page.locator('#pairComparison');
    const heads = sheet.locator('th[scope="col"]');
    await like(hot, 'psk1');
    await like(other, 'ufa');
    assert.equal(await page.locator('[data-compare-row]:visible').count(), 0);
    await like(hot, 'mur');
    assert.equal(await compare.innerText(), 'Сравнить Псков и Мурманск');
    assert.equal(await other.locator('[data-compare-row]').isVisible(), false);
    await compare.click();
    assert.deepEqual(await heads.allTextContents(), ['Псков', 'Мурманск']);
    const cells = name => sheet.getByRole('rowheader', { name, exact: true }).locator('..').locator('td').allTextContents();
    const prices = await cells('Цена');
    assert.deepEqual(prices.map(s => s.replace(/\s/g, '')), ['10000₽', '11000₽']);
    assert.deepEqual(await cells('Даты'), ['10–28 июня', '11–28 июня']);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.goBack();
    await sheet.waitFor({ state: 'hidden' });
    assert.equal(await hot.locator('[data-fav="psk1"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await compare.evaluate(el => document.activeElement === el), true);
    await page.goForward();
    await sheet.getByRole('button', { name: 'Назад к подборке' }).click();
    await page.waitForFunction(() => !history.state?.compareRow);
    await like(hot, 'psk2');
    assert.equal(await compare.innerText(), 'Сравнить Мурманск и Псков');
    await like(hot, 'mur');
    assert.equal(await compare.isVisible(), false);
    await like(hot, 'psk1');  // снять старую отметку, затем заново выбрать рейс
    await like(hot, 'psk1');
    await compare.click();
    const labels = await heads.allTextContents();
    assert.match(labels[0], /Псков.*12 июня/);
    assert.match(labels[1], /Псков.*10 июня/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !history.state?.compareRow);
    await page.locator('.top a[href="/#fav"]').click();
    await like(page.locator('#results'), 'psk1');
    await page.goBack();
    await hot.waitFor();
    assert.equal(await compare.isVisible(), false);
    await like(hot, 'psk1');
    await compare.click();
    const otherTab = await context.newPage();
    await otherTab.goto(base + '/#fav');
    await like(otherTab.locator('#results'), 'psk2');
    await sheet.waitFor({ state: 'hidden' });
    assert.equal(await compare.isVisible(), false);
    await otherTab.close();
    await like(hot, 'psk2');
    assert.equal(await compare.isVisible(), true);
    await page.reload();
    await hot.waitFor();
    assert.equal(await hot.locator('[data-fav="psk1"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await hot.locator('[data-fav="psk2"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await compare.isVisible(), false);
  });
}

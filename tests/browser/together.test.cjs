const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');

const base = process.env.AVIATOR_TEST_URL ?? 'http://127.0.0.1:8000';
const year = new Date().getFullYear() + 1;
const date = (day, hour) => `${year}-02-${String(day).padStart(2, '0')}T${hour}:00:00+03:00`;
const first = { id:'a'.repeat(32), city:'Казань', city_code:'KZN', origin_city:'Москва', origin_city_code:'MOW',
  origin_airport:'SVO', destination_airport:'KZN', origin_timezone:'Europe/Moscow', destination_timezone:'Europe/Moscow',
  departure_at:date(2,'08'), return_at:date(5,'20'), price_minor:1200000, received_at:new Date().toISOString(), duration_to:120 };
const second = { ...first, id:'b'.repeat(32), city:'Сочи', city_code:'AER', destination_airport:'AER', price_minor:1400000 };
const other = { ...first, id:'c'.repeat(32), origin_city:'Санкт-Петербург', origin_city_code:'LED', origin_airport:'LED', departure_at:date(3,'12'), return_at:date(7,'18'), price_minor:500000 };
const longer = { ...other, id:'d'.repeat(32), departure_at:date(1,'10'), price_minor:1000000 };

for (const [engine, width] of [[chromium, 1280], [webkit, 375]]) {
  test(`сравнение поездок и встреча двух групп — ${engine.name()} ${width}`, async t => {
    const browser = await engine.launch(); t.after(() => browser.close());
    const context = await browser.newContext({ viewport:{ width, height:820 } });
    await context.addInitScript(({first, second}) => {
      localStorage.setItem('aviator.favorites', JSON.stringify([first, second]));
      localStorage.setItem('aviator.favoriteComparison', JSON.stringify([second.id, first.id]));
    }, { first, second });
    await context.route('**/api/v1/origin', route => route.fulfill({ json:{name:'Москва', code:'MOW', iata:'SVO', all:true} }));
    const calls = [];
    await context.route('**/api/v1/search/web?*', route => {
      const query = new URL(route.request().url()).searchParams; calls.push(query);
      return route.fulfill({json:{offers:query.get('from') === 'LED' ? [other,longer] : [first,second]}});
    });
    const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/together.html#budget');
    await page.locator('[data-trip="0"]').waitFor();
    assert.equal(await page.locator('[data-trip="0"]').inputValue(), second.id);
    assert.match(await page.locator('#budgetDifference').innerText(), /нужны расходы/);
    await page.locator('#budgetPeople').selectOption('3');
    for (const side of [0,1]) {
      await page.locator(`[data-cost=rate][data-side="${side}"]`).fill(side === 0 ? '1000' : '5000');
      await page.locator(`[data-cost=extra][data-side="${side}"]`).fill('0');
    }
    assert.match((await page.locator('#budgetDifference').innerText()).replace(/\s/g,''), /Перваяпоездкадешевлепримернона6000₽/);
    await page.getByRole('link', { name:'Встретиться в городе' }).click();
    await page.locator('#meetDestination').selectOption('KZN');
    await page.getByRole('button', {name:'Найти город встречи'}).click();
    const result = page.locator('#meetResults article').first(); await result.waitFor();
    assert.deepEqual(calls.map(query => query.get('from')).sort(), ['LED','SVO']);
    assert.ok(calls.every(query => query.get('weekend') === '0' && query.get('tc') === 'KZN'));
    assert.match(await result.innerText(), /54 ч вместе/);
    await page.locator('#secondPeople').selectOption('2');
    assert.match((await result.innerText()).replace(/\s/g,''), /билетынавсех22000₽/);
    assert.equal(new URL(await result.locator('a').last().getAttribute('href'), base).searchParams.get('trip'), other.id);
    await page.locator('#meetSort').selectOption('longest');
    assert.match(await result.innerText(), /82 ч вместе/);
    assert.equal(new URL(await result.locator('a').last().getAttribute('href'), base).searchParams.get('trip'), longer.id);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#secondOrigin').selectOption('MOW');
    await page.getByRole('button', {name:'Найти город встречи'}).click();
    assert.match(await page.locator('#meetStatus').innerText(), /два разных/);
    assert.equal(await result.count(), 0); assert.deepEqual(errors, []);
  });
}

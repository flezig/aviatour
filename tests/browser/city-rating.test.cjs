const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const base = process.env.AVIATOR_TEST_URL ?? 'http://127.0.0.1:8000';
const origin = { code: 'MOW', iata: 'SVO', all: true, name: 'Москва', from: 'Москвы' };
const offer = {
  id: 'kzn-test', city: 'Казань', city_code: 'KZN', destination_airport: 'KZN', origin_airport: 'SVO',
  origin_city_code: 'MOW', origin_city: 'Москва', country: 'Россия', country_code: 'RU',
  origin_timezone: 'Europe/Moscow', destination_timezone: 'Europe/Moscow',
  departure_at: '2026-11-30T23:30:00+03:00', return_at: '2026-12-06T18:00:00+03:00',
  price_minor: 1000000, duration_to: 100, duration_back: 100, transfers: 0, return_transfers: 0,
  airline: 'SU', flight_number: '100', received_at: new Date().toISOString(),
};
const trips = [offer, { ...offer, id: 'sochi-test', city: 'Сочи', city_code: 'AER', transfers: 1 },
  { ...offer, id: 'omsk-test', city: 'Омск', city_code: 'OMS', transfers: null, return_transfers: null }];
const home = {
  origin, received_at: offer.received_at, usual: {}, notes: {}, offers: Object.fromEntries(trips.map(trip => [trip.id, trip])),
  rows: [{ key: 'hot', title: 'Горячие билеты', kind: 'pass', items: trips.map(trip => trip.id) }],
};

for (const mobile of [false, true]) {
  test('расшифровка рейтинга в билете и в открытой поездке · ' + (mobile ? 'касание' : 'мышь и клавиатура'), async t => {
    const browser = await (mobile ? webkit : chromium).launch();
    t.after(() => browser.close());
    const context = await browser.newContext(mobile
      ? { isMobile: true, hasTouch: true, reducedMotion: 'reduce', viewport: { width: 375, height: 812 } }
      : { viewport: { width: 1280, height: 850 } });
    await context.route('**/api/v1/origin', route => route.fulfill({ json: origin }));
    await context.route('**/api/v1/home?*', route => route.fulfill({ json: home }));
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-11-25T12:00:00Z'));
    const details = [];
    page.on('request', req => {
      if (new URL(req.url()).pathname === '/api/v1/city-rating/KZN') details.push(req.url());
    });
    await page.goto(base);
    const firstTile = page.locator('.tile--pass').first();
    const card = firstTile.locator('.portrait > .city-rating--photo');
    const panel = page.locator('#city-rating-popover:popover-open');
    await card.waitFor();
    assert.match(await card.getAttribute('aria-label'), /^Рейтинг города Казань, /);
    assert.doesNotMatch(await card.innerText(), /Рейтинг города/);
    assert.equal(await firstTile.locator('.flight-transfers').innerText(), 'Без пересадок');
    assert.equal(await page.locator('.tile--pass .flight-transfers').nth(1).innerText(), 'На пути туда — 1 пересадка');
    assert.equal(await page.locator('.tile--pass .flight-transfers').nth(2).innerText(), 'Пересадки неизвестны');
    const photo = firstTile.locator('.portrait');
    const withinPhoto = await photo.evaluate(el => {
      const photo = el.getBoundingClientRect();
      const badge = el.querySelector('.city-rating--photo').getBoundingClientRect();
      return Math.abs(photo.bottom - badge.bottom) < 1 && Math.abs(photo.right - badge.right) < 1 &&
        getComputedStyle(el).borderBottomRightRadius === '0px';
    });
    assert.equal(withinPhoto, true);
    assert.equal(await card.getAttribute('data-rating-month'), '12');
    assert.equal(await card.getAttribute('data-rating-year'), '2026');

    if (mobile) await card.tap(); else await card.hover();
    await panel.locator('tbody tr').first().waitFor();
    assert.equal(await panel.locator('tbody tr').count(), 4);
    assert.equal(await panel.locator('h2').innerText(), 'Казань');
    assert.equal(await panel.locator('.rating-caption').innerText(), 'декабрь 2026');
    if (await panel.locator('.city-rating-gaps').count()) {
      assert.match(await panel.locator('.city-rating-gaps').innerText(), /гостиницах|маршрут/);
    } else {
      assert.match(await panel.innerText(), /Росстат/);
      assert.match(await card.innerText(), /7,0/);
    }
    assert.equal(await page.locator('#detail').isVisible(), false);
    const box = await panel.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1);
    if (mobile) {
      await panel.getByRole('button', { name: 'Закрыть рейтинг' }).tap();
    } else {
      await page.keyboard.press('Escape');
      await card.focus();
      await panel.waitFor();
      await page.keyboard.press('Escape');
    }
    await panel.waitFor({ state: 'hidden' });
    const trip = page.locator('[data-open="kzn-test"]').first();
    await trip.press('Enter');
    await page.locator('#detail:modal').waitFor();
    const detailBadge = page.locator('#detail .city-rating');
    if (mobile) await detailBadge.tap(); else await detailBadge.hover();
    await panel.locator('tbody').waitFor();
    assert.equal(details.length, 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#detail').isVisible(), true);
    await panel.waitFor({ state: 'hidden' });
    await page.locator('#detail [data-close]').click();
    await page.locator('[data-row-all="hot"]').click();
    const resultBadge = page.locator('#results .offer .portrait > .city-rating--photo[data-rating-city="KZN"]');
    await resultBadge.waitFor();
    const style = () => resultBadge.evaluate(el => {
      const value = el.querySelector('.city-rating-value').getBoundingClientRect();
      const photo = el.parentElement.getBoundingClientRect();
      return {
        corner: getComputedStyle(el.parentElement).borderBottomRightRadius,
        textDecoration: getComputedStyle(el).textDecorationLine,
        surface: getComputedStyle(el).backgroundColor,
        fits: value.right < photo.right && value.bottom < photo.bottom,
      };
    });
    const expected = { corner: '0px', textDecoration: 'none', surface: 'rgb(245, 246, 248)', fits: true };
    assert.deepEqual(await style(), expected);
    if (mobile) await resultBadge.tap(); else await resultBadge.hover();
    await panel.locator('tbody').waitFor();
    assert.deepEqual(await style(), expected);
    assert.equal(await page.locator('#detail').isVisible(), false);
  });
}

for (const mobile of [false, true]) {
  test('каталог рейтингов · ' + (mobile ? 'нижняя панель' : 'боковая панель'), async t => {
    const browser = await (mobile ? webkit : chromium).launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ hasTouch: mobile, viewport: { width: mobile ? 390 : 1280, height: 840 } });
    await page.goto(base + '/season/?q=LED&month=12');
    const badge = page.locator('.city-rating[data-rating-city="LED"]');
    const panel = page.locator('#city-rating-popover');
    if (mobile) {
      assert.equal(await panel.isVisible(), false);
      await badge.tap();
      assert.equal(await page.locator('.rating-sheet').evaluate(dialog => dialog.matches(':modal')), true);
    }
    await panel.locator('tbody').waitFor();
    assert.equal(await panel.locator('tbody tr').count(), 4);
    assert.equal(await panel.locator('h2').innerText(), 'Санкт-Петербург');
    await panel.getByRole('button', { name: 'Источники и расчёт' }).click();
    assert.ok(await panel.locator('.rating-document li a').count() > 0);
    const back = panel.getByRole('button', { name: 'К рейтингу' });
    assert.equal(await back.evaluate(el => document.activeElement === el), true);
    await back.click();
    await panel.getByRole('button', { name: 'Закрыть рейтинг' }).click();
    assert.equal(await badge.evaluate(el => document.activeElement === el), true);
    await page.getByRole('searchbox').fill('SAW');
    const istanbul = page.locator('.rating-tile-city[href*="/season/IST?"]');
    await istanbul.waitFor();
    assert.equal(await page.locator('.city-rating[data-rating-city="IST"]:visible').count(), 0);
    await page.getByRole('combobox', { name: 'Месяц' }).selectOption('1');
    await page.locator('.rating-tile-city[href*="/season/IST?month=1&"]').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
}

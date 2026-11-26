const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');

for (const [engine, width] of [[chromium, 1280], [webkit, 375]]) {
  test('Жильё передаёт выбранный город, даты и взрослых — ' + engine.name(), async t => {
    const browser = await engine.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 2 });
    await page.goto((process.env.AVIATOR_TEST_URL ?? 'http://localhost:8000') + '/?service=stays');
    const form = page.locator('#hotelSearch');
    const icons = page.locator('.service-tabs img');
    assert.equal(await icons.count(), 4);
    assert.ok(await icons.evaluateAll(async images => {
      await Promise.all(images.map(image => image.decode()));
      return images.every(image => image.currentSrc.endsWith('.svg'));
    }));
    await form.locator('.stay-place').click();
    await page.getByRole('searchbox', { name: 'Найти город' }).fill('дуб');
    await page.getByRole('button', { name: 'Дубай', exact: true }).click();
    await form.locator('[name=adults]').selectOption('3');
    await form.locator('[data-stay-date=checkin]').click();
    const calendar = page.locator('#stayCalendar');
    const checkinButton = calendar.locator('[data-day]:not([disabled])').first();
    const date = await checkinButton.getAttribute('data-day');
    await checkinButton.click();
    const checkoutButton = calendar.locator('[data-day]:not([disabled])').first();
    const checkout = await checkoutButton.getAttribute('data-day');
    assert.ok(checkout > date);
    await checkoutButton.click();
    await calendar.locator('[data-apply]').click();
    await page.locator('#tab-flights').click();
    await page.locator('#tab-stays').click();
    assert.equal(await form.locator('#stayPlace').innerText(), 'Дубай');
    assert.equal(await form.locator('[name=adults]').inputValue(), '3');
    await page.route('**/go?*', route => route.fulfill({ body: 'OK' }));
    await form.getByRole('button', { name: 'Найти жильё на Авиасейлс' }).click();
    await page.waitForURL('**/go?*');
    const redirect = new URL(page.url()).searchParams;
    assert.equal(redirect.get('s'), 'dxb-home-stay');
    const search = new URL(redirect.get('u'));
    assert.equal(search.origin + search.pathname, 'https://www.aviasales.ru/hotels/search');
    assert.deepEqual(Object.fromEntries(search.searchParams), {
      location_id: '6053839', location_type: 'city', checkin: date, checkout, adults: '3'
    });
  });
}

test('Быстрый город заполняет жильё и открывает календарь только без дат', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto((process.env.AVIATOR_TEST_URL ?? 'http://localhost:8000') + '/?service=stays');
  const quick = page.getByRole('group', { name: 'Быстрый выбор города' });
  const calendar = page.locator('#stayCalendar');
  await quick.waitFor();
  assert.deepEqual(await quick.getByRole('button').allTextContents(), ['Казань', 'Сочи', 'Стамбул']);
  await quick.getByRole('button', { name: 'Казань' }).press('Enter');
  await calendar.waitFor();
  assert.equal(await page.locator('#stayPlace').innerText(), 'Казань');
  assert.equal(await quick.isVisible(), false);
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('[data-stay-date=checkin]').evaluate(button => button === document.activeElement));

  await page.evaluate(() => sessionStorage.removeItem('aviator.stay'));
  await page.reload();
  await page.locator('[data-stay-date=checkin]').click();
  await calendar.locator('[data-day]:not([disabled])').first().click();
  await calendar.locator('[data-day]:not([disabled])').first().click();
  await calendar.locator('[data-apply]').click();
  const dates = await page.locator('#stayNights').innerText();
  await quick.getByRole('button', { name: 'Сочи' }).click();
  await page.getByRole('button', { name: 'Город или курорт Сочи' }).waitFor();
  assert.equal(await calendar.isVisible(), false);
  await page.reload();
  await page.getByRole('button', { name: 'Город или курорт Сочи' }).waitFor();
  assert.equal(await quick.isVisible(), false);
  assert.equal(await page.locator('#stayNights').innerText(), dates);
});

test('Из билета в жильё передаются местная дата прилёта и состав семьи', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const year = new Date().getFullYear() + 1;
  const base = process.env.AVIATOR_TEST_URL ?? 'http://localhost:8000';
  const offer = {
    id: '0123456789abcdef0123456789abcdef', city: 'Казань', city_code: 'KZN', destination_airport: 'KZN',
    origin_airport: 'SVO', origin_city_code: 'MOW', origin_city: 'Москва', country: 'Россия', country_code: 'RU',
    origin_timezone: 'Europe/Moscow', destination_timezone: 'Europe/Moscow',
    departure_at: `${year}-12-04T23:30:00+03:00`, return_at: `${year}-12-07T19:00:00+03:00`,
    duration_to: 120, duration_back: 100, transfers: 0, return_transfers: 0,
    price_minor: 700000, airline: 'SU', flight_number: '100', received_at: new Date().toISOString()
  };
  await page.route('**/api/v1/search/web?*', route => route.fulfill({ json: { offers: [offer], received_at: offer.received_at } }));
  await page.goto(base + '/?from=SVO&fc=MOW&to=KZN&tc=KZN&adults=2&ages=6');
  await page.locator('.offer-open').click();
  await page.getByRole('link', { name: /Найти жильё на эти даты/ }).click();
  await page.waitForURL('**/?service=stays');
  const form = page.locator('#hotelSearch');
  await page.getByText('Казань', { exact: true }).first().waitFor();
  assert.equal(await form.locator('#stayPlace').innerText(), 'Казань');
  assert.match(await form.locator('#stayCheckin').innerText(), /5 декабря/);
  assert.match(await page.locator('#stayNights').innerText(), /2 ночи/);
  assert.match(await page.locator('#stayFamily').innerText(), /2 взрослых, 1 ребёнок.*6 лет.*добавьте на Авиасейлс/);
  assert.equal(await form.locator('[name=adults]').inputValue(), '2');
  assert.equal(await page.locator('#stayQuick').isVisible(), false);
  await page.goBack();
  await page.locator('#detail[open]').waitFor();
  assert.equal(await page.locator('#detailTitle').innerText(), 'Казань');
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');

const base = process.env.AVIATOR_TEST_URL ?? 'http://127.0.0.1:8000';
const origin = { code: 'MOW', iata: 'SVO', all: true, name: 'Москва', from: 'Москвы' };
const today = '2030-02-05T09:00:00Z';

function offer(id, city, airport, day, price) {
  const istanbul = city === 'Стамбул';
  return {
    id, city, city_code: istanbul ? 'IST' : 'KZN', destination_airport: airport,
    origin_airport: 'SVO', origin_city_code: 'MOW', origin_city: 'Москва',
    origin_timezone: 'Europe/Moscow', destination_timezone: istanbul ? 'Europe/Istanbul' : 'Europe/Moscow',
    departure_at: '2030-02-' + day + 'T09:00:00+03:00', return_at: '2030-02-' + (day + 2) + 'T14:00:00+03:00',
    price_minor: price * 100, duration_to: 120, duration_back: 120, transfers: 0, return_transfers: 0,
    received_at: today,
  };
}

const offers = [
  offer('ist-12', 'Стамбул', 'IST', 12, 18000),
  offer('saw-14', 'Стамбул', 'SAW', 14, 17000),
  offer('saw-17', 'Стамбул', 'SAW', 17, 19000),
  { ...offer('saw-19-nights', 'Стамбул', 'SAW', 18, 22000), return_at: '2030-03-09T14:00:00+03:00' },
  offer('kzn-16', 'Казань', 'KZN', 16, 12000),
];

const sundayReturn = '2030-02-17T14:00:00+03:00';
const filterOffers = [
  { ...offer('near-weekend', 'Казань', 'KZN', 16, 12000), return_at: sundayReturn, duration_to: 180 },
  { ...offer('near-weekday', 'Стамбул', 'IST', 12, 9000), return_transfers: 1 },
  { ...offer('long-weekend', 'Стамбул', 'IST', 16, 15000), return_at: sundayReturn, duration_back: 181 },
];

async function setup(t, mobile, sample = offers) {
  const browser = await (mobile ? webkit : chromium).launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    isMobile: mobile, hasTouch: mobile, timezoneId: 'Europe/Moscow',
    viewport: { width: mobile ? 390 : 1280, height: 844 },
  });
  page.setDefaultTimeout(7000);
  await page.clock.setFixedTime(new Date(today));
  await page.route('**/api/v1/origin', route => route.fulfill({ json: origin }));
  await page.route('**/api/v1/home?*', route => route.fulfill({ json: { origin, rows: [], offers: {}, notes: {}, usual: {} } }));
  await page.route('**/api/v1/search/web?*', route => {
    const p = new URL(route.request().url()).searchParams;
    const matches = sample.filter(offer => {
      if (p.has('budget') && offer.price_minor > Number(p.get('budget')) * 100) return false;
      if (p.get('direct') === '1' && (offer.transfers || offer.return_transfers)) return false;
      if (p.has('tc')) return p.get('tc') === offer.city_code;
      return !p.has('to') || p.get('to') === offer.destination_airport;
    });
    return route.fulfill({ json: { offers: matches, received_at: today, incomplete: false, warnings: [] } });
  });

  await page.goto(base + '/#ab=B');
  await page.getByText('Подборок пока нет', { exact: true }).waitFor();
  return page;
}

async function searchParams(page, action) {
  const [response] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/search/web'),
    action(),
  ]);
  await page.locator('#results .chips').waitFor();
  const params = new URL(response.url()).searchParams;
  const address = new URL(page.url()).searchParams;
  for (const localFilter of ['filter', 'group', 'length', 'adults', 'ages']) {
    assert.equal(params.has(localFilter), false);
    address.delete(localFilter);
  }
  assert.deepEqual(Object.fromEntries(address), Object.fromEntries(params));
  return params;
}

const submit = page => searchParams(page, () => page.locator('#searchButton').click());
const visibleIds = page => page.locator('#results [data-offer]').evaluateAll(nodes => nodes.map(node => node.dataset.offer));

for (const mobile of [false, true]) {
  const screen = mobile ? 'телефон' : 'компьютер';

  test('Семейный поиск сохраняет возраст и отправляет на проверку цены за троих, ' + screen, async t => {
    const sample = { ...offers[4], id: 'c'.repeat(32), search_url: 'https://www.aviasales.com/search/SVO1602KZN18021?t=adult-only' };
    const page = await setup(t, mobile, [sample]);
    const pick = page.locator('[data-field="passengers"]'), dialog = page.locator('#passengerPicker');
    await pick.click();
    const bounds = await dialog.boundingBox();
    if (mobile) assert.ok(Math.abs(bounds.y + bounds.height - 844) < 2);
    else assert.ok(bounds.width < 400);
    assert.equal(await page.locator('#adultMinus').isDisabled(), true);
    await page.locator('#addChild').click();
    assert.equal(await page.locator('#applyPassengers').isDisabled(), true);
    await page.locator('#childAge0').selectOption('0');
    assert.equal(await page.locator('#infantNote').isVisible(), true);
    await page.locator('#addChild').click();
    assert.equal(await page.locator('#childAge1 option[value="1"]').isDisabled(), true);
    await dialog.getByRole('button', { name: 'Убрать ребёнка 2' }).click();
    await page.locator('#childAge0').selectOption('7');
    await page.locator('#adultPlus').click();
    await page.locator('#applyPassengers').click();
    assert.match(await pick.innerText(), /2 взрослых, 1 ребёнок \(7 лет\)/);
    await submit(page);
    assert.equal(new URL(page.url()).searchParams.get('ages'), '7');
    await searchParams(page, () => page.reload());
    await page.locator('#results [data-offer]').click();
    const action = page.getByRole('link', { name: 'Проверить цену на троих' });
    const dest = async button => new URL(await button.getAttribute('href'), base).searchParams.get('u');
    assert.equal(await dest(action), 'https://www.aviasales.com/search/SVO1602KZN180221');
    assert.match(await page.locator('.pass-stub').innerText(), /за одного взрослого/);
    assert.equal(new URL(page.url()).searchParams.get('ages'), '7');
    await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.sharedTrip = data.url; } }));
    await page.locator('#share').click();
    const shared = await page.evaluate(() => window.sharedTrip);
    await page.goBack();
    assert.equal(new URL(page.url()).searchParams.get('adults'), '2');
    await page.goForward();
    assert.equal(await dest(action), 'https://www.aviasales.com/search/SVO1602KZN180221');
    await page.goto(shared);
    assert.match(await page.locator('#plan').innerText(), /2 взрослых, 1 ребёнок \(7 лет\)/);
    assert.equal(await dest(page.locator('#planTicketLink')), 'https://www.aviasales.com/search/SVO1602KZN180221');
    assert.match(await page.locator('#planTotal').innerText(), /Билеты на всех уточните/);
  });

  test('Поиск везде, в городе и в аэропорту показывает нужные даты, ' + screen, async t => {
    const page = await setup(t, mobile);
    await submit(page);
    assert.deepEqual(await visibleIds(page), ['kzn-16', 'saw-14']);
    assert.equal(await page.locator('[data-chip="unique"]').getAttribute('aria-pressed'), 'true');

    await page.locator('[data-field="destination"]').click();
    await page.locator('#pickerInput').fill('Стамбул');
    await page.locator('#picker [data-city="IST"]').click();
    const city = await submit(page);
    assert.equal(city.get('tc'), 'IST');
    assert.deepEqual(await visibleIds(page), ['saw-14', 'ist-12', 'saw-17', 'saw-19-nights']);
    assert.equal(await page.locator('[data-chip="unique"]').count(), 0);

    await page.locator('[data-field="destination"]').click();
    await page.locator('#pickerInput').fill('SAW');
    await page.locator('#picker [data-iata="SAW"]:not([data-city])').click();
    const airport = await submit(page);
    assert.equal(airport.get('to'), 'SAW');
    assert.equal(airport.get('tc'), null);
    assert.deepEqual(await visibleIds(page), ['saw-14', 'saw-17', 'saw-19-nights']);
    await page.locator('#length').selectOption('short');
    assert.deepEqual(await visibleIds(page), ['saw-14', 'saw-17']);
  });

  test('Быстрый поиск до трёх часов и сочетание с выходными сохраняются в ссылке, ' + screen, async t => {
    const page = await setup(t, mobile, filterOffers);
    const chip = name => page.locator('[data-quick="' + name + '"]');
    const filters = () => new URL(page.url()).searchParams.getAll('filter').sort();
    const calls = [];
    page.on('request', req => {
      if (new URL(req.url()).pathname === '/api/v1/search/web') calls.push(req.url());
    });
    const quick = page.getByRole('group', { name: 'Быстрый поиск по условию' });
    const shortcut = quick.getByRole('button', { name: 'В пути до 3 ч' });
    await shortcut.focus();
    const position = await page.evaluate(() => {
      window.quickSearchScrollCalls = 0;
      const scroll = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (...args) {
        window.quickSearchScrollCalls++;
        return scroll.apply(this, args);
      };
      return scrollY;
    });
    await searchParams(page, () => shortcut.press('Enter'));
    assert.deepEqual(await page.evaluate(() => [scrollY, window.quickSearchScrollCalls]), [position, 0]);
    const source = await page.locator('#results .source').innerText();
    assert.match(source, /^Цены из кеша Aviasales, получены /);
    assert.doesNotMatch(source, /Куда угодно|Москва|Как мы считаем/u);
    assert.equal(await shortcut.evaluate(el => el === document.activeElement), true);
    assert.equal(await chip('near').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(filters(), ['near']);
    assert.deepEqual(await visibleIds(page), ['near-weekday', 'near-weekend']);

    await chip('noLeave').press('Enter');
    assert.equal(await chip('noLeave').evaluate(el => el === document.activeElement), true);
    assert.deepEqual(await page.evaluate(() => [scrollY, window.quickSearchScrollCalls]), [position, 0]);
    assert.deepEqual(filters(), ['near', 'noLeave']);
    assert.deepEqual(await visibleIds(page), ['near-weekend']);
    assert.equal(calls.length, 1);
    await searchParams(page, () => page.reload());
    assert.equal(await chip('near').getAttribute('aria-pressed'), 'true');
    assert.equal(await chip('noLeave').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await visibleIds(page), ['near-weekend']);

    await chip('near').press('Enter');
    assert.deepEqual(filters(), ['noLeave']);
    assert.deepEqual(await visibleIds(page), ['near-weekend', 'long-weekend']);
    await chip('noLeave').press('Enter');
    assert.deepEqual(filters(), []);
    assert.deepEqual(await visibleIds(page), ['near-weekday', 'near-weekend']);
    assert.equal(calls.length, 2);
  });

  test('Старый параметр прямых рейсов доступен в выдаче и снимается запросом, ' + screen, async t => {
    const page = await setup(t, mobile, filterOffers);
    const direct = page.getByRole('button', { name: 'Без пересадок', exact: true });
    const oldLink = '/?from=SVO&fc=MOW&month=2030-02&weekend=0&direct=1';
    const original = await searchParams(page, () => page.goto(base + oldLink));
    assert.equal(original.get('direct'), '1');
    assert.equal(await direct.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await visibleIds(page), ['near-weekend', 'long-weekend']);

    const disabled = await searchParams(page, () => direct.press('Enter'));
    assert.equal(await direct.evaluate(el => el === document.activeElement), true);
    assert.equal(disabled.has('direct'), false);
    assert.equal(await direct.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await visibleIds(page), ['near-weekday', 'near-weekend']);
    const enabled = await searchParams(page, () => direct.press('Enter'));
    assert.equal(enabled.get('direct'), '1');
    assert.deepEqual(await visibleIds(page), ['near-weekend', 'long-weekend']);

    const clear = page.locator('#results [data-chip="all"]');
    const cleared = await searchParams(page, () => clear.press('Enter'));
    await page.locator('#results [data-chip="all"]:focus').waitFor();
    assert.equal(cleared.has('direct'), false);
    assert.equal(await direct.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await visibleIds(page), ['near-weekday', 'near-weekend', 'long-weekend']);
  });

  test('Месяц и точные даты сохраняются независимо при переключении и отправке, ' + screen, async t => {
    const page = await setup(t, mobile);
    const when = page.locator('[data-field="when"]');
    const monthMode = page.locator('[data-mode="month"]');
    const done = page.locator('#calApply');
    await when.click();
    await page.locator('[data-day="2030-02-12"]').click();
    await page.locator('[data-day="2030-02-17"]').click();
    await done.click();
    const dates = await submit(page);
    assert.equal(dates.get('dep'), '2030-02-12');
    assert.equal(dates.get('ret'), '2030-02-17');
    assert.equal(dates.has('month'), false);
    await when.click();
    await monthMode.click();
    await page.locator('[data-month="2030-04"]').click();
    await done.click();
    const month = await submit(page);
    assert.equal(month.get('month'), '2030-04');
    assert.equal(month.has('dep') || month.has('ret'), false);
    await when.click();
    await done.click();
    const restored = await submit(page);
    assert.equal(restored.get('dep'), dates.get('dep'));
    assert.equal(restored.get('ret'), dates.get('ret'));
    await when.click();
    await monthMode.click();
    assert.equal(await page.locator('[data-month="2030-04"]').getAttribute('aria-pressed'), 'true');
  });

  test('Бюджет открывается поверх страницы, принимает сумму и поддерживает старые ссылки, ' + screen, async t => {
    const page = await setup(t, mobile);
    const trigger = page.locator('#flightBudget summary');
    const panel = page.locator('#budgetForm');
    const input = panel.getByRole('spinbutton', { name: 'Максимум за билет, ₽' });
    const filter = page.locator('[data-quick="near"]');
    const before = await filter.boundingBox();
    await trigger.click();
    assert.deepEqual(await filter.boundingBox(), before);
    const box = await panel.boundingBox();
    assert.ok(box.width <= 304 && box.x >= 0 && box.x + box.width <= (mobile ? 390 : 1280));
    assert.equal(await input.inputValue(), '');
    const preset = await searchParams(page, () => panel.getByRole('button', { name: '10 000 ₽' }).click());
    assert.equal(preset.get('budget'), '10000');
    assert.equal(await panel.isVisible(), false);
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true);

    await trigger.click();
    await input.fill('18500');
    const custom = await searchParams(page, () => input.press('Enter'));
    assert.equal(custom.get('budget'), '18500');
    assert.deepEqual(await visibleIds(page), ['kzn-16', 'saw-14']);

    const oldLink = '/?from=SVO&fc=MOW&month=2030-02&weekend=0&budget=25000';
    const restored = await searchParams(page, () => page.goto(base + oldLink));
    assert.equal(restored.get('budget'), '25000');
    await trigger.click();
    assert.equal(await input.inputValue(), '25000');
    await input.press('Escape');
    assert.equal(await panel.isVisible(), false);
    await trigger.click();
    const unlimited = await searchParams(page, () => panel.getByRole('button', { name: 'Без лимита' }).click());
    assert.equal(unlimited.has('budget'), false);
  });
}

for (const mobile of [false, true]) {
  test('Календарь сравнивает возвраты для выбранного вылета, mobile=' + mobile, async t => {
    const fare = (back, price, dep = '2030-02-11T23:00:00Z') => ({
      ...offers[0], source: 'LIVE', currency: 'RUB', departure_at: dep,
      return_at: back + 'T10:00:00+03:00', price_minor: price * 100,
    });
    const page = await setup(t, mobile, [
      fare('2030-02-12', 1000), fare('2030-04-14', 2000),
      fare('2030-03-04', 7000, '2030-03-01T10:00:00Z'),
      fare('2030-02-15', 15400), fare('2030-02-15', 16000), fare('2030-02-16', 12800),
      fare('2030-02-16', 8000, '2030-02-13T10:00:00Z'),
    ]);
    await page.locator('[data-field="destination"]').click();
    await page.locator('#pickerInput').fill('Стамбул');
    await page.locator('#picker [data-city="IST"]').click();
    await page.locator('[data-field="when"]').click();
    const day = number => page.locator('[data-day="2030-02-' + number + '"]');
    await day(12).locator('small').waitFor();
    assert.equal(await day(12).locator('small').innerText(), '12,8');
    assert.match(await day(12).getAttribute('aria-label'), /возврат 16 фев/);
    assert.equal(await day(13).locator('small').innerText(), '8');
    if (mobile) await page.locator('[data-shift="1"]').click();
    await page.locator('[data-day="2030-03-01"].lowest small').waitFor();
    if (mobile) await page.locator('[data-shift="-1"]').click();
    await day(12).click();
    assert.match(await page.locator('#calStatus').innerText(), /при возврате 16 фев/);
    const amount = day(15).locator('small');
    await amount.waitFor();
    assert.equal(await amount.innerText(), '15,4');
    assert.equal(await day(14).locator('small').count(), 0);
    const dateBounds = await day(15).locator('span').boundingBox();
    const priceBounds = await amount.boundingBox();
    assert.ok(dateBounds.y + dateBounds.height <= priceBounds.y + 0.1);
    await day(15).click();
    const better = page.locator('#calCheaper');
    assert.match(await better.innerText(), /2\s600\s₽ дешевле/);
    await better.click();
    assert.match(await page.locator('#calStatus').innerText(), /12\s800\s₽/);
    await page.locator('#calApply').click();
    const params = await submit(page);
    assert.deepEqual([params.get('dep'), params.get('ret')], ['2030-02-12', '2030-02-16']);
  });
}

test('Сортировка после клавиатурного выбора сохраняет фокус внутри списка', async t => {
  const page = await setup(t, false);
  await submit(page);
  const sort = page.getByRole('combobox', { name: 'Сортировка' });
  await sort.click();
  await sort.selectOption('departure');
  assert.equal(await sort.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
  await sort.press('ArrowDown');
  await sort.selectOption('price');
  await page.locator('#sort:focus-visible').waitFor();
  const outline = await sort.evaluate(el => {
    const style = getComputedStyle(el);
    return [style.outlineStyle, style.outlineColor, style.outlineOffset];
  });
  assert.deepEqual(outline, ['solid', 'rgb(48, 52, 59)', '-3px']);
  await sort.press('Tab');
  await page.locator('#length:focus-visible').waitFor();
});

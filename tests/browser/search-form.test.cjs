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

async function openFields(page) {
  if (await page.locator('#budget').isVisible()) return;
  if (await page.locator('#searchSummary').isVisible()) await page.locator('#searchSummary').click();
  else await page.locator('[data-field="when"]').click();
}

async function searchParams(page, action) {
  const [response] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/search/web'),
    action(),
  ]);
  await page.locator('#results .chips').waitFor();
  const params = new URL(response.url()).searchParams;
  const address = new URL(page.url()).searchParams;
  for (const localFilter of ['filter', 'group', 'length']) {
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

  test('Поиск везде, в городе и в аэропорту показывает нужные даты, ' + screen, async t => {
    const page = await setup(t, mobile);
    await openFields(page);
    await submit(page);
    assert.deepEqual(await visibleIds(page), ['kzn-16', 'saw-14']);
    assert.equal(await page.locator('[data-chip="unique"]').getAttribute('aria-pressed'), 'true');

    await openFields(page);
    await page.locator('#destinationPick').click();
    await page.locator('#pickerInput').fill('Стамбул');
    await page.locator('#picker [data-city="IST"]').click();
    const city = await submit(page);
    assert.equal(city.get('tc'), 'IST');
    assert.deepEqual(await visibleIds(page), ['saw-14', 'ist-12', 'saw-17', 'saw-19-nights']);
    assert.equal(await page.locator('[data-chip="unique"]').count(), 0);

    await openFields(page);
    await page.locator('#destinationPick').click();
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
    const chip = name => page.locator('#results [data-chip="' + name + '"]');
    const filters = () => new URL(page.url()).searchParams.getAll('filter').sort();
    const calls = [];
    page.on('request', req => {
      if (new URL(req.url()).pathname === '/api/v1/search/web') calls.push(req.url());
    });
    const quick = page.getByRole('group', { name: 'Быстрый поиск по условию' });
    await searchParams(page, () => quick.getByRole('button', { name: 'В пути до 3 ч' }).press('Enter'));
    await page.locator('#results [data-chip="near"]:focus').waitFor();
    assert.equal(await chip('near').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(filters(), ['near']);
    assert.deepEqual(await visibleIds(page), ['near-weekday', 'near-weekend']);

    await chip('noLeave').press('Enter');
    assert.equal(await chip('noLeave').evaluate(el => el === document.activeElement), true);
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
    await page.locator('#results [data-chip="direct"]:focus').waitFor();
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
    await openFields(page);
    const month = page.locator('#month');
    const exact = page.getByRole('radio', { name: 'Точные даты' });
    const monthly = page.getByRole('radio', { name: 'Месяц', exact: true });
    const departure = page.locator('#departureDate'), returning = page.locator('#returnDate');
    await month.selectOption('2030-04');
    await exact.check();
    assert.match(await departure.inputValue(), /^2030-04-/);
    await departure.fill('2030-05-12');
    await returning.fill('2030-05-17');
    await monthly.check();
    assert.equal(await month.inputValue(), '2030-04');
    await month.selectOption('2030-03');
    const monthText = await month.locator('option:checked').innerText();
    const selectedMonth = await submit(page);
    assert.equal(selectedMonth.get('month'), '2030-03');
    assert.equal(selectedMonth.has('dep') || selectedMonth.has('ret'), false);
    const summary = page.locator(mobile ? '#summaryDetails' : '#lineWhen');
    assert.equal(await summary.innerText(), monthText);

    await openFields(page);
    await exact.check();
    assert.equal(await departure.inputValue(), '2030-05-12');
    assert.equal(await returning.inputValue(), '2030-05-17');
    const dates = await submit(page);
    assert.equal(dates.get('dep'), '2030-05-12');
    assert.equal(dates.get('ret'), '2030-05-17');
    assert.equal(dates.has('month'), false);
    await openFields(page);
    await monthly.check();
    assert.equal(await month.inputValue(), '2030-03');
  });

  test('Бюджет без лимита, первый шаг, возврат клавишей Home и старая ссылка, ' + screen, async t => {
    const page = await setup(t, mobile);
    await openFields(page);
    const slider = page.getByRole('slider', { name: 'Бюджет на билеты' });
    const amount = page.locator('#budgetValue');
    assert.equal(await slider.inputValue(), await slider.getAttribute('min'));
    assert.equal(await slider.getAttribute('aria-valuetext'), 'Без лимита');
    assert.equal(await amount.innerText(), 'Без лимита');
    assert.equal((await submit(page)).has('budget'), false);

    await openFields(page);
    await slider.press('ArrowRight');
    assert.equal(await slider.inputValue(), '5000');
    assert.match(await amount.innerText(), /5\s000\s₽/);
    assert.equal((await submit(page)).get('budget'), '5000');

    const oldLink = '/?from=SVO&fc=MOW&month=2030-02&weekend=0&budget=25000';
    const restored = await searchParams(page, () => page.goto(base + oldLink));
    assert.equal(restored.get('budget'), '25000');
    await openFields(page);
    assert.equal(await slider.inputValue(), '25000');
    assert.match(await amount.innerText(), /25\s000\s₽/);
    await slider.press('Home');
    assert.equal(await amount.innerText(), 'Без лимита');
    assert.equal((await submit(page)).has('budget'), false);
  });
}

for (const mobile of [false, true]) {
  test('Ближайший билет сверх бюджета сохраняет все условия и ID, ' + (mobile ? 'телефон' : 'компьютер'), async t => {
    const page = await setup(t, mobile);
    const budget = 10000;
    const first = { ...offer('a-fare', 'Казань', 'KZN', 12, 10018), price_minor: 1000050 };
    const tied = { ...first, id: 'z-fare' };
    const cheaperButExpired = { ...first, id: 'expired', price_minor: 1000001, expires_at: today };
    const unavailable = { ...first, id: 'unavailable', price_minor: 1000002, availability: 'unavailable' };
    const more = { ...first, id: 'more', price_minor: 1001100 };
    let requests;
    await page.route('**/api/v1/search/web?*', route => {
      const params = new URL(route.request().url()).searchParams;
      requests.push(params);
      const over = [tied, unavailable, more, cheaperButExpired, first];
      if (params.has('direct')) over.reverse();
      const outsideLocalFilters = { ...first, id: 'other', duration_to: 300, price_minor: 1000010 };
      if (params.get('region') === 'russia') over.push(outsideLocalFilters);
      return route.fulfill({ json: { offers: params.has('budget') ? [] : over,
        received_at: today, incomplete: true, warnings: ['Часть предложений недоступна.'] } });
    });
    for (const selection of [
      'month=2030-02', 'month=2030-02&fc=MOW', 'month=2030-02&to=KZN',
      'month=2030-02&to=KZN&tc=KZN', 'month=2030-02&direct=1', 'month=2030-02&filter=cheap',
      'month=2030-02&filter=comfy', 'month=2030-02&region=russia&filter=near',
      'dep=2030-02-12&ret=2030-02-14', 'dep=2030-02-12&ret=2030-02-14&direct=1&length=short',
    ]) {
      requests = [];
      await page.goto(base + '/?from=SVO&budget=' + budget + '&weekend=0&' + selection);
      const button = page.getByRole('button', { name: 'Открыть билет', exact: true });
      await button.waitFor();
      assert.equal(await button.getAttribute('data-ticket'), 'a-fare', selection);
      assert.match((await page.locator('#budgetHint').innerText()).replace(/\s/g, ''), /10000,50₽тудаиобратноНа0,50₽вышебюджета/);
      assert.equal(requests.length, 2);
      const [original, broad] = requests.map(p => new URLSearchParams(p));
      assert.equal(original.get('budget'), String(budget));
      original.delete('budget');
      assert.deepEqual([...broad], [...original], selection);
      const address = page.url();
      await button.click();
      await page.locator('#detail[open]').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('trip'), 'a-fare');
      assert.equal(new URL(page.url()).searchParams.has('budget'), false);
      await page.goBack();
      await button.waitFor();
      assert.equal(page.url(), address);
      assert.equal(requests.length, 2, 'открытие и возврат используют один снимок');
    }
  });
}

test('Подсказка о доплате появляется только при подтверждённом пустом поиске', async t => {
  const page = await setup(t, false);
  let mode, broadCount = 0;
  await page.route('**/api/v1/search/web?*', route => {
    const p = new URL(route.request().url()).searchParams;
    if (!p.has('budget')) {
      broadCount++;
      if (mode === 'error') return route.fulfill({ status: 503, json: {} });
    }
    const sample = mode === 'equal' || mode === 'nonempty' ? [offer('limit', 'Казань', 'KZN', 12, 20000)] : [];
    return route.fulfill({ json: { offers: p.has('budget') && mode !== 'nonempty' ? [] : sample, received_at: today } });
  });
  for (const current of ['error', 'equal', 'none', 'nonempty', 'hardcap', 'unlimited']) {
    mode = current;
    broadCount = 0;
    await page.goto(base + '/?from=SVO&month=2030-02&weekend=0' + (mode === 'unlimited' ? '' : '&budget=20000') + (mode === 'hardcap' ? '&filter=cheap' : ''));
    await page.locator('#results .chips').waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('[data-action="budgetTicket"]').count(), 0, mode);
    assert.equal(broadCount, ['nonempty', 'hardcap'].includes(mode) ? 0 : 1, mode);
  }
});

test('Смена фильтра во время проверки доплаты и после неё сохраняет один запрос', async t => {
  const page = await setup(t, false);
  let release, requested;
  const pending = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { requested = resolve; });
  let broadCount = 0;
  await page.route('**/api/v1/search/web?*', async route => {
    const p = new URL(route.request().url()).searchParams;
    if (p.has('budget')) return route.fulfill({ json: { offers: [], received_at: today } });
    broadCount++;
    requested();
    await pending;
    return route.fulfill({ json: { offers: [
      { ...offer('slow', 'Казань', 'KZN', 12, 12000), duration_back: 181 },
      offer('fast', 'Казань', 'KZN', 12, 13000),
    ], received_at: today } });
  });
  await page.goto(base + '/?from=SVO&month=2030-02&weekend=0&budget=10000');
  await started;
  const quick = page.locator('#results [data-chip="near"]');
  try { await quick.click(); } finally { release(); }
  await page.locator('#budgetHint [data-ticket="fast"]').waitFor();
  await quick.click();
  await page.locator('#budgetHint [data-ticket="slow"]').waitFor();
  assert.equal(broadCount, 1);
});

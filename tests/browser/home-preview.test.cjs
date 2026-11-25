const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');

const base = process.env.AVIATOR_TEST_URL ?? 'http://127.0.0.1:8000';
const moscow = { code: 'MOW', iata: 'SVO', all: true, name: 'Москва', from: 'Москвы' };
const kazan = { code: 'KZN', iata: 'KZN', all: false, name: 'Казань', from: 'Казани' };
const month = new Date().getFullYear() + 1 + '-03';
const destinations = 'UFA AER KUF PEE OVB IKT OMS LED VOG GOJ SVX ROV KGD ASF KRR KEJ'.split(' ');

function home(origin) {
  const trips = destinations.map((code, i) => ({
    id: code, city: 'Город ' + (i + 1), city_code: code, destination_airport: code,
    origin_city: origin.name, origin_city_code: origin.code, origin_airport: origin.iata,
    origin_timezone: 'Europe/Moscow', destination_timezone: 'Europe/Moscow',
    departure_at: month + '-10T09:00:00+03:00', return_at: month + '-12T18:00:00+03:00',
    price_minor: (i + 1) * 100000, transfers: 0, return_transfers: 0, duration_to: 90, duration_back: 90,
    country: 'Россия', country_code: 'RU', airline: 'SU', flight_number: '100', received_at: new Date().toISOString(),
  }));
  const items = destinations.slice(0, 5);
  return {
    origin, received_at: trips[0].received_at, offers: Object.fromEntries(trips.map(trip => [trip.id, trip])),
    usual: { ['UFA|' + month + '|0']: [200000, 10] },
    notes: { UFA: { leave: null }, AER: { leave: 1 }, KUF: { leave: 0 }, PEE: { leave: 1 } },
    rows: [
      { key: 'hot', title: 'Ближайшие вылеты', kind: 'pass', items },
      { key: 'holidays', title: 'Каникулы', hint: 'Праздничные дни', items },
    ],
  };
}

async function openPage(t, engine, width) {
  const browser = await engine.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width, height: 580 } });
  await page.route('**/api/v1/origin', route => route.fulfill({ json: moscow }));
  await page.route('**/api/v1/home?*', route => {
    const origin = new URL(route.request().url()).searchParams.get('from') === 'KZN' ? kazan : moscow;
    return route.fulfill({ json: home(origin) });
  });
  await page.route('**/api/v1/search/web?*', route => route.fulfill({ json: { offers: [] } }));
  await page.goto(base);
  return page;
}

for (const [engine, width] of [[chromium, 1280], [webkit, 320]]) {
  test('Каталог возвращает позицию и фокус после перехода — ' + engine.name(), async t => {
    const page = await openPage(t, engine, width);
    const trigger = page.locator('.directions-toggle');
    const dialog = page.locator('#directionCatalog');
    const link = dialog.locator('[data-city="KRR"]');
    await trigger.click();
    await dialog.getByRole('searchbox').fill('Город ');
    await link.focus();
    await link.scrollIntoViewIfNeeded();
    const position = () => dialog.locator('.sheet-body').evaluate(el => [scrollY, el.scrollTop]);
    const [top, list] = await position();
    assert.ok(top > 0 && list > 0);
    await link.press('Enter');
    await page.waitForURL(url => url.searchParams.get('to') === 'KRR');
    const homeAgain = async () => {
      await page.goBack();
      await dialog.waitFor();
      assert.equal(await dialog.getByRole('searchbox').inputValue(), 'Город ');
      assert.ok(await link.evaluate(el => document.activeElement === el));
      const [actualTop, actualList] = await position();
      assert.ok(Math.abs(top - actualTop) <= 2, JSON.stringify([top, actualTop]));
      assert.ok(Math.abs(list - actualList) <= 2, JSON.stringify([list, actualList]));
    };
    await homeAgain();
    await page.goForward();
    await page.waitForURL(url => url.searchParams.get('to') === 'KRR');
    await homeAgain();
    await page.reload(); // восстановление в новом документе, без кеша страниц
    await dialog.waitFor();
    assert.ok(await link.evaluate(el => document.activeElement === el));
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.ok(await trigger.evaluate(el => el === document.activeElement));
    await trigger.click();
    assert.equal(await dialog.getByRole('searchbox').inputValue(), '');
    await link.click();
    await page.waitForURL(url => url.searchParams.get('to') === 'KRR');
    await page.evaluate(origin => localStorage.setItem('aviator.origin', JSON.stringify({ ...origin, manual: true })), kazan);
    await page.goBack();
    await page.getByRole('heading', { name: 'Направления из Казани' }).waitFor();
    assert.equal(await dialog.isVisible(), false);
  });
}

test('Каникулы учитывают отпуск до цены только в своей подборке', async t => {
  const page = await openPage(t, chromium, 1280);
  const row = page.locator('[data-feed=holidays]');
  await row.waitFor();
  const order = ['KUF', 'AER', 'PEE', 'UFA', 'OVB'];
  assert.deepEqual(await row.locator('[data-open]').evaluateAll(nodes => nodes.map(el => el.dataset.open)), order);
  assert.deepEqual(await row.locator('.tile-note').allTextContents(),
    ['Без отпуска', '1 день отпуска', '1 день отпуска', 'Дни отпуска неизвестны', 'Дни отпуска неизвестны']);
  await row.locator('.row-all').click();
  const results = page.locator('#results');
  const ids = () => results.locator('[data-offer]').evaluateAll(nodes => nodes.map(el => el.dataset.offer));
  assert.deepEqual(await ids(), order);
  assert.equal(await results.getByText('Дни отпуска неизвестны', { exact: true }).count(), 2);
  await results.locator('#sort').selectOption('price');
  assert.deepEqual(await ids(), destinations.slice(0, 5));
  await page.goBack();
  const hot = page.locator('[data-feed=hot]');
  await hot.locator('.row-all').click();
  assert.equal(await results.locator('#sort').inputValue(), 'price');
  assert.equal(await results.locator('option[value=leave]').count(), 0);
  assert.equal(await results.getByText('Дни отпуска неизвестны').count(), 0);
});

test('Талон на ПК показывает маршрут, даты и цену с одним сравнением', async t => {
  const page = await openPage(t, chromium, 1280);
  const tile = page.locator('[data-feed=hot] .tile').first();
  await tile.waitFor();
  const size = selector => tile.locator(selector).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(await size('.cities') > await size('.codes'));
  assert.match(await tile.locator('.legs').innerText(), /10.*мар/us);
  assert.match(await tile.locator('.legs').innerText(), /12.*мар/us);
  assert.match(await tile.innerText(), /туда и обратно за одного взрослого/i);
  assert.equal((await tile.innerText()).match(/50%/g)?.length, 1);
  await tile.locator('[data-fav]').click();
  assert.equal(await tile.locator('[data-fav]').getAttribute('aria-pressed'), 'true');
  await tile.locator('.city-rating').focus();
  assert.ok(await tile.locator('.city-rating').evaluate(el => el === document.activeElement));
  await tile.locator('[data-open]').press('Enter');
  await page.locator('#detail[open]').waitFor();
});

test('Туры показывают статус и рабочий переход к авиабилетам на 320 пикселях', async t => {
  const page = await openPage(t, webkit, 320);
  const tab = page.getByRole('tab', { name: /Туры.*В разработке/ });
  await tab.click();
  const panel = page.locator('#panel-tours');
  assert.equal(await panel.locator('input, select').count(), 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await panel.getByRole('button', { name: 'Найти авиабилеты' }).click();
  assert.equal(await page.locator('#tab-flights').getAttribute('aria-selected'), 'true');
  assert.ok(await page.locator('#flight-service').isVisible());
});

test('Поиск работает с сохранённой версией страницы без каталога и кнопки туров', async t => {
  const page = await openPage(t, chromium, 1280);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = base + '/?from=SVO&fc=MOW&to=KZN&tc=KZN&weekend=0';
  await page.route(url, async route => {
    const response = await route.fetch();
    const html = (await response.text())
      .replace(/<dialog[^>]+id="directionCatalog"[\s\S]*?<\/dialog>/, '')
      .replace(/<button[^>]+id="toursToFlights"[^>]*>[\s\S]*?<\/button>/, '');
    await route.fulfill({ response, body: html });
  });
  await page.goto(url);
  await page.locator('#results').getByRole('heading', { name: 'Пока без вариантов' }).waitFor();
  assert.deepEqual(errors, []);
});

test('Размороженная главная сверяет город до повторного открытия каталога', async t => {
  const page = await openPage(t, chromium, 1280);
  await page.locator('.directions-toggle').click();
  await page.locator('#catalogLinks [data-city="KRR"]').click();
  await page.waitForURL(url => url.searchParams.get('to') === 'KRR');
  await page.goBack();
  await page.locator('#directionCatalog[open]').waitFor();
  // Автоматизация Chromium обычно отключает BFCache. Имитируем его событие на сохранившемся документе.
  await page.evaluate(origin => {
    localStorage.setItem('aviator.origin', JSON.stringify({ ...origin, manual: true }));
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  }, kazan);
  await page.getByRole('heading', { name: 'Направления из Казани' }).waitFor();
  assert.equal(await page.locator('#directionCatalog').isVisible(), false);
  assert.equal(await page.evaluate(() => history.state?.catalog), undefined);
});

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
  Object.assign(trips[0], { airline: 'Y7', airline_name: 'NordStar' });
  Object.assign(trips[1], { airline: '5N', airline_name: 'Smartavia' });
  Object.assign(trips[2], { airline: 'XX', airline_name: 'Тестовая авиакомпания' });
  const items = destinations.slice(0, 5);
  return {
    origin, received_at: trips[0].received_at, offers: Object.fromEntries(trips.map(trip => [trip.id, trip])),
    usual: { ['UFA|' + month + '|0']: [200000, 10] },
    notes: { UFA: { leave: null }, AER: { leave: 1 }, KUF: { leave: 0 }, PEE: { leave: 1 } },
    rows: [
      { key: 'hot', title: 'Ближайшие вылеты', kind: 'pass', items },
      { key: 'weekend-1', title: 'Первые выходные', hint: '10–12 марта', items },
      { key: 'weekend-2', title: 'Вторые выходные', hint: '17–19 марта, без отпуска', items },
      { key: 'budget10000', title: 'До 10 000 ₽', hint: 'От 5 000 до 10 000 ₽ туда и обратно', items },
      { key: 'holidays', title: 'Каникулы', hint: 'Праздничные дни', items },
    ],
  };
}

async function openPage(t, engine, width, initialOrigin = moscow, homeResponse = home) {
  const browser = await engine.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width, height: 580 } });
  await page.route('**/api/v1/origin', route => route.fulfill({ json: initialOrigin }));
  await page.route('**/api/v1/home?*', route => {
    const origin = new URL(route.request().url()).searchParams.get('from') === 'KZN' ? kazan : moscow;
    return route.fulfill({ json: homeResponse(origin) });
  });
  await page.route('**/api/v1/search/web?*', route => route.fulfill({ json: { offers: [] } }));
  await page.goto(base);
  return page;
}

for (const [engine, width] of [[chromium, 1280], [webkit, 320]]) {
  test('Рядом с авиакомпанией помещается подпись прямого рейса — ' + engine.name(), async t => {
    const page = await openPage(t, engine, width, moscow, origin => {
      const response = home(origin);
      const year = month.slice(0, 4);
      Object.assign(response.offers.UFA, { airline: 'DP', airline_name: 'Pobeda' });
      Object.assign(response.offers.AER, {
        airline: 'FV', airline_name: 'Rossiya Airlines',
        departure_at: year + '-09-29T09:00:00+03:00', return_at: year + '-10-06T18:00:00+03:00',
      });
      Object.assign(response.offers.PEE, { transfers: 1, return_transfers: 2 });
      return response;
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const budget = page.locator('[data-feed=budget10000]');
    await budget.getByRole('heading', { name: 'До 10 000 ₽' }).waitFor();
    await page.evaluate(async () => { await document.fonts.ready; });

    async function checkDirectFlights(section) {
      for (const name of ['Победа', 'Rossiya Airlines', 'Тестовая авиакомпания']) {
        const row = section.locator('.flight-meta').filter({ hasText: name });
        assert.equal(await row.locator('.flight-transfers').textContent(), 'Без пересадок');
        assert.ok(await row.evaluate(el => {
          const carrier = el.querySelector('.carrier').getBoundingClientRect();
          const label = el.querySelector('.flight-transfers');
          const text = document.createRange();
          text.selectNodeContents(label);
          const transfer = label.getBoundingClientRect();
          return Math.abs(carrier.top + carrier.height / 2 - transfer.top - transfer.height / 2) < 1
            && carrier.right <= transfer.left
            && text.getClientRects().length === 1
            && text.getBoundingClientRect().right <= el.closest('article').getBoundingClientRect().right + 1;
        }), name);
      }
    }

    async function checkAlignedRows(cards, dates) {
      const [short, long] = await Promise.all(['Победа', 'Rossiya Airlines'].map(name =>
        cards.filter({ hasText: name }).evaluate((card, selector) => {
          const dateText = document.createRange();
          dateText.selectNodeContents(card.querySelector(selector));
          return {
            dateHeight: dateText.getBoundingClientRect().height,
            rowTop: card.querySelector('.flight-meta').getBoundingClientRect().top,
          };
        }, dates),
      ));
      assert.ok(long.dateHeight > short.dateHeight, JSON.stringify({ short, long }));
      assert.ok(Math.abs(long.rowTop - short.rowTop) < 1, JSON.stringify({ short, long }));
    }

    await checkDirectFlights(page.locator('[data-feed=hot]'));
    await checkDirectFlights(budget);
    await checkAlignedRows(budget.locator('.tile'), '.tile-dates');
    await budget.locator('.row-all').click();
    const results = page.locator('#results');
    await checkDirectFlights(results);
    assert.equal(await results.getByText('Туда — 1 пересадка, обратно — 2 пересадки', { exact: true }).count(), 1);
    if (width > 600) await checkAlignedRows(results.locator('.offer'), '.offer-dates');
    await results.locator('.offer').filter({ hasText: 'Rossiya Airlines' }).locator('.offer-open').click();
    await page.locator('#detail .route-note').getByText('Rossiya Airlines', { exact: true }).waitFor();
    assert.equal(await page.locator('#detail .pass-stub > .caption').innerText(), 'Билеты туда и обратно за одного взрослого.');
  });
}

for (const [engine, width] of [[chromium, 1280], [webkit, 320]]) {
  test('Каталог возвращает позицию и фокус после перехода — ' + engine.name(), async t => {
    const page = await openPage(t, engine, width);
    const trigger = page.locator('.directions-toggle');
    const dialog = page.locator('#directionCatalog');
    const link = dialog.locator('[data-city="KRR"]');
    await trigger.click();
    const insets = await dialog.evaluate(el => {
      const body = el.querySelector('.sheet-body');
      const { left, right } = body.getBoundingClientRect();
      const input = el.querySelector('#catalogSearch').getBoundingClientRect();
      const photo = el.querySelector('.direction-link .portrait').getBoundingClientRect();
      const title = el.querySelector('h2').getBoundingClientRect();
      return {
        inputStart: input.left - left,
        inputEnd: right - input.right,
        photoStart: photo.left - left,
        titleStart: title.left - left,
      };
    });
    assert.ok(insets.inputStart >= 16 && insets.inputEnd >= 16, JSON.stringify(insets));
    assert.equal(insets.photoStart, insets.titleStart);
    assert.equal(insets.inputStart, insets.titleStart);
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

test('Карточки показывают логотипы, а подборка на выходные сохраняет выбор дат', async t => {
  const page = await openPage(t, chromium, 1280);
  const hot = page.locator('[data-feed=hot]');
  for (const [name, code] of [['NordStar', 'Y7'], ['Smartavia', '5N']]) {
    const meta = hot.locator('.flight-meta').filter({ hasText: name });
    const logo = meta.locator('.carrier img');
    await logo.scrollIntoViewIfNeeded();
    assert.equal(await logo.getAttribute('src'), '/airlines/' + code + '.png');
    await page.waitForFunction(img => img.complete && img.naturalWidth > 0, await logo.elementHandle());
    assert.match(await meta.innerText(), /Без пересадок/);
  }
  const fallback = hot.locator('.flight-meta').filter({ hasText: 'Тестовая авиакомпания' });
  assert.equal(await fallback.locator('.carrier img').count(), 0);

  const weekends = page.getByRole('region', { name: 'На выходные' });
  await weekends.waitFor();
  assert.equal(await weekends.getByText('Без отпуска', { exact: true }).count(), 0);
  const second = weekends.getByRole('button', { name: '17–19 марта' });
  await second.click();
  assert.equal(await second.getAttribute('aria-pressed'), 'true');
  assert.equal(await weekends.getByText('Без отпуска', { exact: true }).count(), 0);
  assert.equal(await page.locator('[data-quick="noLeave"]').innerText(), 'На выходные');
  await weekends.locator('.row-all').click();
  assert.equal(await page.locator('#results').getByText('Без отпуска', { exact: true }).count(), 0);
});

for (const [engine, width] of [[chromium, 960], [webkit, 320]]) {
  test('Прокрутка над подборкой следует направлению жеста — ' + engine.name(), async t => {
    const page = await openPage(t, engine, width);
    for (const feed of ['weekend-1', 'budget10000']) {
      const strip = page.locator(`[data-feed=${feed}] .strip`);
      const card = strip.locator('.tile').first();
      await card.scrollIntoViewIfNeeded();
      const stripElement = await strip.elementHandle();
      const position = () => strip.evaluate(el => ({
        pageTop: window.scrollY, stripLeft: el.scrollLeft, stripTop: el.scrollTop,
      }));

      for (const horizontalDrift of [0, 12]) {
        await card.hover();
        const beforeVertical = await position();
        await page.mouse.wheel(horizontalDrift, 140);
        await page.waitForFunction(top => window.scrollY > top, beforeVertical.pageTop);
        const afterVertical = await position();
        assert.equal(afterVertical.stripLeft, beforeVertical.stripLeft);
        assert.equal(afterVertical.stripTop, 0);
      }

      await card.hover();
      const beforeHorizontal = await position();
      await page.mouse.wheel(260, 0);
      await page.waitForFunction(el => el.scrollLeft > 0, stripElement);
      assert.equal((await position()).pageTop, beforeHorizontal.pageTop);
      assert.equal(await strip.evaluate(el => getComputedStyle(el).overflowY), 'hidden');
    }
  });
}

test('Бюджетная подборка без подписи с диапазоном и с ценой под городом', async t => {
  const page = await openPage(t, chromium, 1280);
  const row = page.locator('[data-feed=budget10000]');
  await row.getByRole('heading', { name: 'До 10 000 ₽' }).waitFor();
  assert.equal(await row.locator('.row-hint').count(), 0);
  assert.match(await row.locator('.tile-price').first().innerText(), /^от /);
  assert.equal(await page.locator('#showcase').getByText('Цены ориентировочные', { exact: false }).count(), 0);
  const direction = page.locator('.direction-info').first();
  assert.ok(await direction.evaluate(el =>
    el.querySelector('span').getBoundingClientRect().top >= el.querySelector('b').getBoundingClientRect().bottom));

  await row.locator('.row-all').click();
  const results = page.locator('#results');
  assert.equal(await results.getByText('Цены ориентировочные', { exact: false }).count(), 0);
  const card = results.locator('.offer').first();
  assert.match(await card.locator('.offer-price').innerText(), /^от /);
  assert.ok(await card.evaluate(el =>
    el.querySelector('.offer-price').getBoundingClientRect().top >= el.querySelector('.offer-city').getBoundingClientRect().bottom));
});

test('Пункты подвала раскрываются на месте без перехода', async t => {
  const page = await openPage(t, webkit, 320);
  const footer = page.locator('footer.footer--accordion');
  const summaries = footer.locator('summary:visible');
  const url = page.url();
  assert.ok(await summaries.count() >= 9);
  for (const summary of await summaries.all()) {
    const item = summary.locator('..');
    await summary.click();
    assert.equal(page.url(), url);
    assert.ok(await item.locator('.footer-answer').isVisible());
    const expectedLinks = (await summary.innerText()) === 'Как мы считаем' ? ['/how-we-count.html'] : [];
    assert.deepEqual(await item.locator('a').evaluateAll(links => links.map(a => a.getAttribute('href'))), expectedLinks);
    await summary.press('Enter');
    assert.equal(await item.locator('.footer-answer').isVisible(), false);
  }
});

test('Каникулы учитывают отпуск до цены только в своей подборке', async t => {
  const page = await openPage(t, chromium, 1280);
  const row = page.locator('[data-feed=holidays]');
  await row.waitFor();
  const order = ['KUF', 'AER', 'PEE', 'UFA', 'OVB'];
  assert.deepEqual(await row.locator('[data-open]').evaluateAll(nodes => nodes.map(el => el.dataset.open)), order);
  assert.deepEqual(await row.locator('.tile-note').allTextContents(),
    ['1 день отпуска', '1 день отпуска', 'Дни отпуска неизвестны', 'Дни отпуска неизвестны']);
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

test('Талон на ПК показывает маршрут, даты и цену без сравнения с обычной', async t => {
  const page = await openPage(t, chromium, 1280);
  const tile = page.locator('[data-feed=hot] .tile').first();
  await tile.waitFor();
  const size = selector => tile.locator(selector).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(await size('.cities') > await size('.codes'));
  assert.match(await tile.locator('.legs').innerText(), /10.*мар/us);
  assert.match(await tile.locator('.legs').innerText(), /12.*мар/us);
  assert.match(await tile.innerText(), /2 ночи/u);
  assert.match(await tile.locator('.pass-price').innerText(), /^от /);
  assert.doesNotMatch(await tile.innerText(), /дешевле обычного/u);
  assert.equal(await tile.locator('[data-fav]').count(), 0);
  assert.equal(await tile.locator('.city-rating:visible').count(), 0);
  await tile.locator('[data-open]').press('Enter');
  const detail = page.locator('#detail[open]');
  await detail.waitFor();
  assert.equal(await detail.locator('nav').count(), 0);
  const url = page.url();
  await detail.getByText('О цене и времени', { exact: true }).press('Enter');
  assert.equal(await detail.locator('.fare-explanation').getAttribute('open'), '');
  assert.equal(page.url(), url);
  await detail.locator('[data-fav]').click();
  assert.equal(await detail.locator('[data-fav]').getAttribute('aria-pressed'), 'true');
});

test('Туры открывают Travelata по выбранным городу и стране на 320 пикселях', async t => {
  const page = await openPage(t, webkit, 320, { ...moscow, iata: 'DME', all: false });
  await page.getByRole('tab', { name: 'Туры', exact: true }).click();
  const panel = page.locator('#panel-tours');
  const origin = panel.getByRole('combobox', { name: 'Город вылета' });
  const links = panel.getByRole('link');
  const addresses = () => links.evaluateAll(items => items.map(item => item.href));
  await links.first().waitFor();
  assert.equal(await origin.inputValue(), 'MOW');
  assert.deepEqual(await addresses(), ['turkey', 'egypt', 'uae'].map(path => 'https://travelata.ru/' + path));
  await origin.selectOption('LED');
  assert.deepEqual(await addresses(), ['turkey', 'egypt', 'uae'].map(path => 'https://spb.travelata.ru/' + path));
  assert.equal(await panel.locator('input').count(), 0);
  assert.ok((await origin.boundingBox()).height >= 44);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const egypt = 'https://spb.travelata.ru/egypt';
  await page.route(egypt, route => route.fulfill({ body: 'OK' }));
  await panel.getByRole('link', { name: 'Египет На Travelata' }).press('Enter');
  await page.waitForURL(egypt);
});

test('Туры предлагают выбрать поддерживаемый вылет без подстановки Москвы', async t => {
  const page = await openPage(t, chromium, 1280);
  await page.goto(base + '/?from=KZN&fc=KZN&service=tours');
  const panel = page.locator('#panel-tours');
  const origin = panel.getByRole('combobox', { name: 'Город вылета' });
  await page.waitForFunction(() => document.querySelector('#originLabel').dataset.city === 'KZN');
  assert.equal(await origin.inputValue(), '');
  assert.equal(await panel.getByRole('link').count(), 0);
  assert.match(await panel.getByRole('status').innerText(), /выберите Москву или Санкт-Петербург/);
  await origin.selectOption('MOW');
  assert.equal(await panel.getByRole('link', { name: 'ОАЭ На Travelata' }).getAttribute('href'), 'https://travelata.ru/uae');
});

test('Поиск работает с сохранённой версией страницы без каталога и формы туров', async t => {
  const page = await openPage(t, chromium, 1280);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = base + '/?from=SVO&fc=MOW&to=KZN&tc=KZN&weekend=0';
  await page.route(url, async route => {
    const response = await route.fetch();
    const html = (await response.text())
      .replace(/<details class="flight-budget"[\s\S]*?<\/details>/, `<details class="flight-budget">
        <summary id="lineBudget">Бюджет</summary><output id="budgetValue"></output>
        <input type="range" id="budget" min="4000" max="500000" step="1000">
        <p id="budgetUnit" hidden></p><input type="checkbox" id="directOnly"></details>`)
      .replace(/<dialog[^>]+id="directionCatalog"[\s\S]*?<\/dialog>/, '')
      .replace(/(<section[^>]+id="panel-tours"[^>]*>)[\s\S]*?(<\/section>)/, '$1$2');
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

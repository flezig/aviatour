// Запуск с локальным сайтом: node --test tests/browser/airport-picker.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');

const base = process.env.AVIATOR_TEST_URL ?? 'http://127.0.0.1:8000';
const origin = '[data-field="origin"]';
const destination = '[data-field="destination"]';

async function setup(t, engine, mobile = false) {
  const browser = await engine.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 850 },
    isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce',
  });
  await page.route('**/api/v1/search/web?*', route => route.fulfill({ json: {
    offers: [], incomplete: false, warnings: [], received_at: new Date().toISOString(),
  } }));
  const request = () => page.waitForRequest(r => new URL(r.url()).pathname === '/api/v1/search/web');
  await Promise.all([request(), page.goto(base + '/?from=SVO&fc=MOW')]);
  return { page, request };
}

async function checkAnchor(page, selector) {
  await page.waitForFunction(selector => {
    const button = document.querySelector(selector).getBoundingClientRect();
    const panel = document.getElementById('picker').getBoundingClientRect();
    const expectedLeft = Math.max(8, Math.min(button.left, document.documentElement.clientWidth - panel.width - 8));
    return Math.abs(expectedLeft - panel.left) < 2 && (Math.abs(panel.top - button.bottom - 6) < 2 || Math.abs(button.top - panel.bottom - 6) < 2);
  }, selector);
}

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: выбор DME и всех аэропортов Москвы меняет параметры поиска`, async t => {
    const { page, request } = await setup(t, engine);
    const picker = page.locator('#picker'), input = page.locator('#pickerInput');
    async function submit() {
      const [sent] = await Promise.all([request(), page.locator('#searchButton').click()]);
      const params = new URL(sent.url()).searchParams;
      return [params.get('from'), params.get('fc')];
    }
    await page.locator(origin).click();
    await checkAnchor(page, origin);
    await picker.locator('[data-city="MOW"][aria-current]').waitFor();
    const groupToggle = picker.locator('.airport-group[open] summary').first();
    await groupToggle.press('Enter');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator(':focus').getAttribute('data-iata'), 'LED');
    await picker.locator('.airport-group summary').first().click();
    const dme = picker.locator('.airport-members [data-iata="DME"]');
    await dme.click();
    assert.equal(await page.locator('#lineCode').innerText(), 'DME');
    assert.deepEqual(await submit(), ['DME', null]);
    await page.locator(origin).click();
    assert.equal(await dme.getAttribute('aria-current'), 'true');
    assert.equal(await picker.locator('[data-city="MOW"]').getAttribute('aria-current'), null);
    await input.fill('mow');
    await input.press('ArrowDown');
    assert.equal(await page.locator(':focus').getAttribute('data-city'), 'MOW');
    await page.keyboard.press('Enter');
    assert.deepEqual(await submit(), ['SVO', 'MOW']);
    await page.locator(origin).click();
    await input.fill('dMe');
    await input.press('Enter');
    assert.deepEqual(await submit(), ['DME', null]);
  });

  test(`${name}: заголовок, свёрнутая и раскрытая формы привязывают панель к нажатому полю`, async t => {
    const { page } = await setup(t, engine);
    const picker = page.locator('#picker');
    for (const selector of ['#originTitle', destination, origin]) {
      const trigger = page.locator(selector);
      await trigger.click();
      await checkAnchor(page, selector);
      await page.evaluate(() => window.scrollBy(0, 22));
      await checkAnchor(page, selector);
      await page.setViewportSize({ width: 1050, height: 710 });
      await checkAnchor(page, selector);
      if (selector === destination) await page.mouse.click(6, 100);
      else await page.keyboard.press('Escape');
      await picker.waitFor({ state: 'hidden' });
      await page.waitForFunction(selector => document.activeElement === document.querySelector(selector), selector);
    }

  });
}

test('WebKit на телефоне: лист, раскрытие других городов, выбор по коду и возврат фокуса', async t => {
  const { page } = await setup(t, webkit, true);
  const trigger = page.locator(origin);
  await trigger.click();
  const panel = page.locator('#picker');
  const rect = await panel.boundingBox();
  assert.deepEqual([rect.x, rect.y, rect.width, rect.height], [0, 0, 390, 844]);
  assert.equal(await page.locator('#pickerInput').evaluate(el => el === document.activeElement), false);
  await page.locator('#pickerInput').fill('Стамбул');
  const istanbul = panel.locator('.airport-group').first();
  await istanbul.locator('summary').click();
  assert.equal(await istanbul.getAttribute('open'), null);
  await istanbul.locator('summary').click();
  assert.ok(await istanbul.locator('[data-iata="SAW"]').isVisible());
  await page.locator('#pickerInput').fill('dme');
  assert.equal(await panel.locator('[data-iata="DME"]').count(), 1);
  await panel.locator('[data-iata="DME"]').click();
  assert.match(await trigger.innerText(), /Москва, DME/);
  await page.waitForFunction(() => document.activeElement === document.querySelector('[data-field="origin"]'));
});

test('на двух экранах список целиком остаётся в панели с полем ввода', async t => {
  const { page } = await setup(t, chromium);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1114, height: 720, deviceScaleFactor: 1, mobile: false,
    displayFeature: { orientation: 'vertical', offset: 540, maskLength: 34 },
  });
  const trigger = page.locator(destination);
  await trigger.click();
  const panel = await page.locator('#picker').boundingBox();
  const field = await trigger.boundingBox();
  assert.ok(panel.x >= 0 && panel.x + panel.width <= 540);
  assert.ok(Math.abs(panel.x - field.x) < 2);
});

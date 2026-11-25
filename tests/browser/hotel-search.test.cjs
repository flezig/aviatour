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
    await form.locator('[name=place]').selectOption('DXB');
    await form.locator('[name=adults]').selectOption('3');
    const date = new Date().getFullYear() + 1 + '-05-05';
    await form.locator('[name=start]').fill(date);
    const checkout = date.slice(0, -2) + '06';
    assert.equal(await form.locator('[name=end]').getAttribute('min'), checkout);
    await form.locator('[name=end]').fill(checkout);
    await page.route('**/go?*', route => route.fulfill({ body: 'OK' }));
    await form.getByRole('button').click();
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

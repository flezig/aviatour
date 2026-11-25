const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');

const base = process.env.AVIATOR_TEST_URL ?? 'http://127.0.0.1:8000';
for (const [engine, width] of [[chromium, 1280], [webkit, 320]]) {
  test('Даты проживания — диапазон, клавиатура и отмена, ' + engine.name(), async t => {
    const browser = await engine.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width, height: 650 }, timezoneId: 'Europe/Berlin' });
    await page.clock.setFixedTime(new Date('2028-02-28T12:00:00Z'));
    await page.route('**/stay-calendar-fixture', route => route.fulfill({
      contentType: 'text/html', body: `<!doctype html><html lang="ru"><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/stay-calendar.css">
        <button id="dates">Даты</button>
        <script type="module">
          import { openStayCalendar } from '/js/lib/stay-calendar.js';
          window.selection = { checkin: '', checkout: '' };
          document.getElementById('dates').onclick = event => openStayCalendar(event.currentTarget, window.selection,
            dates => { window.selection = dates; });
        </script></html>`
    }));
    await page.goto(base + '/stay-calendar-fixture');
    const trigger = page.getByRole('button', { name: 'Даты', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Даты проживания' });
    const day = key => dialog.locator('[data-day="' + key + '"]');
    const apply = dialog.getByRole('button', { name: 'Готово' });
    const values = () => page.evaluate(() => window.selection);
    await trigger.click();
    assert.equal(await apply.isDisabled(), true);
    assert.equal(await day('2028-02-27').isDisabled(), true);
    await day('2028-02-28').press('ArrowRight');
    await day('2028-02-29').press('Enter');
    assert.equal(await dialog.locator('[data-step="checkout"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await apply.isDisabled(), true);
    assert.equal(await day('2028-03-01').evaluate(el => document.activeElement === el), true);
    await day('2028-03-01').press('ArrowRight');
    await day('2028-03-02').press('Enter');
    assert.equal(await dialog.getByRole('status').textContent(), '2 ночи');
    const rect = await dialog.boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1 && rect.y >= 0 && rect.y + rect.height <= 651);
    await apply.click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(await values(), { checkin: '2028-02-29', checkout: '2028-03-02' });
    await page.waitForFunction(() => document.activeElement.id === 'dates');
    await page.evaluate(() => { window.selection.step = 'checkout'; });
    await trigger.click();
    assert.equal(await day('2028-03-02').evaluate(el => document.activeElement === el), true);
    await day('2028-03-02').press('PageDown');
    await day('2028-04-02').press('Enter');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal((await values()).checkout, '2028-03-02');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  });
}

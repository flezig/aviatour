const assert = require('node:assert/strict');
const { test } = require('node:test');
const { chromium, webkit } = require('playwright');

const base = process.env.AVIATOR_TEST_URL ?? 'http://127.0.0.1:8000';
const now = '2030-02-05T10:00:00Z';
const route = '/?from=SVO&fc=MOW&to=JFK&tc=NYC&month=2030-02&weekend=0';
const onTime = {
  id: 'a'.repeat(32), city: 'Нью-Йорк', city_code: 'NYC', destination_airport: 'JFK', destination_name: 'Джон Кеннеди',
  origin_airport: 'SVO', origin_city_code: 'MOW', origin_city: 'Москва', origin_name: 'Шереметьево',
  origin_timezone: 'Europe/Moscow', destination_timezone: 'America/New_York',
  departure_at: '2030-02-12T19:30:00+03:00', return_at: '2030-02-13T00:20:00-05:00',
  price_minor: 3500000, duration_to: 420, duration_back: 420, transfers: 0, return_transfers: 0,
  airline: 'SU', flight_number: '100', received_at: now,
};
const offers = [onTime,
  { ...onTime, id: 'b'.repeat(32), duration_back: 421, duration_to: 421 },
  { ...onTime, id: 'c'.repeat(32), return_at: '2030-02-13T00:19:00-05:00', duration_back: null },
];

test('локальные окна отбирают рейсы, переживают перезагрузку и передают адрес в план', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ timezoneId: 'Asia/Tokyo' });
  await page.clock.setFixedTime(new Date(now));
  const calls = [];
  await page.route('**/api/v1/search/web?*', request => {
    calls.push(new URL(request.request().url()));
    return request.fulfill({ json: { offers, received_at: now } });
  });
  await page.goto(base + route);
  const meeting = page.locator('#flightWindows').getByRole('link', { name: 'Встреча из двух городов' });
  assert.equal(await meeting.getAttribute('href'), '/together.html#meet');
  const rows = page.locator('#results [data-offer]');
  await rows.last().waitFor();
  assert.equal(await rows.count(), 3);

  const shift = page.locator('[data-window="shift"]');
  await shift.locator('summary').press('Enter');
  await shift.locator('[name="freeFrom"]').fill('2030-02-12T18:00');
  await shift.locator('[name="backBy"]').fill('2030-02-13T16:20');
  await shift.locator('[name="before"]').fill('90');
  await shift.locator('[name="after"]').fill('60');
  await shift.getByRole('button', { name: 'Отобрать рейсы' }).click();
  assert.deepEqual(await rows.evaluateAll(nodes => nodes.map(el => el.dataset.offer)), [onTime.id]);

  const event = page.locator('[data-window="event"]');
  await event.locator('summary').click();
  const booking = {
    title: 'Спектакль', address: '123 Broadway', start: '2030-02-12T20:00',
    duration: '110', transferMinutes: '60', bufferMinutes: '30', returnReserveMinutes: '150',
  };
  for (const [name, value] of Object.entries(booking)) await event.locator(`[name="${name}"]`).fill(value);
  await event.getByRole('button', { name: 'Отобрать рейсы' }).click();
  assert.deepEqual(await rows.evaluateAll(nodes => nodes.map(el => el.dataset.offer)), [onTime.id]);
  assert.equal(calls.length, 1);
  assert.ok(!page.url().includes('Broadway'));
  assert.equal(new URL(page.url()).searchParams.get('eventStart'), booking.start);

  await page.reload();
  await rows.first().waitFor();
  assert.equal(await rows.count(), 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].search, calls[0].search);
  await rows.first().click();
  const link = page.locator('#detail a[href^="/trip.html?"]');
  const planHref = await link.getAttribute('href');
  const sharedPlan = JSON.parse(Buffer.from(new URL(planHref, base).hash.slice(4), 'base64url'));
  assert.equal(sharedPlan.event, undefined);
  await link.click();
  const fixed = page.locator('#itinerary .it-booking');
  await fixed.getByText(booking.title, { exact: true }).waitFor();
  await fixed.getByText(booking.address, { exact: true }).waitFor();
});

test('форма события помещается на узком экране Safari', async t => {
  const browser = await webkit.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ isMobile: true, hasTouch: true, viewport: { width: 320, height: 720 } });
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/v1/search/web?*', request => request.fulfill({ json: { offers, received_at: now } }));
  await page.goto(base + route);
  const event = page.locator('[data-window="event"]');
  await event.locator('summary').click();
  await event.locator('[name="start"]').waitFor();
  assert.ok(await event.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  assert.ok(await event.locator('input').evaluateAll(inputs => inputs.every(input => input.offsetWidth <= input.parentElement.offsetWidth)));
});

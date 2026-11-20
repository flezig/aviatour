const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium, webkit, devices } = require('playwright');

const base = process.env.AVIATOR_TEST_URL ?? 'http://127.0.0.1:8000';
for (const [device, engine, settings] of [['настольный браузер',chromium,{}],['iPhone',webkit,devices['iPhone 13']]]) {
  test('три места, бронь, час и чтение скачанного файла без сети — ' + device, async t => {
    const { tripPath, snapshot } = await import('../../web/js/lib/trip.js');
    const plan = snapshot({id:'a'.repeat(32), city_code:'KZN', city:'Казань', origin_city:'Москва', origin_airport:'SVO', destination_airport:'KZN',
      origin_timezone:'Europe/Moscow', destination_timezone:'Europe/Moscow', price_minor:654000, departure_at:'2026-11-27T17:00:00+03:00',
      return_at:'2026-11-29T09:00:00+03:00', duration_to:270, received_at:'2026-11-20T08:00:00Z'});
    const browser = await engine.launch();
    t.after(() => browser.close());
    const ctx = await browser.newContext(settings);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + tripPath(plan));
    await page.getByLabel('Казанский кремль', {exact:true}).check();
    await page.getByLabel('Кот Казанский на Баумана', {exact:true}).check();
    await page.getByLabel('Петропавловский собор', {exact:true}).check();
    assert.match(await page.locator('.it-stay').getAttribute('href'),/places=kremlin,cat,cathedral/);
    await page.getByText('Закрепить бронь или событие', {exact:true}).click();
    const booking = page.locator('.it-fixed form');
    await booking.getByLabel('Название').fill('Встреча у театра');
    await booking.getByLabel('Адрес').fill('Личный адрес 17');
    await booking.getByLabel('Дата и время начала').fill('2026-11-28T19:00');
    await booking.getByRole('button', {name:'Сохранить бронь'}).click();
    await page.locator('.it-booking').waitFor();
    await page.getByText('Остался час', {exact:true}).click();
    const hour = page.locator('.it-short form');
    await hour.getByLabel('Когда есть час').fill('2026-11-28T17:30');
    await hour.getByRole('button', {name:'Пересобрать день'}).click();
    await page.reload();
    assert.equal(await page.locator('.it-places input:checked').count(),3);
    assert.match(await page.locator('.it-booking').innerText(), /19:00–20:00[\s\S]*Личный адрес 17/);
    assert.match(await page.locator('.it-days').innerText(), /За этот час можно посетить/);
    assert.equal(await page.locator('#savePlan').isVisible(),true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),true);
    const dir = await mkdtemp(join(tmpdir(),'aviator-plan-'));
    t.after(() => rm(dir,{recursive:true,force:true}));
    const [download] = await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:/Скачать план/}).click()]);
    const file = join(dir,download.suggestedFilename());
    await download.saveAs(file);
    await ctx.close();
    const offline = await browser.newContext({...settings,offline:true});
    const viewer = await offline.newPage();
    await viewer.goto(pathToFileURL(file).href);
    const text = await viewer.locator('body').innerText();
    for (const expected of ['Личный адрес 17', 'Выехать в аэропорт', '06:00', 'Ул. Мусы Джалиля, 21', '2026-11-20']) assert.ok(text.includes(expected),expected);
    assert.deepEqual(errors, []);
  });
}

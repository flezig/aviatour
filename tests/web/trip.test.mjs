import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot, tripPath, decodeTrip, budget, tripDates, countdown, flightCode, firstPrompt, saveTrip, savedTrips } from '../../web/js/lib/trip.js';

const offer = { id: '0'.repeat(32), city_code:'LED', city:'Санкт-Петербург', origin_city:'Омск', origin_airport:'OMS',
  destination_airport:'LED', origin_timezone:'Asia/Omsk', destination_timezone:'Europe/Moscow', price_minor:502350,
  departure_at:'2026-12-03T23:00:00+06:00', return_at:'2026-12-07T17:00:00+03:00', received_at:'2026-11-17T17:00:00Z',
  duration_to:330, transfers:0, airline:'DP', flight_number:'123' };

test('ссылка переносит маршрут и бюджет, включая ночь перелёта и часовые пояса', () => {
  const p = { ...snapshot(offer), people:2, food:1000, stay:2500 };
  assert.equal(new URL(tripPath(p), 'https://example.org').searchParams.get('city'), p.cityCode);
  assert.deepEqual(decodeTrip(new URL(tripPath(p), 'https://example.org').hash), p);
  assert.equal(tripDates(p).start,'2026-12-04');
  assert.equal(tripDates(p).nights,3);
  assert.deepEqual(budget(p),{ tickets:1004700, complete:true, total:2554700 });
  assert.equal(budget(snapshot(offer)).complete,false);
  assert.equal(countdown(p,new Date('2026-12-02T18:01Z')), 'Вылет сегодня');
  assert.equal(countdown(p,new Date('2026-12-04T00:00Z')), 'Поездка началась');
  assert.equal(flightCode({...offer,transfers:1}),null);
});
test('сломанная ссылка и неподдерживаемый часовой пояс не прерывают страницу', () => {
  for (const hash of ['#v1=e30', '#v1=%', '#v1=' + 'x'.repeat(6100),
    new URL(tripPath({...snapshot(offer),zone:'Invalid/City'}), 'https://example.org').hash]) assert.equal(decodeTrip(hash),null);
});
test('подсказка однократная, сохранённый план обновляется без дублей', () => {
  const data = new Map();
  globalThis.localStorage = { getItem:k => data.get(k) ?? null, setItem:(k,v) => data.set(k,v) };
  const p = snapshot(offer);
  assert.equal(firstPrompt(p.id),true);
  assert.equal(firstPrompt(p.id),false);
  assert.equal(saveTrip(p),true);
  saveTrip({...p,food:0});
  assert.equal(savedTrips().length,1);
  assert.equal(savedTrips()[0].food,0);
});

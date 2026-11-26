// Проверки сборщика партнёрских ссылок сайта: node --test tests/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partnerLink, clickLabel } from '../../web/js/lib/links.js';

const TICKETS = 'https://www.aviasales.com/search/MOW2212LED23121?t=abc&expected_price=3176';
const HOTELS = 'https://www.aviasales.ru/hotels/search?location_id=12153&location_type=city&checkin=2026-12-01&checkout=2026-12-08&adults=1';

test('метка: город-страница-блок, только a–z 0–9 и дефис, до 32 знаков', () => {
  assert.equal(clickLabel({ city: 'LED', page: 'trip', block: 'tickets' }), 'led-trip-tickets');
  assert.equal(clickLabel({ city: 'AER', page: 'trip', block: 'hotel', variant: 'B' }), 'aer-trip-hotel-b');
  assert.equal(clickLabel({ city: 'Мск', page: 'trip', block: 'tickets' }), 'trip-tickets');
  const long = clickLabel({ city: 'kzn', page: 'city', block: 'x'.repeat(40) });
  assert.ok(long.length <= 32 && /^[a-z0-9-]+$/.test(long) && !long.endsWith('-'));
  assert.equal(clickLabel({}), '');
});

test('билеты и отели Aviasales идут через /go с меткой', () => {
  assert.equal(partnerLink(TICKETS, { kind: 'tickets', city: 'LED', page: 'trip', block: 'tickets' }), `/go?s=led-trip-tickets&u=${encodeURIComponent(TICKETS)}`);
  assert.equal(partnerLink(HOTELS, { kind: 'hotels', city: 'LED', page: 'trip', block: 'hotel' }), `/go?s=led-trip-hotel&u=${encodeURIComponent(HOTELS)}`);
});

test('чужие и подозрительные адреса не превращаются в ссылку', () => {
  for (const url of [
    'http://www.aviasales.com/search/MOW2212LED23121',
    'https://aviasales.ru.example.com/search/MOW2212LED23121',
    'https://user:pass@www.aviasales.com/search/MOW2212LED23121',
    'https://www.aviasales.com:8443/search/MOW2212LED23121',
    'https://www.aviasales.com/hotels/search?location_id=1',
    'https://evil.example/search/x',
    'javascript:alert(1)',
    'не адрес',
  ]) assert.equal(partnerLink(url, { kind: 'tickets', city: 'led', page: 'trip', block: 'tickets' }), null, url);
  assert.equal(partnerLink(TICKETS, { kind: 'hotels' }), null);
  assert.equal(partnerLink(TICKETS, { kind: 'unknown' }), null);
});

test('Островок: только страница города, без параметров', () => {
  const page = 'https://ostrovok.ru/hotel/russia/kazan/';
  assert.equal(partnerLink(page, { kind: 'ostrovok', city: 'KZN', page: 'city', block: 'stay' }), `/go?s=kzn-city-stay&u=${encodeURIComponent(page)}`);
  for (const url of ['https://ostrovok.ru/hotel/russia/kazan/?utm=1', 'http://ostrovok.ru/hotel/russia/kazan/', 'https://ostrovok.ru.example.com/hotel/russia/kazan/',
    'https://ostrovok.ru/', 'https://ostrovok.ru/hotel/russia/kazan/#x', 'https://www.aviasales.ru/hotels/search?location_id=1']) {
    assert.equal(partnerLink(url, { kind: 'ostrovok', city: 'KZN' }), null, url);
  }
});

test('состав семьи заменяет параметры точного предложения и учитывает местные даты обоих аэропортов', async () => {
  const { ticketLink } = await import('../../web/js/lib/links.js');
  const { passengersFromParams, setPassengerParams, validPassengers } = await import('../../web/js/lib/passengers.js');
  const offer = {
    origin_airport: 'SVO', destination_airport: 'HKT', origin_timezone: 'Europe/Moscow', destination_timezone: 'Asia/Bangkok',
    departure_at: '2030-04-01T22:15:00Z', return_at: '2030-04-09T18:20:00Z', search_url: TICKETS,
  };
  const address = p => new URL(ticketLink(offer, p, {}), 'https://example.org').searchParams.get('u');
  assert.equal(address({ adults: 1, ages: [] }), TICKETS);
  for (const [party, suffix] of [
    [{ adults: 9, ages: [] }, '9'],
    [{ adults: 2, ages: [2, 11] }, '22'],
    [{ adults: 1, ages: [0] }, '101'],
    [{ adults: 2, ages: [1, 7, 0] }, '212'],
  ]) {
    assert.equal(address(party), 'https://www.aviasales.com/search/SVO0204HKT1004' + suffix);
    const params = new URLSearchParams();
    setPassengerParams(params, party);
    assert.deepEqual(passengersFromParams(params), party);
  }
  for (const invalid of [{ adults: 1, ages: [0, 1] }, { adults: 9, ages: [7] }, { adults: 1, ages: [12] }]) {
    assert.equal(validPassengers(invalid), false);
    assert.equal(ticketLink(offer, invalid, {}), null);
  }
  assert.deepEqual(passengersFromParams(new URLSearchParams('adults=0&ages=1')), { adults: 1, ages: [] });
});

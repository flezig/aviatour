import assert from 'node:assert/strict';
import test from 'node:test';
import {
  eventWindow, flightEventFor, flightWindowDetails, flightWindowPeriodNote, flightWindowsForRoute,
  localInstant, matchFlightWindows, readFlightWindows, shiftWindow, writeFlightWindows,
} from '../../web/js/lib/flight-windows.js';

const home = { origin: 'SVO', originCityCode: 'MOW', originZone: 'Europe/Moscow' };
const nyc = { ...home, destination: 'JFK', destinationCity: 'NYC', destinationZone: 'America/New_York' };

const shift = shiftWindow({
  freeFrom: '2030-02-10T20:00', backBy: '2030-02-13T02:30', before: '90', after: '60',
}, home).value;
const eventFields = {
  title: 'Спектакль', address: '123 Broadway', start: '2030-02-12T20:00',
  duration: '110', transferMinutes: '60', bufferMinutes: '30', returnReserveMinutes: '150',
};
const event = eventWindow(eventFields, nyc).value;
const flight = {
  origin_airport: 'SVO', origin_city_code: 'MOW', city_code: 'NYC', destination_airport: 'JFK',
  departure_at: '2030-02-12T19:30:00+03:00', duration_to: 420,
  return_at: '2030-02-13T00:20:00-05:00', duration_back: 420,
};

test('местные даты однозначны и учитывают переходы на летнее время и дробные смещения', () => {
  assert.equal(localInstant('2030-02-10T20:00', 'Europe/Moscow'), Date.parse('2030-02-10T17:00:00Z'));
  assert.equal(localInstant('2030-02-10T20:00', 'Asia/Kathmandu'), Date.parse('2030-02-10T14:15:00Z'));
  assert.equal(localInstant('2030-03-31T02:30', 'Europe/Berlin'), null);
  assert.equal(localInstant('2030-10-27T02:30', 'Europe/Berlin'), null);
  assert.equal(localInstant('2030-10-27T03:00', 'Europe/Berlin'), Date.parse('2030-10-27T02:00:00Z'));
  assert.equal(localInstant('2030-10-06T02:10', 'Australia/Lord_Howe'), null);
  assert.equal(localInstant('2030-02-30T13:00', 'Europe/Moscow'), null);
  assert.equal(localInstant('2030-02-10T24:00', 'Europe/Moscow'), null);
  assert.equal(localInstant('2030-02-10T20:00', 'Unknown/City'), null);
});

test('между сменами с ночным прилётом учитываются дорога и обе границы', () => {
  const offer = {
    ...flight, city_code: 'BKK', destination_airport: 'BKK',
    departure_at: '2030-02-10T21:30:00+03:00',
    return_at: '2030-02-13T01:00:00+07:00', duration_back: 270,
  };
  assert.ok(matchFlightWindows(offer, { shift }));
  assert.ok(!matchFlightWindows({ ...offer, departure_at: '2030-02-10T21:29:00+03:00' }, { shift }));
  assert.ok(!matchFlightWindows({ ...offer, duration_back: 271 }, { shift }));
  assert.ok(!matchFlightWindows({ ...offer, duration_back: null }, { shift }));
  assert.ok(!matchFlightWindows({ ...offer, origin_airport: 'LED', origin_city_code: 'LED' }, { shift }));
  assert.ok(matchFlightWindows({
    ...offer, duration_back: null, inbound_segments: [{ arrival_at: '2030-02-13T01:30:00+03:00' }],
  }, { shift }));
  assert.equal(shiftWindow({ ...shift, before: 'abc' }, home).field, 'before');
  assert.equal(shiftWindow({ ...shift, backBy: '2030-02-10T21:00' }, home).field, 'backBy');
});

test('для события учитываются местное время, прилёт, дорога, окончание и запас до обратного вылета', () => {
  assert.ok(matchFlightWindows(flight, { event }));
  assert.ok(!matchFlightWindows({ ...flight, city_code: 'BOS', destination_airport: 'BOS' }, { event }));
  assert.ok(!matchFlightWindows({ ...flight, duration_to: null }, { event }));
  assert.ok(!matchFlightWindows({ ...flight, duration_to: 421 }, { event }));
  assert.ok(!matchFlightWindows({ ...flight, return_at: '2030-02-13T00:19:00-05:00' }, { event }));
  assert.ok(matchFlightWindows({
    ...flight, duration_to: 425, outbound_segments: [{ arrival_at: '2030-02-12T18:30:00-05:00' }],
  }, { event }));
  assert.equal(eventWindow({ ...eventFields, duration: '0' }, nyc).field, 'duration');
  assert.equal(eventWindow({ ...eventFields, transferMinutes: '' }, nyc).field, 'transferMinutes');
  assert.equal(eventWindow(eventFields, home).value, undefined);
  assert.equal(flightEventFor(flight, { event, shift }), null);
  assert.deepEqual(flightEventFor(flight, { event }), {
    title: 'Спектакль', address: '123 Broadway', start: '2030-02-12T20:00',
    duration: 110, transferMinutes: 60, bufferMinutes: 30, returnReserveMinutes: 150,
  });
});

test('дата события может отличаться от дня вылета после ночного рейса и смены часовых поясов', () => {
  for (const [destination, zone, start, departureAt, elapsed, returnAt] of [
    ['NRT', 'Asia/Tokyo', '2030-02-11T07:00', '2030-02-09T23:30:00-08:00', 780, '2030-02-11T11:20:00+09:00'],
    ['DXB', 'Asia/Dubai', '2030-02-11T09:00', '2030-02-11T00:30:00+03:00', 360, '2030-02-11T13:20:00+04:00'],
    ['KZN', 'Europe/Moscow', '2030-03-01T00:00', '2030-02-28T15:30:00+03:00', 420, '2030-03-01T04:20:00+03:00'],
    ['BER', 'Europe/Berlin', '2030-03-31T07:00', '2030-03-30T22:30:00+01:00', 360, '2030-03-31T11:20:00+02:00'],
  ]) {
    const result = eventWindow({ ...eventFields, start }, { destination, destinationZone: zone }).value;
    const offer = { ...flight, destination_airport: destination, departure_at: departureAt, duration_to: elapsed, return_at: returnAt };
    assert.ok(matchFlightWindows(offer, { event: result }), zone);
    assert.ok(!matchFlightWindows({ ...offer, duration_to: elapsed + 1 }, { event: result }), zone);
  }
});

test('ссылка сохраняет время и запасы, а адрес и название восстанавливаются из истории', () => {
  const params = new URLSearchParams('from=SVO&to=JFK&tc=NYC&month=2030-02');
  writeFlightWindows(params, { shift, event });
  assert.ok(!params.toString().includes('Broadway'));
  assert.deepEqual(readFlightWindows(params, nyc, flightWindowDetails({ event })), { shift, event });
  assert.equal(readFlightWindows(params, nyc).event.address, '');
  assert.equal(readFlightWindows(params, nyc, { ...flightWindowDetails({ event }), start: '2030-02-11T20:00' }).event.title, 'Событие');
  params.set('eventBuffer', '1.5');
  assert.deepEqual(readFlightWindows(params, nyc), { shift });
  writeFlightWindows(params, {});
  assert.equal(params.toString(), 'from=SVO&to=JFK&tc=NYC&month=2030-02');
});

test('смена аэропорта или города сверяет действующие условия, несовпадение периода заметно', () => {
  assert.deepEqual(flightWindowsForRoute({ shift, event }, nyc), { shift, event });
  assert.deepEqual(flightWindowsForRoute({ shift, event }, home), { shift });
  assert.deepEqual(flightWindowsForRoute({ shift, event }, { ...nyc, destination: 'LGA' }), { shift });
  assert.deepEqual(flightWindowsForRoute({}, {}), {});
  assert.equal(flightWindowPeriodNote({ shift }, { month: '2030-02' }, home), '');
  assert.match(flightWindowPeriodNote({ shift }, { month: '2030-01' }, home), /февраль 2030/i);
  assert.match(flightWindowPeriodNote({ event }, { month: '2030-03' }, nyc), /февраль 2030/i);
  assert.match(flightWindowPeriodNote({ event }, { exact: true, departure: '2030-02-12', returning: '2030-02-12' }, nyc), /обратного рейса/);
  assert.match(flightWindowPeriodNote({ shift }, { exact: true, departure: '2030-02-09' }, home), /дата вылета вне/);
});

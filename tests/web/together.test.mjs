import assert from 'node:assert/strict';
import test from 'node:test';
import { groupBudget, meetingCities, stayNights, usableOffer } from '../../web/js/lib/together.js';

const base = { id: 'a'.repeat(32), city: 'Казань', city_code: 'KZN', origin_city: 'Омск', origin_city_code: 'OMS',
  origin_airport: 'OMS', destination_airport: 'KZN', duration_to: 180, origin_timezone: 'Asia/Omsk',
  destination_timezone: 'Europe/Moscow', departure_at: '2027-01-01T23:00:00+06:00', return_at: '2027-01-05T15:00:00+03:00',
  price_minor: 500050, received_at: '2026-11-20T09:00:00Z' };

// Independent expected minor-unit totals for ten budgets with the same three cost categories.
for (const [people, rate, extras, known, complete] of [
  [1, 1000, 2000, 1100050, true], [2, 1000, 2000, 1600100, true], [3, 1000, 2000, 2100150, true],
  [2, 1800, 2100, 1930100, true], [2, 0, 3000, 1300100, true], [2, 2000, 0, 1800100, true],
  [2, 0, 0, 1000100, true], [2, null, 1000, 1100100, false], [2, 1000, null, 1400100, false],
  [2, null, null, 1000100, false],
]) {
  test(`групповая смета: ${people} чел., жильё ${rate}, прочее ${extras}`, () => {
    const result = groupBudget(base, people, rate, extras);
    assert.equal(result.nights, 4);
    assert.deepEqual([result.known, result.complete], [known, complete]);
  });
}
test('ночи считают по местным датам на месте, начиная с прилёта', () => {
  assert.equal(stayNights({ ...base, duration_to: 320 }), 3);
  const day = { ...base, return_at: '2027-01-01T23:50:00+03:00' };
  assert.equal(groupBudget(day, 2, null, 0).complete, true);
  assert.equal(stayNights({ ...base, duration_to: null }), null);
});
test('старые, просроченные и неполные записи не выдают за действующие тарифы', () => {
  const now = Date.parse('2026-11-25T00:00:00Z');
  assert.ok(usableOffer(base, now));
  for (const patch of [{ availability: 'unavailable' }, { expires_at: '2026-11-22T00:00:00Z' },
    { departure_at: '2026-11-20T00:00:00Z' }, { received_at: undefined }, { source: 'MOCK' }, {currency:'EUR'}, { destination_timezone: 'no-such-zone' }]) {
    assert.equal(usableOffer({ ...base, ...patch }, now), false);
  }
});
const second = { ...base, id: 'b'.repeat(32), origin_city: 'Москва', origin_city_code: 'MOW', origin_airport: 'SVO',
  origin_timezone: 'Europe/Moscow', departure_at: '2027-01-02T11:00:00+03:00', duration_to: 60, price_minor: 200000 };

// Same city, different local schedules. Include differing return days and non-overlapping boundary cases.
for (const [name, patch, minutes] of [
  ['оба улетают одновременно', {}, 4500],
  ['вторая группа улетает на два дня раньше', { return_at: '2027-01-03T15:00:00+03:00' }, 1620],
  ['вторая группа улетает на день позже', { return_at: '2027-01-06T05:00:00+03:00' }, 4500],
  ['обратный вылет до прилёта другой группы', { departure_at: '2027-01-05T16:00:00+03:00', return_at: '2027-01-08T07:00:00+03:00' }, null],
  ['прилёт совпадает с обратным вылетом', { departure_at: '2027-01-05T14:00:00+03:00', return_at: '2027-01-08T07:00:00+03:00' }, null],
]) {
  test(`встреча: ${name}`, () => {
    const result = meetingCities([base], [{ ...second, ...patch }], 2, 3).get('KZN')?.cheap;
    assert.equal(result?.minutes ?? null, minutes);
    if (result) { assert.equal(result.cost, 1600100); assert.equal(result.left.id, base.id); assert.equal(result.right.id, second.id); }
  });
}
test('подбор сохраняет дешёвую и длинную пару и отсекает неподтверждённое пересечение', () => {
  const longer = { ...second, departure_at:'2027-01-01T10:00:00+03:00', price_minor:450000, id:'c'.repeat(32) };
  const result = meetingCities([base], [second, longer], 1, 1).get('KZN');
  assert.equal(result.cheap.right, second); assert.equal(result.longest.right, longer);
  for (const patch of [{ city_code:'AER' }, { origin_city_code:'OMS' }, { duration_to:0 }, { duration_to:null }]) {
    assert.equal(meetingCities([base], [{ ...second, ...patch }], 1, 1).size, 0);
  }
});

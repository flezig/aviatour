// Уровень цены и подписи подборок: node --test tests/web/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceLevel, usualKey, hotLine, leaveLine, levelNote, priceChange, daysAhead } from '../../web/js/lib/levels.js';

test('уровень цены: ±15 % — обычная, округление как на сервере', () => {
  assert.deepEqual(priceLevel(8500, 10000), { kind: 'low', diff: -15 });
  assert.deepEqual(priceLevel(8600, 10000), { kind: 'usual', diff: -14 });
  assert.deepEqual(priceLevel(11500, 10000), { kind: 'high', diff: 15 });
  assert.deepEqual(priceLevel(11250, 10000), { kind: 'usual', diff: 13 });
  assert.deepEqual(priceLevel(8550, 10000), { kind: 'low', diff: -15 }); // сервер даёт то же (tests: test_showcase.py)
});

test('ключ обычной цены: город, месяц, длина поездки', () => {
  assert.equal(usualKey('KZN', '2026-11', 2), 'KZN|2026-11|0');
  assert.equal(usualKey('KZN', '2026-11', 3), 'KZN|2026-11|1');
  assert.equal(usualKey('KZN', '2026-11', 7), 'KZN|2026-11|2');
  assert.equal(usualKey('KZN', '2026-11', 14), 'KZN|2026-11|3');
});

test('подписи подборок', () => {
  assert.equal(hotLine(3, -30, '2026-12'), 'вылет через 3 дня · на 30% ниже обычной цены в декабре');
  assert.equal(hotLine(1, -21, '2026-11'), 'вылет завтра · на 21% ниже обычной цены в ноябре');
  assert.equal(daysAhead(5), 'через 5 дней');
  assert.equal(leaveLine(2, 6), '2 дня отпуска — 6 дней поездки');
  assert.equal(leaveLine(0, 3), 'без отпуска · 3 дня');
  assert.equal(leaveLine(1, 5), '1 день отпуска — 5 дней поездки');
  assert.match(levelNote({ diff: -33, usualText: '5 084 ₽', pairs: 45, month: '2026-11', nights: 5 }), /середина самых низких цен Aviasales на разные даты в ноябре для поездок на 5–7 ночей \(45 пар дат\)\. Эта на 33% ниже\./);
});

test('пары дат: согласование', () => {
  assert.match(levelNote({ diff: 0, usualText: '1 ₽', pairs: 21, month: '2026-11', nights: 1 }), /\(21 пара дат\)\. Эта — такая же\./);
});

test('изменение цены той же поездки', () => {
  assert.deepEqual(priceChange(500000, 416000), { kind: 'down', amount: 84000 });
  assert.deepEqual(priceChange(500000, 510000), { kind: 'up', amount: 10000 });
  assert.deepEqual(priceChange(500000, 500000), { kind: 'same', amount: 0 });
  assert.equal(priceChange(undefined, 1), null);
});

// Проверки города вылета посетителя: node --test tests/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validOrigin } from '../../web/js/lib/origin.js';

test('город вылета: только коды из трёх латинских букв и название', () => {
  assert.ok(validOrigin({ code: 'MOW', iata: 'SVO', all: true, name: 'Москва', from: 'Москвы' }));
  assert.ok(validOrigin({ code: 'KZN', iata: 'KZN', all: false, name: 'Казань', from: null }));
  for (const bad of [null, {}, { code: 'mow', iata: 'SVO', all: true, name: 'Москва' }, { code: 'MOW', iata: 'SVO', all: 'yes', name: 'Москва' },
    { code: 'MOW', iata: 'SVO1', all: true, name: 'Москва' }, { code: 'MOW', iata: 'SVO', all: true, name: '' }, { code: 'MOW', iata: 'SVO', all: true, name: 'Москва', from: 5 }]) {
    assert.equal(validOrigin(bad), false, JSON.stringify(bad));
  }
});

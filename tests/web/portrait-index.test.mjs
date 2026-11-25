import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

test('фотокаталог связывает каждый зарубежный город с его страной и локальным флагом', () => {
  const photos = json('web/photos/manifest.json');
  const index = json('web/data/portrait-index.json');
  const cities = new Map(json('backend/app/airports.json').map(row => [row.city_code, row]));
  assert.deepEqual(Object.keys(index).sort(), photos.slice().sort());
  for (const code of photos) {
    const city = cities.get(code);
    if (!city || city.country_code === 'RU') {
      assert.equal(index[code], null, code);
      continue;
    }
    assert.deepEqual(index[code], [city.country_code, city.country], code);
    const flag = new URL('web/flags/' + city.country_code.toLowerCase() + '.svg', root);
    assert.ok(existsSync(flag), code);
  }
});

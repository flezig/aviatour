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

test('у каждого фото города есть обе миниатюры и одна запись об авторстве', () => {
  const photos = json('web/photos/manifest.json');
  const credits = readFileSync(new URL('web/photos/credits.md', root), 'utf8');
  const credited = Array.from(credits.matchAll(/^- \*\*([A-Z]{3})\*\*:/gm), match => match[1]);
  assert.deepEqual(credited.sort(), [...photos].sort());
  for (const code of photos) {
    for (const path of [code + '.jpg', 's/' + code + '.webp', 's/' + code + '.jpg']) {
      assert.ok(existsSync(new URL('web/photos/' + path, root)), path);
    }
  }
});

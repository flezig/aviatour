import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const separator = /\u00b7|&(?:middot|centerdot|#0*183|#x0*b7);|\\(?:u00b7|u\{0*b7\}|xb7|0{0,4}b7(?![\da-f]))/i;
const photoCredit = '\u00b7˙\u00b7ChinaUli2010\u00b7.\u00b7';

function* sources(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.(?:html|js|css|py|json|svg|md)$/.test(entry.name)) yield path;
  }
}

test('в тексте сайта нет разделителя U+00B7', () => {
  const locations = [];
  for (const directory of ['web', 'backend/app']) {
    for (const path of sources(join(root, directory))) {
      let content = readFileSync(path, 'utf8');
      if (['web/data/cities.json', 'web/photos/credits-web.md', 'web/photos/credits.md'].includes(relative(root, path))) {
        content = content.replaceAll(photoCredit, '');
      }
      content.split('\n').forEach((line, i) => {
        if (separator.test(line)) locations.push(relative(root, path) + ':' + (i + 1));
      });
    }
  }
  assert.deepEqual(locations, []);
});

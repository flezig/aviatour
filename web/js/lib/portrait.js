import { esc } from './ui.js';

let photos;

function countryBadge(code) {
  const country = photos?.get(code);
  if (!country) return '';
  const [cc, label] = country;
  return `<span class="portrait-country"><img src="/flags/${esc(cc.toLowerCase())}.svg" alt="" loading="lazy"><span>${esc(label)}</span></span>`;
}

function image(code, eager) {
  const base = '/photos/' + encodeURIComponent(code);
  const thumb = '/photos/s/' + encodeURIComponent(code) + '.webp';
  return `<img src="${thumb}" srcset="${thumb} 1x, ${base}.jpg 2x" alt="" loading="${eager ? 'eager' : 'lazy'}" decoding="async">`;
}

// The photo index and the offers load independently. Keep the label and any focused
// favorite button in place when an image becomes available.
export async function loadPortraits() {
  try {
    const response = await fetch('/data/portrait-index.json', { cache: 'no-cache' });
    photos = new Map(Object.entries(response.ok ? await response.json() : {}));
    for (const slot of document.querySelectorAll('.portrait[data-pending]')) {
      if (photos.has(slot.dataset.cityCode)) {
        slot.insertAdjacentHTML('beforeend', countryBadge(slot.dataset.cityCode));
        slot.insertAdjacentHTML('afterbegin', image(slot.dataset.cityCode, slot.dataset.pending === 'eager'));
      }
      delete slot.dataset.pending;
    }
  } catch { /* City names remain readable offline. */ }
}

export const longPortraitName = name => name.length > 14 || name.includes("(");

export function portrait(code, name, { action = '', eager = false, named = false } = {}) {
  const pending = photos ? '' : ` data-pending="${eager ? 'eager' : 'lazy'}"`;
  const long = longPortraitName(name);
  const [, main, qualifier] = /^(.*?)(?: (\([^()]+\)))?$/u.exec(name);
  const label = esc(main) + (qualifier ? ' <span class="city-qualifier">' + esc(qualifier) + '</span>' : '');
  return `<span class="portrait${long ? ' portrait--long' : ''}" data-city-code="${esc(code)}"${pending}>${photos?.has(code) ? image(code, eager) : ''}<span class="portrait-name"${named ? '' : ' aria-hidden="true"'}>${label}</span>${countryBadge(code)}${action}</span>`;
}

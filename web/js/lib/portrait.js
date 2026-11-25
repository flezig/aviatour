import { esc } from './ui.js';

let photos;

function image(code, eager) {
  const base = '/photos/' + encodeURIComponent(code);
  const thumb = '/photos/s/' + encodeURIComponent(code) + '.webp';
  return `<img src="${thumb}" srcset="${thumb} 1x, ${base}.jpg 2x" alt="" loading="${eager ? 'eager' : 'lazy'}" decoding="async">`;
}

// The photo index and the offers load independently. Keep the label and any focused
// favorite button in place when an image becomes available.
export async function loadPortraits() {
  try {
    const response = await fetch('/photos/manifest.json', { cache: 'no-cache' });
    photos = new Set(response.ok ? await response.json() : []);
    for (const slot of document.querySelectorAll('.portrait[data-pending]')) {
      if (photos.has(slot.dataset.cityCode)) {
        slot.insertAdjacentHTML('afterbegin', image(slot.dataset.cityCode, slot.dataset.pending === 'eager'));
      }
      delete slot.dataset.pending;
    }
  } catch { /* City names remain readable offline. */ }
}

export function portrait(code, name, { action = '', eager = false, named = false } = {}) {
  const pending = photos ? '' : ` data-pending="${eager ? 'eager' : 'lazy'}"`;
  return `<span class="portrait" data-city-code="${esc(code)}"${pending}>${photos?.has(code) ? image(code, eager) : ''}<span class="portrait-name"${named ? '' : ' aria-hidden="true"'}>${esc(name)}</span>${action}</span>`;
}

import './lib/measure.js';
import { previewFirstRating } from './lib/city-rating.js';

const form = document.querySelector('.rating-filters');
const results = document.getElementById('rating-results');
const period = document.getElementById('rating-period');
let timer, pending;
form.classList.add('rating-filters-live');

async function filter() {
  clearTimeout(timer);
  pending?.abort();
  const request = new AbortController();
  pending = request;
  const url = new URL(form.action);
  url.search = new URLSearchParams(new FormData(form));
  if (!url.searchParams.get('q')) url.searchParams.delete('q');
  results.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(url, { signal: request.signal });
    if (!response.ok) throw new Error();
    const html = new DOMParser().parseFromString(await response.text(), 'text/html');
    const next = html.getElementById('rating-results');
    if (!next) throw new Error();
    if (request.signal.aborted) return;
    results.replaceChildren(...next.childNodes);
    period.textContent = html.getElementById('rating-period').textContent;
    history.replaceState(history.state, '', url);
    previewFirstRating();
  } catch {
    if (!request.signal.aborted) location.assign(url);
  } finally {
    if (pending === request) results.removeAttribute('aria-busy');
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  filter();
});
form.querySelector('[name=q]').addEventListener('input', () => {
  clearTimeout(timer);
  pending?.abort();
  timer = setTimeout(filter, 220);
});
for (const input of form.querySelectorAll('select, [type=checkbox]')) input.addEventListener('change', filter);
previewFirstRating();

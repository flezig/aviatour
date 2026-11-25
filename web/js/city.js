// Страница города (готовый HTML с сервера, цены из Москвы): цены из города посетителя, выбор города вылета,
// время цен по часам посетителя, пометки «Реклама» со сведениями из config.js, цели Метрики.
import './lib/city-rating.js';
import { $, adMark } from './lib/ui.js';
import { goal } from './lib/measure.js';
import { fmtDay, fmtTime, localZone } from './lib/format.js';
import { currentOrigin, saveOrigin } from './lib/origin.js';

const main = document.querySelector('[data-city]');
const city = main.dataset.city, fixed = main.dataset.fixed === '1';
let shown = main.dataset.origin, loading = null;

function polish(root) {
  for (const time of root.querySelectorAll('time[data-local]')) {
    const moment = new Date(time.dateTime);
    if (!Number.isNaN(moment.getTime())) time.textContent = `${fmtDay(moment, localZone)}, ${fmtTime(moment, localZone)}`;
  }
  for (const mark of root.querySelectorAll('[data-ad]')) mark.outerHTML = adMark(mark.dataset.ad);
}

// Цены, месяцы и жильё из другого города вылета — тот же HTML, что сервер рисует для Москвы.
async function show(origin, refocus = false) {
  if (!origin || origin.code === city || origin.code === shown) return;
  loading?.abort();
  loading = new AbortController();
  const params = new URLSearchParams({ from: origin.iata });
  if (origin.all) params.set('fc', origin.code);
  main.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(`/api/v1/city/${encodeURIComponent(city)}?${params}`, { signal: loading.signal });
    const data = response.ok ? await response.json() : null;
    if (typeof data?.price !== 'string') return;
    $('fares').innerHTML = data.price;
    for (const id of ['months', 'stay']) { $(id).innerHTML = data[id] ?? ''; $(id).hidden = !data[id]; }
    shown = origin.code;
    for (const link of main.querySelectorAll('a[href^="/season/"]')) {
      const url = new URL(link.href);
      url.searchParams.set('from', origin.iata);
      if (origin.all) url.searchParams.set('fc', origin.code); else url.searchParams.delete('fc');
      link.href = url.href;
    }
    polish(main);
    // Кнопку выбора города заменили новой — фокус возвращается на неё, а не в начало страницы.
    if (refocus) $('fares').querySelector('[data-origin-pick]')?.focus();
  } catch { /* нет связи — остаются цены, с которыми пришла страница */ }
  finally { main.removeAttribute('aria-busy'); }
}

polish(document);
goal('view_city', { city, from: shown, page: fixed ? 'route' : 'city' });
document.addEventListener('click', (event) => {
  const partner = event.target.closest('a[data-partner]');
  if (partner) goal('affiliate_click', { partner: partner.dataset.partner, block: partner.dataset.block, city });
});

const sheet = $('originSheet');
if (!fixed && sheet) {
  const filter = $('originFilter'), options = [...sheet.querySelectorAll('[data-origin]')];
  const filterOrigins = () => {
    const term = filter.value.toLocaleLowerCase('ru').trim();
    for (const row of options) {
      row.hidden = ![row.dataset.name, row.dataset.iata, row.dataset.origin].some(s => s.toLocaleLowerCase('ru').includes(term));
      if (row.dataset.origin === shown) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
    }
    $('noOrigins').hidden = options.some(row => !row.hidden);
  };
  filter.addEventListener('input', filterOrigins);
  main.addEventListener('click', event => {
    if (!event.target.closest('[data-origin-pick]')) return;
    filter.value = '';
    filterOrigins();
    sheet.showModal();
    filter.focus();
  });
  sheet.addEventListener('click', (event) => {
    const row = event.target.closest('[data-origin]');
    if (row) {
      const origin = { code: row.dataset.origin, iata: row.dataset.iata, all: row.dataset.all === '1', name: row.dataset.name, from: row.dataset.from };
      saveOrigin(origin, true);
      sheet.close();
      show(origin, true);
    } else if (event.target === sheet || event.target.closest('[data-close]')) sheet.close();
  });
  currentOrigin().then(show);
}

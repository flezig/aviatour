// Поиск поездок (главная). Правила повторяют приложение iOS (Aviator/Utilities/SearchRules.swift); источник истины — сервер.
import { $, esc, icon, adMark } from './lib/ui.js';
import { DEFAULT_ZONE, localZone, zoned, fmtDate, fmtDay, fmtTime, fmtMoney, fmtRange, monthLabel, months, defaultMonth, addDays, duration, daysLabel, nightsLabel, countLabel } from './lib/format.js';
import { partnerLink } from './lib/links.js';
import { goal } from './lib/measure.js';

const EUROPE = new Set('AL AD AT BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT LV LI LT LU MT MD MC ME NL MK NO PL PT RO SM RS SK SI ES SE CH TR UA GB VA XK'.split(' '));
const REGIONS = { any: 'Куда угодно', russia: 'По России', europe: 'Поездка в Европу', usa: 'Поездка в США' };
// Регионы, которые ищутся по списку городов; остальные — одним поиском с отбором по стране.
const CITY_REGIONS = new Set(['europe', 'usa']);
const LENGTHS = { any: 'Любая длина', short: '1–2 дня', mid: '3–4 дня', week: '5–7 дней', long: 'Дольше недели' };
const SORTS = { price: 'Сначала дешевле', priceDescending: 'Сначала дороже', departure: 'Ближайший вылет', duration: 'Меньше времени в пути', stay: 'Больше времени на месте', value: 'Выгоднее час поездки', flightRating: 'По оценке перелёта' };
const CHIPS = { cheap: 'До 20 000 ₽', direct: 'Прямые', noLeave: 'Без отпуска', comfy: 'Удобное время вылета', near: 'В пути до 3 ч', russia: 'Россия', unique: 'Один вариант на город' };
const TAGS = { sea: 'Море', culture: 'Музеи и культура', food: 'Гастрономия', architecture: 'Архитектура', nature: 'Природа', nightlife: 'Вечерняя жизнь' };
const POPULAR = ['MOW', 'LED', 'SVX', 'OVB', 'KZN', 'GOJ', 'KUF', 'UFA', 'AER', 'KGD'];
// «Куда улететь из …»: родительный падеж для частых городов вылета; для остальных — «Вылет: город».
const FROM = { MOW: 'Москвы', LED: 'Петербурга', SVX: 'Екатеринбурга', OVB: 'Новосибирска', KZN: 'Казани', GOJ: 'Нижнего Новгорода', KUF: 'Самары', UFA: 'Уфы', AER: 'Сочи', KGD: 'Калининграда', KRR: 'Краснодара', ROV: 'Ростова-на-Дону', PEE: 'Перми', CEK: 'Челябинска', KJA: 'Красноярска', IKT: 'Иркутска', VVO: 'Владивостока', KHV: 'Хабаровска', TJM: 'Тюмени', OMS: 'Омска', VOG: 'Волгограда', MRV: 'Минеральных Вод', MSQ: 'Минска' };
const PAGE = 60;
const config = window.AVIATOR ?? {};
// A/B: вариант выбирается один раз на браузер и хранится. #ab=A или #ab=B показывает вариант без записи.
function variant(name) {
  const preview = /[#&]ab=([AB])\b/.exec(location.hash)?.[1];
  if (preview) return preview;
  if (!config.experiments?.[name]) return 'B';
  try {
    let value = localStorage.getItem('aviator.ab.' + name);
    if (value !== 'A' && value !== 'B') { value = Math.random() < 0.5 ? 'A' : 'B'; localStorage.setItem('aviator.ab.' + name, value); }
    return value;
  } catch { return 'B'; }
}
const homeVariant = variant('home');
// Пока идёт эксперимент, вариант попадает в метку перехода: led-trip-tickets-b.
const testVariant = config.experiments?.home ? homeVariant.toLowerCase() : '';
const inRegion = (region, country) => region === 'any' || (region === 'usa' ? country === 'US' : region === 'russia' ? country === 'RU' : EUROPE.has(country));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

// --- состояние ---
const state = {
  query: { origin: 'SVO', originCity: 'MOW', destination: null, destinationCity: null, region: 'any', exact: false, month: defaultMonth(DEFAULT_ZONE), departure: null, returning: null, weekend: false, budget: 25000, direct: false },
  labels: { origin: 'Москва · все аэропорты', destination: null },
  performed: null, performedLabels: null, performedSummary: null, performedLabel: '', status: 'idle', error: '', result: null,
  // Новичок спрашивает «куда», поэтому по умолчанию один лучший вариант на город; «Все» показывает каждую дату и рейс.
  filters: { cheap: false, direct: false, noLeave: false, comfy: false, near: false, russia: false, unique: true }, length: 'any', sort: 'price', limit: PAGE,
  airports: null, cities: null, byIata: new Map(), photos: new Set(), guides: {}, hotels: {}, view: 'results', favs: readFavs(), pickerTarget: 'origin', shown: new Map(), detail: null, backFrom: null, nudged: new Set(),
};
let request = null;
// Избранное прежних версий читается как есть; битая запись не ломает страницу.
function readFavs() {
  try {
    const list = JSON.parse(localStorage.getItem('aviator.favorites') ?? '[]');
    return new Map((Array.isArray(list) ? list : []).filter((offer) => offer?.id && offer.departure_at && offer.return_at && Number.isFinite(offer.price_minor)).map((offer) => [offer.id, offer]));
  } catch { return new Map(); }
}
const originZone = () => state.byIata.get(state.query.origin)?.timezone || DEFAULT_ZONE;

// --- варианты ---
const factCache = new WeakMap();
function facts(offer) {
  if (factCache.has(offer)) return factCache.get(offer);
  const dep = new Date(offer.departure_at), ret = new Date(offer.return_at);
  // Прилёт рассчитан по длительности перелёта; неизвестная или нулевая длительность — прилёт неизвестен.
  const arr = offer.duration_to > 0 ? new Date(dep.getTime() + offer.duration_to * 60000) : null;
  const home = offer.duration_back > 0 ? new Date(ret.getTime() + offer.duration_back * 60000) : null;
  const stay = arr && ret > arr ? (ret - arr) / 3600000 : null;
  const value = {
    dep, ret, arr, home, stay, cost: stay ? Math.ceil(offer.price_minor / stay) : null,
    out: zoned(dep, offer.origin_timezone), homeZone: home ? zoned(home, offer.origin_timezone) : null,
    direct: offer.transfers === 0 && offer.return_transfers === 0,
    flight: offer.duration_to > 0 && offer.duration_back > 0 ? offer.duration_to + offer.duration_back : Infinity,
  };
  value.back = zoned(ret, offer.destination_timezone);
  value.days = Math.round((Date.parse(value.back.key) - Date.parse(value.out.key)) / 86400000);
  factCache.set(offer, value);
  return value;
}
function accepts(offer) {
  const f = state.filters, x = facts(offer);
  if (x.dep <= Date.now()) return false;
  if (f.direct && !x.direct) return false;
  if (f.cheap && offer.price_minor > 2000000) return false;
  if (f.russia && offer.country_code !== 'RU') return false;
  // Удобное время: оба вылета с 06:00 до 22:59 местного. В пути до 3 ч: каждое плечо известно и не дольше трёх часов.
  if (f.comfy && (x.out.hour < 6 || x.out.hour > 22 || x.back.hour < 6 || x.back.hour > 22)) return false;
  if (f.near && !(offer.duration_to > 0 && offer.duration_to <= 180 && offer.duration_back > 0 && offer.duration_back <= 180)) return false;
  const days = x.days, length = state.length;
  if (length !== 'any' && !(length === 'short' ? days <= 2 : length === 'mid' ? days >= 3 && days <= 4 : length === 'week' ? days >= 5 && days <= 7 : days > 7)) return false;
  if (f.noLeave) {
    const departureOK = (x.out.weekday === 6 && x.out.hour >= 18) || x.out.weekday === 7;
    const returnOK = x.homeZone && (x.homeZone.weekday === 1 || (x.homeZone.weekday === 2 && x.homeZone.hour < 9));
    if (!departureOK || !returnOK) return false;
  }
  return true;
}
function sortKey(offer) {
  const x = facts(offer);
  switch (state.sort) {
    case 'priceDescending': return -offer.price_minor;
    case 'departure': return x.dep.getTime();
    case 'duration': return x.flight;
    case 'stay': return x.stay == null ? Infinity : -x.stay;
    case 'value': return x.stay == null ? Infinity : offer.price_minor / x.stay;
    case 'flightRating': return offer.trip_rating?.preliminary_score == null ? Infinity : -offer.trip_rating.preliminary_score;
    default: return offer.price_minor;
  }
}
function visibleOffers() {
  const seen = new Set();
  return (state.result?.offers ?? []).filter(accepts).sort((a, b) => {
    const av = sortKey(a), bv = sortKey(b);
    if (av !== bv) return av < bv ? -1 : 1;
    if (a.price_minor !== b.price_minor) return a.price_minor - b.price_minor;
    if (a.city_code !== b.city_code) return a.city_code < b.city_code ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }).filter((offer) => !state.filters.unique || (!seen.has(offer.city_code) && seen.add(offer.city_code)));
}
const airlineLabel = (offer) => offer.airline_name || offer.airline || 'Авиакомпания не указана';
const stayLabel = (offer) => { const days = facts(offer).days; return days > 0 ? nightsLabel(days) : 'в тот же день'; };
// «Дольше — дешевле»: сервер нашёл поездку в тот же день с возвращением на 1–4 дня позже и дешевле.
// Подаётся как факт с оговоркой: жильё на лишние ночи в цену не входит.
function longer(offer) {
  const trip = state.result?.longer?.[offer.id];
  if (!trip) return null;
  const x = facts(offer), y = facts(trip), zone = offer.destination_timezone;
  const days = Math.round((Date.parse(zoned(y.ret, zone).key) - Date.parse(zoned(x.ret, zone).key)) / 86400000);
  return { trip, days, saving: offer.price_minor - trip.price_minor, sameFlight: y.dep.getTime() === x.dep.getTime() };
}
// Жильё: поиск отелей Aviasales по городу, заезд в день прилёта, выезд в день обратного вылета.
// Только для городов с известным номером отелей Aviasales (data/hotel-locations.json).
function lodging(offer, block) {
  const location = state.hotels[offer.city_code], x = facts(offer), zone = offer.destination_timezone;
  if (!location || x.dep <= Date.now()) return null;
  const checkin = zoned(x.arr ?? x.dep, zone).key, checkout = zoned(x.ret, zone).key;
  const nights = Math.round((Date.parse(checkout) - Date.parse(checkin)) / 86400000);
  if (nights < 1) return null;
  const url = `https://www.aviasales.ru/hotels/search?location_id=${location}&location_type=city&checkin=${checkin}&checkout=${checkout}&adults=1`;
  const link = partnerLink(url, { kind: 'hotels', city: offer.city_code, page: 'trip', block, variant: testVariant });
  const day = (key) => new Date(key + 'T00:00:00Z');
  return link && { link, block, nights, dates: fmtRange(day(checkin), day(checkout), 'UTC', 'UTC') };
}
// «Дешевле в соседние дни»: тот же город и длина поездки, вылет на 1–3 дня раньше или позже,
// дешевле минимум на 5 % и 300 ₽, пересадок не больше. Из уже найденных вариантов.
function shifted(offer) {
  const x = facts(offer), fewer = (a, b) => b == null || (a != null && a <= b);
  let best = null;
  for (const other of state.result?.offers ?? []) {
    const y = facts(other), shift = Math.round((Date.parse(y.out.key) - Date.parse(x.out.key)) / 86400000);
    if (other.city_code !== offer.city_code || y.days !== x.days || !shift || Math.abs(shift) > 3 || y.dep <= Date.now()) continue;
    if (offer.price_minor - other.price_minor < Math.max(30000, offer.price_minor * 0.05)) continue;
    if (!fewer(other.transfers, offer.transfers) || !fewer(other.return_transfers, offer.return_transfers)) continue;
    if (!best || other.price_minor < best.trip.price_minor) best = { trip: other, shift, saving: offer.price_minor - other.price_minor };
  }
  return best;
}
// «За эти же деньги»: до трёх других городов, чей лучший видимый вариант в пределах 15 % от этой цены.
function similar(offer) {
  const seen = new Set([offer.city_code]);
  return (state.result?.offers ?? []).filter(accepts)
    .filter((other) => Math.abs(other.price_minor - offer.price_minor) <= offer.price_minor * 0.15)
    .sort((a, b) => a.price_minor - b.price_minor)
    .filter((other) => !seen.has(other.city_code) && seen.add(other.city_code)).slice(0, 3);
}
// Фото: в узкие места — уменьшенная копия (photos/s/, до 480 px), в широкие — исходный файл.
function photo(code, extra = '', sizes = '(min-width: 900px) 270px, calc(100vw - 48px)') {
  const img = state.photos.has(code)
    ? `<img src="/photos/s/${esc(code)}.jpg" srcset="/photos/s/${esc(code)}.jpg 480w, /photos/${esc(code)}.jpg 720w" sizes="${sizes}" alt="" loading="lazy" decoding="async">`
    : icon('plane');
  return `<div class="photo">${img}${extra}</div>`;
}
// Билеты: только HTTPS-поиск Aviasales и только через /go (links.js).
const handoff = (offer) => partnerLink(offer.search_url, { kind: 'tickets', city: offer.city_code, page: 'trip', block: 'tickets', variant: testVariant });
const receivedLabel = (iso) => { const date = new Date(iso); return `${fmtDay(date, localZone)}, ${fmtTime(date, localZone)}`; };

const favButton = (offer) => `<button type="button" class="fav" data-fav="${esc(offer.id)}" aria-pressed="${state.favs.has(offer.id)}" aria-label="В избранное: ${esc(offer.city)}">${icon('heart')}</button>`;
// Карточка отвечает на три вопроса: куда, сколько, когда. Время рейсов и подробности — в карточке поездки.
function offerCard(offer) {
  const x = facts(offer), hint = longer(offer), guide = state.guides[offer.city_code];
  return `<article class="offer">
    <div class="stamp">${photo(offer.city_code, favButton(offer))}</div>
    <div class="offer-body">
      <div class="offer-head">
        <h3 class="offer-city"><button type="button" class="offer-open" data-offer="${esc(offer.id)}">${esc(offer.city)}</button></h3>
        <span class="offer-price">${esc(fmtMoney(offer.price_minor))}</span>
      </div>
      <p class="offer-dates">${esc(fmtRange(x.dep, x.ret, offer.origin_timezone, offer.destination_timezone))} · ${esc(stayLabel(offer))}</p>
      <p class="offer-meta">${x.direct ? 'прямые' : 'с пересадками'} · ${esc(airlineLabel(offer))}</p>
      ${guide ? `<p class="offer-about">${esc(guide.summary)}</p>` : ''}
      ${hint ? `<p class="offer-hint">+${esc(daysLabel(hint.days))} на месте — на ${esc(fmtMoney(hint.saving))} дешевле</p>` : ''}
    </div>
  </article>`;
}

// Избранное хранится только в этом браузере: целые варианты, новые в конце, не больше 30.
function saveFavs() { try { localStorage.setItem('aviator.favorites', JSON.stringify([...state.favs.values()])); } catch { /* частный режим: до конца визита */ } }
function toggleFav(id) {
  const offer = state.favs.get(id) ?? state.shown.get(id) ?? (state.detail?.id === id ? state.detail : null);
  if (!offer) return;
  if (state.favs.has(id)) state.favs.delete(id);
  else {
    state.favs.set(id, offer);
    if (state.favs.size > 30) state.favs.delete(state.favs.keys().next().value);
    goal('save_trip', { city: offer.city_code, nights: facts(offer).days, people: 1 });
  }
  saveFavs();
  for (const button of document.querySelectorAll('[data-fav]')) if (button.dataset.fav === id) button.setAttribute('aria-pressed', String(state.favs.has(id)));
  if (state.view === 'fav') renderResults();
  else if ($('favCount')) $('favCount').textContent = state.favs.size;
}
function compareTable(offers) {
  const cheapest = Math.min(...offers.map((offer) => offer.price_minor));
  const row = (title, cell) => `<tr><th scope="row">${title}</th>${offers.map((offer) => `<td>${cell(offer, facts(offer))}</td>`).join('')}</tr>`;
  return `<div class="compare"><table>
    <thead><tr><td></td>${offers.map((offer) => `<th scope="col">${esc(offer.city)}</th>`).join('')}</tr></thead>
    <tbody>
      ${row('Цена', (offer) => `<b class="${offer.price_minor === cheapest ? 'best' : ''}">${esc(fmtMoney(offer.price_minor))}</b>`)}
      ${row('Даты', (offer, x) => esc(fmtRange(x.dep, x.ret, offer.origin_timezone, offer.destination_timezone)))}
      ${row('На месте', (offer, x) => x.stay ? `≈ ${Math.floor(x.stay)} ч` : '—')}
      ${row('Час поездки', (offer, x) => x.stay ? esc(fmtMoney(x.cost)) : '—')}
      ${row('В пути', (offer, x) => Number.isFinite(x.flight) ? esc(duration(x.flight)) : '—')}
      ${row('Пересадки', (offer, x) => x.direct ? 'Прямые' : 'Есть')}
      ${row('Авиакомпания', (offer) => esc(airlineLabel(offer)))}
    </tbody></table></div>`;
}
function renderFavorites() {
  const section = $('results'), offers = [...state.favs.values()].filter((offer) => facts(offer).dep > Date.now()).reverse();
  state.shown = new Map(offers.map((offer) => [offer.id, offer]));
  section.hidden = false;
  section.innerHTML = `<div class="results-head"><h2>Избранное</h2><button type="button" class="chip" data-action="results">${icon('arrow-left')}К вариантам</button></div>
    ${offers.length > 1 ? `<p class="caption">Сравнение${offers.length > 4 ? ' первых четырёх' : ''} поездок. Самая низкая цена выделена.</p>${compareTable(offers.slice(0, 4))}` : ''}
    ${offers.length ? `<div class="grid">${offers.map(offerCard).join('')}</div><p class="caption">Избранное хранится только в этом браузере. Цены — на момент добавления; актуальную покажет Aviasales.</p>`
      : statusPanel('heart', 'Пока пусто', 'Нажмите на сердечко на карточке поездки — она появится здесь, и поездки можно будет сравнить.')}`;
}

function statusPanel(symbol, title, message) {
  return `<div class="status">${icon(symbol)}<h3>${esc(title)}</h3><p>${esc(message)}</p></div>`;
}
const action = (name, title, primary = true) => `<button type="button" class="${primary ? 'btn-primary' : 'btn-inline'}" data-action="${name}">${esc(title)}</button>`;

function renderResults() {
  if (state.view === 'fav') { renderFavorites(); return; }
  const section = $('results'), q = state.performed;
  section.hidden = state.status === 'idle';
  $('searchButton').disabled = state.status === 'loading';
  // Первый экран не загрузился сам — выдачи нет, остаётся форма.
  if (!q || state.status === 'idle') return;
  let body = '', title = 'Варианты', tools = '';
  const announce = (text) => { $('resultsStatus').textContent = text; };
  if (state.status === 'loading') {
    // Заготовки карточек: страница держит форму, пока грузятся цены.
    body = `<div class="grid" aria-hidden="true">${'<div class="offer skeleton"><div class="stamp"><div class="photo"></div></div><div class="offer-body"><i></i><i></i><i></i></div></div>'.repeat(4)}</div>`;
    announce('Ищем варианты поездки');
  } else if (state.status === 'error') {
    body = statusPanel('alert', 'Поиск не завершён', state.error) + `<div class="status-actions">${action('retry', 'Попробовать ещё раз')}</div>`;
    announce('Поиск не завершён. ' + state.error);
  } else if (state.status === 'offline') {
    body = statusPanel('offline', 'Нет связи', 'Не удалось связаться с сервером. Проверьте подключение.') + `<div class="status-actions">${action('retry', 'Повторить поиск')}</div>`;
    announce('Нет связи с сервером');
  } else {
    const offers = visibleOffers(), active = Object.values(state.filters).some(Boolean) || state.length !== 'any';
    // «Один вариант на город» ничего не прячет целиком, поэтому пустую выдачу объясняют только остальные фильтры.
    const hiding = Object.entries(state.filters).some(([name, on]) => on && name !== 'unique') || state.length !== 'any';
    state.shown = new Map(offers.map((offer) => [offer.id, offer]));
    title = countLabel(offers.length);
    announce(offers.length ? `Найдено: ${countLabel(offers.length)}` : 'Подходящих вариантов нет');
    const chips = `<button type="button" class="chip" data-chip="all" aria-pressed="${!active}">Все</button>` + Object.entries(CHIPS)
      .filter(([name]) => name !== 'russia' || q.region === 'any')
      .map(([name, title]) => `<button type="button" class="chip" data-chip="${name}" aria-pressed="${state.filters[name]}">${title}</button>`).join('');
    const menu = (id, label, options, value) => `<select class="menu menu--plain" id="${id}" aria-label="${label}">${Object.entries(options).map(([name, title]) => `<option value="${name}" ${value === name ? 'selected' : ''}>${title}</option>`).join('')}</select>`;
    tools = `<div class="sort-menus">${menu('sort', 'Сортировка', SORTS, state.sort)}${menu('length', 'Длительность поездки', LENGTHS, state.length)}</div>`;
    body = `<p class="source"><span class="summary">${esc(state.performedLabel)}. </span>Цены Aviasales на ${esc(receivedLabel(state.result.received_at ?? new Date().toISOString()))} · туда и обратно на одного · <a href="/how-we-count.html">Как мы считаем</a></p>
      <div class="chips" role="group" aria-label="Быстрые фильтры">${chips}</div>
      ${state.sort === 'flightRating' ? '<p class="caption">Оценка перелёта — цена и дорога, 0–100. Варианты без оценки идут в конце.</p>' : ''}
      ${state.sort === 'stay' || state.sort === 'value' ? '<p class="caption">Время на месте — от расчётного прилёта до обратного вылета, включая ночи.</p>' : ''}
      ${state.result.incomplete ? `<p class="caption">Источник вернул часть вариантов, выдача может быть неполной.</p>${state.result.warnings.map((text) => `<p class="caption">${esc(text)}</p>`).join('')}` : ''}`;
    if (!offers.length) {
      if (hiding) {
        body += statusPanel('send', 'Пока без вариантов', 'Фильтры скрыли все найденные варианты. Сбросьте их, чтобы увидеть результаты поиска.')
          + `<div class="status-actions">${action('resetFilters', 'Сбросить фильтры')}</div>`;
      } else {
        body += statusPanel('send', 'Пока без вариантов', 'В найденных ценах нет поездок под эти даты и бюджет. Это не значит, что билетов нет. Увеличьте бюджет или выберите другой месяц.' + (q.direct ? ' Или разрешите пересадки.' : ''))
          + `<div class="status-actions">
            ${!q.exact && q.weekend ? action('allTrips', 'Показать не только короткие выходные') : ''}
            ${q.budget < 500000 ? action('moreBudget', 'Увеличить бюджет на 10 000 ₽') : ''}
            ${q.direct ? action('allowTransfers', 'Разрешить пересадки') : ''}
            ${action('edit', 'Изменить даты и направление', false)}
          </div>`;
      }
    } else {
      body += `<div class="grid">${offers.slice(0, state.limit).map(offerCard).join('')}</div>`
        + (state.limit < offers.length ? `<div class="status-actions">${action('more', `Ещё варианты · ${offers.length - state.limit}`)}</div>` : '');
    }
  }
  section.innerHTML = `<div class="results-head"><h2>${esc(title)}</h2>${tools}<button type="button" class="chip chip--fav" data-action="favorites">${icon('heart')}Избранное · <span id="favCount">${state.favs.size}</span></button></div>${body}`;
}

function endpoint(date, estimated, zone, city, airport, code) {
  return `<div class="endpoint">
    <div class="endpoint-time"><b>${date ? (estimated ? '≈ ' : '') + esc(fmtTime(date, zone)) : '—'}</b><span class="caption">${date ? esc(fmtDay(date, zone, true)) : 'время не указано'}</span></div>
    <div class="endpoint-place"><b>${esc(city)}</b><span>${esc(airport)}, ${esc(code)}</span></div>
  </div>`;
}
function routeCard(offer, outbound) {
  const x = facts(offer), transfers = outbound ? offer.transfers : offer.return_transfers, minutes = outbound ? offer.duration_to : offer.duration_back;
  const from = outbound ? offer.origin_city : offer.city, to = outbound ? offer.city : offer.origin_city;
  return `<section class="card route">
    <div class="route-head"><h3>${icon(outbound ? 'takeoff' : 'landing')}${outbound ? 'Туда' : 'Обратно'}</h3>${minutes ? `<span class="caption">${esc(duration(minutes))} в пути</span>` : ''}</div>
    ${outbound
      ? endpoint(x.dep, false, offer.origin_timezone, from, offer.origin_name, offer.origin_airport) + endpoint(x.arr, true, offer.destination_timezone, to, offer.destination_name, offer.destination_airport)
      : endpoint(x.ret, false, offer.destination_timezone, from, offer.destination_name, offer.destination_airport) + endpoint(x.home, true, offer.origin_timezone, to, offer.origin_name, offer.origin_airport)}
    <p class="route-note">${icon(transfers === 0 ? 'check' : 'swap')}<span>${transfers == null ? 'Пересадки неизвестны' : transfers === 0 ? 'Без пересадок' : `Пересадок: ${esc(transfers)}. Где и сколько ждать, смотрите на Aviasales`}${outbound ? ` · ${esc(airlineLabel(offer))}${offer.flight_number ? `, рейс ${esc(offer.flight_number)}` : ''}` : ''}</span></p>
  </section>`;
}
// Редакционные заметки о городах из приложения (backend/app/city_guides.json); только где они есть.
function guideBlock(code) {
  const guide = state.guides[code];
  if (!guide) return '';
  const list = (items) => `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
  const link = /^https:\/\//.test(guide.tourism_url ?? '') ? guide.tourism_url : null;
  return `<section class="card guide">
    <h3>О городе</h3>
    <p>${esc(guide.summary)}</p>
    <div class="tags">${guide.tags.filter((tag) => TAGS[tag]).map((tag) => `<span class="tag">${TAGS[tag]}</span>`).join('')}</div>
    <h4>Идеи прогулок</h4>${list(guide.places)}
    <h4>Районы</h4>${list(guide.areas)}
    <p class="caption">${esc(guide.days)}. Заметки редакции от ${esc(fmtDate(new Date(guide.editorial_updated + 'T00:00:00Z'), 'UTC'))}.</p>
    ${link ? `<a class="btn-inline" href="${esc(link)}" target="_blank" rel="noopener">Официальный туристический портал</a>` : ''}
  </section>`;
}
function hotelBlock(offer, hotel) {
  return `<section class="card lodging">
    <h3>${icon('bed')}Где жить</h3>
    <p>${esc(offer.city)} · ${esc(hotel.dates)} · ${esc(nightsLabel(hotel.nights))} · один взрослый</p>
    <a class="btn-inline" href="${esc(hotel.link)}" target="_blank" rel="noopener" data-partner="aviasales" data-block="${hotel.block}">Отели на эти даты на Aviasales ${icon('arrow-right')}</a>
    ${adMark('aviasales')}
  </section>`;
}
function openDetail(offer) {
  const x = facts(offer), past = x.dep <= Date.now(), link = past ? null : handoff(offer), hint = past ? null : longer(offer), hotel = lodging(offer, 'hotel');
  const alike = past ? [] : similar(offer), nearby = past ? null : shifted(offer);
  state.detail = offer; state.alike = new Map(alike.map((other) => [other.id, other]));
  $('detailTitle').textContent = offer.city;
  $('detailBody').innerHTML = `<div class="detail">
    <div class="stamp stamp--wide">${photo(offer.city_code, favButton(offer), '(min-width: 700px) 640px, 100vw')}</div>
    <div class="detail-head"><h2>${esc(offer.city)}</h2><p class="caption">${esc(offer.country ?? '')}</p></div>
    ${past ? '<p class="caption">Даты прошли. Выполните новый поиск.</p>' : ''}
    <article class="pass">
      <div class="pass-main">
        <div class="codes"><span>${esc(offer.origin_airport)}</span><span class="flight">${icon('plane')}</span><span>${esc(offer.destination_airport)}</span></div>
        <div class="cities"><span>${esc(offer.origin_city)}</span><span>${esc(offer.city)}</span></div>
        <div class="legs">
          <span><small>Туда</small><b>${esc(fmtDay(x.dep, offer.origin_timezone, true))}</b><b>${esc(fmtTime(x.dep, offer.origin_timezone))}</b></span>
          <span><small>Обратно</small><b>${esc(fmtDay(x.ret, offer.destination_timezone, true))}</b><b>${esc(fmtTime(x.ret, offer.destination_timezone))}</b></span>
          <span><small>На месте</small><b>${esc(stayLabel(offer))}</b></span>
        </div>
      </div>
      <div class="pass-stub">
        <p class="pass-price">${esc(fmtMoney(offer.price_minor))}</p>
        <p class="caption">билеты туда и обратно на одного · цена Aviasales на ${esc(receivedLabel(offer.received_at))} · <a href="/how-we-count.html">как мы считаем</a></p>
      </div>
    </article>
    ${hint ? `<section class="idea">
      <h3>Дольше — дешевле</h3>
      <p>Если вернуться ${esc(fmtDay(facts(hint.trip).ret, offer.destination_timezone, true))}, билеты будут на <b>${esc(fmtMoney(hint.saving))} дешевле</b>, а на месте — на ${esc(daysLabel(hint.days))} больше.</p>
      <p class="caption">${hint.sameFlight ? 'Туда тот же рейс' : `Вылет в тот же день, в ${esc(fmtTime(facts(hint.trip).dep, offer.origin_timezone))}`}. Жильё и еда на лишние дни — отдельно.</p>
      <button type="button" class="btn-inline" data-longer>Посмотреть · ${esc(fmtMoney(hint.trip.price_minor))}</button>
    </section>` : ''}
    ${nearby ? `<section class="idea">
      <h3>Дешевле в соседние дни</h3>
      <p>Вылет ${esc(fmtDay(facts(nearby.trip).dep, offer.origin_timezone, true))} — на ${esc(daysLabel(Math.abs(nearby.shift)))} ${nearby.shift < 0 ? 'раньше' : 'позже'} — и билеты на <b>${esc(fmtMoney(nearby.saving))} дешевле</b>. Поездка той же длины.</p>
      <button type="button" class="btn-inline" data-shifted>Посмотреть · ${esc(fmtMoney(nearby.trip.price_minor))}</button>
    </section>` : ''}
    ${guideBlock(offer.city_code)}
    ${routeCard(offer, true)}
    ${routeCard(offer, false)}
    ${x.stay ? `<section class="card stay">
      <h3>${icon('sun')}Время на месте</h3>
      <p><b>≈ ${Math.floor(x.stay)} ч</b> · ${esc(fmtMoney(x.cost))} за час поездки</p>
      <p class="caption">От расчётного прилёта до обратного вылета, включая ночи.</p>
    </section>` : ''}
    ${hotel ? hotelBlock(offer, hotel) : ''}
    ${alike.length ? `<section class="card alike">
      <h3>За эти же деньги</h3>
      ${alike.map((other) => `<button type="button" class="alike-row" data-similar="${esc(other.id)}">
        <span><b>${esc(other.city)}</b><span class="caption">${esc(fmtRange(facts(other).dep, facts(other).ret, other.origin_timezone, other.destination_timezone))}</span></span>
        <b class="alike-price">${esc(fmtMoney(other.price_minor))}</b>
      </button>`).join('')}
    </section>` : ''}
    <p class="trust">${icon('shield')}<span>Aviasales откроется в новой вкладке. Покупка и оплата — там; мы не просим данные карты и паспорта. <a href="/how-we-earn.html">Как мы зарабатываем</a></span></p>
    <div class="detail-cta">
      ${!link && !past ? '<p class="caption">Не удалось сформировать безопасную ссылку.</p>' : ''}
      ${link ? `${adMark('aviasales')}<a class="btn-primary" href="${esc(link)}" target="_blank" rel="noopener" data-partner="aviasales" data-block="tickets">Проверить цену на Aviasales ${icon('arrow-right')}</a>` : `<span class="btn-primary" aria-disabled="true">Проверить цену на Aviasales</span>`}
    </div>
  </div>`;
  $('detailBody').scrollTop = 0;
  if (!$('detail').open) $('detail').showModal();
  // У поездки свой адрес: «Назад» закрывает карточку, а ссылкой можно поделиться.
  const hash = `?${toParams(state.performed ?? state.query)}#trip=${offer.id}`;
  if (history.state?.trip) history.replaceState({ trip: offer.id }, '', hash); else history.pushState({ trip: offer.id }, '', hash);
  $('share').textContent = 'Поделиться';
  goal('view_city', { city: offer.city_code, from: offer.origin_city_code, page: 'trip' });
}
// Один заметный переход на сайте: фото карточки раскрывается в карточку поездки (View Transitions).
// Без поддержки браузера или при «уменьшить движение» карточка просто открывается.
let opening = null;
function openFromCard(offer, card) {
  if (opening) return;
  const picture = card?.querySelector('.photo');
  if (!document.startViewTransition || reduceMotion.matches || !picture || $('detail').open) { openDetail(offer); return; }
  picture.style.viewTransitionName = 'trip-photo';
  opening = document.startViewTransition(() => { picture.style.viewTransitionName = ''; openDetail(offer); });
  // Пропущенный переход — не ошибка: карточка всё равно открывается.
  opening.ready.catch(() => {});
  opening.finished.catch(() => {}).finally(() => { opening = null; });
}
async function shareTrip() {
  const offer = state.detail;
  if (!offer) return;
  const url = location.href, title = `${offer.city} за ${fmtMoney(offer.price_minor)} туда-обратно`;
  goal('share', { city: offer.city_code });
  if (navigator.share) {
    try { await navigator.share({ title, text: title, url }); return; } catch (error) { if (error.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); $('share').textContent = 'Ссылка скопирована'; } catch { $('share').textContent = 'Скопируйте адрес страницы'; }
}
// Ссылка на поездку: когда её поиск загрузился, открыть эту поездку (если рейс ещё есть в ответе).
function openLinked(id) {
  const offer = state.result?.offers.find((other) => other.id === id);
  if (offer) openDetail(offer);
}

// --- форма ---
function renderForm() {
  const q = state.query, zone = originZone(), list = months(zone), today = zoned(new Date(), zone).key;
  if (!q.exact && !list.includes(q.month)) q.month = list[0];
  $('originLabel').textContent = state.labels.origin;
  const city = q.originCity ?? state.byIata.get(q.origin)?.city_code;
  $('originTitle').innerHTML = `${FROM[city] ? `из&nbsp;${esc(FROM[city])}` : esc(state.labels.origin.split(' · ')[0])}${icon('chevron-down')}`;
  $('destinationLabel').textContent = state.labels.destination ?? (CITY_REGIONS.has(q.region) ? 'Все основные города' : 'Любой город');
  $('destinationClear').hidden = !q.destination;
  $('region').value = q.region;
  $('regionHint').hidden = !CITY_REGIONS.has(q.region);
  document.querySelector(`input[name="dateMode"][value="${q.exact ? 'exact' : 'month'}"]`).checked = true;
  $('monthFields').hidden = q.exact;
  $('exactFields').hidden = !q.exact;
  $('month').innerHTML = list.map((month) => `<option value="${month}">${esc(monthLabel(month))}</option>`).join('');
  $('month').value = q.exact ? list[0] : q.month;
  $('weekendOnly').checked = q.weekend;
  if (q.exact) {
    const last = addDays(list[5].slice(0, 7) + '-01', 31).slice(0, 7) + '-01';
    $('departureDate').min = today; $('departureDate').max = addDays(last, -1); $('departureDate').value = q.departure;
    $('returnDate').min = addDays(q.departure, 1); $('returnDate').max = addDays(q.departure, 60); $('returnDate').value = q.returning;
  }
  $('budget').value = q.budget;
  $('budget').style.setProperty('--fill-to', `${((q.budget - 5000) / 495000) * 100}%`);
  $('budgetValue').textContent = fmtMoney(q.budget * 100);
  $('directOnly').checked = q.direct;
}
function setExact(enabled) {
  const q = state.query;
  q.exact = enabled;
  if (enabled) {
    q.departure = addDays(zoned(new Date(), originZone()).key, 1);
    q.returning = addDays(q.departure, 2);
    q.month = q.departure.slice(0, 7);
  } else { q.departure = q.returning = null; }
}
function setDeparture(key) {
  const q = state.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
  q.departure = key; q.month = key.slice(0, 7);
  const lower = addDays(key, 1), upper = addDays(key, 60);
  q.returning = !q.returning || q.returning < lower ? lower : q.returning > upper ? upper : q.returning;
}
function summary(q) {
  const day = (key) => fmtDay(new Date(key + 'T00:00:00Z'), 'UTC');
  const dates = q.exact ? `${day(q.departure)} – ${day(q.returning)}` : monthLabel(q.month);
  // Свёрнутая форма: код города вылета, куда и когда — как на талоне.
  return { code: q.originCity ?? q.origin, route: state.labels.destination ?? REGIONS[q.region], details: `${dates} · до ${fmtMoney(q.budget * 100)}` };
}
// Телефон: когда пошёл поиск, форма сворачивается в строку, чтобы первые карточки были на первом экране.
// Класс меняет раскладку только уже 900 px; на широком экране форма видна целиком.
function collapseForm(collapsed) {
  $('search').classList.toggle('search--collapsed', collapsed);
  $('searchSummary').setAttribute('aria-expanded', String(!collapsed));
  if (collapsed && state.performedSummary) {
    $('summaryCode').textContent = state.performedSummary.code;
    $('summaryRoute').textContent = state.performedSummary.route;
    $('summaryDetails').textContent = state.performedSummary.details;
  }
}

// --- поиск ---
// Адрес страницы и запрос поиска используют одни параметры (/api/v1/search/web).
function toParams(q) {
  const params = new URLSearchParams({ from: q.origin, budget: q.budget });
  if (q.originCity) params.set('fc', q.originCity);
  if (q.destination) params.set('to', q.destination);
  if (q.destinationCity) params.set('tc', q.destinationCity);
  if (q.region !== 'any') params.set('region', q.region);
  if (q.exact) { params.set('dep', q.departure); params.set('ret', q.returning); } else { params.set('month', q.month); if (!q.weekend) params.set('weekend', '0'); }
  if (q.direct) params.set('direct', '1');
  return params;
}
// auto: первый экран сам загружает поиск по умолчанию; если не вышло, остаётся просто форма.
async function search({ scroll = true, auto = false } = {}) {
  request?.abort();
  request = new AbortController();
  const q = { ...state.query }, signal = request.signal, label = summary(q);
  Object.assign(state, { performed: q, performedLabels: { ...state.labels }, performedSummary: label, performedLabel: `${state.labels.origin} → ${state.labels.destination ?? REGIONS[q.region]} · ${label.details}`, status: 'loading', limit: PAGE, view: 'results' });
  if (!auto) { history.replaceState(null, '', '?' + toParams(q)); goal('search', { from: q.originCity ?? q.origin, region: q.region }); }
  collapseForm(true);
  renderResults();
  if (scroll) $('results').scrollIntoView({ block: 'start' });
  try {
    // GET с параметрами страницы: повторные запросы (прежде всего первый экран) отвечает CDN, не трогая поиск.
    const response = await fetch('/api/v1/search/web?' + toParams(q), { signal });
    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data?.offers)) {
      Object.assign(state, { status: auto ? 'idle' : 'error', error: data?.error?.message || 'Сервер вернул неожиданный ответ. Попробуйте позже.' });
    } else {
      Object.assign(state, { status: 'done', result: data });
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
    state.status = auto ? 'idle' : 'offline';
  }
  // Если не загрузился первый экран, остаётся форма — значит, она должна быть раскрыта.
  if (state.status === 'idle') collapseForm(false);
  renderResults();
}

// --- аэропорты ---
async function loadAirports() {
  if (state.airports) return;
  const response = await fetch('/api/v1/airports');
  if (!response.ok) throw new Error('airports');
  // Поиск принимает только трёхбуквенные латинские коды; в справочнике есть и местные кириллические.
  state.airports = (await response.json()).filter((airport) => airport.timezone && /^[A-Z]{3}$/.test(airport.iata) && /^[A-Z]{3}$/.test(airport.city_code));
  state.cities = new Map();
  for (const airport of state.airports) {
    state.byIata.set(airport.iata, airport);
    if (!state.cities.has(airport.city_code)) state.cities.set(airport.city_code, { id: airport.city_code, name: airport.city, country: airport.country, countryCode: airport.country_code, airports: [] });
    state.cities.get(airport.city_code).airports.push(airport);
  }
}
function airportLabel(iata, cityCode) {
  const airport = state.byIata.get(iata);
  if (!airport) return cityCode ?? iata;
  return cityCode ? `${airport.city} · все аэропорты` : `${airport.city} · ${airport.iata}`;
}
function pickerCities(term) {
  const region = state.pickerTarget === 'destination' ? state.query.region : 'any';
  const all = [...state.cities.values()].filter((city) => inRegion(region, city.countryCode));
  if (!term) {
    const popular = POPULAR.map((code) => state.cities.get(code)).filter((city) => city && all.includes(city));
    return popular.length ? popular : all.sort((a, b) => a.name.localeCompare(b.name, 'ru')).slice(0, 40);
  }
  const rank = (city) => city.name.toLowerCase().startsWith(term) ? 0 : city.id.toLowerCase() === term || city.airports.some((a) => a.iata.toLowerCase() === term) ? 1 : 2;
  return all.filter((city) => city.name.toLowerCase().includes(term) || city.id.toLowerCase().includes(term) || city.airports.some((a) => a.iata.toLowerCase().includes(term) || a.name.toLowerCase().includes(term)))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ru')).slice(0, 40);
}
function renderPicker() {
  const list = $('pickerList');
  if (!state.cities) { list.innerHTML = '<p class="picker-note">Загружаем справочник аэропортов…</p>'; return; }
  const cities = pickerCities($('pickerInput').value.trim().toLowerCase());
  list.innerHTML = cities.length ? cities.map((city) => `<div class="picker-city">${esc(city.name)} <span class="caption">${esc(city.country ?? '')}</span></div>`
    + (city.airports.length > 1 ? `<button type="button" class="picker-row" data-iata="${esc(city.airports[0].iata)}" data-city="${esc(city.id)}"><b>Все аэропорты города</b><span>${esc(city.airports.map((a) => a.iata).join(', '))}</span></button>` : '')
    + city.airports.map((airport) => `<button type="button" class="picker-row" data-iata="${esc(airport.iata)}"><b>${esc(airport.city)} · ${esc(airport.iata)}</b><span>${esc(airport.name)}</span></button>`).join('')).join('')
    : '<p class="picker-note">Ничего не найдено. Попробуйте название города или код аэропорта.</p>';
}
async function openPicker(target) {
  state.pickerTarget = target;
  $('pickerTitle').textContent = target === 'origin' ? 'Откуда летим' : 'Куда летим';
  $('pickerInput').value = '';
  renderPicker();
  $('picker').showModal();
  try { await loadAirports(); renderPicker(); }
  catch { $('pickerList').innerHTML = '<p class="picker-note">Не удалось загрузить справочник. Проверьте подключение и откройте список ещё раз.</p>'; }
}
function choose(iata, cityCode) {
  const q = state.query;
  if (state.pickerTarget === 'origin') {
    q.origin = iata; q.originCity = cityCode; state.labels.origin = airportLabel(iata, cityCode);
  } else {
    q.destination = iata; q.destinationCity = cityCode; state.labels.destination = airportLabel(iata, cityCode);
  }
  $('picker').close();
  renderForm();
}
function showFavorites() {
  state.view = 'fav';
  renderResults();
  $('results').scrollIntoView({ block: 'start' });
}

// --- события ---
$('originPick').addEventListener('click', () => openPicker('origin'));
$('originTitle').addEventListener('click', () => openPicker('origin'));
$('destinationPick').addEventListener('click', () => openPicker('destination'));
$('destinationClear').addEventListener('click', () => { Object.assign(state.query, { destination: null, destinationCity: null }); state.labels.destination = null; renderForm(); });
$('pickerInput').addEventListener('input', renderPicker);
$('pickerList').addEventListener('click', (event) => {
  const row = event.target.closest('[data-iata]');
  if (row) choose(row.dataset.iata, row.dataset.city ?? null);
});
$('region').addEventListener('change', (event) => {
  const q = state.query;
  q.region = event.target.value;
  if (q.destination && !inRegion(q.region, state.byIata.get(q.destination)?.country_code)) { q.destination = q.destinationCity = null; state.labels.destination = null; }
  // Региональный поиск идёт по горстке городов; только выходные оставили бы почти ничего.
  if (CITY_REGIONS.has(q.region)) q.weekend = false;
  renderForm();
});
for (const input of document.querySelectorAll('input[name="dateMode"]')) input.addEventListener('change', () => { setExact(input.value === 'exact'); renderForm(); });
$('month').addEventListener('change', (event) => { state.query.month = event.target.value; });
$('weekendOnly').addEventListener('change', (event) => { state.query.weekend = event.target.checked; });
$('departureDate').addEventListener('change', (event) => { setDeparture(event.target.value); renderForm(); });
$('returnDate').addEventListener('change', (event) => { if (event.target.value) state.query.returning = event.target.value; renderForm(); });
$('budget').addEventListener('input', (event) => { state.query.budget = +event.target.value; renderForm(); });
$('directOnly').addEventListener('change', (event) => { state.query.direct = event.target.checked; });
$('search').addEventListener('submit', (event) => { event.preventDefault(); search(); });
// Вернулся с вкладки Aviasales, а карточка поездки открыта: одна тихая строка про жильё над кнопкой, один раз на поездку.
document.addEventListener('visibilitychange', () => {
  const offer = state.detail;
  if (document.visibilityState !== 'visible' || !offer || state.backFrom !== offer.id || !$('detail').open || state.nudged.has(offer.id)) return;
  state.backFrom = null;
  const hotel = lodging(offer, 'hotelback'), cta = $('detailBody').querySelector('.detail-cta');
  if (!hotel || !cta) return;
  state.nudged.add(offer.id);
  cta.insertAdjacentHTML('afterbegin', `<div class="cta-hotel">
    <a class="cta-hotel-link" href="${esc(hotel.link)}" target="_blank" rel="noopener" data-partner="aviasales" data-block="hotelback">${icon('bed')}<span>Билеты — на Aviasales. А жильё? <b>Отели: ${esc(offer.city)}, ${esc(hotel.dates)}</b><small class="ad-mark">Реклама · Aviasales</small></span></a>
    <button type="button" class="cta-hotel-close" aria-label="Скрыть подсказку про жильё" data-hotel-close>${icon('close')}</button>
  </div>`);
});
$('share').addEventListener('click', shareTrip);
// Закрытие карточки рукой отступает на её запись в истории, один раз: сюда приходят и щелчок, и событие закрытия диалога.
let leaving = false;
function leaveTrip() { if (!leaving && history.state?.trip) { leaving = true; history.back(); } }
window.addEventListener('popstate', () => { leaving = false; if (!history.state?.trip && $('detail').open) $('detail').close(); });
window.addEventListener('hashchange', () => { if (location.hash === '#fav') showFavorites(); });
$('searchSummary').addEventListener('click', () => { collapseForm(false); $('originPick').focus(); });
$('detailBody').addEventListener('click', (event) => {
  const fav = event.target.closest('[data-fav]');
  if (fav) { toggleFav(fav.dataset.fav); return; }
  if (event.target.closest('[data-hotel-close]')) { event.target.closest('.cta-hotel').remove(); return; }
  const partner = event.target.closest('a[data-partner]');
  if (partner) {
    goal('affiliate_click', { partner: partner.dataset.partner, block: partner.dataset.block, city: state.detail?.city_code });
    if (partner.dataset.block === 'tickets') state.backFrom = state.detail?.id ?? null;
  }
  const hint = event.target.closest('[data-longer]') && longer(state.detail);
  if (hint) { goal('select_idea', { idea: 'longer' }); openDetail(hint.trip); return; }
  const nearby = event.target.closest('[data-shifted]') && shifted(state.detail);
  if (nearby) { goal('select_idea', { idea: 'shifted' }); openDetail(nearby.trip); return; }
  const other = state.alike?.get(event.target.closest('[data-similar]')?.dataset.similar);
  if (other) { goal('select_idea', { idea: 'similar' }); openDetail(other); }
});

$('results').addEventListener('click', (event) => {
  const chip = event.target.closest('[data-chip]'), act = event.target.closest('[data-action]'), open = event.target.closest('[data-offer]'), fav = event.target.closest('[data-fav]');
  if (fav) { toggleFav(fav.dataset.fav); return; }
  if (chip) {
    if (chip.dataset.chip === 'all') { for (const name of Object.keys(state.filters)) state.filters[name] = false; state.length = 'any'; }
    else {
      state.filters[chip.dataset.chip] = !state.filters[chip.dataset.chip];
      if (state.filters[chip.dataset.chip]) goal('select_idea', { idea: `filter-${chip.dataset.chip}` });
    }
    state.limit = PAGE;
    renderResults();
  } else if (act) {
    const name = act.dataset.action, q = state.query;
    if (name === 'favorites') { showFavorites(); return; }
    if (name === 'results') { state.view = 'results'; if (location.hash === '#fav') history.replaceState(history.state, '', location.pathname + location.search); renderResults(); $('results').scrollIntoView({ block: 'start' }); return; }
    if (name === 'more') { state.limit += PAGE; renderResults(); return; }
    if (name === 'resetFilters') { for (const key of Object.keys(state.filters)) state.filters[key] = false; state.length = 'any'; renderResults(); return; }
    if (name === 'edit') { collapseForm(false); $('search').scrollIntoView({ block: 'start' }); return; }
    if (name !== 'retry') { Object.assign(q, state.performed); state.labels = { ...state.performedLabels }; }
    if (name === 'moreBudget') q.budget = Math.min(500000, q.budget + 10000);
    if (name === 'allowTransfers') q.direct = false;
    if (name === 'allTrips') q.weekend = false;
    renderForm();
    search({ scroll: false });
  } else if (open && state.shown.has(open.dataset.offer)) {
    openFromCard(state.shown.get(open.dataset.offer), open.closest('.offer'));
  }
});
$('results').addEventListener('change', (event) => {
  if (event.target.id === 'sort') { state.sort = event.target.value; state.limit = PAGE; renderResults(); }
  if (event.target.id === 'length') { state.length = event.target.value; state.limit = PAGE; if (state.length !== 'any') goal('select_idea', { idea: `length-${state.length}` }); renderResults(); }
});
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', (event) => { if (event.target === dialog || event.target.closest('[data-close]')) { dialog.close(); if (dialog.id === 'detail') leaveTrip(); } });
  if (dialog.id === 'detail') dialog.addEventListener('close', () => { if (!dialog.open) leaveTrip(); });
}

// --- запуск ---
async function restore() {
  const params = new URLSearchParams(location.search), q = state.query;
  const code = (name) => /^[A-Z]{3}$/.test(params.get(name) ?? '') ? params.get(name) : null;
  const day = (name) => /^\d{4}-\d{2}-\d{2}$/.test(params.get(name) ?? '') ? params.get(name) : null;
  if (!code('from')) return false;
  try { await loadAirports(); } catch { return false; }
  if (!state.byIata.has(code('from'))) return false;
  q.origin = code('from'); q.originCity = code('fc');
  state.labels.origin = airportLabel(q.origin, q.originCity);
  if (params.get('region') in REGIONS) q.region = params.get('region');
  if (code('to') && state.byIata.has(code('to'))) { q.destination = code('to'); q.destinationCity = code('tc'); state.labels.destination = airportLabel(q.destination, q.destinationCity); }
  const budget = Number(params.get('budget'));
  if (Number.isInteger(budget) && budget >= 5000 && budget <= 500000) q.budget = budget;
  q.direct = params.get('direct') === '1';
  if (day('dep') && day('ret')) { q.exact = true; q.departure = day('dep'); q.returning = day('ret'); q.month = q.departure.slice(0, 7); }
  else { if (months(originZone()).includes(params.get('month'))) q.month = params.get('month'); q.weekend = params.get('weekend') !== '0'; }
  return true;
}
(async () => {
  renderForm();
  // Список фото меняется с каждой выкладкой; /photos/* кешируются на сутки, поэтому сам список перепроверяется.
  fetch('/photos/manifest.json', { cache: 'no-cache' }).then((response) => response.ok ? response.json() : []).then((codes) => { state.photos = new Set(codes); if (state.status === 'done') renderResults(); }).catch(() => {});
  fetch('/data/hotel-locations.json').then((response) => response.ok ? response.json() : {}).then((hotels) => { state.hotels = hotels; }).catch(() => {});
  fetch('/data/city-guides.json').then((response) => response.ok ? response.json() : {}).then((guides) => { state.guides = guides; if (state.status === 'done') renderResults(); }).catch(() => {});
  const wantFav = location.hash === '#fav';
  const restored = await restore();
  renderForm();
  // Прочитать до поиска: поиск переписывает адрес и убирает хеш.
  const linked = restored && /^#trip=([0-9a-f]{32})$/.exec(location.hash)?.[1];
  // Вариант A эксперимента — голая форма: ничего не грузится, пока посетитель не начнёт поиск.
  if (restored || homeVariant === 'B') search({ scroll: false, auto: !restored }).then(() => { if (linked && state.status === 'done') openLinked(linked); });
  if (wantFav) showFavorites();
})();

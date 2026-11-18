// Поиск поездок (главная). Правила повторяют приложение iOS (Aviator/Utilities/SearchRules.swift); источник истины — сервер.
import { $, esc, icon, adMark } from './lib/ui.js';
import { DEFAULT_ZONE, localZone, zoned, fmtDate, fmtDay, fmtTime, fmtMoney, fmtRange, monthLabel, months, defaultMonth, addDays, duration, daysLabel, nightsLabel, countLabel } from './lib/format.js';
import { snapshot, tripPath, savedTrips, firstPrompt, saveTrip, tripDates } from './lib/trip.js';
import { cityRating } from './lib/city-rating.js';
import { partnerLink } from './lib/links.js';
import { goal } from './lib/measure.js';
import { currentOrigin, saveOrigin } from './lib/origin.js';
import { priceLevel, usualKey, hotLine, leaveLine, levelNote, priceChange } from './lib/levels.js';
import { mountSky } from './lib/sky.js';
import { flightLoader } from './lib/art.js';
import { sticker, rowSticker } from './lib/stickers.js';
import { favoriteList, favoriteComparison, favoriteOptions, hoursMinutes } from './lib/favorites.js';
import { DESTINATION_SCOPES } from './lib/destination-scopes.js';

const SCOPE_TERMS = {
  russia: 'Россию России Россией',
  turkey: 'Турцию Турции Турцией',
  egypt: 'Египта Египте Египтом Египту',
  tunisia: 'Туниса Тунисе Тунисом Тунису',
  europe: 'Европу Европе Европой Европы',
  asia: 'Азию Азии Азией',
};
// Эти страны появляются только при вводе названия в поле «Куда».
const COUNTRIES_ON_INPUT = {
  thailand: ['таиланд', 'таиланда', 'таиланде', 'таиланду', 'таиландом', 'thailand'],
  uae: ['оаэ', 'эмираты', 'эмиратов', 'эмиратах', 'эмиратам', 'эмиратами',
    'объединенные арабские эмираты', 'объединенных арабских эмиратах', 'арабские эмираты',
    'uae', 'united arab emirates', 'emirates'],
};
// По умолчанию — поездки на 1–14 ночей: «туда и обратно в один день» и поездки на месяц в выдаче мешали. Предел 7 ночей — только в подборках:
// в поиске он срезал половину городов (из Москвы на декабрь — 11 вместо 25).
const LENGTHS = { any: '1–14 ночей', short: '1–2 ночи', mid: '3–4 ночи', week: '5–7 ночей', long: '8–14 ночей', more: 'Больше 14 ночей', day: 'В тот же день', all: 'Любая длина' };
const FITS = { any: (d) => d >= 1 && d <= 14, short: (d) => d >= 1 && d <= 2, mid: (d) => d >= 3 && d <= 4, week: (d) => d >= 5 && d <= 7, long: (d) => d >= 8 && d <= 14, more: (d) => d > 14, day: (d) => d === 0, all: () => true };
const SORTS = { price: 'Сначала дешевле', priceDescending: 'Сначала дороже', departure: 'Ближайший вылет', duration: 'Меньше времени в пути', stay: 'Больше времени на месте', value: 'Выгоднее час поездки', flightRating: 'По оценке перелёта' };
const CHIPS = { cheap: 'До 20 000 ₽', direct: 'Прямые', noLeave: 'Без отпуска', comfy: 'Удобное время вылета', near: 'В пути до 3 ч', russia: 'Россия', unique: 'Один вариант на город' };
const TAGS = { sea: 'Море', culture: 'Музеи и культура', food: 'Гастрономия', architecture: 'Архитектура', nature: 'Природа', nightlife: 'Вечерняя жизнь' };
const POPULAR = ['MOW', 'LED', 'SVX', 'OVB', 'KZN', 'GOJ', 'KUF', 'UFA', 'AER', 'KGD'];
// «Куда улететь из …»: родительный падеж для частых городов вылета; для остальных — «Вылет: город».
// Подписи «из Москвы» — из web/data/origins.json; для остальных городов «из города …».
const PAGE = 24; // карточек на странице выдачи
const config = window.AVIATOR ?? {};
// A/B: вариант выбирается один раз на браузер и хранится. #ab=A или #ab=B показывает вариант без записи.
function variant(name) {
  const key = name === 'home' ? 'ab' : 'tripab';
  const preview = new URLSearchParams(location.hash.slice(1)).get(key);
  if (preview === 'A' || preview === 'B') return preview;
  if (!config.experiments?.[name]) return 'B';
  try {
    let value = localStorage.getItem('aviator.ab.' + name);
    if (value !== 'A' && value !== 'B') { value = Math.random() < 0.5 ? 'A' : 'B'; localStorage.setItem('aviator.ab.' + name, value); }
    return value;
  } catch { return 'B'; }
}
const homeVariant = variant('home');
// Пока идёт эксперимент, вариант попадает в метку перехода: led-trip-tickets-b.
const afterTicket = variant('afterTicket');
const testVariant = (config.experiments?.home ? homeVariant.toLowerCase() : '')
  + (config.experiments?.afterTicket ? 'p' + afterTicket.toLowerCase() : '');
if (config.experiments?.afterTicket) goal('trip_variant', { variant: afterTicket });

// --- состояние ---
const state = {
  query: { origin: 'SVO', originCity: 'MOW', destination: null, destinationCity: null, region: 'any', exact: false, month: defaultMonth(DEFAULT_ZONE), departure: null, returning: null, weekend: false, budget: 25000, direct: false },
  labels: { origin: 'Москва · все аэропорты', destination: null },
  performed: null, performedLabels: null, performedSummary: null, performedLabel: '', status: 'idle', error: '', result: null,
  // Новичок спрашивает «куда», поэтому по умолчанию один лучший вариант на город; «Все» показывает каждую дату и рейс.
  filters: { cheap: false, direct: false, noLeave: false, comfy: false, near: false, russia: false, unique: true }, length: 'any', sort: 'price', page: 1, allRows: false,
  home: null, homeStatus: 'idle', recent: readRecent(), recentPrices: {}, recentOffers: new Map(), collection: null,
  airports: null, cities: null, byIata: new Map(), fromNames: new Map([['MOW', 'Москвы']]), cityPages: new Map(), photos: new Set(), guides: {}, hotels: {}, view: 'results', favs: readFavs(), pickerTarget: 'origin', shown: new Map(), detail: null, backFrom: null, nudged: new Set(),
};
let request = null;
// «Продолжить планирование»: последние открытые поездки — только в этом браузере, до восьми.
function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem('aviator.recent') ?? '[]');
    return (Array.isArray(list) ? list : []).filter((item) => item?.offer?.id && item.offer.departure_at && item.offer.return_at && item.offer.origin_timezone
      && item.offer.destination_timezone && Number.isFinite(item.offer.price_minor) && Number.isFinite(item.price)).slice(0, 8);
  } catch { return []; }
}
// Избранное прежних версий читается как есть; битая запись не ломает страницу.
function readFavs() {
  try {
    const list = JSON.parse(localStorage.getItem('aviator.favorites') ?? '[]');
    return new Map((Array.isArray(list) ? list : []).filter((offer) => offer?.id && Number.isFinite(Date.parse(offer.departure_at)) && Number.isFinite(Date.parse(offer.return_at)) && Number.isFinite(offer.price_minor)).map((offer) => [offer.id, offer]));
  } catch { return new Map(); }
}
const choiceKey = 'aviator.favoriteComparison';
function readChoice() {
  try {
    const ids = JSON.parse(localStorage.getItem(choiceKey));
    return Array.isArray(ids) ? [...new Set(ids)].filter(id => state.favs.has(id)).slice(0, 4) : [];
  } catch { return []; }
}
let favoriteChoice = readChoice(), removedFavorite = null;
function saveChoice(ids) {
  favoriteChoice = ids;
  try { localStorage.setItem(choiceKey, JSON.stringify(ids)); } catch { /* до конца визита */ }
}
function selectedFavorites(offers) {
  const selection = favoriteChoice.map(id => state.favs.get(id)).filter(Boolean);
  return selection.length >= 2 ? selection : offers.slice(0, 2);
}
const favoritesHash = () => location.hash === '#fav' || location.hash === '#fav/compare';
const originZone = () => state.byIata.get(state.query.origin)?.timezone || DEFAULT_ZONE;
// Два последних новых сердечка каждой ленты живут до смены города вылета или перезагрузки.
const rowPicks = new Map();
function pairOffers(key) {
  return (rowPicks.get(key) ?? []).map(id => state.favs.get(id)).filter(Boolean);
}
function pairLabel(key) {
  const [first, second] = pairOffers(key);
  if (!second) return '';
  return first.city === second.city ? `Сравнить два рейса · ${first.city}` : `Сравнить ${first.city} и ${second.city}`;
}

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
  if (f.russia && (state.view === 'collection' || state.performed?.region === 'any') && offer.country_code !== 'RU') return false;
  // Удобное время: оба вылета с 06:00 до 22:59 местного. В пути до 3 ч: каждое плечо известно и не дольше трёх часов.
  if (f.comfy && (x.out.hour < 6 || x.out.hour > 22 || x.back.hour < 6 || x.back.hour > 22)) return false;
  if (f.near && !(offer.duration_to > 0 && offer.duration_to <= 180 && offer.duration_back > 0 && offer.duration_back <= 180)) return false;
  // Точные даты посетитель выбрал сам — длина поездки по умолчанию их не прячет.
  const length = state.length === 'any' && state.performed?.exact ? 'all' : state.length;
  if (!FITS[length](x.days)) return false;
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
// Предложения вокруг открытой поездки: выдача поиска или подборки главной.
const contextOffers = () => state.view === 'results' ? state.result?.offers ?? [] : [...(state.home?.offers.values() ?? [])];
function visibleOffers(list = state.result?.offers ?? []) {
  const seen = new Set();
  return list.filter(accepts).sort((a, b) => {
    const av = sortKey(a), bv = sortKey(b);
    if (av !== bv) return av < bv ? -1 : 1;
    if (a.price_minor !== b.price_minor) return a.price_minor - b.price_minor;
    if (a.city_code !== b.city_code) return a.city_code < b.city_code ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }).filter((offer) => !state.filters.unique || (!seen.has(offer.city_code) && seen.add(offer.city_code)));
}
const airlineLabel = (offer) => offer.airline_name || offer.airline || 'Авиакомпания не указана';
// Locally bundled Aviasales marks. Keep the carrier name for all other airlines.
const carrierLogos = new Set('3F 4G 5N 6R A4 AA AF AY B2 BA D2 DL DP EK EO EW EY F7 FR FV FZ G9 H9 HY I8 IO IZ J2 J9 KC KL KV LH LO LX N4 OS PC QR R3 RT S7 SK SU SZ TK U2 U6 U9 UA UT VF WZ Y7 YC'.split(' '));
function carrier(offer) {
  const logo = carrierLogos.has(offer.airline) ? `<img width="20" height="20" loading="lazy" decoding="async" src="/airlines/${offer.airline}.png" alt="">` : '';
  return `<span class="carrier">${logo}${esc(airlineLabel(offer))}</span>`;
}

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
  for (const other of contextOffers()) {
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
  return contextOffers().filter(accepts)
    .filter((other) => Math.abs(other.price_minor - offer.price_minor) <= offer.price_minor * 0.15)
    .sort((a, b) => a.price_minor - b.price_minor)
    .filter((other) => !seen.has(other.city_code) && seen.add(other.city_code)).slice(0, 3);
}
function photoImage(code, wide) {
  const thumb = `<img src="/photos/s/${esc(code)}.webp" alt="" loading="${wide ? 'eager' : 'lazy'}" decoding="async">`;
  return wide ? thumb + `<img src="/photos/${esc(code)}.jpg" alt="" decoding="async">` : thumb;
}
function photo(code, extra = '', wide = false) {
  const pending = !state.photos.has(code);
  return `<div class="photo"${pending ? ` data-photo="${esc(code)}" data-wide="${wide}"` : ''}>${pending ? icon('plane') : photoImage(code, wide)}${extra}</div>`;
}
// Билеты: только HTTPS-поиск Aviasales и только через /go (links.js).
const handoff = (offer) => partnerLink(offer.search_url, { kind: 'tickets', city: offer.city_code, page: 'trip', block: 'tickets', variant: testVariant });
// Цена часа — до рубля: копейки здесь только шумят.
const hourCost = (x) => fmtMoney(Math.round(x.cost / 100) * 100);
const receivedLabel = (iso) => { const date = new Date(iso); return `${fmtDay(date, localZone)}, ${fmtTime(date, localZone)}`; };
const cachedPriceLabel = iso => 'Цены из кеша Aviasales' + (iso ? ` · получены ${receivedLabel(iso)}` : '');

const favButton = (offer) => `<button type="button" class="fav" data-fav="${esc(offer.id)}" aria-pressed="${state.favs.has(offer.id)}" aria-label="В избранное: ${esc(offer.city)}">${icon('heart')}</button>`;
// Карточка отвечает на три вопроса: куда, сколько, когда. Время рейсов и подробности — в карточке поездки.
function offerRating(offer) {
  const x = facts(offer), date = zoned(x.arr ?? x.dep, offer.destination_timezone);
  const query = state.view === 'results' && state.performed ? state.performed : state.query;
  const all = query.originCity === offer.origin_city_code ? query.originCity : null;
  return cityRating(offer.city_code, date, offer.origin_airport, offer.city, all);
}
function offerCard(offer) {
  const x = facts(offer), hint = longer(offer), guide = state.guides[offer.city_code];
  return `<article class="offer">
    <div class="stamp">${photo(offer.city_code, favButton(offer))}</div>
    <div class="offer-body">
      <div class="offer-head">
        <h3 class="offer-city"><button type="button" class="offer-open" data-offer="${esc(offer.id)}">${esc(offer.city)}</button></h3>
        <span class="offer-price">${esc(fmtMoney(offer.price_minor))}</span>
      </div>
      <p class="offer-dates">${esc(fmtRange(x.dep, x.ret, offer.origin_timezone, offer.destination_timezone))}, ${esc(stayLabel(offer))}</p>
      <p class="offer-meta">${x.direct ? 'прямые' : 'с пересадками'} · ${carrier(offer)}</p>
      ${levelTag(offer)}
      ${offerRating(offer)}
      ${guide ? `<p class="offer-about">${esc(guide.summary)}</p>` : ''}
      ${hint ? `<p class="offer-hint">+${esc(daysLabel(hint.days))} на месте — на ${esc(fmtMoney(hint.saving))} дешевле</p>` : ''}
    </div>
  </article>`;
}

// Избранное хранится только в этом браузере: целые варианты, новые в конце, не больше 30.
function saveFavs() { try { localStorage.setItem('aviator.favorites', JSON.stringify([...state.favs.values()])); } catch { /* частный режим: до конца визита */ } }
function toggleFav(id, rowKey) {
  const visibleOffer = rowKey ? feedOffer(rowKey, id) : state.shown.get(id);
  const offer = state.favs.get(id) ?? visibleOffer ?? (state.detail?.id === id ? state.detail : null) ?? homeOffer(id) ?? state.recentOffers.get(id);
  if (!offer) return;
  if (state.favs.has(id)) {
    if (state.view === 'fav') {
      removedFavorite = { offer, index: [...state.favs.keys()].indexOf(id), choice: favoriteChoice };
    }
    state.favs.delete(id);
  } else {
    removedFavorite = null;
    state.favs.set(id, offer);
    if (state.favs.size > 30) state.favs.delete(state.favs.keys().next().value);
    if (rowKey) rowPicks.set(rowKey, [...(rowPicks.get(rowKey) ?? []), id].slice(-2));
    goal('save_trip', { city: offer.city_code, nights: facts(offer).days, people: 1 });
  }
  saveFavs();
  if (favoriteChoice.some(key => !state.favs.has(key))) saveChoice(favoriteChoice.filter(key => state.favs.has(key)));
  refreshFavorites(id);
  if (!$('detail').open && removedFavorite?.offer.id === id) $('undoFavorite')?.focus({ preventScroll: true });
}
function undoFavorite() {
  if (!removedFavorite) return;
  const { offer, index, choice } = removedFavorite;
  const entries = [...state.favs.entries()];
  entries.splice(index, 0, [offer.id, offer]);
  state.favs = new Map(entries);
  removedFavorite = null;
  saveFavs();
  saveChoice(choice.filter(id => state.favs.has(id)));
  refreshFavorites(offer.id);
  $('results').querySelector(`[data-fav="${CSS.escape(offer.id)}"]`)?.focus({ preventScroll: true });
  $('resultsStatus').textContent = 'Билет вернули на прежнее место.';
}
function refreshFavorites(changedId) {
  for (const [key, ids] of rowPicks) {
    const remaining = ids.filter(id => state.favs.has(id));
    if (remaining.length) rowPicks.set(key, remaining);
    else rowPicks.delete(key);
  }
  for (const button of document.querySelectorAll('[data-fav]')) {
    const id = button.dataset.fav, pressed = state.favs.has(id);
    button.setAttribute('aria-pressed', String(pressed));
    if (id !== changedId) continue;
    // Сердечко «подпрыгивает» и разлетается искрами, только когда поездку добавили.
    button.classList.remove('pop');
    if (pressed) { void button.offsetWidth; button.classList.add('pop'); setTimeout(() => button.classList.remove('pop'), 600); }
  }
  for (const button of $('showcase').querySelectorAll('[data-compare-row]')) {
    const label = pairLabel(button.dataset.compareRow);
    button.querySelector('span').textContent = label;
    button.closest('.compare-prompt').hidden = !label;
  }
  if ($('pairComparison').open) syncComparison();
  if (state.view === 'fav') renderResults();
  else if ($('favCount')) $('favCount').textContent = state.favs.size;
}
function compareTable(offers, distinguishFlights = false) {
  const prices = offers.map(offer => offer.price_minor);
  const lowest = Math.min(...prices), highest = Math.max(...prices);
  const priceCell = offer => {
    const price = `<b>${esc(fmtMoney(offer.price_minor))}</b>`;
    if (offer.price_minor !== lowest || lowest === highest) return price;
    const note = offers.length === 2 ? `На ${fmtMoney(highest - lowest)} дешевле` : 'Минимальная цена';
    return `${price}<small class="compare-price-note">${esc(note)}</small>`;
  };
  const heading = (offer) => {
    if (!distinguishFlights) return esc(offer.city);
    const dep = facts(offer).dep, zone = offer.origin_timezone;
    const flight = [`${fmtDay(dep, zone)}, ${fmtTime(dep, zone)}`, `${offer.origin_airport} → ${offer.destination_airport}`, offer.flight_number].filter(Boolean);
    return `${esc(offer.city)}<small>${esc(flight.join(' · '))}</small>`;
  };
  const row = (title, cell) => `<tr><th scope="row">${title}</th>${offers.map((offer) => `<td>${cell(offer, facts(offer))}</td>`).join('')}</tr>`;
  const changes = offer => {
    if (offer.transfers == null || offer.return_transfers == null) return 'Нет данных';
    return offer.transfers === 0 && offer.return_transfers === 0 ? 'Прямые' : `Туда: ${esc(offer.transfers)}, обратно: ${esc(offer.return_transfers)}`;
  };
  return `<div class="compare"${offers.length > 2 ? ' tabindex="0" role="region" aria-label="Сравнение выбранных билетов"' : ''}><table data-count="${offers.length}">
    <thead><tr><td></td>${offers.map(offer => `<th scope="col">${heading(offer)}</th>`).join('')}</tr></thead>
    <tbody>
      ${row('Цена', priceCell)}
      ${row('Даты', (offer, x) => esc(fmtRange(x.dep, x.ret, offer.origin_timezone, offer.destination_timezone)))}
      ${row('На месте', (offer, x) => hoursMinutes(x.stay == null ? null : Math.round(x.stay * 60)))}
      ${row('Час поездки', (offer, x) => x.stay ? esc(hourCost(x)) : 'Нет данных')}
      ${row('В пути', (offer, x) => hoursMinutes(Number.isFinite(x.flight) ? x.flight : null))}
      ${row('Пересадки', changes)}
      ${row('Авиакомпания', (offer) => esc(airlineLabel(offer)))}
    </tbody></table></div>`;
}
function syncComparison() {
  const dialog = $('pairComparison'), key = history.state?.compareRow;
  const offers = pairOffers(key);
  if (offers.length === 2 && state.view === 'showcase') {
    $('pairBody').innerHTML = compareTable(offers, offers[0].city === offers[1].city);
    if (!dialog.open) dialog.showModal();
  } else if (dialog.open) dialog.close();
  else if (key) history.replaceState(null, '');
}
function renderFavorites() {
  const section = $('results'), offers = [...state.favs.values()].reverse(), chosen = selectedFavorites(offers);
  state.shown = state.favs;
  if (chosen.length < 2 && state.favoriteDetails) {
    state.favoriteDetails = false;
    if (location.hash === '#fav/compare') history.replaceState(null, '', '#fav');
  }
  section.hidden = false;
  section.innerHTML = state.favoriteDetails
    ? favoriteComparison(chosen, offers.length > 2, compareTable(chosen, true), removedFavorite?.offer)
    : favoriteList(offers, chosen, removedFavorite?.offer, facts, photo);
  document.title = $('favoriteTitle').textContent + ' · Aviator';
  if ($('favoritePicker').open && offers.length < 3) $('favoritePicker').close();
}

function updateFavoriteOptions() {
  const inputs = [...$('favoriteOptions').querySelectorAll('input')];
  const count = inputs.filter(input => input.checked).length;
  for (const input of inputs) input.disabled = count >= 4 && !input.checked;
  $('favoriteChoiceCount').textContent = `Выбрано ${count} из 4`;
  $('applyFavoriteChoice').disabled = count < 2 || count > 4;
}
function openFavoritePicker() {
  const offers = [...state.favs.values()].reverse();
  $('favoriteOptions').innerHTML = favoriteOptions(offers, selectedFavorites(offers).map(offer => offer.id));
  updateFavoriteOptions();
  $('favoritePicker').showModal();
}

// Номера страниц: первая, соседние с текущей, последняя; между ними — «…».
function pager(pages) {
  if (pages <= 1) return '';
  const shown = [...new Set([1, state.page - 1, state.page, state.page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const button = (n, label = n, extra = '') => `<button type="button" data-page="${n}" ${n === state.page && label === n ? 'aria-current="page"' : ''} ${extra}>${label}</button>`;
  return `<nav class="pager" aria-label="Страницы выдачи">${button(state.page - 1, '‹', `aria-label="Предыдущая страница" ${state.page === 1 ? 'disabled' : ''}`)}${shown.map((n, i) => (i && n - shown[i - 1] > 1 ? '<span class="gap">…</span>' : '') + button(n)).join('')}${button(state.page + 1, '›', `aria-label="Следующая страница" ${state.page === pages ? 'disabled' : ''}`)}</nav>`;
}
function statusPanel(symbol, title, message) {
  return `<div class="status">${icon(symbol)}<h3>${esc(title)}</h3><p>${esc(message)}</p></div>`;
}
const action = (name, title, primary = true) => `<button type="button" class="${primary ? 'btn-primary' : 'btn-inline'}" data-action="${name}">${esc(title)}</button>`;

function renderResults() {
  if (state.view === 'fav') { renderFavorites(); return; }
  if (state.view === 'showcase') { $('results').hidden = true; return; }
  // «Все» в подборке — та же выдача с фильтрами и сортировками, но из поездок подборки.
  const collection = state.view === 'collection' ? homeRow(state.collection) : null;
  const section = $('results'), q = collection ? { region: 'any' } : state.performed, status = collection ? 'done' : state.status;
  section.hidden = status === 'idle';
  $('searchButton').disabled = state.status === 'loading';
  // Первый экран не загрузился сам — выдачи нет, остаётся форма.
  if (!q || status === 'idle') return;
  let body = '', title = 'Варианты', tools = '';
  const announce = (text) => { $('resultsStatus').textContent = text; };
  if (status === 'loading') {
    // Заготовки карточек: страница держит форму, пока грузятся цены.
    body = flightLoader('Ищем варианты поездки…');
    announce('Ищем варианты поездки');
  } else if (status === 'error') {
    body = statusPanel('alert', 'Поиск не завершён', state.error) + `<div class="status-actions">${action('retry', 'Попробовать ещё раз')}</div>`;
    announce('Поиск не завершён. ' + state.error);
  } else if (status === 'offline') {
    body = statusPanel('offline', 'Нет связи', 'Не удалось связаться с сервером. Проверьте подключение.') + `<div class="status-actions">${action('retry', 'Повторить поиск')}</div>`;
    announce('Нет связи с сервером');
  } else {
    const offers = visibleOffers(collection ? rowOffers(collection) : undefined);
    const filters = Object.entries(state.filters).filter(([name]) => name !== 'russia' || q.region === 'any');
    const active = filters.some(([, on]) => on) || state.length !== 'any';
    // «Один вариант на город» ничего не прячет целиком, поэтому пустую выдачу объясняют только остальные фильтры.
    const hiding = filters.some(([name, on]) => on && name !== 'unique') || state.length !== 'any';
    state.shown = new Map(offers.map((offer) => [offer.id, offer]));
    title = collection ? `${collection.title} · ${countLabel(offers.length)}` : countLabel(offers.length);
    announce(offers.length ? `Найдено: ${countLabel(offers.length)}` : 'Подходящих вариантов нет');
    const chips = `<button type="button" class="chip" data-chip="all" aria-pressed="${!active}">Все</button>` + Object.entries(CHIPS)
      .filter(([name]) => name !== 'russia' || q.region === 'any')
      .map(([name, title]) => `<button type="button" class="chip" data-chip="${name}" aria-pressed="${state.filters[name]}">${title}</button>`).join('');
    const menu = (id, label, options, value) => `<select class="menu menu--plain" id="${id}" aria-label="${label}">${Object.entries(options).map(([name, title]) => `<option value="${name}" ${value === name ? 'selected' : ''}>${title}</option>`).join('')}</select>`;
    tools = `<div class="sort-menus">${menu('sort', 'Сортировка', SORTS, state.sort)}${menu('length', 'Длительность поездки', LENGTHS, state.length)}</div>`;
    body = collection ? `<p class="source">${esc(collection.hint)}. ${esc(cachedPriceLabel(state.home.received_at))} · туда и обратно на одного · <a href="/how-we-count.html#home">Как мы считаем</a></p>`
      : `<p class="source"><span class="summary">${esc(state.performedLabel)}. </span>${esc(cachedPriceLabel(state.result.received_at))} · туда и обратно на одного · <a href="/how-we-count.html">Как мы считаем</a></p>`;
    body += `
      <div class="chips" role="group" aria-label="Быстрые фильтры">${chips}</div>
      ${state.sort === 'flightRating' ? '<p class="caption">Оценка перелёта — цена и дорога, 0–100. Варианты без оценки идут в конце.</p>' : ''}
      ${state.sort === 'stay' || state.sort === 'value' ? '<p class="caption">Время на месте — от расчётного прилёта до обратного вылета, включая ночи.</p>' : ''}
      ${!collection && state.result.incomplete ? (state.result.warnings?.length ? state.result.warnings : ['Удалось проверить только часть вариантов.']).map(text => `<p class="caption">${esc(text)}</p>`).join('') : ''}`;
    if (!offers.length) {
      if (collection || (hiding && state.result.offers.length)) {
        body += statusPanel('send', 'Пока без вариантов', 'Фильтры скрыли все найденные варианты. Сбросьте их, чтобы увидеть результаты поиска.')
          + `<div class="status-actions">${action('resetFilters', 'Сбросить фильтры')}</div>`;
      } else {
        const message = state.result.offers.length ? 'Попробуйте изменить длительность поездки.' : 'Среди проверенных городов предложений не найдено';
        body += statusPanel('send', 'Пока без вариантов', message)
          + `<div class="status-actions">
            ${(state.result?.offers ?? []).some((offer) => facts(offer).dep > Date.now() && !FITS.any(facts(offer).days)) ? action('allLengths', 'Показать поездки любой длины') : ''}
            ${!q.exact && q.weekend ? action('allTrips', 'Показать не только короткие выходные') : ''}
            ${q.budget < 500000 ? action('moreBudget', 'Увеличить бюджет на 10 000 ₽') : ''}
            ${q.direct ? action('allowTransfers', 'Разрешить пересадки') : ''}
            ${action('edit', 'Изменить даты и направление', false)}
          </div>`;
      }
    } else {
      const pages = Math.ceil(offers.length / PAGE);
      state.page = Math.min(Math.max(1, state.page), pages);
      body += `<div class="grid">${offers.slice((state.page - 1) * PAGE, state.page * PAGE).map(offerCard).join('')}</div>${pager(pages)}`;
    }
  }
  const back = homeVariant === 'B' ? `<button type="button" class="chip" data-action="showcase">${icon('arrow-left')}Подборки</button>` : '';
  section.innerHTML = `<div class="results-head"><h2>${esc(title)}</h2>${tools}${back}<button type="button" class="chip chip--fav" data-action="favorites">${icon('heart')}Избранное · <span id="favCount">${state.favs.size}</span></button></div>${body}`;
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
    <p class="route-note">${icon(transfers === 0 ? 'check' : 'swap')}<span>${transfers == null ? 'Пересадки неизвестны' : transfers === 0 ? 'Без пересадок' : `Пересадок: ${esc(transfers)}. Где и сколько ждать, смотрите на Aviasales`}${outbound ? ` · ${carrier(offer)}${offer.flight_number ? `, рейс ${esc(offer.flight_number)}` : ''}` : ''}</span></p>
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
  state.backFrom = null;
  const x = facts(offer), past = x.dep <= Date.now(), link = past ? null : handoff(offer), hint = past ? null : longer(offer), hotel = lodging(offer, 'hotel');
  const alike = past ? [] : similar(offer), nearby = past ? null : shifted(offer), level = past ? null : levelOf(offer);
  if (!past) rememberTrip(offer);
  state.detail = offer; state.alike = new Map(alike.map((other) => [other.id, other]));
  $('detailTitle').textContent = offer.city;
  $('detailBody').innerHTML = `<div class="detail">
    <div class="stamp stamp--wide">${photo(offer.city_code, favButton(offer), true)}</div>
    <div class="detail-head"><h2>${esc(offer.city)}</h2><p class="caption">${esc(offer.country ?? '')}</p></div>
    ${offerRating(offer)}
    ${state.cityPages.has(offer.city_code) ? `<a class="btn-inline city-link" href="/city/${esc(state.cityPages.get(offer.city_code))}">Когда лететь дешевле и где жить${icon('arrow-right')}</a>` : ''}
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
        <p class="caption">Билеты туда и обратно на одного · ${esc(cachedPriceLabel(offer.received_at))} · <a href="/how-we-count.html">Как мы считаем</a></p>
        ${level ? `<p class="caption level-line level-line--${level.kind}">${esc(levelNote({ ...level, usualText: fmtMoney(level.usual) }))}</p>` : ''}
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
      <p><b>≈ ${Math.floor(x.stay)} ч</b> · ≈ ${esc(hourCost(x))} за час поездки</p>
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
  // Поездка из подборки знает свой поиск (q с сервера): по этой ссылке её найдёт и откроет любой браузер.
  const params = new URLSearchParams(offer.q ?? toParams(state.performed ?? state.query));
  params.set('city', offer.city_code);
  params.set('trip', offer.id);
  const href = '/?' + params;
  if (history.state?.trip) history.replaceState({ trip: offer.id }, '', href); else history.pushState({ trip: offer.id }, '', href);
  $('share').textContent = 'Поделиться';
  goal('view_city', { city: offer.city_code, from: offer.origin_city_code, page: 'trip' });
}
async function shareTrip() {
  const offer = state.detail;
  if (!offer) return;
  const saved = savedTrips().find(p => p.id === offer.id);
  const url = new URL(tripPath(saved ?? snapshot(offer)), location.href).href, title = `${offer.city} за ${fmtMoney(offer.price_minor)} туда-обратно`;
  goal('share', { city: offer.city_code });
  if (navigator.share) {
    try { await navigator.share({ title, text: title, url }); return; } catch (error) { if (error.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); $('share').textContent = 'Ссылка скопирована'; } catch {
    $('portableLink')?.remove();
    $('detailBody').insertAdjacentHTML('afterbegin', `<a class="btn-inline" id="portableLink" href="${esc(url)}">Открыть ссылку на поездку</a>`);
    $('portableLink').focus();
  }
}
// Ссылка на поездку: когда её поиск загрузился, открыть эту поездку (если рейс ещё есть в ответе).
function openLinked(id) {
  const offer = state.result?.offers.find((other) => other.id === id);
  if (offer) openDetail(offer);
}

// --- главная-витрина (этап 3): подборки с сервера, /api/v1/home ---
const homeOffer = (id) => state.home?.offers.get(id);
const feedOffer = (key, id) => key === 'recent' ? state.recentOffers.get(id) : homeOffer(id);
const homeRow = (key) => state.home?.rows.find((row) => row.key === key) ?? null;
const rowOffers = (row) => row.items.map(homeOffer).filter((offer) => offer && facts(offer).dep > Date.now());
const daysFromToday = (offer) => Math.round((Date.parse(facts(offer).out.key) - Date.parse(zoned(new Date(), offer.origin_timezone).key)) / 86400000);

// Уровень цены — только если для города, месяца и длины поездки сервер посчитал обычную цену (поиск маршрута на месяц).
function levelOf(offer) {
  if (!state.home || offer.origin_city_code !== state.home.origin.code) return null;
  const x = facts(offer), month = x.out.key.slice(0, 7);
  const found = x.days >= 1 && x.days <= 14 ? state.home.usual[usualKey(offer.city_code, month, x.days)] : null;
  return found ? { ...priceLevel(offer.price_minor, found[0]), usual: found[0], pairs: found[1], month, nights: x.days } : null;
}
let levelSeq = 0;
// Плашка уровня цены; по нажатию — объяснение в карточке, без всплывающих окон.
function levelTag(offer) {
  const level = levelOf(offer);
  if (!level) return '';
  const id = `level-${++levelSeq}`;
  const text = level.kind === 'usual' ? 'Обычная цена' : `${Math.abs(level.diff)}% ${level.diff < 0 ? 'ниже' : 'выше'} обычной`;
  return `<div class="level-wrap"><button type="button" class="level level--${level.kind}" data-level aria-expanded="false" aria-controls="${id}"><span><i aria-hidden="true">${level.kind === 'usual' ? '≈' : level.diff < 0 ? '↘' : '↗'}</i>${text}</span></button>
    <p class="level-note" id="${id}" hidden>${esc(levelNote({ ...level, usualText: fmtMoney(level.usual) }))} <a href="/how-we-count.html#level">Как мы считаем</a></p></div>`;
}
function toggleLevel(button) {
  const open = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(open));
  document.getElementById(button.getAttribute('aria-controls')).hidden = !open;
}
const tripLabel = offer => `${offer.city}: ${fmtMoney(offer.price_minor)}, ${fmtRange(facts(offer).dep, facts(offer).ret, offer.origin_timezone, offer.destination_timezone)}`;
const openButton = (offer, row) => `<button type="button" class="tile-open" data-open="${esc(offer.id)}" data-row="${esc(row)}" aria-label="${esc(tripLabel(offer))}"></button>`;

// Ближайшие вылеты показываем как посадочные талоны с датами и сравнением цены.
function passTile(offer, row) {
  const x = facts(offer), level = levelOf(offer);
  return `<article class="tile tile--pass"><div class="pass">
    <div class="pass-main">
      <div class="codes"><span>${esc(offer.origin_city_code ?? offer.origin_airport)}</span><span class="flight">${icon('plane')}</span><span>${esc(offer.city_code)}</span></div>
      <div class="cities"><span>${esc(offer.origin_city)}</span><span>${esc(offer.city)}</span></div>
      <div class="legs"><span><small>Туда</small><b>${esc(fmtDay(x.dep, offer.origin_timezone, true))}</b></span><span><small>Обратно</small><b>${esc(fmtDay(x.ret, offer.destination_timezone, true))}</b></span><span><small>На месте</small><b>${esc(stayLabel(offer))}</b></span></div>
    </div>
    <div class="pass-stub">
      <div class="tile-price-row"><p class="pass-price">${esc(fmtMoney(offer.price_minor))}</p>${levelTag(offer)}${favButton(offer).replace('class="fav"', 'class="fav fav--inline"')}</div>
      ${level && level.diff < 0 ? `<p class="caption">${esc(hotLine(daysFromToday(offer), level.diff, level.month))}</p>` : ''}
      ${offerRating(offer)}
      <p class="caption">${x.direct ? 'прямые' : 'с пересадками'} · ${carrier(offer)}</p>
    </div></div>${openButton(offer, row)}</article>`;
}
// Остальные подборки — марки: фото, город, цена, даты.
function stampTile(offer, row, note = '') {
  const x = facts(offer);
  return `<article class="tile">
    <div class="stamp">${photo(offer.city_code, favButton(offer))}</div>
    <div class="tile-body">
      <h3 class="tile-city">${esc(offer.city)}</h3>
      <div class="tile-price-row"><b class="tile-price">${esc(fmtMoney(offer.price_minor))}</b>${levelTag(offer)}</div>
      <p class="tile-dates">${esc(fmtRange(x.dep, x.ret, offer.origin_timezone, offer.destination_timezone))}, ${esc(stayLabel(offer))}</p>
      ${offerRating(offer)}
      ${note ? `<p class="tile-note">${note}</p>` : ''}
    </div>${openButton(offer, row)}</article>`;
}
function rowSection(key, title, hint, tiles, action, pass = false, mark = 'weekend') {
  const label = pairLabel(key);
  return `<section class="row" data-feed="${esc(key)}" aria-labelledby="row-${key}">
    <div class="row-head"><span class="row-mark">${sticker(mark)}</span><h2 id="row-${key}">${esc(title)}</h2>${hint ? `<p class="row-hint">${esc(hint)}</p>` : ''}${action}</div>
    <div class="strip${pass ? ' strip--pass' : ''}">${tiles}</div>
    <div class="compare-prompt"${label ? '' : ' hidden'}>
      <span class="compare-count">${icon('heart')}Выбрано 2 поездки</span>
      <button type="button" class="btn-primary" data-compare-row="${esc(key)}" aria-haspopup="dialog" aria-controls="pairComparison"><span>${esc(label)}</span>${icon('arrow-right')}</button>
    </div>
  </section>`;
}
// «Продолжить планирование»: изменение цены — только если сегодня найден тот же самый вариант (тот же рейс и даты).
function recentPriceNote(item, latest) {
  const change = latest ? priceChange(item.price, latest.price_minor) : null;
  return !change ? `цена на ${esc(fmtDay(new Date(item.offer.received_at), localZone))}`
      : change.kind === 'down' ? `<span class="down">подешевело на ${esc(fmtMoney(change.amount))}</span>`
      : change.kind === 'up' ? `подорожало на ${esc(fmtMoney(change.amount))}` : 'цена та же';
}
function recentRow() {
  const trips = state.recent.filter((item) => facts(item.offer).dep > Date.now());
  if (!trips.length) return '';
  state.recentOffers = new Map();
  const tiles = trips.map((item) => {
    const now = state.recentPrices[item.offer.id];
    const offer = now ? { ...item.offer, price_minor: now.price_minor, received_at: now.received_at } : item.offer;
    state.recentOffers.set(offer.id, offer);
    return stampTile(offer, 'recent', recentPriceNote(item, now));
  }).join('');
  return rowSection('recent', 'Продолжить планирование', '', tiles, '', false, 'recent');
}
function renderShowcase() {
  const section = $('showcase');
  if (state.homeStatus === 'loading') {
    section.innerHTML = flightLoader('Подбираем билеты из вашего города…') + recentRow();
    $('resultsStatus').textContent = 'Подбираем билеты';
    return;
  }
  if (state.homeStatus === 'error' || !state.home) {
    section.innerHTML = recentRow() + statusPanel('alert', 'Подборки не загрузились', 'Поиск в форме выше работает. Подборки можно загрузить ещё раз.')
      + `<div class="status-actions">${action('retryHome', 'Загрузить подборки')}</div>`;
    return;
  }
  const visible = state.allRows ? state.home.rows : state.home.rows.slice(0, 5), hidden = state.home.rows.length - visible.length;
  const rows = visible.map((row) => {
    const offers = rowOffers(row);
    if (offers.length < 3) return '';
    const note = (offer) => state.home.notes[offer.id] ? esc(leaveLine(state.home.notes[offer.id].leave, state.home.notes[offer.id].trip)) : '';
    // В ленте — до шести карточек, дальше полупрозрачная карточка «Ещё N»: лента не тянется бесконечно.
    const tiles = offers.slice(0, 6).map((offer) => row.kind === 'pass' ? passTile(offer, row.key) : stampTile(offer, row.key, note(offer))).join('')
      + (offers.length > 6 ? `<button type="button" class="tile-more" data-row-all="${esc(row.key)}"><b>+${offers.length - 6}</b><span>Показать все</span>${icon('arrow-right')}</button>` : '');
    return rowSection(row.key, row.title, row.hint, tiles, `<button type="button" class="row-all" data-row-all="${esc(row.key)}">Все${icon('arrow-right')}</button>`, row.kind === 'pass', rowSticker(row));
  }).join('');
  section.innerHTML = recentRow() + (rows ? rows + (hidden > 0 ? `<button type="button" class="btn-inline more-rows" data-more-rows>Ещё подборки · ${hidden}</button>` : '') : statusPanel('send', 'Подборок пока нет', 'Для этого города вылета не нашлось поездок на ближайшие недели. Попробуйте поиск в форме выше.'))
    + `<p class="source">${esc(cachedPriceLabel(state.home.received_at))} · туда и обратно на одного · <a href="/how-we-count.html#home">Как мы считаем подборки</a></p>`;
  $('resultsStatus').textContent = 'Подборки загружены';
}
const homeWaiters = [];
function loadHomeThen(callback) { if (state.homeStatus === 'done') callback(); else homeWaiters.push(callback); }
let homeRequest;
async function loadHome() {
  const q = state.query, params = new URLSearchParams({ from: q.origin });
  if (q.originCity) params.set('fc', q.originCity);
  const key = params.toString();
  if (state.homeStatus === 'loading' && homeRequest?.key === key) return;
  if (homeRequest?.key !== key) rowPicks.clear();
  homeRequest?.controller.abort();
  const controller = new AbortController();
  homeRequest = { key, controller };
  state.homeStatus = 'loading';
  renderShowcase();
  try {
    const response = await fetch('/api/v1/home?' + params, { signal: controller.signal });
    const data = response.ok ? await response.json() : null;
    if (controller.signal.aborted) return;
    if (!Array.isArray(data?.rows)) throw new Error('home');
    const rows = data.rows.map(row => row.key === 'hot'
      ? { ...row, title: 'Ближайшие вылеты', hint: 'Вылет через 1–14 дней, цена минимум на 20 % ниже обычной' }
      : row);
    state.home = { ...data, rows, offers: new Map(Object.entries(data.offers)) };
    state.homeStatus = 'done';
  } catch { if (controller.signal.aborted) return; state.homeStatus = 'error'; state.home = null; }
  if (state.view === 'showcase') renderShowcase();
  if (state.homeStatus === 'done') for (const callback of homeWaiters.splice(0)) callback();
  const wanted = state.recent.filter((item) => item.offer.origin_city_code === state.home?.origin.code).map((item) => item.offer.id);
  if (state.home && wanted.length) {
    fetch(`/api/v1/home/prices?${params}&ids=${wanted.join(',')}`, { signal: controller.signal }).then((response) => response.ok ? response.json() : null)
      .then(data => {
        if (controller.signal.aborted) return;
        state.recentPrices = data?.prices ?? {};
        if (state.view === 'showcase' && Object.keys(state.recentPrices).length) renderShowcase();
      }).catch(() => {});
  }
}
// Активная вкладка шапки: «Избранное» — когда показано избранное, иначе «Билеты».
function markNav(view) {
  for (const link of document.querySelectorAll('.top .nav a')) {
    const href = link.getAttribute('href'), active = view === 'fav' ? href === '/#fav' : href === '/';
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
}
const homeTitle = document.title;
function setView(view) {
  const fromFavorites = state.view === 'fav';
  if ($('favoritePicker').open) $('favoritePicker').close();
  state.view = view;
  document.body.classList.toggle('has-hero', view !== 'fav');
  document.body.classList.toggle('favorites-page', view === 'fav');
  document.querySelector('.skip').textContent = view === 'fav' ? 'К избранному' : 'К поиску';
  if (view !== 'fav') {
    document.title = homeTitle;
    if (fromFavorites) { removedFavorite = null; fitHero(); }
  }
  markNav(view);
  $('showcase').hidden = view !== 'showcase';
  if (view === 'showcase') $('results').hidden = true;
}
function showShowcase() {
  setView('showcase');
  collapseForm(true);
  const origin = state.home?.origin;
  if (state.homeStatus === 'done' && origin && origin.iata === state.query.origin && (origin.all ? origin.code : null) === state.query.originCity) renderShowcase();
  else loadHome();
}
function showCollection(key, push = true) {
  if (!homeRow(key)) return;
  Object.assign(state, { collection: key, page: 1 });
  if (push) history.pushState({ row: key }, '', `${location.pathname}#row=${key}`);
  setView('collection');
  renderResults();
  $('results').scrollIntoView({ block: 'start' });
}
// Последние открытые поездки: целиком (без лишних полей), с ценой на момент просмотра.
function rememberTrip(offer) {
  const { trip_rating: _rating, outbound_segments: _out, inbound_segments: _in, ...saved } = offer;
  state.recent = [{ offer: saved, price: offer.price_minor, at: Date.now() }, ...state.recent.filter((item) => item.offer.id !== offer.id)].slice(0, 8);
  try { localStorage.setItem('aviator.recent', JSON.stringify(state.recent)); } catch { /* частный режим */ }
}
// «Назад» и «Вперёд» между подборками, «Все» и выдачей.
function syncView() {
  const row = /^#row=([a-z0-9]+)$/.exec(location.hash)?.[1];
  if (row && homeRow(row)) { if (state.view !== 'collection' || state.collection !== row) showCollection(row, false); return; }
  if (favoritesHash()) { showFavorites(); return; }
  if (homeVariant === 'B' && !location.search) { if (state.view !== 'showcase') showShowcase(); return; }
  if (state.view === 'fav' && !location.search && !state.performed) { search({ scroll: false, auto: true }); return; }
  if ((location.search || state.view === 'fav') && state.view !== 'results' && state.performed) { setView('results'); renderResults(); }
}

// --- форма ---
function renderForm() {
  const q = state.query, zone = originZone(), list = months(zone), today = zoned(new Date(), zone).key;
  if (!q.exact && !list.includes(q.month)) q.month = list[0];
  $('originLabel').textContent = state.labels.origin;
  const city = q.originCity ?? state.byIata.get(q.origin)?.city_code;
  const from = state.fromNames.get(city);
  $('originTitle').innerHTML = `${from ? `из&nbsp;${esc(from)}` : `из&nbsp;города ${esc(state.labels.origin.split(' · ')[0])}`}${icon('chevron-down')}`;
  $('destinationLabel').textContent = state.labels.destination ?? DESTINATION_SCOPES[q.region].label;
  $('searchAction').textContent = q.destination ? 'Найти билеты' : 'Показать направления';
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
  const line = summary(q);
  $('summaryCode').textContent = line.code;
  $('summaryRoute').textContent = line.route;
  $('summaryDetails').textContent = line.details;
  $('lineCode').textContent = q.originCity ?? q.origin;
  $('lineOrigin').textContent = state.labels.origin.split(' · ')[0];
  $('lineTo').textContent = line.route;
  $('lineWhen').textContent = line.details.split(' · ')[0];
  $('lineBudget').textContent = `до ${fmtMoney(q.budget * 100)}`;
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
  return { code: q.originCity ?? q.origin, route: state.labels.destination ?? DESTINATION_SCOPES[q.region].label, details: `${dates} · до ${fmtMoney(q.budget * 100)}` };
}
// Телефон: когда пошёл поиск, форма сворачивается в строку, чтобы первые карточки были на первом экране.
// Класс меняет раскладку только уже 900 px; на широком экране форма видна целиком.
// Свёрнутая форма: на телефоне — строка «MOW Куда угодно · Изменить», на компьютере — четыре поля в одну строку и «Найти».
function collapseForm(collapsed) {
  $('search').classList.toggle('search--collapsed', collapsed);
  $('searchSummary').setAttribute('aria-expanded', String(!collapsed));
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
  const q = { ...state.query }, signal = request.signal, label = summary(q), fromShowcase = state.view === 'showcase' || state.view === 'collection';
  Object.assign(state, { performed: q, performedLabels: { ...state.labels }, performedSummary: label, performedLabel: `${state.labels.origin} → ${label.route} · ${label.details}`, status: 'loading', page: 1, view: 'results' });
  if (!auto) {
    history[fromShowcase ? 'pushState' : 'replaceState'](null, '', '?' + toParams(q));
    goal('search', { from: q.originCity ?? q.origin, region: q.region });
  }
  setView('results');
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
let airportRequest;
function loadAirports() {
  if (!airportRequest) airportRequest = fetchAirports().catch(error => { airportRequest = null; throw error; });
  return airportRequest;
}
async function fetchAirports() {
  const response = await fetch('/api/v1/airports');
  if (!response.ok) throw new Error('airports');
  // Поиск принимает только трёхбуквенные латинские коды; в справочнике есть и местные кириллические.
  state.airports = (await response.json()).filter((airport) => airport.timezone && /^[A-Z]{3}$/.test(airport.iata) && /^[A-Z]{3}$/.test(airport.city_code));
  state.cities = new Map();
  for (const airport of state.airports) {
    state.byIata.set(airport.iata, airport);
    if (!state.cities.has(airport.city_code)) state.cities.set(airport.city_code, { id: airport.city_code, name: airport.city, country: airport.country, airports: [] });
    state.cities.get(airport.city_code).airports.push(airport);
  }
}
function airportLabel(iata, cityCode) {
  const airport = state.byIata.get(iata);
  if (!airport) return cityCode ?? iata;
  return cityCode ? `${airport.city} · все аэропорты` : `${airport.city} · ${airport.iata}`;
}
const matchesText = (text, term) => text.toLocaleLowerCase('ru').replaceAll('ё', 'е').includes(term);
function renderScopeCoverage() {
  $('pickerScopeCities').innerHTML = Object.entries(DESTINATION_SCOPES)
    .filter(([key, scope]) => scope.cities.length && (!COUNTRIES_ON_INPUT[key] || key === state.query.region))
    .map(([, { label, cities }]) => `<div><dt>${esc(label)}</dt><dd>${esc(cities.map(code => state.cities?.get(code)?.name ?? code).join(', '))}</dd></div>`)
    .join('');
}
function renderPicker() {
  const list = $('pickerList');
  const term = $('pickerInput').value.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');
  const origin = state.pickerTarget === 'origin';
  if (!origin) {
    for (const option of $('pickerRegions').querySelectorAll('[data-region]')) {
      const { region } = option.dataset;
      if (!state.query.destination && region === state.query.region) option.setAttribute('aria-current', 'true');
      else option.removeAttribute('aria-current');
      const aliases = COUNTRIES_ON_INPUT[region];
      if (aliases) {
        const name = term.replace(/^тай(?=л|$)/, 'таи');
        option.hidden = !name || !aliases.some(alias => alias.startsWith(name));
      } else {
        option.hidden = !matchesText(DESTINATION_SCOPES[region].label, term) && !matchesText(SCOPE_TERMS[region] ?? '', term);
      }
    }
  }
  const matchedScope = !origin && Boolean($('pickerRegions').querySelector('[data-region]:not([hidden])'));
  $('pickerScopeHeading').hidden = !term || !matchedScope;
  $('pickerRegions').hidden = !matchedScope;
  $('pickerRegions').classList.toggle('scope-matches', Boolean(term));
  $('pickerCoverage').hidden = origin || Boolean(term);
  if (!state.cities) {
    list.innerHTML = airportRequest ? '<p class="picker-note">Загружаем аэропорты…</p>'
      : '<p class="picker-note">Не удалось загрузить аэропорты.</p><button class="btn-inline" type="button" data-retry-airports>Повторить</button>';
    return;
  }
  const current = origin ? state.query.origin : state.query.destination;
  const allAirports = origin ? state.query.originCity : state.query.destinationCity;
  const currentCity = allAirports ?? state.byIata.get(current)?.city_code;
  const fromCity = state.query.originCity ?? state.byIata.get(state.query.origin)?.city_code;
  let cities = [...state.cities.values()].filter(city => origin || city.id !== fromCity);
  const cityMatch = city => matchesText(city.name, term) || matchesText(city.id, term);
  const airportMatch = a => matchesText(a.name, term) || matchesText(a.iata, term);
  if (term) {
    const rank = c => c.id.toLowerCase() === term || c.airports.some(a => a.iata.toLowerCase() === term) ? 0
      : c.name.toLowerCase().startsWith(term) ? 1 : 2;
    cities = cities.filter(c => cityMatch(c) || c.airports.some(airportMatch))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ru')).slice(0, 40);
  } else {
    const scope = DESTINATION_SCOPES[origin ? 'any' : state.query.region];
    if (scope.countries.length) cities = cities.filter(city => scope.countries.includes(city.airports[0].country_code));
    const eligible = new Map(cities.map(city => [city.id, city]));
    const order = [...new Set([currentCity, ...(scope.cities.length ? scope.cities : POPULAR)])];
    const popular = order.map(id => eligible.get(id)).filter(Boolean);
    cities = popular.length ? popular : cities.sort((a,b) => a.name.localeCompare(b.name, 'ru')).slice(0, 40);
  }
  const row = (title, subtitle, code, iata, group, selected, glyph) => `<button class="airport-option" type="button" data-iata="${esc(iata)}"${group ? ` data-city="${esc(group)}"` : ''}${selected ? ' aria-current="true"' : ''}>
    ${icon(glyph)}<span><b>${esc(title)}</b><small>${esc(subtitle)}</small></span><span class="airport-code">${selected ? icon('check') : ''}${esc(code)}</span></button>`;
  const groups = cities.map(c => {
    const [first] = c.airports;
    const single = c.airports.length === 1;
    const individual = a => row(a.name, c.name, a.iata, a.iata, null, !allAirports && current === a.iata, 'plane');
    if (term && !cityMatch(c)) return c.airports.filter(airportMatch).map(individual).join('');
    if (single) return row(c.name, first.name === c.name ? (c.country ?? 'Аэропорт') : first.name, first.iata, first.iata, null, currentCity === c.id, 'plane');
    const group = row(c.name, 'Все аэропорты города', c.id, first.iata, c.id, allAirports === c.id, 'pin');
    return group + `<details class="airport-group"${term || (currentCity === c.id && !allAirports) ? ' open' : ''}><summary>Выбрать аэропорт (${c.airports.length})</summary>
      ${c.airports.map(individual).join('')}</details>`;
  });
  list.innerHTML = groups.length ? '<p class="picker-section">Города и аэропорты</p>' + groups.join('')
    : matchedScope ? '' : '<p class="picker-note">Ничего не найдено. Введите другое название или трёхбуквенный код.</p>';
}
async function loadPickerCities() {
  if (state.cities) { renderPicker(); return; }
  const request = loadAirports();
  renderPicker();
  try { await request; } catch { /* renderPicker offers a retry while keeping region choices available. */ }
  if ($('picker').open) { renderScopeCoverage(); renderPicker(); }
}
function openPicker(target) {
  state.pickerTarget = target;
  const picker = $('picker'), input = $('pickerInput'), destination = target === 'destination';
  picker.classList.toggle('destination-picker', destination);
  $('pickerTitle').textContent = destination ? 'Куда летите?' : 'Откуда вылетаете?';
  const placeholder = destination ? 'Страна, город или аэропорт' : 'Город, аэропорт или код';
  input.placeholder = placeholder;
  input.setAttribute('aria-label', placeholder);
  input.value = '';
  if (destination) {
    $('pickerRegions').innerHTML = Object.entries(DESTINATION_SCOPES).map(([key, { label }]) =>
      `<button type="button" class="region-option" data-region="${key}">${esc(label)}${icon('check')}</button>`
    ).join('');
    $('pickerCoverage').open = false;
    renderScopeCoverage();
  }
  const focusSearch = matchMedia('(hover: hover) and (pointer: fine)').matches;
  input.toggleAttribute('autofocus', focusSearch);
  picker.querySelector('[data-close]').toggleAttribute('autofocus', !focusSearch);
  picker.showModal();
  picker.querySelector('.sheet-body').scrollTop = 0;
  loadPickerCities();
}
function choose(iata, cityCode) {
  const q = state.query;
  if (state.pickerTarget === 'origin') {
    q.origin = iata; q.originCity = cityCode; state.labels.origin = airportLabel(iata, cityCode);
    const airport = state.byIata.get(iata);
    // Выбор запоминается: в следующий раз и на страницах городов цены будут из этого города.
    if (airport) saveOrigin({ code: airport.city_code, iata, all: Boolean(cityCode), name: airport.city, from: state.fromNames.get(airport.city_code) ?? null }, true);
  } else {
    const { countries } = DESTINATION_SCOPES[q.region];
    if (countries.length && !countries.includes(state.byIata.get(iata).country_code)) q.region = 'any';
    q.destination = iata; q.destinationCity = cityCode; state.labels.destination = airportLabel(iata, cityCode);
  }
  $('picker').close();
  renderForm();
  // Подборки — из нового города вылета.
  if (state.pickerTarget === 'origin' && state.view === 'showcase') showShowcase();
}
function showFavorites(focusTitle = true) {
  const detailed = location.hash === '#fav/compare';
  if (state.view === 'fav' && detailed === state.favoriteDetails) return;
  state.favoriteDetails = detailed;
  setView('fav');
  renderFavorites();
  window.scrollTo({ top: 0 });
  if (focusTitle) $('favoriteTitle').focus({ preventScroll: true });
}

// --- события ---
$('originPick').addEventListener('click', () => openPicker('origin'));
$('originTitle').addEventListener('click', () => openPicker('origin'));
$('destinationPick').addEventListener('click', () => openPicker('destination'));
for (const trigger of document.querySelectorAll('#originTitle, #originPick, #destinationPick, [data-field="origin"], [data-field="destination"]')) {
  const preload = () => loadAirports().catch(() => {});
  trigger.addEventListener('pointerenter', preload, { once:true });
  trigger.addEventListener('focus', preload, { once:true });
}
$('pickerInput').addEventListener('input', () => {
  $('picker').querySelector('.sheet-body').scrollTop = 0;
  renderPicker();
});
$('pickerInput').addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !event.isComposing) {
    event.preventDefault();
    $('picker').close();
  }
});
$('pickerList').addEventListener('click', (event) => {
  if (event.target.closest('[data-retry-airports]')) { loadPickerCities(); return; }
  const row = event.target.closest('[data-iata]');
  if (row) choose(row.dataset.iata, row.dataset.city ?? null);
});
$('pickerRegions').addEventListener('click', (event) => {
  const option = event.target.closest('[data-region]');
  if (!option) return;
  const q = state.query;
  const region = option.dataset.region;
  Object.assign(q, { region, destination: null, destinationCity: null });
  state.labels.destination = null;
  $('picker').close();
  if (matchMedia('(max-width: 899px)').matches) collapseForm(false);
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
function planFor(offer) {
  return savedTrips().find(p => p.id === offer.id) ?? snapshot(offer);
}
function showWaiting(offer) {
  if (!$('detail').open || state.detail !== offer || $('waiting')) return;
  const plan = planFor(offer);
  $('detailTitle').textContent = 'Моя поездка';
  $('detailBody').innerHTML = `<div class="detail waiting" id="waiting">
    <header class="plan-hero"><div><p class="label">Пока смотрите билет</p><h2>${esc(plan.city)}</h2>
    <p>${esc(plan.from)} → ${esc(plan.city)} · ${esc(tripDates(plan).label)}</p></div>
    ${state.photos.has(plan.cityCode) ? `<div class="plan-photo"><img src="/photos/s/${esc(plan.cityCode)}.webp" alt=""></div>` : ''}</header>
    <div id="returnPrompt"></div><div id="waitingOptions" class="plan-options"></div>
    <a class="btn-inline" href="${esc(tripPath(plan))}">Открыть план поездки ${icon('arrow-right')}</a>
    <button type="button" class="btn-inline" data-ticket-details>Вернуться к билету</button></div>`;
  $('detailBody').scrollTop = 0;
  const options = $('waitingOptions');
  import('./lib/plan-links.js').then(async ({planCatalog, localActivities}) => {
    options.innerHTML = localActivities(plan, await planCatalog(), 'wait', testVariant);
  }).catch(() => {});
}
function onReturn() {
  const offer = state.detail;
  if (document.visibilityState !== 'visible' || !offer || state.backFrom !== offer.id || !$('detail').open) return;
  state.backFrom = null;
  if (afterTicket === 'B') {
    showWaiting(offer);
    if (firstPrompt(offer.id)) $('returnPrompt').innerHTML = `<section class="card plan-prompt" aria-label="Сохранение поездки">
      <h3>Купили билет?</h3><button class="btn-primary" data-save-plan type="button">Сохранить поездку</button>
      <button class="btn-inline" type="button" data-dismiss-plan>Скрыть</button></section>`;
    return;
  }
  if (state.nudged.has(offer.id)) return;
  const hotel = lodging(offer, 'hotelback'), cta = $('detailBody').querySelector('.detail-cta');
  if (!hotel || !cta) return;
  state.nudged.add(offer.id);
  cta.insertAdjacentHTML('afterbegin', `<div class="cta-hotel">
    <a class="cta-hotel-link" href="${esc(hotel.link)}" target="_blank" rel="noopener" data-partner="aviasales" data-block="hotelback">${icon('bed')}<span>Билеты — на Aviasales. А жильё? <b>Отели: ${esc(offer.city)}, ${esc(hotel.dates)}</b><small class="ad-mark">Реклама · Aviasales</small></span></a>
    <button type="button" class="cta-hotel-close" aria-label="Скрыть подсказку про жильё" data-hotel-close>${icon('close')}</button>
  </div>`);
}
document.addEventListener('visibilitychange', onReturn);
window.addEventListener('focus', onReturn);
const detailNav = $('detail').querySelector('.detail-nav');
for (const link of document.querySelector('.top .nav').children) detailNav.append(link.cloneNode(true));
$('share').addEventListener('click', shareTrip);
$('searchLine').addEventListener('click', (event) => {
  const field = event.target.closest('[data-field]')?.dataset.field;
  if (!field) return;
  if (field === 'origin' || field === 'destination') { openPicker(field); return; }
  collapseForm(false);
  ({ when: state.query.exact ? $('departureDate') : $('month'), budget: $('budget') })[field]?.focus();
});
$('showcase').addEventListener('click', (event) => {
  const compare = event.target.closest('[data-compare-row]');
  if (compare) {
    compare.focus({ preventScroll: true });
    history.pushState({ compareRow: compare.dataset.compareRow }, '');
    syncComparison();
    return;
  }
  const level = event.target.closest('[data-level]');
  if (level) { toggleLevel(level); return; }
  const all = event.target.closest('[data-row-all]');
  if (all) { goal('select_idea', { idea: `row-${all.dataset.rowAll}` }); showCollection(all.dataset.rowAll); return; }
  if (event.target.closest('[data-action="retryHome"]')) { loadHome(); return; }
  const fav = event.target.closest('[data-fav]');
  if (fav) {
    const key = fav.closest('[data-feed]').dataset.feed;
    toggleFav(fav.dataset.fav, key);
    $('resultsStatus').textContent = pairLabel(key);
    return;
  }
  if (event.target.closest('[data-more-rows]')) { state.allRows = true; renderShowcase(); return; }
  const open = event.target.closest('[data-open]');
  const offer = open && feedOffer(open.dataset.row, open.dataset.open);
  if (offer) { goal('select_idea', { idea: `row-${open.dataset.row}` }); openDetail(offer); }
});
// Закрытие карточки рукой отступает на её запись в истории, один раз: сюда приходят и щелчок, и событие закрытия диалога.
let leaving = false;
function leaveTrip() { if (!leaving && history.state?.trip) { leaving = true; history.back(); } }
window.addEventListener('popstate', () => {
  leaving = false;
  if (history.state?.compareRow || $('pairComparison').open) syncComparison();
  if (!history.state?.trip && $('detail').open) $('detail').close();
  if (!history.state?.trip) syncView();
});
$('pairComparison').addEventListener('close', () => {
  if (!$('pairComparison').open && history.state?.compareRow) history.back();
});
window.addEventListener('storage', (event) => {
  if (event.storageArea !== localStorage || ![null, 'aviator.favorites', choiceKey].includes(event.key)) return;
  state.favs = readFavs();
  favoriteChoice = readChoice();
  removedFavorite = null;
  if ($('favoritePicker').open) $('favoritePicker').close();
  refreshFavorites();
});
window.addEventListener('hashchange', () => { if (favoritesHash()) showFavorites(); });
document.querySelector('.skip').addEventListener('click', event => {
  if (state.view === 'fav') { event.preventDefault(); $('favoriteTitle').focus(); }
});
$('favoriteOptions').addEventListener('change', updateFavoriteOptions);
$('applyFavoriteChoice').addEventListener('click', () => {
  const ids = [...$('favoriteOptions').querySelectorAll('input:checked')].map(input => input.value).filter(id => state.favs.has(id));
  if (ids.length < 2 || ids.length > 4) return;
  saveChoice(ids);
  removedFavorite = null;
  $('favoritePicker').close();
  if (location.hash !== '#fav/compare') location.hash = 'fav/compare';
  else { renderFavorites(); $('favoriteTitle').focus({ preventScroll: true }); }
});
$('searchSummary').addEventListener('click', () => { collapseForm(false); $('originPick').focus(); });
$('detailBody').addEventListener('click', (event) => {
  const fav = event.target.closest('[data-fav]');
  if (fav) { toggleFav(fav.dataset.fav); return; }
  if (event.target.closest('[data-hotel-close]')) { event.target.closest('.cta-hotel').remove(); return; }
  if (event.target.closest('[data-dismiss-plan]')) {
    $('returnPrompt').replaceChildren();
    $('waiting').querySelector('a[href^="/trip.html"]').focus();
    return;
  }
  if (event.target.closest('[data-ticket-details]')) { openDetail(state.detail); return; }
  if (event.target.closest('[data-save-plan]')) {
    const plan = planFor(state.detail);
    saveTrip(plan);
    goal('save_trip', { city: plan.cityCode, page:'waiting', variant:afterTicket });
    location.assign(tripPath(plan));
    return;
  }
  const partner = event.target.closest('a[data-partner]');
  if (partner) {
    goal('affiliate_click', { partner: partner.dataset.partner, block: partner.dataset.block, city: state.detail?.city_code, variant:afterTicket });
    if (partner.dataset.block === 'tickets') {
      const offer = state.detail;
      state.backFrom = offer.id;
      if (afterTicket === 'B') setTimeout(() => { if (state.backFrom === offer.id) showWaiting(offer); }, 0);
    }
  }
  const hint = event.target.closest('[data-longer]') && longer(state.detail);
  if (hint) { goal('select_idea', { idea: 'longer' }); openDetail(hint.trip); return; }
  const nearby = event.target.closest('[data-shifted]') && shifted(state.detail);
  if (nearby) { goal('select_idea', { idea: 'shifted' }); openDetail(nearby.trip); return; }
  const other = state.alike?.get(event.target.closest('[data-similar]')?.dataset.similar);
  if (other) { goal('select_idea', { idea: 'similar' }); openDetail(other); }
});

$('results').addEventListener('click', (event) => {
  if (event.target.closest('[data-choose-favorites]')) { openFavoritePicker(); return; }
  if (event.target.closest('#undoFavorite')) { undoFavorite(); return; }
  const chip = event.target.closest('[data-chip]'), act = event.target.closest('[data-action]'), open = event.target.closest('[data-offer]'), fav = event.target.closest('[data-fav]');
  const level = event.target.closest('[data-level]'), page = event.target.closest('[data-page]');
  if (level) { toggleLevel(level); return; }
  if (fav) { toggleFav(fav.dataset.fav); return; }
  if (page && !page.disabled) { state.page = Number(page.dataset.page); renderResults(); $('results').scrollIntoView({ block: 'start' }); return; }
  if (chip) {
    if (chip.dataset.chip === 'all') { for (const name of Object.keys(state.filters)) state.filters[name] = false; state.length = 'any'; }
    else {
      state.filters[chip.dataset.chip] = !state.filters[chip.dataset.chip];
      if (state.filters[chip.dataset.chip]) goal('select_idea', { idea: `filter-${chip.dataset.chip}` });
    }
    state.page = 1;
    renderResults();
  } else if (act) {
    const name = act.dataset.action, q = state.query;
    if (name === 'favorites') { history.pushState(null, '', '/#fav'); showFavorites(); return; }
    if (name === 'showcase' || (name === 'results' && !state.performed && homeVariant === 'B')) { history.pushState(null, '', location.pathname); showShowcase(); window.scrollTo({ top: 0 }); return; }
    if (name === 'results') { setView(state.collection && !state.performed ? 'collection' : 'results'); if (location.hash === '#fav') history.replaceState(history.state, '', location.pathname + location.search); renderResults(); $('results').scrollIntoView({ block: 'start' }); return; }
    if (name === 'allLengths') { state.length = 'all'; state.page = 1; renderResults(); return; }
    if (name === 'resetFilters') { for (const key of Object.keys(state.filters)) state.filters[key] = false; state.length = 'any'; renderResults(); return; }
    if (name === 'edit') { collapseForm(false); $('search').scrollIntoView({ block: 'start' }); return; }
    if (name !== 'retry') { Object.assign(q, state.performed); state.labels = { ...state.performedLabels }; }
    if (name === 'moreBudget') q.budget = Math.min(500000, q.budget + 10000);
    if (name === 'allowTransfers') q.direct = false;
    if (name === 'allTrips') q.weekend = false;
    renderForm();
    search({ scroll: false });
  } else if (open && state.shown.has(open.dataset.offer)) {
    openDetail(state.shown.get(open.dataset.offer));
  }
});
$('results').addEventListener('change', (event) => {
  if (event.target.id === 'sort') { state.sort = event.target.value; state.page = 1; renderResults(); }
  if (event.target.id === 'length') { state.length = event.target.value; state.page = 1; if (state.length !== 'any') goal('select_idea', { idea: `length-${state.length}` }); renderResults(); }
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
  if (Object.hasOwn(DESTINATION_SCOPES, params.get('region'))) q.region = params.get('region');
  if (code('to') && state.byIata.has(code('to'))) { q.destination = code('to'); q.destinationCity = code('tc'); state.labels.destination = airportLabel(q.destination, q.destinationCity); }
  const budget = Number(params.get('budget'));
  if (Number.isInteger(budget) && budget >= 5000 && budget <= 500000) q.budget = budget;
  q.direct = params.get('direct') === '1';
  if (day('dep') && day('ret')) { q.exact = true; q.departure = day('dep'); q.returning = day('ret'); q.month = q.departure.slice(0, 7); }
  else { if (months(originZone()).includes(params.get('month'))) q.month = params.get('month'); q.weekend = params.get('weekend') !== '0'; }
  return true;
}
// Фото в шапке — до низа свёрнутой формы (+ немного воздуха): тёмные заголовки ниже не попадают на фото.
function fitHero() {
  if (state.view === 'fav' || !$('search').classList.contains('search--collapsed')) return;
  document.documentElement.style.setProperty('--hero-h', `${Math.round($('search').getBoundingClientRect().bottom + scrollY + 28)}px`);
}
addEventListener('resize', fitHero);
document.fonts?.ready.then(fitHero);
(async () => {
  mountSky();
  renderForm();
  fitHero();
  // Photos and offers may arrive in either order. Hydrate placeholders in place to preserve scroll and focus.
  fetch('/photos/manifest.json', { cache: 'no-cache' }).then(response => response.ok ? response.json() : []).then(codes => {
    state.photos = new Set(codes);
    for (const slot of document.querySelectorAll('[data-photo]')) {
      if (state.photos.has(slot.dataset.photo)) slot.firstElementChild.outerHTML = photoImage(slot.dataset.photo, slot.dataset.wide === 'true');
      delete slot.dataset.photo;
    }
  }).catch(() => {});
  fetch('/data/hotel-locations.json').then((response) => response.ok ? response.json() : {}).then((hotels) => { state.hotels = hotels; }).catch(() => {});
  fetch('/data/origins.json').then((response) => response.ok ? response.json() : null).then((data) => { for (const origin of data?.cities ?? []) state.fromNames.set(origin.code, origin.from); renderForm(); }).catch(() => {});
  fetch('/data/cities.json').then((response) => response.ok ? response.json() : null).then((data) => { state.cityPages = new Map((data?.cities ?? []).map((city) => [city.code, city.slug])); }).catch(() => {});
  fetch('/data/city-guides.json').then((response) => response.ok ? response.json() : {}).then((guides) => { state.guides = guides; if (state.status === 'done') renderResults(); }).catch(() => {});
  if (favoritesHash()) showFavorites(false);
  const restored = await restore();
  // Без параметров поиска в адресе — город вылета посетителя: его выбор или ближайший город по местоположению.
  if (!restored) {
    const origin = await currentOrigin();
    if (origin) {
      Object.assign(state.query, { origin: origin.iata, originCity: origin.all ? origin.code : null });
      state.labels.origin = `${origin.name} · ${origin.all ? 'все аэропорты' : origin.iata}`;
      if (origin.from) state.fromNames.set(origin.code, origin.from);
    }
  }
  renderForm();
  fitHero();
  if (favoritesHash()) return;
  if (restored && $('picker').open) { renderScopeCoverage(); renderPicker(); }
  // Прочитать до поиска: поиск переписывает адрес и убирает хеш.
  const tripId = new URLSearchParams(location.search).get('trip') ?? location.hash.replace(/^#trip=/, '');
  const linked = restored && /^[0-9a-f]{32}$/.test(tripId) && tripId;
  // Вариант A эксперимента — голая форма: ничего не грузится, пока посетитель не начнёт поиск.
  const wantRow = !restored && /^#row=([a-z0-9]+)$/.exec(location.hash)?.[1];
  if (restored) search({ scroll: false }).then(() => { if (linked && state.status === 'done') openLinked(linked); });
  // Эксперимент home: A — прежняя главная (форма и сразу список), B — витрина с подборками.
  else if (homeVariant === 'A') search({ scroll: false, auto: true });
  else { showShowcase(); if (wantRow) loadHomeThen(() => showCollection(wantRow, false)); }
})();

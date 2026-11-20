import { $, adMark, esc } from './lib/ui.js';
import { partnerLink } from './lib/links.js';
import { DEFAULT_ZONE, defaultMonth, fmtDate, fmtMoney, localZone, monthLabel, months, nightsLabel, plural, zoned } from './lib/format.js';
import { currentOrigin } from './lib/origin.js';
import { snapshot, tripPath } from './lib/trip.js';
import { groupBudget, meetingCities, stayWindow, usableOffer } from './lib/together.js';

const params = new URLSearchParams(location.search);
const origins = new Map(), destinations = new Map();
const estimates = new Map();
let saved = [], found = [], choices = ['', ''], meeting = null, pageSize = 5;
const requests = new Map();
const fmtInstant = (value, zone) => fmtDate(new Date(value), zone, true);
const peopleLabel = n => `${n} ${plural(n, 'человек', 'человека', 'человек')}`;
const option = (value, label) => `<option value="${esc(value)}">${esc(label)}</option>`;
const offerLabel = o => `${o.origin_city} → ${o.city}, ${fmtInstant(o.departure_at, o.origin_timezone)} — ${fmtInstant(o.return_at, o.destination_timezone)}, ${fmtMoney(o.price_minor)}, ${o.origin_airport} → ${o.destination_airport}${o.flight_number ? ', ' + (o.airline ?? '') + ' ' + o.flight_number : ''}`;

function readList(key) {
  try { const value = JSON.parse(localStorage.getItem(key)); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function catalog() {
  return new Map([...saved, ...found].filter(o => usableOffer(o)).map(o => [o.id, o]));
}
function loadSaved() {
  saved = readList('aviator.favorites').filter(o => usableOffer(o));
  const ids = new Set(saved.map(o => o.id));
  const chosen = [...new Set(readList('aviator.favoriteComparison'))].filter(id => ids.has(id));
  const preferred = chosen.length >= 2 ? chosen : [...ids];
  choices = ['a', 'b'].map((key, i) => params.has(key) ? (ids.has(params.get(key)) ? params.get(key) : '') : preferred[i] ?? '');
  if (choices[0] === choices[1]) choices[1] = '';
  renderBudget();
  if (['a', 'b'].some((key, i) => params.has(key) && !choices[i])) {
    $('budgetStatus').textContent = 'Один из билетов по ссылке больше не доступен в избранном этого браузера. Выберите другой рейс.';
  } else if (!saved.length) {
    $('budgetStatus').innerHTML = 'Найдите рейсы выше или добавьте билеты в <a href="/#fav">избранное</a>.';
  }
}
function fareReference(offer) {
  let path, link;
  if (/^[a-f0-9]{32}$/.test(offer.id) && stayWindow(offer)) {
    path = tripPath(snapshot(offer));
    link = 'Маршрут поездки';
  } else {
    const dep = zoned(new Date(offer.departure_at), offer.origin_timezone).key;
    const ret = zoned(new Date(offer.return_at), offer.destination_timezone).key;
    const days = (Date.parse(ret) - Date.parse(dep)) / 86400000;
    const query = new URLSearchParams({ from: offer.origin_airport, to: offer.destination_airport });
    if (days >= 1 && days <= 60) { query.set('dep', dep); query.set('ret', ret); }
    else { query.set('month', dep.slice(0, 7)); query.set('weekend', '0'); query.set('length', days === 0 ? 'day' : 'all'); }
    path = '/?' + query;
    link = 'Открыть поиск рейса';
  }
  const ticket = partnerLink(offer.search_url, { kind: 'tickets', city: offer.city_code, page: 'together', block: 'tickets' });
  return `<div class="together-fare"><p>${esc(offer.origin_city)} (${esc(offer.origin_airport)}) → ${esc(offer.city)} (${esc(offer.destination_airport)})</p>
    <p class="caption">Туда ${esc(fmtInstant(offer.departure_at, offer.origin_timezone))}, обратно ${esc(fmtInstant(offer.return_at, offer.destination_timezone))}. Местное время.</p>
    <p><b>${esc(fmtMoney(offer.price_minor))}</b> на одного туда и обратно</p>
    <p class="caption">Данные Aviasales получены ${esc(fmtInstant(offer.received_at, localZone))} по вашему времени.</p>
    <div class="together-links"><a href="${esc(path)}">${link}</a>${ticket ? `<a href="${esc(ticket)}" target="_blank" rel="noopener">Проверить цену на Aviasales ↗</a>` : ''}</div>
    ${ticket ? adMark('aviasales') : ''}</div>`;
}

function row(label, value, sum = false) {
  return `<div${sum ? ' class="sum"' : ''}><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}
function estimate(offer) {
  if (!estimates.has(offer.id)) estimates.set(offer.id, { rate: '', extra: '' });
  return estimates.get(offer.id);
}
function amount(value) {
  const n = Number(value);
  return value !== '' && Number.isSafeInteger(n) && n >= 0 && n <= 1e8 ? n : null;
}
function expenseField(index, key, label, value) {
  return `<label>${label}<input data-side="${index}" data-cost="${key}" type="number" min="0" max="100000000" step="1" inputmode="numeric" placeholder="Пока неизвестно" value="${esc(value)}"></label>`;
}
function renderBudget() {
  const available = catalog();
  $('budgetComparison').hidden = available.size === 0;
  const sorted = [...available.values()].sort((a, b) => a.city.localeCompare(b.city, 'ru') || Date.parse(a.departure_at) - Date.parse(b.departure_at) || a.price_minor - b.price_minor);
  $('budgetCards').innerHTML = choices.map((id, i) => {
    const offer = available.get(id), costs = offer && estimate(offer);
    const eligible = sorted.filter(o => o.id !== choices[1 - i]);
    const cities = new Map(eligible.map(o => [o.city_code, o.city]));
    const cityOptions = [...cities].map(([code, name]) => option(code, name)).join('');
    const flightOptions = eligible.filter(o => o.city_code === offer?.city_code).map(o => option(o.id, offerLabel(o))).join('');
    const select = `<label>Куда<select data-city="${i}">${option('', 'Выберите город')}${cityOptions}</select></label>
      <label>Билет<select data-trip="${i}" ${offer ? '' : 'disabled'}>${offer ? flightOptions : option('', 'Сначала выберите город')}</select></label>`;
    return `<article class="card"><h3>${i === 0 ? 'Первая поездка' : 'Вторая поездка'}</h3>${select}${offer ? `${fareReference(offer)}
      ${expenseField(i, 'rate', 'Жильё, ₽ за ночь на всех', costs.rate)}
      ${expenseField(i, 'extra', 'Прочие расходы, ₽ на всех за поездку', costs.extra)}
      <dl id="sum${i}" class="together-summary"></dl>` : ''}</article>`;
  }).join('');
  document.querySelectorAll('[data-city]').forEach((select, i) => { select.value = available.get(choices[i])?.city_code ?? ''; });
  document.querySelectorAll('[data-trip]').forEach((select, i) => { select.value = choices[i]; });
  renderTotals(available);
}
function renderTotals(available = catalog()) {
  const people = Number($('budgetPeople').value);
  const totals = choices.map((id, i) => {
    const offer = available.get(id);
    if (!offer || !$('sum' + i)) return null;
    const costs = estimate(offer), b = groupBudget(offer, people, amount(costs.rate), amount(costs.extra));
    const unknown = 'Пока неизвестно';
    $('sum' + i).innerHTML = row('Билеты на ' + peopleLabel(people), fmtMoney(b.tickets))
      + row(b.nights === null ? 'Жильё, число ночей неизвестно' : 'Жильё, ' + nightsLabel(b.nights), b.stay === null ? unknown : fmtMoney(b.stay))
      + row('Прочие расходы', b.other === null ? unknown : fmtMoney(b.other))
      + row(b.complete ? 'Всего по оценке' : 'Известные расходы', fmtMoney(b.known), true)
      + row(b.complete ? 'На человека' : 'Учтено на человека', fmtMoney(Math.round(b.known / people)));
    return b;
  });
  let message = '';
  if (!totals.every(Boolean)) message = 'Для сравнения выберите два разных билета.';
  else if (totals.some(b => b.nights === null && b.stay === null)) message = 'Неизвестно время прилёта по одному из билетов. Количество ночей и расходы на жильё по этому рейсу пока не посчитать.';
  else if (!totals.every(b => b.complete)) message = 'Для сравнения полной суммы нужны расходы по обеим поездкам. Если расходов нет, введите 0.';
  else {
    const difference = totals[0].known - totals[1].known;
    message = difference === 0 ? 'Обе поездки стоят одинаково по вашей оценке.'
      : `${difference < 0 ? 'Первая' : 'Вторая'} поездка дешевле примерно на ${fmtMoney(Math.abs(difference))} на всех.`;
  }
  $('budgetDifference').textContent = message;
}
function refreshBudgetChoices() {
  const options = [...catalog().values()].sort((a, b) => a.price_minor - b.price_minor);
  const first = options.find(o => o.id === choices[0]) ?? options[0];
  const second = options.find(o => o.id === choices[1] && o.id !== first?.id)
    ?? options.find(o => o.city_code !== first?.city_code) ?? options.find(o => o.id !== first?.id);
  choices = [first?.id ?? '', second?.id ?? ''];
  renderBudget();
}

async function search(origin, month, destination, signal) {
  const query = new URLSearchParams({ from: origin.iata, month, weekend: '0' });
  if (origin.all) query.set('fc', origin.code);
  if (destination) { query.set('to', destination.airport); query.set('tc', destination.code); }
  const response = await fetch('/api/v1/search/web?' + query, { signal });
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data?.offers)) throw new Error(data?.error?.message || 'Не удалось получить билеты. Повторите поиск.');
  return { offers: data.offers.filter(o => usableOffer(o)), partial: Boolean(data.incomplete) };
}
function showOutcome(mode) {
  if ($(mode).hidden || !matchMedia('(max-width: 680px)').matches) return;
  const status = $(mode + 'Status');
  status.focus({ preventScroll: true }); status.scrollIntoView({ block: 'start' });
}
function cancel(key) {
  requests.get(key)?.abort();
  requests.delete(key);
}
function start(key) {
  cancel(key);
  const controller = new AbortController(); requests.set(key, controller); return controller.signal;
}
$('budgetSearch').addEventListener('submit', async event => {
  event.preventDefault();
  const origin = origins.get($('budgetOrigin').value);
  if (!origin) return;
  const signal = start('budget');
  found = []; refreshBudgetChoices();
  $('budgetStatus').textContent = 'Ищем билеты…';
  try {
    const result = await search(origin, $('budgetMonth').value, null, signal);
    if (signal.aborted) return;
    found = result.offers; refreshBudgetChoices();
    $('budgetStatus').textContent = (found.length ? `Найдено билетов: ${found.length}.` : 'По этому запросу билетов пока нет.') + (result.partial ? ' Получена часть выдачи.' : '');
  } catch (error) { if (!signal.aborted) $('budgetStatus').textContent = error.message; }
  if (!signal.aborted) showOutcome('budget');
});
$('budgetCards').addEventListener('change', event => {
  const { city, trip } = event.target.dataset;
  if (city === undefined && trip === undefined) return;
  const side = Number(city ?? trip);
  if (city !== undefined) {
    const flights = [...catalog().values()].filter(o => o.city_code === event.target.value && o.id !== choices[1 - side]);
    choices[side] = flights.sort((a, b) => a.price_minor - b.price_minor)[0]?.id ?? '';
  } else choices[side] = event.target.value;
  renderBudget();
  document.querySelector(`[data-${city === undefined ? 'trip' : 'city'}="${side}"]`).focus({ preventScroll: true });
});
$('budgetCards').addEventListener('input', event => {
  const { side, cost } = event.target.dataset;
  if (!cost) return;
  const offer = catalog().get(choices[Number(side)]);
  if (offer) { estimate(offer)[cost] = event.target.value; renderTotals(); }
});
$('budgetPeople').addEventListener('change', () => renderTotals());

function partyCard(offer, people) {
  return `<section><h4>${esc(offer.origin_city)}, ${esc(peopleLabel(people))}</h4><p><b>${esc(fmtMoney(offer.price_minor * people))}</b> за билеты группы</p>${fareReference(offer)}</section>`;
}
function renderMeetings() {
  if (!meeting) return;
  const firstPeople = Number($('firstPeople').value), secondPeople = Number($('secondPeople').value);
  const cities = meetingCities(meeting.first, meeting.second, firstPeople, secondPeople);
  const mode = $('meetSort').value;
  const pairs = [...cities.values()].map(city => city[mode]).sort((a, b) => mode === 'cheap'
    ? a.cost - b.cost || b.minutes - a.minutes : b.minutes - a.minutes || a.cost - b.cost);
  $('meetOptions').hidden = !pairs.length;
  const partial = meeting.partial ? ' Получена часть выдачи.' : '';
  const status = !meeting.first.length || !meeting.second.length ? `Для ${!meeting.first.length && !meeting.second.length ? 'обеих групп' : !meeting.first.length ? 'первой группы' : 'второй группы'} пока нет билетов. Попробуйте другой месяц.`
    : !pairs.length ? 'В найденных рейсах нет подтверждённого пересечения по городу и времени. Попробуйте выбрать город встречи или другой месяц.'
    : `Городов с общим временем: ${pairs.length}. Для каждого показана одна пара рейсов по выбранному условию.`;
  $('meetStatus').textContent = status + partial;
  $('meetResults').innerHTML = pairs.slice(0, pageSize).map(pair => {
    const zone = pair.left.destination_timezone;
    const hours = Math.floor(pair.minutes / 60), mins = pair.minutes % 60;
    const duration = [hours && hours + ' ч', mins && mins + ' мин'].filter(Boolean).join(' ');
    return `<article class="card"><div class="together-meeting"><h3>${esc(pair.left.city)}</h3>
      <p><strong>${duration} вместе</strong>, билеты на всех ${esc(fmtMoney(pair.cost))}</p>
      <p>${esc(fmtInstant(pair.start, zone))} — ${esc(fmtInstant(pair.end, zone))}</p>
      <p class="caption">Местное время. От расчётного прилёта последней группы до первого обратного вылета. Дорога из аэропорта и обратно входит в этот интервал.</p></div>
      <div class="together-grid">${partyCard(pair.left, firstPeople)}${partyCard(pair.right, secondPeople)}</div></article>`;
  }).join('') + (pairs.length > pageSize ? '<button type="button" class="btn-inline" id="moreMeetings">Показать ещё города</button>' : '')
    + (pairs.length ? '<p class="caption">Предложения получены на одного взрослого. Наличие мест для всей группы проверяется при покупке.</p>' : '');
}
function resetMeeting() {
  cancel('meet'); meeting = null; pageSize = 5;
  $('meetOptions').hidden = true; $('meetResults').replaceChildren(); $('meetStatus').textContent = '';
}
$('meetSearch').addEventListener('submit', async event => {
  event.preventDefault(); resetMeeting();
  const first = origins.get($('firstOrigin').value), second = origins.get($('secondOrigin').value);
  const destination = destinations.get($('meetDestination').value);
  if (!first || !second) return;
  if (first.code === second.code) { $('meetStatus').textContent = 'Выберите два разных города вылета.'; return; }
  if (destination && [first.code, second.code].includes(destination.code)) { $('meetStatus').textContent = 'Выберите город встречи, куда обе группы могут прилететь.'; return; }
  const month = $('meetMonth').value, signal = start('meet');
  $('meetStatus').textContent = 'Ищем рейсы из обоих городов…';
  try {
    const [a, b] = await Promise.all([search(first, month, destination, signal), search(second, month, destination, signal)]);
    if (signal.aborted) return;
    meeting = { first: a.offers, second: b.offers, partial: a.partial || b.partial }; renderMeetings(); showOutcome('meet');
  } catch (error) { if (!signal.aborted) { cancel('meet'); $('meetStatus').textContent = 'Не удалось сравнить обе выдачи. ' + error.message; } }
});
$('meetSort').addEventListener('change', () => { pageSize = 5; renderMeetings(); });
$('meetSearch').addEventListener('change', event => {
  if (['firstPeople','secondPeople'].includes(event.target.id)) { if (meeting) renderMeetings(); }
  else resetMeeting();
});
$('meetResults').addEventListener('click', event => {
  if (event.target.closest('#moreMeetings')) { pageSize += 5; renderMeetings(); }
});
$('budgetSearch').addEventListener('change', () => {
  cancel('budget'); found = []; refreshBudgetChoices(); $('budgetStatus').textContent = 'Нажмите «Найти варианты», чтобы обновить список билетов.';
});
function setMode() {
  const mode = location.hash === '#meet' ? 'meet' : 'budget';
  for (const name of ['budget', 'meet']) {
    $(name).hidden = mode !== name;
    const link = document.querySelector(`.together-modes a[href="#${name}"]`);
    if (name === mode) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
}
async function initSearch() {
  const period = months(DEFAULT_ZONE).map(m => option(m, monthLabel(m))).join('');
  for (const id of ['budgetMonth', 'meetMonth']) { $(id).innerHTML = period; $(id).value = defaultMonth(DEFAULT_ZONE); }
  try {
    const response = await fetch('/data/origins.json');
    if (!response.ok) throw new Error();
    const items = (await response.json()).cities;
    for (const item of items) origins.set(item.code, item);
    const list = items.map(o => option(o.code, o.name)).join('');
    for (const id of ['budgetOrigin', 'firstOrigin', 'secondOrigin']) $(id).innerHTML = list;
    $('secondOrigin').value = 'LED';
    const selected = await currentOrigin();
    // A slow location hint must not overwrite choices already made in either form.
    if (selected && origins.has(selected.code) && !originEdited) {
      $('firstOrigin').value = $('budgetOrigin').value = selected.code;
      $('secondOrigin').value = selected.code === 'LED' ? 'MOW' : 'LED';
    }
  } catch {
    for (const id of ['budgetStatus','meetStatus']) $(id).textContent = 'Не удалось загрузить города вылета. Обновите страницу, чтобы повторить.';
  }
}
async function loadDestinations() {
  try {
    const response = await fetch('/data/cities.json');
    if (!response.ok) return;
    for (const city of (await response.json()).cities) destinations.set(city.code, city);
    const options = [...destinations.values()].sort((a,b) => a.name.localeCompare(b.name, 'ru')).map(c => option(c.code, c.name)).join('');
    $('meetDestination').insertAdjacentHTML('beforeend', options);
  } catch { /* Searching across all destinations still works. */ }
}
let originEdited = false;
for (const id of ['budgetSearch', 'meetSearch']) {
  $(id).addEventListener('input', () => { originEdited = true; });
  $(id).addEventListener('submit', () => { originEdited = true; });
}
for (const id of ['budgetPeople','firstPeople','secondPeople']) {
  $(id).innerHTML = Array.from({ length: 9 }, (_, i) => option(i + 1, i + 1)).join('');
}
$('budgetPeople').value = '2';
window.addEventListener('hashchange', setMode);
window.addEventListener('storage', event => {
  if (!['aviator.favorites', 'aviator.favoriteComparison', null].includes(event.key)) return;
  saved = readList('aviator.favorites').filter(o => usableOffer(o)); refreshBudgetChoices();
});
setMode(); loadSaved(); initSearch(); loadDestinations();

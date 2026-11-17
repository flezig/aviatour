import { $, esc, icon } from './lib/ui.js';
import { goal } from './lib/measure.js';
import { daysLabel, fmtDate, fmtDay, fmtMoney, nightsLabel, zoned, addDays, localZone } from './lib/format.js';
import { budget, countdown, decodeTrip, savedTrips, saveTrip, tripDates, tripPath } from './lib/trip.js';
import { localActivities, planCatalog } from './lib/plan-links.js';

const airportRoutes = {
  LED: ['Из Пулково до метро «Московская» ходят автобусы 39 и 39Э.', 'Организатор перевозок', 'https://orgp.spb.ru/airport_pulkovo/'],
  SVO: ['Из Шереметьево на Белорусский вокзал можно доехать поездом «Аэроэкспресс».', 'Аэроэкспресс', 'https://aeroexpress.ru/ru/aero/route/sheremetyevo'],
};
const main = $('plan');
let plan, catalogue, stored;
const dateTime = (value, zone) => esc(fmtDate(new Date(value), zone, true));

function listPlans(invalid) {
  const trips = savedTrips();
  main.innerHTML = `<h1>Мои поездки</h1>${invalid ? '<p role="status">Ссылка на поездку повреждена. Попросите отправить её ещё раз.</p>' : ''}
    ${trips.length ? trips.map(p => `<a class="card plan-list-item" href="${esc(tripPath(p))}"><span><b>${esc(p.city)}</b>
    <small>${esc(p.from)} · ${esc(tripDates(p).label)}</small></span>${icon('arrow-right')}</a>`).join('') : '<p>Сохраните поездку после перехода за билетом. Здесь будут её даты и план.</p><a class="btn-inline" href="/">Найти поездку</a>'}`;
}

function updateLinks() {
  const url = new URL(tripPath(plan), location.href);
  history.replaceState(null, '', url);
  $('telegram').href = 'https://t.me/share/url?' + new URLSearchParams({ url: url.href, text: plan.from + ' → ' + plan.city });
}
function showBudget() {
  const b = budget(plan);
  $('planTickets').textContent = fmtMoney(b.tickets);
  $('planTotal').textContent = (b.complete ? 'Бюджет поездки ≈ ' : 'Учтено расходов на ') + fmtMoney(b.total);
}
function showCity() {
  const g = catalogue.guides[plan.cityCode];
  $('activities').innerHTML = localActivities(plan, catalogue, 'plan', reportVariant());
  const city = catalogue.cities.get(plan.cityCode);
  if (city?.photo) {
    $('planPhoto').innerHTML = `<img src="/photos/s/${esc(plan.cityCode)}.webp" alt="">`;
    $('planPhoto').hidden = false;
  }
  if (g?.places?.length) $('places').innerHTML = `<h2>Что посмотреть</h2><ul>${g.places.map(s => `<li>${esc(s)}</li>`).join('')}</ul><p class="caption">Заметки редакции · ${esc(fmtDate(new Date(g.editorial_updated + 'T00:00:00Z'), 'UTC'))}</p>`;
  $('places').hidden = !g?.places?.length;
}
function reportVariant() {
  if (!window.AVIATOR?.experiments?.afterTicket) return '';
  try { return ({ A:'pa', B:'pb' })[localStorage.getItem('aviator.ab.afterTicket')] ?? ''; } catch { return ''; }
}
async function showWeather(p) {
  const dates = tripDates(p), today = zoned(new Date(), p.zone).key;
  if (dates.end < today) return;
  const box = $('weather');
  if (dates.start > addDays(today, 9)) {
    box.innerHTML = '<h2>Погода</h2><p>Срок прогноза — до девяти дней. Загляните ближе к вылету.</p>';
    box.hidden = false;
    return;
  }
  try {
    const r = await fetch('/api/v1/trip-weather/' + p.cityCode);
    const data = r.ok ? await r.json() : null;
    const days = data?.days?.filter(d => d.date >= dates.start && d.date >= today && d.date <= dates.end);
    if (!box.isConnected || !days?.length) return;
    box.innerHTML = `<h2>Погода в поездке</h2><ul class="weather-days">${days.map(d => `<li><span>${esc(fmtDay(new Date(d.date + 'T12:00:00Z'), 'UTC'))}</span><b>${esc(d.low)}…${esc(d.high)} °C</b></li>`).join('')}</ul><p class="caption">Температура по прогнозу <a href="https://www.met.no/en">MET Norway</a> · ${dateTime(data.updated, localZone)} · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></p>`;
    box.hidden = false;
  } catch { /* the itinerary is available when weather is offline */ }
}

function render() {
  plan = decodeTrip(location.hash);
  if (!plan) { listPlans(Boolean(location.hash)); return; }
  stored = savedTrips().some(p => p.id === plan.id && tripPath(p) === tripPath(plan));
  const dates = tripDates(plan), route = airportRoutes[plan.toCode];
  document.title = plan.city + ' · Моя поездка — Aviator';
  main.innerHTML = `<a class="plan-back" href="/trip.html">← Мои поездки</a>
    <header class="plan-hero"><div><p class="label">Моя поездка</p><h1>${esc(plan.city)}</h1><p id="countdown">${esc(countdown(plan))}</p></div><div class="plan-photo" id="planPhoto" hidden></div></header>
    <section class="card"><h2>Маршрут</h2><dl class="plan-route"><div><dt>Туда · ${esc(plan.from)} (${plan.fromCode})</dt><dd>${dateTime(plan.out, plan.fromZone)}</dd></div>
    <div><dt>Обратно · ${esc(plan.city)} (${plan.toCode})</dt><dd>${dateTime(plan.back, plan.zone)}</dd></div></dl><p class="caption">Местное время аэропортов</p>
    ${plan.flight ? `<a class="plan-flight" href="https://www.flightradar24.com/data/flights/${plan.flight.toLowerCase()}" rel="noopener" target="_blank">Рейс ${esc(plan.flight)} на Flightradar24 ↗</a><small class="caption">Сверьте дату и маршрут на странице рейса.</small>` : ''}</section>
    <div class="plan-actions"><button class="btn-primary" type="button" id="savePlan" ${stored ? 'hidden' : ''}>Сохранить в мои поездки</button>
    <a class="btn-inline" id="telegram" target="_blank" rel="noopener">Отправить себе в Telegram</a><button class="btn-inline" type="button" id="copyPlan">Скопировать ссылку</button></div>
    <p class="caption" id="planStatus" role="status">${stored ? 'Сохранено в этом браузере' : ''}</p>
    <section class="card"><h2>Бюджет поездки</h2><p>Билеты туда и обратно · <strong id="planTickets"></strong></p>
    <p class="caption">Цена Aviasales на ${dateTime(plan.quoted, localZone)}. Жильё и питание можно добавить по своей оценке.</p>
    <div class="plan-inputs"><label>Путешественники<select id="people" class="menu">${[1,2,3,4].map(n => `<option ${plan.people === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    ${dates.nights ? `<label>Жильё, ₽ за ночь на всех<input id="stay" type="number" inputmode="numeric" min="0" max="100000000" step="1" value="${plan.stay ?? ''}"></label>` : ''}
    <label>Питание, ₽ в день на человека<input id="food" type="number" inputmode="numeric" min="0" max="100000000" step="1" value="${plan.food ?? ''}"></label></div>
    <p class="caption">${esc(nightsLabel(dates.nights))} · ${esc(daysLabel(dates.nights + 1))} на месте</p><strong id="planTotal" aria-live="polite"></strong></section>
    <section class="card" id="weather" hidden></section><div class="plan-options" id="activities"></div><section class="card" id="places" hidden></section>
    ${route ? `<section class="card"><h2>Из аэропорта в город</h2><p>${esc(route[0])}</p><p class="caption"><a href="${route[2]}">${esc(route[1])}</a> · проверено 17 ноября 2026</p></section>` : ''}`;
  showBudget();
  updateLinks();
  const current = plan;
  planCatalog().then(data => { if (plan === current) { catalogue = data; showCity(); } });
  showWeather(plan);
}

main.addEventListener('input', event => {
  const field = event.target;
  if (!['stay','food','people'].includes(field.id) || !field.validity.valid) return;
  plan[field.id] = field.value === '' ? null : Number(field.value);
  showBudget();
  updateLinks();
  if (stored && !saveTrip(plan)) $('planStatus').textContent = 'Хранилище браузера недоступно. Скопируйте ссылку с изменениями.';
  if (catalogue && field.id === 'people') showCity();
});
main.addEventListener('click', async event => {
  if (!plan) return;
  if (event.target.closest('#savePlan')) {
    stored = saveTrip(plan);
    $('planStatus').textContent = stored ? 'Сохранено в этом браузере' : 'Хранилище браузера недоступно. Скопируйте ссылку на поездку.';
    $('savePlan').hidden = stored;
    goal('save_trip', { city: plan.cityCode, page:'plan' });
  }
  if (event.target.closest('#copyPlan')) {
    try { await navigator.clipboard.writeText(location.href); $('planStatus').textContent = 'Ссылка скопирована'; }
    catch { $('planStatus').textContent = 'Скопируйте адрес страницы'; }
    goal('share', { city:plan.cityCode, page:'plan' });
  }
  if (event.target.closest('#telegram')) goal('share', { city:plan.cityCode, page:'telegram' });
  const a = event.target.closest('[data-partner]');
  if (a) goal('affiliate_click', { partner:a.dataset.partner, block:a.dataset.block, city:plan.cityCode, variant:reportVariant() });
});
window.addEventListener('hashchange', render);
window.addEventListener('pageshow', () => { if (!location.hash) render(); });
function tick() { if (plan && $('countdown')) $('countdown').textContent = countdown(plan); }
document.addEventListener('visibilitychange', tick);
setInterval(tick, 60000);
render();

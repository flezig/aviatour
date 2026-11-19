// На всех экранах билет опознаётся по сохранённому id, даже если города и даты совпадают.
import { esc, icon } from './ui.js';
import { fmtDay, fmtRange, fmtTime, fmtMoney, plural } from './format.js';

export const ticketCount = n => n + ' ' + plural(n, 'билет', 'билета', 'билетов');
const dateTime = offer => {
  const dep = new Date(offer.departure_at);
  return fmtDay(dep, offer.origin_timezone) + ', ' + fmtTime(dep, offer.origin_timezone);
};
const dates = offer => fmtRange(new Date(offer.departure_at), new Date(offer.return_at), offer.origin_timezone, offer.destination_timezone);
const route = offer => [offer.origin_airport, offer.destination_airport].filter(Boolean).join(' → ');
const name = (offer, others) => others.some(other => offer.id !== other.id && offer.city === other.city)
  ? [offer.city, dateTime(offer), offer.flight_number].filter(Boolean).join(', ') : offer.city;

export function hoursMinutes(minutes) {
  if (minutes == null) return 'Нет данных';
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return [hours && hours + ' ч', (rest || !hours) && rest + ' мин'].filter(Boolean).join(' ');
}

function quickComparison(chosen, canChoose, facts) {
  if (chosen.length < 2) return '';
  let title = 'Сравнение билетов', note = chosen.map(offer => name(offer, chosen)).join(', ');
  if (chosen.length === 2) {
    const [a, b] = chosen, difference = Math.abs(a.price_minor - b.price_minor);
    const cheaper = a.price_minor < b.price_minor ? a : b;
    title = difference ? 'Дешевле на ' + fmtMoney(difference) + ' — ' + name(cheaper, chosen) : 'Сохранённые цены совпадают';
    const stayA = facts(a).stay, stayB = facts(b).stay;
    if (stayA == null || stayB == null) note = 'Время на месте: нет данных для сравнения.';
    else {
      const minutes = Math.round(Math.abs(stayA - stayB) * 60);
      note = minutes ? 'На ' + hoursMinutes(minutes) + ' дольше на месте — ' + name(stayA > stayB ? a : b, chosen) : 'Времени на месте поровну.';
    }
  }
  return `<section class="favorite-summary" aria-label="Быстрое сравнение">
    <div><h2>${esc(title)}</h2><p>${esc(note)}</p></div>
    <div class="favorite-actions">${canChoose ? chooseButton('Выбрать билеты') : ''}<a href="#fav/compare" class="btn-primary">Сравнить подробно</a></div></section>`;
}

const chooseButton = label => `<button class="favorite-link" type="button" data-choose-favorites aria-haspopup="dialog">${label}</button>`;
const detailsButton = (offer, label) => `<button type="button" class="favorite-link" data-offer="${esc(offer.id)}">${esc(label)}</button>`;

function removalNotice(removed) {
  return removed ? `<div class="favorite-undo"><span>Убрали билет — ${esc(removed.city)}, ${esc(dateTime(removed))}</span><button type="button" class="favorite-link" id="undoFavorite">Вернуть</button></div>` : '';
}
export function favoriteList(offers, chosen, removed, facts, photo) {
  const undo = removalNotice(removed);
  const header = `<header class="favorite-heading"><div><h1 id="favoriteTitle" tabindex="-1">Избранное</h1>${offers.length ? '<p>' + ticketCount(offers.length) + '</p>' : ''}</div>${offers.length ? '<a class="favorite-link" href="/">Найти ещё билеты →</a>' : ''}</header>`;
  if (!offers.length) return header + undo + `<section class="favorite-panel favorite-empty"><h2>Пока нет сохранённых билетов</h2><p>Нажмите сердечко рядом с билетом. Здесь можно вернуться к нему и сравнить с другим рейсом.</p><a href="/" class="btn-primary">Найти билеты</a></section>`;
  const list = offers.map(offer => {
    const when = dates(offer) + ', вылет в ' + fmtTime(facts(offer).dep, offer.origin_timezone);
    return `<li class="favorite-ticket">${photo(offer.city_code)}
      <div class="favorite-info"><h3>${detailsButton(offer, offer.city)}</h3><p>${esc(when)}</p><p class="caption">${esc([offer.origin_city, route(offer)].filter(Boolean).join(', '))}</p></div>
      <div class="favorite-fare"><b>${esc(fmtMoney(offer.price_minor))}</b><span class="caption">Сохранённая цена</span></div>
      <button type="button" class="fav fav--inline" data-fav="${esc(offer.id)}" aria-pressed="true" aria-label="Убрать из избранного — ${esc(offer.city)}, ${esc(dateTime(offer))}">${icon('heart')}</button></li>`;
  }).join('');
  return header + undo + `<div class="favorite-panel">${quickComparison(chosen, offers.length > 2, facts)}<ul class="favorite-list">${list}</ul></div>`;
}

export function favoriteComparison(chosen, canChoose, table, removed) {
  return `<a class="favorite-link favorite-back" href="#fav">← В избранное</a>
    <header class="favorite-heading"><div><h1 id="favoriteTitle" tabindex="-1">Сравнение билетов</h1><p>Туда и обратно на одного</p></div>${canChoose ? chooseButton('Изменить выбор') : ''}</header>
    ${removalNotice(removed)}<div class="favorite-panel favorite-comparison">${chosen.length > 2 ? '<p class="favorite-scroll-hint">Прокрутите таблицу вправо, чтобы увидеть остальные билеты.</p>' : ''}${table}
    <div class="favorite-actions favorite-details">${chosen.map(offer => detailsButton(offer, name(offer, chosen) + ' →')).join('')}</div></div>`;
}

export function favoriteOptions(offers, ids) {
  return offers.map(offer => `<label class="favorite-option"><input type="checkbox" value="${esc(offer.id)}" ${ids.includes(offer.id) ? 'checked' : ''}>
    <span><b><span class="favorite-option-city">${esc(offer.city)}</span>, ${esc(fmtMoney(offer.price_minor))}</b><small>${esc([dates(offer), fmtTime(new Date(offer.departure_at), offer.origin_timezone), route(offer), offer.flight_number].filter(Boolean).join(', '))}</small></span></label>`).join('');
}

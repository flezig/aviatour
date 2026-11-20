import { esc } from './lib/ui.js';
import { fmtDate } from './lib/format.js';
import { localInstant } from './lib/flight-windows.js';
import { buildItinerary, bookingProblem, localStamp, restoreItinerary, validReplan } from './lib/itinerary.js';
import { checkedOn, places, placeById, walkSource } from './lib/itinerary-places.js';
import { dayHeading, offlineText, rowDetails, rowsForDay } from './lib/itinerary-export.js';

const memory = new Map();
const dayLabel = ms => fmtDate(new Date(ms), 'UTC');
const options = places.map(p => '<option value="' + p.id + '">' + esc(p.title) + '</option>').join('');
function readState(key) {
  try { return JSON.parse(localStorage.getItem(key)) || memory.get(key); }
  catch { return memory.get(key); }
}
function renderDay(day, result, plan) {
  const rows = rowsForDay(day, result, plan);
  if (!rows.length) return '';
  return `<section class="it-day"><h3>${esc(dayHeading(day.date))}</h3><ol>${rows.map(row => {
    const {time, notes} = rowDetails(row, plan.zone, day.date);
    return `<li class="it-row it-${row.kind}"><span class="it-time">${esc(time)}</span><div><strong>${esc(row.title)}</strong>
      ${notes.map(s => '<small>' + esc(s) + '</small>').join('')}
      ${row.kind === 'booking' ? `<button type="button" class="it-textbutton" data-edit="${esc(row.id)}" aria-label="Изменить бронь ${esc(row.title)}">Изменить</button>` : ''}</div></li>`;
  }).join('')}</ol></section>`;
}
function downloadPlan(plan, state, result) {
  const blob = new Blob(['\uFEFF' + offlineText(plan, state, result)], {type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Aviator-' + plan.cityCode + '-' + localStamp(result.back, plan.zone).slice(0,10) + '.txt';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function mountItinerary(root, plan) {
  const key = 'aviator.itinerary.v1.' + plan.id;
  const state = restoreItinerary(plan, readState(key));
  let result = buildItinerary(plan, state);
  let editId = null;
  const first = localStamp(result.arrive ?? Date.parse(plan.out), plan.zone);
  const last = localStamp(result.back, plan.zone);
  const defaultHour = first.slice(0,10) + 'T14:00';
  const nearNow = Date.now() >= (result.arrive ?? Date.parse(plan.out)) && Date.now() < result.back;
  const shortStart = state.replan?.at || (nearNow ? localStamp(Date.now(), plan.zone) : (defaultHour >= first && defaultHour <= last ? defaultHour : first));
  const number = (name, title) => `<label>${title}<input name="${name}" type="number" min="0" max="1440" step="1" required value="${state[name]}"></label>`;
  root.innerHTML = `<header><h2>План по дням</h2><p class="caption">Время в городе назначения (${esc(plan.zone)}). Ваши изменения сохраняются в этом браузере.</p></header>
    ${result.pilot ? `<fieldset class="it-places"><legend>Выберите до трёх мест в Казани</legend>${places.map(p => `<label><input type="checkbox" value="${p.id}"> ${esc(p.title)}</label>`).join('')}</fieldset>
      <a class="it-stay" href="/stay.html">Сравнить жильё рядом с этими местами</a>` : ''}
    <details class="it-panel it-travel"${result.arrive === null ? ' open' : ''}><summary>Время на дорогу</summary>
      <form class="it-form"><div class="plan-inputs">${number('afterLanding','После прилёта до первого места, мин')}${number('beforeFlight','До обратного рейса, с дорогой в аэропорт, мин')}${number('bookingTravel','До и после каждой брони, мин')}</div>
      <label>Прилёт по вашему билету, местное время<input type="datetime-local" name="arrival" value="${esc(state.arrival || (result.arrive !== null ? first : ''))}" min="${esc(localStamp(Date.parse(plan.out),plan.zone))}" max="${esc(last)}"></label>
      <p class="caption">Начальный запас после прилёта и перед вылетом — ориентир. Укажите свои значения с учётом багажа, регистрации и адресов.</p>
      ${plan.event?.bufferMinutes ? `<p class="caption">Перед событием из поиска дополнительно оставлено ${esc(plan.event.bufferMinutes)} мин.</p>` : ''}
      <button class="btn-inline" type="submit">Обновить время</button></form></details>
    <details class="it-panel it-fixed"><summary>Закрепить бронь или событие</summary>
      <form class="it-form"><label>Название<input name="title" maxlength="160" placeholder="Например, спектакль" required></label>
      <label>Адрес<input name="address" maxlength="240" required></label>
      <div class="plan-inputs"><label>Дата и время начала<input type="datetime-local" name="start" required></label>
      <label>Длительность, мин<input name="duration" type="number" min="1" max="1440" required value="60"></label></div>
      <label>Часовой пояс места<input name="zone" value="${esc(plan.zone)}" list="it-zones" maxlength="80" required></label><datalist id="it-zones"></datalist>
      <div class="plan-actions"><button class="btn-inline" type="submit">Сохранить бронь</button><button class="it-textbutton" type="button" data-remove hidden>Удалить бронь</button><button class="it-textbutton" type="button" data-cancel hidden>Отмена</button></div>
      <p class="caption" role="alert"></p></form></details>
    ${result.pilot ? `<details class="it-panel it-short"><summary>Остался час</summary><form class="it-form"><div class="plan-inputs">
      <label>Откуда вы идёте<select name="from">${options}</select></label><label>Когда есть час<input name="at" type="datetime-local" required min="${first}" max="${last}" value="${esc(shortStart)}"></label></div>
      <p class="caption">Подберём одну прогулку от выбранного места до ближайшей брони или выезда. Остальные места по возможности перенесём на следующие дни.</p>
      <div class="plan-actions"><button class="btn-inline" type="submit">Пересобрать день</button><button class="it-textbutton" type="button" data-undo>Вернуть полный день</button></div></form></details>` : ''}
    <p class="caption it-feedback" role="status"></p><div class="it-days"></div>
    <div class="plan-actions"><button class="btn-inline" type="button" data-download>Скачать план без интернета (.txt)</button></div>
    ${result.pilot ? `<details class="it-panel"><summary>Часы, адреса и пешие маршруты</summary><p class="caption">Сверено ${esc(dayLabel(Date.parse(checkedOn)))}. Планируем прогулки с 09:00 до 20:00. Время осмотра приблизительное. Уточните временные ограничения и мероприятия в день визита.</p>
      <ul>${places.map(p => `<li><a href="${esc(p.url)}">${esc(p.title)}</a> — ${p.minutes} мин. ${esc(p.note)}</li>`).join('')}</ul>
      <p class="caption">Переходы между пятью местами рассчитаны по пешеходной сети <a href="${esc(walkSource)}">FOSSGIS OSRM</a>, <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>. Дорогу по произвольным адресам брони и в аэропорт уточните отдельно.</p></details>` : ''}`;
  const q = selector => root.querySelector(selector);
  const bookingForm = q('.it-fixed form'), roadForm = q('.it-travel form'), hourForm = q('.it-short form');
  try {
    const zones = new Set([plan.zone, plan.fromZone, ...Intl.supportedValuesOf('timeZone')]);
    q('#it-zones').innerHTML = [...zones].map(zone => `<option value="${esc(zone)}"></option>`).join('');
  } catch { /* The input also accepts an IANA time zone by hand. */ }
  function draw() {
    result = buildItinerary(plan, state);
    if (result.pilot) {
      for (const input of root.querySelectorAll('.it-places input')) {
        input.checked = state.selected.includes(input.value);
        input.disabled = !input.checked && state.selected.length >= 3;
      }
      q('.it-stay').href = '/stay.html' + (state.selected.length ? '?places=' + state.selected.join(',') : '');
      q('[data-undo]').hidden = !state.replan;
    }
    const warnings = [...result.warnings];
    if (result.arrive === null) warnings.unshift('Уточните время прилёта в разделе «Время на дорогу», чтобы спланировать прогулки.');
    if (state.replan && result.pilot) {
      const label = state.replan.at.replace('T',' ') + ' от «' + placeById.get(state.replan.from).title + '». ';
      warnings.push(label + (result.shortVisit ? 'За этот час можно посетить «' + result.shortVisit.title + '».' : 'В этот час прогулка с дорогой не помещается.'));
    }
    if (result.missing.length) warnings.push('Не поместились в расписание: ' + result.missing.map(id => placeById.get(id).title).join(', ') + '.');
    q('.it-days').innerHTML = warnings.map(s => `<p class="it-note">${esc(s)}</p>`).join('') + result.days.map(day => renderDay(day, result, plan)).join('');
  }
  function save(message) {
    state.updated = new Date().toISOString();
    memory.set(key, state);
    try { localStorage.setItem(key, JSON.stringify(state)); }
    catch { message += ' Для сохранения после закрытия страницы скачайте план.'; }
    draw();
    q('.it-feedback').textContent = message;
  }
  function resetBooking() {
    editId = null;
    bookingForm.reset();
    bookingForm.elements.start.value = first;
    bookingForm.querySelector('[role="alert"]').textContent = '';
    q('[data-remove]').hidden = q('[data-cancel]').hidden = true;
  }
  resetBooking();
  if (hourForm && state.replan) hourForm.elements.from.value = state.replan.from;
  root.addEventListener('change', e => {
    if (!e.target.closest('.it-places')) return;
    state.selected = [...root.querySelectorAll('.it-places input:checked')].map(i => i.value);
    save('Расписание обновлено.');
  });
  roadForm.addEventListener('submit', e => {
    e.preventDefault();
    const value = roadForm.elements.arrival.value;
    if (value) {
      const ms = localInstant(value, plan.zone);
      if (ms === null || ms < Date.parse(plan.out) || ms > Date.parse(plan.back)) {
        q('.it-feedback').textContent = 'Проверьте местное время прилёта и даты рейсов.';
        return;
      }
    }
    for (const name of ['afterLanding','beforeFlight','bookingTravel']) state[name] = Number(roadForm.elements[name].value);
    state.arrival = value === localStamp(Date.parse(plan.arrive), plan.zone) ? '' : value;
    if (value && Date.parse(plan.arrive) === Date.parse(plan.out)) state.arrival = value;
    save('Время на дорогу обновлено.');
  });
  bookingForm.addEventListener('submit', e => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(bookingForm));
    const entry = {...values, title:values.title.trim(), address:values.address.trim(), zone:values.zone.trim(), id:editId ?? Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8,'0')).join(''), duration:Number(values.duration)};
    const problem = bookingProblem(plan, state, entry);
    bookingForm.querySelector('[role="alert"]').textContent = problem;
    if (problem) return;
    state.bookings = [...state.bookings.filter(b => b.id !== entry.id), entry];
    resetBooking();
    q('.it-fixed').open = false;
    q('.it-fixed summary').focus();
    save('Бронь закреплена.');
  });
  hourForm?.addEventListener('submit', e => {
    e.preventDefault();
    const request = Object.fromEntries(new FormData(hourForm));
    if (!validReplan(plan, request) || result.arrive === null || localInstant(request.at, plan.zone) < result.arrive) {
      q('.it-feedback').textContent = 'Укажите время после прилёта и до обратного рейса.'; return;
    }
    state.replan = request;
    save('Остаток дня пересобран. Время брони сохранено.');
  });
  root.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-edit')) {
      const b = state.bookings.find(b => b.id === button.dataset.edit);
      if (!b) return;
      editId = b.id;
      for (const name of ['title','address','start','duration','zone']) bookingForm.elements[name].value = b[name] ?? '';
      q('[data-remove]').hidden = q('[data-cancel]').hidden = false;
      bookingForm.querySelector('[role="alert"]').textContent = '';
      q('.it-fixed').open = true;
      bookingForm.elements.title.focus();
    }
    if (button.hasAttribute('data-remove')) {
      state.bookings = state.bookings.filter(b => b.id !== editId);
      resetBooking(); q('.it-fixed').open = false; q('.it-fixed summary').focus(); save('Бронь удалена.');
    }
    if (button.hasAttribute('data-cancel')) { resetBooking(); q('.it-fixed').open = false; q('.it-fixed summary').focus(); }
    if (button.hasAttribute('data-undo')) { state.replan = null; save('Полный день восстановлен.'); hourForm.querySelector('[type="submit"]').focus(); }
    if (button.hasAttribute('data-download')) { downloadPlan(plan, state, result); q('.it-feedback').textContent = 'Сохраните текстовый файл на устройство. Его можно открыть без интернета.'; }
  });
  draw();
}

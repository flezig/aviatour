import { fmtDay, localZone, monthLabel, nightsLabel, zoned } from './format.js';

const DAY = 86400000;
const lastDay = Date.parse('9999-12-31T00:00:00Z');
const iso = day => new Date(day).toISOString().slice(0, 10);
const clamp = (day, min, max) => Math.max(min, Math.min(day, max));
const mondayIndex = day => (new Date(day).getUTCDay() + 6) % 7;
function readDay(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const date = Date.parse(key + 'T00:00:00Z');
  return Number.isFinite(date) && iso(date) === key ? date : null;
}
function monthStart(day) {
  const date = new Date(day);
  return date.setUTCDate(1);
}
function shiftMonth(day, offset) {
  const first = new Date(monthStart(day));
  first.setUTCMonth(first.getUTCMonth() + offset);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return first.setUTCDate(Math.min(new Date(day).getUTCDate(), last.getUTCDate()));
}

export function openStayCalendar(trigger, { checkin, checkout, step }, onApply) {
  if (document.getElementById('stayCalendar')?.open) return;
  const today = readDay(zoned(new Date(), localZone).key);
  let start = readDay(checkin), end = readDay(checkout);
  if (start === null || start < today || start >= lastDay) start = null;
  if (start === null || end === null || end <= start) end = null;
  let selectingEnd = step === 'checkout' && start !== null;
  let cursor = selectingEnd ? end ?? start + DAY : start ?? today;

  const dialog = document.createElement('dialog');
  dialog.id = 'stayCalendar';
  dialog.setAttribute('aria-labelledby', 'stayCalendarTitle');
  dialog.innerHTML = `
    <div class="stay-cal-head">
      <h2 id="stayCalendarTitle">Даты проживания</h2>
      <button type="button" data-close aria-label="Закрыть">×</button>
    </div>
    <div class="stay-cal-range" role="group" aria-label="Даты проживания">
      <button type="button" data-step="checkin"><small>Заезд</small><b></b></button>
      <button type="button" data-step="checkout"><small>Выезд</small><b></b></button>
    </div>
    <div class="stay-cal-month">
      <button type="button" data-shift="-1" aria-label="Предыдущий месяц">‹</button>
      <h3 id="stayCalendarMonth" aria-live="polite"></h3>
      <button type="button" data-shift="1" aria-label="Следующий месяц">›</button>
    </div>
    <div class="stay-cal-week" aria-hidden="true">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => `<span>${d}</span>`).join('')}</div>
    <div class="stay-cal-days" role="group" aria-labelledby="stayCalendarMonth"></div>
    <div class="stay-cal-foot">
      <p role="status"></p><button type="button" class="btn-primary" data-apply>Готово</button>
    </div>`;
  const find = selector => dialog.querySelector(selector);
  const days = find('.stay-cal-days');
  function position() {
    if (!dialog.open || matchMedia('(max-width: 699px)').matches) return;
    const box = trigger.getBoundingClientRect(), gap = 8;
    const above = box.bottom + gap + dialog.offsetHeight > innerHeight;
    dialog.style.setProperty('--stay-left', clamp(box.left, gap, innerWidth - dialog.offsetWidth - gap) + 'px');
    dialog.style.setProperty('--stay-top', clamp(above ? box.top - dialog.offsetHeight - gap : box.bottom + gap,
      gap, innerHeight - dialog.offsetHeight - gap) + 'px');
  }
  function render(focusDay = false) {
    const min = selectingEnd ? start + DAY : today;
    const max = selectingEnd ? lastDay : lastDay - DAY;
    cursor = clamp(cursor, min, max);
    const first = monthStart(cursor), next = shiftMonth(first, 1);
    find('#stayCalendarMonth').textContent = monthLabel(iso(first).slice(0, 7));
    find('[data-shift="-1"]').disabled = first <= min;
    find('[data-shift="1"]').disabled = next > max;
    for (const button of dialog.querySelectorAll('[data-step]')) {
      const isEnd = button.dataset.step === 'checkout', value = isEnd ? end : start;
      button.setAttribute('aria-pressed', String(isEnd === selectingEnd));
      button.disabled = isEnd && start === null;
      button.querySelector('b').textContent = value === null ? 'Выбрать дату' : fmtDay(new Date(value), 'UTC');
    }
    const cells = [];
    for (let day = first; day < next; day += DAY) {
      const date = new Date(day), key = iso(day);
      const edge = day === start || day === end;
      const between = end !== null && day > start && day < end;
      const label = fmtDay(date, 'UTC', true) + (day === start ? ', заезд' : day === end ? ', выезд' : '');
      cells.push(`<button type="button" data-day="${key}" aria-label="${label}" aria-pressed="${edge}"
        tabindex="${day === cursor ? 0 : -1}" ${day < min || day > max ? 'disabled' : ''}
        ${day === today ? 'aria-current="date"' : ''} ${between ? 'class="between"' : ''}>${date.getUTCDate()}</button>`);
    }
    days.innerHTML = cells.join('');
    days.firstElementChild.style.gridColumnStart = mondayIndex(first) + 1;
    find('[role="status"]').textContent = end !== null ? nightsLabel((end - start) / DAY)
      : start === null ? 'Выберите дату заезда' : 'Выберите дату выезда';
    find('[data-apply]').disabled = end === null;
    position();
    if (focusDay) days.querySelector('[tabindex="0"]').focus({ preventScroll: true });
  }
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();
      return;
    }
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.hasAttribute('data-close')) { close(); return; }
    if (button.hasAttribute('data-apply')) {
      close();
      onApply({ checkin: iso(start), checkout: iso(end) });
      return;
    }
    if (button.dataset.step) {
      selectingEnd = button.dataset.step === 'checkout';
      cursor = selectingEnd ? end ?? start + DAY : start ?? today;
    } else if (button.dataset.shift) {
      cursor = shiftMonth(cursor, Number(button.dataset.shift));
    } else if (button.dataset.day) {
      cursor = readDay(button.dataset.day);
      if (selectingEnd) end = cursor;
      else {
        start = cursor;
        if (end !== null && end <= start) end = null;
        selectingEnd = true;
        cursor = start + DAY;
      }
    }
    render(!button.dataset.shift);
    if (button.disabled) days.querySelector('[tabindex="0"]').focus({ preventScroll: true });
  });
  days.addEventListener('keydown', event => {
    const day = readDay(event.target.dataset.day);
    if (day === null || event.altKey || event.ctrlKey || event.metaKey) return;
    const shifts = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -mondayIndex(day), End: 6 - mondayIndex(day) };
    if (Object.hasOwn(shifts, event.key)) cursor = day + shifts[event.key] * DAY;
    else if (event.key === 'PageUp' || event.key === 'PageDown') cursor = shiftMonth(day, event.key === 'PageUp' ? -1 : 1);
    else return;
    event.preventDefault();
    render(true);
  });
  const controller = new AbortController();
  window.addEventListener('resize', position, { signal: controller.signal });
  window.addEventListener('scroll', position, { passive: true, signal: controller.signal });
  function cleanup() {
    controller.abort();
    dialog.remove();
    trigger.setAttribute('aria-expanded', 'false');
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
  }
  function close() {
    dialog.close();
    cleanup();
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', cleanup, { once: true, signal: controller.signal });
  document.body.append(dialog);
  trigger.setAttribute('aria-expanded', 'true');
  render();
  dialog.showModal();
  position();
  days.querySelector('[tabindex="0"]').focus({ preventScroll: true });
}

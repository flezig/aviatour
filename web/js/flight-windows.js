import { fmtDate } from './lib/format.js';
import { icon } from './lib/ui.js';
import { EVENT_ADDRESS_LIMIT, EVENT_TITLE_LIMIT, MAX_RESERVE, eventWindow, flightWindowPeriodNote, flightWindowsForRoute, shiftWindow } from './lib/flight-windows.js';

const field = (label, name, attributes) => `<label class="window-field"><span>${label}</span><input name="${name}" ${attributes}></label>`;
const datetime = (label, name) => field(label, name, 'type="datetime-local" required');
const number = (label, name, minimum = 0, required = true) =>
  field(label, name, `type="number" min="${minimum}" max="${MAX_RESERVE}" step="1" inputmode="numeric" ${required ? 'required' : 'placeholder="0"'}`);

function panel(kind, label, iconName, fields) {
  return `<details class="window-panel" data-window="${kind}">
    <summary><span class="window-label">${icon(iconName)}${label}</span>
      <span class="window-current" data-window-current hidden></span>${icon('chevron-down')}</summary>
    ${kind === 'event' ? '<div class="window-pick" hidden><p class="caption">Чтобы указать местное время события, выберите город или аэропорт назначения.</p><button class="btn-inline" type="button" data-window-destination aria-haspopup="dialog" aria-controls="picker">Выбрать направление</button></div>' : ''}
    <form class="window-form">
      <p class="caption" data-window-zone></p>
      <div class="window-fields">${fields}</div>
      <p class="caption window-error" role="alert" hidden></p>
      <div class="window-actions"><button class="btn-primary" type="submit">Отобрать рейсы</button>
      <button class="btn-inline" type="button" data-window-clear hidden>Снять условие</button></div>
    </form>
  </details>`;
}

function summary(kind, value) {
  if (kind === 'event') return fmtDate(new Date(value.startMs), value.zone, true);
  // Без минут на дорогу в подписи, чтобы она совпадала с введённым свободным временем.
  const date = time => fmtDate(new Date(time), value.zone, true);
  return `${date(value.earliest - value.before * 60000)} → ${date(value.latest + value.after * 60000)}`;
}

export function mountFlightWindows(root, { context, apply, chooseDestination }) {
  root.classList.add('flight-windows');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Условия по времени');
  root.innerHTML = `<div class="window-panels">${panel('shift', 'Между сменами', 'calendar',
    datetime('Свободен с', 'freeFrom') + datetime('Нужно вернуться к', 'backBy')
    + number('Запас до вылета, мин', 'before', 0, false)
    + number('От прилёта до дома, мин', 'after', 0, false))}
    ${panel('event', 'Успеть к событию', 'pin',
      field('Название события', 'title', `type="text" maxlength="${EVENT_TITLE_LIMIT}" autocomplete="off" placeholder="Событие"`)
      + field('Адрес события', 'address', `type="text" maxlength="${EVENT_ADDRESS_LIMIT}" autocomplete="off" required`)
      + datetime('Начало события', 'start') + number('Длительность события, мин', 'duration', 1)
      + number('Дорога от аэропорта до адреса, мин', 'transferMinutes')
      + number('Дополнительный запас до начала, мин', 'bufferMinutes')
      + number('От конца события до вылета, мин', 'returnReserveMinutes'))}
    <a class="window-meeting" href="/together.html#meet">Встреча из двух городов</a></div>
    <p class="caption window-period" role="status" hidden></p>`;

  const period = root.querySelector('.window-period');
  const picker = root.querySelector('.window-pick');
  const kinds = ['shift', 'event'];
  const panels = Object.fromEntries(kinds.map(kind => {
    const node = root.querySelector(`[data-window="${kind}"]`);
    return [kind, {
      node, summary: node.querySelector('summary'), form: node.querySelector('form'),
      status: node.querySelector('[data-window-current]'), zone: node.querySelector('[data-window-zone]'),
      clear: node.querySelector('[data-window-clear]'), error: node.querySelector('.window-error'),
    }];
  }));
  let current = {}, displayed = {};

  function notify(p, message = '') {
    p.error.textContent = message;
    p.error.hidden = !message;
  }

  function refresh(kind, value) {
    const p = panels[kind];
    p.status.hidden = !value;
    p.status.textContent = value ? summary(kind, value) : '';
    p.clear.hidden = !value;
    if (value === displayed[kind]) return;
    p.form.reset();
    if (value) {
      for (const input of p.form.querySelectorAll('input')) input.value = value[input.name] ?? '';
    }
    notify(p);
  }

  for (const kind of kinds) {
    const p = panels[kind];
    p.node.addEventListener('toggle', () => {
      if (!p.node.open) return;
      for (const other of kinds) if (other !== kind) panels[other].node.open = false;
    });
    p.form.addEventListener('input', () => notify(p));
    p.form.addEventListener('submit', event => {
      event.preventDefault();
      const route = context();
      const fields = Object.fromEntries(new FormData(p.form));
      const parse = kind === 'shift' ? shiftWindow : eventWindow;
      const parsed = kind === 'event' && !fields.address.trim()
        ? { error: 'Укажите адрес события.', field: 'address' }
        : parse(fields, route);
      if (parsed.error) {
        notify(p, parsed.error);
        p.form.elements.namedItem(parsed.field)?.focus();
        return;
      }
      const next = flightWindowsForRoute(current, route);
      next[kind] = parsed.value;
      p.node.open = false;
      p.summary.focus({ preventScroll: true });
      apply(next);
    });
    p.clear.addEventListener('click', () => {
      const next = { ...current };
      delete next[kind];
      p.node.open = false;
      p.summary.focus({ preventScroll: true });
      apply(next);
    });
  }
  root.querySelector('[data-window-destination]').addEventListener('click', chooseDestination);

  return {
    sync(windows, query) {
      current = windows ?? {};
      const route = context();
      const currentRoute = flightWindowsForRoute(current, route);
      const p = panels.event;
      const selected = Boolean(route.destination && route.destinationZone);
      p.form.hidden = !selected;
      picker.hidden = selected;
      const origin = route.originName || 'город вылета';
      const destination = route.destinationName || 'город назначения';
      panels.shift.zone.textContent = `Местное время города вылета (${origin}). Укажите, сколько минут понадобится на дорогу и аэропорт перед вылетом, а также на дорогу домой после прилёта.`;
      p.zone.textContent = `Местное время в месте события (${destination}). В запас до начала включите время на выход из аэропорта и вход на площадку. В запас до вылета включите дорогу и время в аэропорту.`;
      for (const kind of kinds) refresh(kind, currentRoute[kind]);
      displayed = currentRoute;
      const note = flightWindowPeriodNote(currentRoute, query, route);
      if (period.textContent !== note) period.textContent = note;
      period.hidden = !note;
    },
  };
}

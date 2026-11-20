import { addDays, formatter, monthLabel, zoned } from './format.js';

const MINUTE = 60000;
export const MAX_RESERVE = 1440;
export const EVENT_TITLE_LIMIT = 120;
export const EVENT_ADDRESS_LIMIT = 240;

function localParts(time, zone) {
  const fields = formatter(zone, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }, 'en-GB').formatToParts(time);
  const { year, month, day, hour, minute } = Object.fromEntries(fields.map(part => [part.type, part.value]));
  return `${year.padStart(4, '0')}-${month}-${day}T${hour}:${minute}`;
}

// В день перевода часов местное время может пропасть или встретиться дважды.
export function localInstant(value, zone) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
      || typeof zone !== 'string' || !zone || zone.length > 64) return null;
  const wall = Date.parse(value + 'Z');
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== value) return null;
  const offsets = new Set();
  try {
    for (const hours of [-36, -12, 0, 12, 36]) {
      const probe = wall + hours * 60 * MINUTE;
      offsets.add(Date.parse(localParts(probe, zone) + 'Z') - probe);
    }
    const candidates = [...offsets].map(offset => wall - offset).filter(time => localParts(time, zone) === value);
    return candidates.length === 1 ? candidates[0] : null;
  } catch { return null; }
}

function minutes(value, minimum = 0) {
  if (typeof value === 'string' && /^\d{1,4}$/.test(value)) value = Number(value);
  return Number.isInteger(value) && value >= minimum && value <= MAX_RESERVE ? value : null;
}

function text(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function originCode(context) {
  return context.originCityCode ?? context.originCity ?? context.origin;
}

export function shiftWindow(fields, context) {
  const zone = context.originZone, from = localInstant(fields.freeFrom, zone), until = localInstant(fields.backBy, zone);
  if (from === null) return { error: 'Укажите существующие дату и время начала в городе вылета.', field: 'freeFrom' };
  if (until === null || until <= from) return { error: 'Укажите время возвращения позже начала свободного времени.', field: 'backBy' };
  const before = minutes(fields.before || 0), after = minutes(fields.after || 0);
  if (before === null || after === null) return { error: 'Укажите запас от 0 до 1440 минут.', field: before === null ? 'before' : 'after' };
  const earliest = from + before * MINUTE, latest = until - after * MINUTE;
  if (earliest >= latest) return { error: 'Уменьшите запас или расширьте свободное время.', field: 'backBy' };
  return { value: { zone, origin: context.origin, originCode: originCode(context), freeFrom: fields.freeFrom, backBy: fields.backBy, before, after, earliest, latest } };
}

export function eventWindow(fields, context) {
  const { destination, destinationCity, destinationZone: zone } = context;
  if (!destination || !zone) return { error: 'Выберите город или аэропорт назначения.' };
  const startMs = localInstant(fields.start, zone);
  if (startMs === null) return { error: 'Укажите существующие дату и время события в городе назначения.', field: 'start' };
  const values = {};
  for (const field of ['duration', 'transferMinutes', 'bufferMinutes', 'returnReserveMinutes']) {
    const minimum = field === 'duration' ? 1 : 0;
    const parsed = minutes(fields[field], minimum);
    if (parsed === null) return { error: `Укажите число от ${minimum} до 1440 минут.`, field };
    values[field] = parsed;
  }
  const latestArrival = startMs - (values.transferMinutes + values.bufferMinutes) * MINUTE;
  const earliestReturn = startMs + (values.duration + values.returnReserveMinutes) * MINUTE;
  return { value: {
    destination, destinationCity, zone, start: fields.start, startMs, latestArrival, earliestReturn,
    title: text(fields.title, EVENT_TITLE_LIMIT) || 'Событие',
    address: text(fields.address, EVENT_ADDRESS_LIMIT), ...values,
  } };
}

export function flightWindowsForRoute(windows, context) {
  if (!windows) return {};
  const result = {};
  const { shift, event } = windows;
  if (shift && shift.zone === context.originZone && shift.originCode === originCode(context)) result.shift = shift;
  if (event && event.zone === context.destinationZone && event.destination === context.destination
      && event.destinationCity === context.destinationCity) result.event = event;
  return result;
}

function arrival(offer, outbound, departure) {
  const segments = outbound ? offer.outbound_segments : offer.inbound_segments;
  const precise = Date.parse(segments?.at(-1)?.arrival_at);
  if (precise > departure) return precise;
  const minutes = outbound ? offer.duration_to : offer.duration_back;
  return Number.isFinite(minutes) && minutes > 0 ? departure + minutes * MINUTE : NaN;
}

export function matchFlightWindows(offer, { shift, event } = {}) {
  if (!shift && !event) return true;
  const out = Date.parse(offer.departure_at), back = Date.parse(offer.return_at);
  if (!Number.isFinite(out) || !Number.isFinite(back) || back <= out) return false;
  if (shift) {
    const fromHome = offer.origin_city_code === shift.originCode || offer.origin_airport === shift.origin;
    if (!fromHome || out < shift.earliest || !(arrival(offer, false, back) <= shift.latest)) return false;
  }
  if (event) {
    const toEvent = event.destinationCity ? offer.city_code === event.destinationCity : offer.destination_airport === event.destination;
    if (!toEvent || back < event.earliestReturn || !(arrival(offer, true, out) <= event.latestArrival)) return false;
  }
  return true;
}

export function flightEventFor(offer, windows) {
  if (!windows?.event || !matchFlightWindows(offer, windows)) return null;
  const { title, address, start, duration, transferMinutes, bufferMinutes, returnReserveMinutes } = windows.event;
  return { title, address, start, duration, transferMinutes, bufferMinutes, returnReserveMinutes };
}

const SHIFT_PARAMS = { freeFrom: 'freeFrom', backBy: 'backBy', before: 'shiftBefore', after: 'shiftAfter' };
const EVENT_PARAMS = {
  start: 'eventStart', duration: 'eventDuration', transferMinutes: 'eventTransfer',
  bufferMinutes: 'eventBuffer', returnReserveMinutes: 'eventReturnReserve',
};

export function flightWindowDetails(windows) {
  const event = windows?.event;
  return event ? { start: event.start, destination: event.destination, title: event.title, address: event.address } : null;
}

export function writeFlightWindows(params, windows) {
  for (const [kind, keys] of [['shift', SHIFT_PARAMS], ['event', EVENT_PARAMS]]) {
    const window = windows?.[kind];
    for (const [field, param] of Object.entries(keys)) {
      if (window) params.set(param, window[field]);
      else params.delete(param);
    }
  }
  return params;
}

export function readFlightWindows(params, context, privateEvent) {
  const read = keys => Object.fromEntries(Object.entries(keys).map(([field, param]) => [field, params.get(param)]));
  const shift = shiftWindow(read(SHIFT_PARAMS), context).value;
  const event = read(EVENT_PARAMS);
  if (privateEvent?.start === event.start && privateEvent?.destination === context.destination) {
    Object.assign(event, { title: privateEvent.title, address: privateEvent.address });
  }
  const restoredEvent = eventWindow(event, context).value;
  return { ...(shift ? { shift } : {}), ...(restoredEvent ? { event: restoredEvent } : {}) };
}

// Период поиска задан в датах вылета. Границы события пересчитываем в даты города вылета.
export function flightWindowPeriodNote(windows, query, context) {
  if (!query || !context.originZone) return '';
  const { shift, event } = flightWindowsForRoute(windows, context);
  if (!shift && !event) return '';
  const day = (time, zone = context.originZone) => zoned(new Date(time), zone).key;
  const lower = shift ? day(shift.earliest) : null;
  const latest = Math.min(shift?.latest ?? Infinity, event?.latestArrival ?? Infinity);
  const upper = day(latest);
  if (shift && shift.earliest >= latest) return 'Свободное время и событие не оставляют времени на перелёт.';
  if (query.exact && query.departure && ((lower && query.departure < lower) || query.departure > upper)) {
    return 'Выбранная дата вылета вне вашего окна. Измените даты поиска.';
  }
  if (query.exact && query.returning && event && query.returning < day(event.earliestReturn, event.zone)) {
    return 'Обратный рейс выбран раньше окончания события с запасом на дорогу. Измените дату обратного рейса.';
  }
  if (query.exact && query.returning && shift && context.destinationZone
      && query.returning > day(shift.latest, context.destinationZone)) {
    return 'Дата обратного рейса позже срока возвращения. Измените даты поиска.';
  }
  if (!query.exact && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month ?? '')) {
    const first = query.month + '-01';
    const last = addDays(addDays(first, 32).slice(0, 7) + '-01', -1);
    if (first > upper || (lower && last < lower)) {
      return `Месяц поиска вне вашего окна. Попробуйте выбрать «${monthLabel((lower ?? upper).slice(0, 7))}».`;
    }
  }
  return '';
}

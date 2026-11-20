import { addDays, fmtTime, zoned } from './format.js';
import { localInstant } from './flight-windows.js';
import { places, placeById, walkMinutes } from './itinerary-places.js';

const minute = 60000;
const between = (n, low, high) => Number.isInteger(n) && n >= low && n <= high;
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const dayKey = (ms, zone) => zoned(new Date(ms), zone).key;
export const localStamp = (ms, zone) => dayKey(ms, zone) + 'T' + fmtTime(new Date(ms), zone);
export function flightBounds(plan, state) {
  const arrival = state.arrival ? localInstant(state.arrival, plan.zone) : null;
  const scheduled = Date.parse(plan.arrive);
  const known = scheduled > Date.parse(plan.out);
  return { arrive: arrival ?? (known ? scheduled : null), back: Date.parse(plan.back) };
}
export function initialItinerary(plan) {
  return { selected: [], bookings: [], afterLanding: between(plan.event?.transferMinutes, 0, 1440) ? plan.event.transferMinutes : 60, beforeFlight: 180, bookingTravel: 30,
    arrival: '', replan: null, imported: null, updated: null,
    ...(between(plan.event?.returnReserveMinutes, 0, 1440) ? {beforeFlight:plan.event.returnReserveMinutes} : {}) };
}
function cleanBooking(raw, plan) {
  if (!raw || typeof raw.title !== 'string' || !raw.title.trim() || typeof raw.start !== 'string') return null;
  const zone = raw.zone || plan.zone;
  if (typeof zone !== 'string' || zone.length > 80 || localInstant(raw.start, zone) === null) return null;
  return { id: String(raw.id || 'event').slice(0, 100), title: raw.title.trim().slice(0, 160),
    address: String(raw.address || '').trim().slice(0, 240), start: raw.start, zone,
    duration: between(raw.duration, 1, 1440) ? raw.duration : null };
}
// Private additions are kept with the ticket on this device. A newly supplied search event
// is imported once, even when an older local itinerary for the same ticket already exists.
export function restoreItinerary(plan, raw = {}) {
  const state = initialItinerary(plan);
  if (!raw || typeof raw !== 'object') raw = {};
  state.selected = Array.isArray(raw.selected) ? [...new Set(raw.selected.filter(id => placeById.has(id)))].slice(0, 3) : [];
  state.bookings = Array.isArray(raw.bookings) ? raw.bookings.map(b => cleanBooking(b, plan)).filter(Boolean) : [];
  for (const key of ['afterLanding', 'beforeFlight', 'bookingTravel']) {
    if (between(raw[key], 0, 1440)) state[key] = raw[key];
  }
  if (typeof raw.arrival === 'string') {
    const ms = localInstant(raw.arrival, plan.zone);
    if (ms !== null && ms >= Date.parse(plan.out) && ms <= Date.parse(plan.back)) state.arrival = raw.arrival;
  }
  state.replan = validReplan(plan, raw.replan) ? raw.replan : null;
  state.updated = typeof raw.updated === 'string' && Number.isFinite(Date.parse(raw.updated)) ? raw.updated : null;
  state.imported = typeof raw.imported === 'string' ? raw.imported : null;
  const event = cleanBooking(plan.event, plan);
  if (event) {
    const signature = JSON.stringify([event.title, event.address, event.start, event.duration, event.zone]);
    if (state.imported !== signature) {
      state.imported = signature;
      state.bookings = [...state.bookings.filter(b => b.id !== 'search-event'), {...event, id:'search-event'}];
    }
  }
  return state;
}
export function validReplan(plan, value) {
  if (!value || !placeById.has(value.from) || typeof value.at !== 'string') return false;
  const ms = localInstant(value.at, plan.zone);
  return ms !== null && ms >= Date.parse(plan.out) && ms < Date.parse(plan.back);
}
function fixedRow(booking) {
  const start = localInstant(booking.start, booking.zone);
  return {...booking, kind:'booking', start, end: booking.duration ? start + booking.duration * minute : null };
}
function protectedEnd(row, back) {
  // With an unknown duration, leave the calendar occupied until the traveller supplies the end.
  return row.end ?? Math.max(row.start + minute, back);
}
export function bookingProblem(plan, state, booking) {
  const normalized = cleanBooking(booking, plan);
  if (!normalized || !normalized.duration || !normalized.address) return 'Укажите название, адрес, действительные местные дату, время, часовой пояс и длительность.';
  const row = fixedRow(normalized);
  const {arrive, back} = flightBounds(plan, state);
  if (row.start < (arrive ?? Date.parse(plan.out)) || row.end > back) return 'Бронь выходит за время поездки. Проверьте даты и часовой пояс.';
  const others = state.bookings.filter(b => b.id !== row.id).map(fixedRow);
  if (others.some(b => overlaps(row, {...b, end:protectedEnd(b, back)}))) return 'В это время уже есть бронь. Проверьте время окончания обеих встреч.';
  return '';
}
function lunchSlot(day, fixed) {
  const earliest = Math.max(day.start, day.midnight + 12 * 60 * minute);
  const latest = Math.min(day.end, day.midnight + 15 * 60 * minute);
  const duration = 45 * minute;
  const candidates = [Math.max(earliest, day.midnight + 13 * 60 * minute), earliest, ...fixed.map(b => b.end)].sort((a,b) => Math.abs(a - (day.midnight + 13 * 60 * minute)) - Math.abs(b - (day.midnight + 13 * 60 * minute)));
  for (const start of candidates) {
    const row = {kind:'lunch', title:'Свободно для обеда', start, end:start + duration};
    if (start >= earliest && row.end <= latest && !fixed.some(b => overlaps(row, b))) return row;
  }
  return null;
}
function visitSlot(day, place) {
  const previous = day.visits.at(-1);
  let from = previous?.id;
  let available = Math.max(day.start, previous?.end ?? day.start);
  const open = day.midnight + place.open * minute, close = Math.min(day.end, day.midnight + place.close * minute);
  for (const block of [...day.blocks].sort((a,b) => a.start - b.start)) {
    if (block.end <= available) continue;
    const walk = from ? walkMinutes(from, place.id) : 0;
    const start = Math.max(open, available + walk * minute);
    if (start + place.minutes * minute <= block.start) break;
    available = Math.max(available, block.end);
    if (block.kind === 'booking') from = null;
  }
  const walk = from ? walkMinutes(from, place.id) : 0;
  const start = Math.max(open, available + walk * minute), end = start + place.minutes * minute;
  return end <= close ? {...place, kind:'place', start, end, walk, from} : null;
}
function fillDays(days, ids) {
  const missing = [];
  for (const id of ids) {
    const slots = days.map(day => ({day, row:visitSlot(day, placeById.get(id))})).filter(s => s.row)
      .sort((a,b) => a.day.visits.length - b.day.visits.length || a.row.start - b.row.start);
    if (slots.length) slots[0].day.visits.push(slots[0].row);
    else missing.push(id);
  }
  return missing;
}
function hourVisit(day, replan, selected, past) {
  const from = replan.from, at = localInstant(replan.at, 'Europe/Moscow');
  if (at < day.start || at >= day.end || day.blocks.some(b => b.start <= at && b.end > at)) return null;
  const next = day.blocks.filter(b => b.start >= at).sort((a,b) => a.start - b.start)[0];
  const until = Math.min(at + 60 * minute, day.end, next?.start ?? Infinity);
  const options = places.filter(p => p.id !== from && !past.has(p.id)).map(p => {
    const walk = walkMinutes(from, p.id);
    const start = Math.max(at + walk * minute, day.midnight + p.open * minute);
    return {...p, kind:'place', start, end:start + p.minutes * minute, walk, from};
  }).filter(p => p.end <= until && p.end <= day.midnight + p.close * minute);
  options.sort((a,b) => Number(selected.includes(b.id)) - Number(selected.includes(a.id)) || a.walk - b.walk);
  return options[0] || null;
}
export function buildItinerary(plan, state) {
  const {arrive, back} = flightBounds(plan, state);
  const first = dayKey(arrive ?? Date.parse(plan.out), plan.zone), last = dayKey(back, plan.zone);
  const fixed = state.bookings.map(fixedRow).sort((a,b) => a.start - b.start);
  const dates = new Set([first, last]);
  const dateCount = Math.round((Date.parse(last) - Date.parse(first)) / 86400000) + 1;
  const pilot = plan.cityCode === 'KZN' && plan.zone === 'Europe/Moscow' && dateCount >= 1 && dateCount <= 62;
  for (const b of fixed) {
    dates.add(dayKey(b.start, plan.zone));
    if (b.end) dates.add(dayKey(b.end - 1, plan.zone));
  }
  if (pilot) for (let i = 1; i < dateCount - 1; i++) dates.add(addDays(first, i));
  const departure = back - state.beforeFlight * minute;
  const ready = arrive === null ? Infinity : arrive + state.afterLanding * minute;
  const eventBuffer = between(plan.event?.bufferMinutes, 0, 1440) ? plan.event.bufferMinutes * minute : 0;
  const travel = state.bookingTravel * minute;
  dates.add(dayKey(departure, plan.zone));
  const warnings = [];
  if (arrive !== null && ready > departure) warnings.push('С указанным запасом между прилётом и выездом в аэропорт нет времени на прогулку. Проверьте время на дорогу.');
  for (let i = 0; i < fixed.length; i++) {
    const b = fixed[i], prev = fixed[i - 1];
    if (!b.duration) warnings.push('Уточните длительность события «' + b.title + '», чтобы продолжить план после него.');
    const early = b.id === 'search-event' ? eventBuffer : 0;
    if ((b.start < ready + early && arrive !== null) || protectedEnd(b, back) > departure) warnings.push('Проверьте запас между рейсом и бронью «' + b.title + '».');
    if (prev && b.start < protectedEnd(prev, back) + travel) warnings.push('Между бронями «' + prev.title + '» и «' + b.title + '» мало времени. Сверьте адреса и время в пути.');
  }
  const days = [...dates].sort().map(date => {
    const bookings = fixed.filter(b => dayKey(b.start, plan.zone) <= date && dayKey((b.end ?? b.start + 1) - 1, plan.zone) >= date);
    const midnight = pilot ? Date.parse(date + 'T00:00:00+03:00') : 0;
    const day = {date, midnight, bookings, visits:[], blocks:[], lunch:null,
      start:Math.max(ready, midnight + 9 * 60 * minute), end:Math.min(departure, midnight + 20 * 60 * minute)};
    if (pilot) {
      day.blocks = fixed.map(b => {
        const early = b.id === 'search-event' ? eventBuffer : 0;
        return {kind:'booking', start:b.start - travel - early, end:protectedEnd(b, back) + travel};
      })
        .filter(b => overlaps(b, day));
      day.lunch = lunchSlot(day, day.blocks);
      if (day.lunch) day.blocks.push(day.lunch);
    }
    return day;
  });
  let missing = pilot ? fillDays(days, state.selected) : [];
  let shortVisit = null;
  if (pilot && arrive !== null && validReplan(plan, state.replan)) {
    const request = state.replan;
    const at = localInstant(request.at, plan.zone);
    const day = days.find(d => d.date === request.at.slice(0, 10));
    if (day) {
      const past = new Set();
      for (const d of days) {
        d.visits = d.visits.filter(v => v.end <= at);
        for (const v of d.visits) past.add(v.id);
      }
      if (day.lunch && overlaps(day.lunch, {start:at, end:at + 60 * minute})) {
        day.blocks = day.blocks.filter(b => b !== day.lunch);
        day.lunch = lunchSlot(day, [...day.blocks, ...day.visits, {start:at, end:at + 60 * minute}]);
        if (day.lunch) day.blocks.push(day.lunch);
      }
      shortVisit = hourVisit(day, request, state.selected, past);
      if (shortVisit) { day.visits.push(shortVisit); past.add(shortVisit.id); }
      missing = fillDays(days.filter(d => d.date > day.date), state.selected.filter(id => !past.has(id)));
    }
  }
  return {days, fixed, missing, warnings, arrive, back, departure, pilot, shortVisit, arrivalLabel: state.arrival ? 'Прилёт по вашему билету' : (plan.arrivalSource === 'segment' ? 'Прилёт по расписанию' : 'Расчётный прилёт')};
}

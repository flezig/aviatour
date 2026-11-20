import { fmtDate, fmtTime } from './format.js';
import { checkedOn, places, placeById, walkSource } from './itinerary-places.js';
import { localStamp } from './itinerary.js';

export const dayHeading = date => new Intl.DateTimeFormat('ru-RU', {weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'UTC'}).format(new Date(date + 'T12:00Z'));
const stamp = (ms, zone) => fmtDate(new Date(ms), zone, true);
export function rowsForDay(day, result, plan) {
  const rows = [...day.bookings, ...day.visits];
  if (day.lunch && (day.visits.length || day.bookings.length)) rows.push(day.lunch);
  for (const [kind, start, title] of [
    ['arrival', result.arrive, result.arrivalLabel + ', ' + plan.toCode],
    ['leave', result.departure, 'Выехать в аэропорт ' + plan.toCode],
    ['flight', result.back, 'Обратный вылет, ' + plan.toCode],
  ]) if (start !== null && localStamp(start, plan.zone).startsWith(day.date)) rows.push({kind, start, title});
  return rows.sort((a,b) => a.start - b.start);
}
export function rowDetails(row, zone, day) {
  const fmt = ms => localStamp(ms, zone).slice(0,10) === day ? fmtTime(new Date(ms), zone) : stamp(ms, zone);
  const time = fmt(row.start) + (row.end ? '–' + fmt(row.end) : '');
  const notes = [];
  if (row.kind === 'booking') {
    notes.push('Закреплено', row.address || 'Уточните адрес');
    if (!row.duration) notes.push('Уточните длительность');
    if (row.zone !== zone) notes.push('По часам места брони ' + stamp(row.start, row.zone) + ' (' + row.zone + ')');
  }
  if (row.kind === 'place') {
    notes.push(row.address);
    if (row.from) notes.push('Пешком от «' + placeById.get(row.from).title + '» около ' + row.walk + ' мин');
    notes.push(row.note);
  }
  return {time, notes};
}
export function offlineText(plan, state, result, now = new Date()) {
  const lines = [plan.city + ' — план поездки', 'Время плана по городу назначения (' + plan.zone + ').', '',
    'Туда: ' + plan.from + ' (' + plan.fromCode + ') → ' + plan.city + ' (' + plan.toCode + ')',
    'Вылет: ' + stamp(Date.parse(plan.out), plan.fromZone) + ' (' + plan.fromZone + ')',
    result.arrive === null ? 'Уточните время прилёта по билету.' : result.arrivalLabel + ': ' + stamp(result.arrive, plan.zone),
    'Обратный вылет: ' + stamp(result.back, plan.zone) + ', ' + plan.toCode,
    'Выехать в аэропорт: ' + stamp(result.departure, plan.zone) + ' (запас с дорогой ' + state.beforeFlight + ' мин).',
    'От прилёта до начала прогулки заложено ' + state.afterLanding + ' мин. До и после брони заложено по ' + state.bookingTravel + ' мин.',
    'Сверьте дорогу до адресов брони и аэропорта. Очереди и временные перекрытия могут изменить время в пути.'];
  if (plan.event?.bufferMinutes) lines.push('Дополнительный запас перед событием из поиска: ' + plan.event.bufferMinutes + ' мин.');
  for (const day of result.days) {
    const rows = rowsForDay(day, result, plan);
    if (!rows.length) continue;
    lines.push('', dayHeading(day.date));
    for (const row of rows) {
      const {time, notes} = rowDetails(row, plan.zone, day.date);
      lines.push(time + '  ' + row.title, ...notes.map(note => '  ' + note));
    }
  }
  if (state.replan) lines.push('', 'Остался час с ' + state.replan.at.replace('T',' ') + ', от «' + placeById.get(state.replan.from).title + '».',
    result.shortVisit ? 'Место на этот час: ' + result.shortVisit.title : 'Подходящего места в этот час нет.');
  if (result.missing.length) lines.push('', 'Не поместились: ' + result.missing.map(id => placeById.get(id).title).join(', '));
  if (result.warnings.length) lines.push('', ...result.warnings);
  lines.push('', 'Данные рейса получены ' + stamp(Date.parse(plan.quoted), plan.zone) + '.');
  if (result.pilot) {
    lines.push('Адреса и режим посещения сверены ' + checkedOn + '. Время осмотра — оценка для плана.',
      'Пешие маршруты рассчитаны ' + checkedOn + ', FOSSGIS OSRM, © OpenStreetMap contributors.', walkSource,
      'https://www.openstreetmap.org/copyright');
    const included = new Set([...state.selected, result.shortVisit?.id]);
    for (const p of places.filter(p => included.has(p.id))) lines.push(p.title + ' — ' + p.address, p.url);
  }
  if (state.updated) lines.push('План изменён ' + stamp(Date.parse(state.updated), plan.zone) + '.');
  if (state.bookings.length) lines.push('Время и адреса брони указаны путешественником.');
  lines.push('Файл сохранён ' + stamp(+now, plan.zone) + '.');
  return lines.join('\n') + '\n';
}

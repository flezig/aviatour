// Даты, деньги и слова. Даты всегда в часовом поясе своего аэропорта.
export const DEFAULT_ZONE = 'Europe/Moscow';
export const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_ZONE;

const formatters = new Map();
export function formatter(zone, options, locale = 'ru-RU') {
  const key = locale + zone + JSON.stringify(options);
  if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat(locale, { timeZone: zone, ...options }));
  return formatters.get(key);
}
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// weekday: 1 = воскресенье … 7 = суббота, как в календаре приложения.
export function zoned(date, zone) {
  const p = Object.fromEntries(formatter(zone, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }, 'en-US').formatToParts(date).map((part) => [part.type, part.value]));
  return { year: +p.year, month: +p.month, hour: +p.hour % 24, weekday: WEEKDAYS.indexOf(p.weekday) + 1, key: `${p.year}-${p.month}-${p.day}` };
}
export const fmtDate = (date, zone, time = false) => formatter(zone, { day: 'numeric', month: 'short', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}) }).format(date).replace(' г.', '');
// Без года: «17 нояб.»; с днём недели: «вт, 17 нояб.».
export const fmtDay = (date, zone, weekday = false) => formatter(zone, { day: 'numeric', month: 'short', ...(weekday ? { weekday: 'short' } : {}) }).format(date);
export const fmtTime = (date, zone) => formatter(zone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
export const fmtMoney = (minor) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(minor / 100);
export function fmtRange(from, to, fromZone, toZone) {
  const a = zoned(from, fromZone), b = zoned(to, toZone);
  if (a.key === b.key) return fmtDay(from, fromZone);
  if (a.year === b.year && a.month === b.month) return `${Number(a.key.slice(8))}–${fmtDay(to, toZone)}`;
  return `${fmtDay(from, fromZone)} – ${fmtDay(to, toZone)}`;
}
export function monthLabel(month) {
  const [year, number] = month.split('-').map(Number);
  const text = formatter('UTC', { month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, number - 1, 1))).replace(' г.', '');
  return text[0].toUpperCase() + text.slice(1);
}
export function months(zone) {
  const now = zoned(new Date(), zone);
  return Array.from({ length: 6 }, (_, i) => {
    const date = new Date(Date.UTC(now.year, now.month - 1 + i, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}
// Если до конца месяца меньше 10 дней, по умолчанию — следующий месяц.
export function defaultMonth(zone) {
  const now = zoned(new Date(), zone), list = months(zone);
  const left = new Date(Date.UTC(now.year, now.month, 0)).getUTCDate() - Number(now.key.slice(8));
  return left < 10 ? list[1] : list[0];
}
export const addDays = (key, days) => new Date(Date.parse(key + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
export function duration(minutes) {
  const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), rest = minutes % 60;
  return (days ? `${days} д ` : '') + (hours ? `${hours} ч ` : '') + `${rest} мин`;
}
export function plural(count, one, few, many) {
  const tail = count % 100, last = count % 10;
  return tail >= 11 && tail <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}
export const daysLabel = (count) => `${count} ${plural(count, 'день', 'дня', 'дней')}`;
export const nightsLabel = (count) => `${count} ${plural(count, 'ночь', 'ночи', 'ночей')}`;
export const countLabel = (count) => `${count} ${plural(count, 'вариант', 'варианта', 'вариантов')}`;

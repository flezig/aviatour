// Единственное место, где собираются партнёрские ссылки. Каждая идёт через наш /go с меткой
// «<код города>-<страница>-<блок>» (только a–z, 0–9 и дефис, до 32 знаков): метка уходит в Travelpayouts как sub_id
// и видна в отчётах. Пока идёт эксперимент, в конец метки добавляется вариант: led-trip-tickets-b.
// Здесь те же списки разрешённых адресов, что и на сервере (backend/app/rules.py); сервер проверяет ещё раз.
const AVIASALES_HOSTS = new Set(['aviasales.com', 'www.aviasales.com', 'aviasales.ru', 'www.aviasales.ru']);
const KINDS = {
  tours: (url) => url.hostname === 'experience.tripster.ru' && /^\/experience\/[A-Za-z_0-9-]+\/$/.test(url.pathname),
  // Поиск билетов: https://(www.)aviasales.(ru|com)/search/…
  tickets: (url) => AVIASALES_HOSTS.has(url.hostname) && url.pathname.startsWith('/search/'),
  // Поиск отелей по городу и датам: https://(www.)aviasales.(ru|com)/hotels/search?location_id=…
  hotels: (url) => AVIASALES_HOSTS.has(url.hostname) && url.pathname === '/hotels/search',
  // Страница города на Островке: только адреса из web/data/cities.json, сервер сверяет ссылку со списком целиком.
  ostrovok: (url) => url.hostname === 'ostrovok.ru' && /^\/hotel\/[a-z_]+\/[a-z0-9._-]+\/?$/.test(url.pathname) && !url.hash && (!url.search || /^\?dates=\d{2}\.\d{2}\.\d{4}-\d{2}\.\d{2}\.\d{4}&guests=[1-4]$/.test(url.search)),
};
export const PARTNER = { tickets: 'aviasales', hotels: 'aviasales', ostrovok: 'ostrovok', tours: 'tripster' };

const slug = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function clickLabel({ city, page, block, variant } = {}) {
  return [city, page, block, variant].map(slug).filter(Boolean).join('-').slice(0, 32).replace(/-+$/, '');
}

export function partnerLink(address, { kind, city, page, block, variant } = {}) {
  let url;
  try { url = new URL(address); } catch { return null; }
  const allowed = KINDS[kind];
  if (!allowed || url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowed(url)) return null;
  const label = clickLabel({ city, page, block, variant });
  return `/go?${label ? `s=${label}&` : ''}u=${encodeURIComponent(address)}`;
}

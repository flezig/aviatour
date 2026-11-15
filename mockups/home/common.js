'use strict';
// Общие помощники макетов главной. Только оформление данных из data.js, без сети.
(() => {
  const M = window.MOCK;
  const NBSP = ' ', THIN = ' ';
  const DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const local = (iso) => { const [d, t] = iso.split('T'); const [y, m, dd] = d.split('-').map(Number); return { y, m, d: dd, wd: new Date(Date.UTC(y, m - 1, dd)).getUTCDay(), time: t.slice(0, 5) }; };
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const F = {
    esc, plural,
    price: (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, THIN) + NBSP + '₽',
    num: (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, THIN),
    day: (iso) => { const x = local(iso); return `${DAYS[x.wd]}${NBSP}${x.d}${NBSP}${MON[x.m - 1]}`; },
    dayShort: (iso) => { const x = local(iso); return `${x.d}${NBSP}${MON[x.m - 1]}`; },
    time: (iso) => local(iso).time,
    range: (a, b) => { const x = local(a), y = local(b); return x.m === y.m ? `${x.d}–${y.d}${NBSP}${MON[x.m - 1]}` : `${x.d}${NBSP}${MON[x.m - 1]} – ${y.d}${NBSP}${MON[y.m - 1]}`; },
    rangeDays: (a, b) => `${F.day(a)} – ${F.day(b)}`,
    nights: (n) => `${n}${NBSP}${plural(n, 'ночь', 'ночи', 'ночей')}`,
    inDays: (n) => n === 1 ? 'вылет завтра' : `вылет через ${n}${NBSP}${plural(n, 'день', 'дня', 'дней')}`,
    weekday: (iso) => DAYS[local(iso).wd],
    city: (s) => s.replace(/\s*\(.+\)$/, ''),
    photo: (o) => o.photo ? `../../web/photos/${o.code}.jpg` : null,
    level: (o) => o.level === 'low' ? 'Цена ниже обычной' : o.level === 'high' ? 'Цена выше обычной' : o.level === 'usual' ? 'Обычная цена' : null,
    levelShort: (o) => o.level === 'low' ? 'ниже обычной' : o.level === 'high' ? 'выше обычной' : o.level === 'usual' ? 'обычная' : null,
    levelNote: (o) => o.usual ? `Обычная цена — середина цен в этот город в ${o.monthIn} для поездок похожей длины: ${F.price(o.usual)}.` : '',
    hotLine: (o) => `${F.inDays(o.inDays)} · на ${Math.abs(o.diff)}% ниже обычной цены в ${o.monthIn}`,
    route: (o) => o.direct ? 'прямой' : 'с пересадкой',
    received: () => { const d = new Date(M.receivedAt); const msk = new Date(d.getTime() + 3 * 3600e3); return `${msk.getUTCDate()}${NBSP}${MONTH_GEN[msk.getUTCMonth()]}, ${String(msk.getUTCHours()).padStart(2, '0')}:${String(msk.getUTCMinutes()).padStart(2, '0')}`; },
  };
  // Подборки: подпись, пояснение и ряд из data.js. Подборка, где меньше трёх вариантов, не показывается.
  const ROWS = [
    { key: 'hot', title: 'Горячие билеты', hint: 'Вылет в ближайшие две недели, цена заметно ниже обычной', icon: 'i-drop' },
    { key: 'weekend', title: 'На эти выходные', hint: '20–22 ноября, без отпуска', icon: 'i-weekend' },
    { key: 'nextWeekend', title: 'На следующие выходные', hint: '27–29 ноября, без отпуска', icon: 'i-weekend2' },
    { key: 'under5', title: `До 5${THIN}000${NBSP}₽`, hint: 'Билеты туда и обратно', icon: 'i-wallet' },
    { key: 'under10', title: `До 10${THIN}000${NBSP}₽`, hint: 'Билеты туда и обратно', icon: 'i-wallet2' },
  ].filter((row) => (M.rows[row.key] ?? []).length >= 3).map((row) => ({ ...row, items: M.rows[row.key] }));
  // Свои значки в стиле web/icons.svg: 24×24, линия 2, скруглённые концы.
  const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
  <symbol id="i-plane" viewBox="0 0 24 24"><path fill="currentColor" d="M21.5 3.2c-.9-.9-2.4-.7-3.4.3l-3.5 3.5-9.3-2.6-1.6 1.6 7.5 4.4-3.6 3.6-2.6-.5-1.3 1.3 3.5 1.9 1.9 3.5 1.3-1.3-.5-2.6 3.6-3.6 4.4 7.5 1.6-1.6-2.6-9.3 3.5-3.5c1-1 1.2-2.5.3-3.4z"/></symbol>
  <symbol id="i-search" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></g></symbol>
  <symbol id="i-heart" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0112 7.3 4.3 4.3 0 0119.5 10c0 5.4-7.5 10-7.5 10z"/></symbol>
  <symbol id="i-pen" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></g></symbol>
  <symbol id="i-pin" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0113 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></g></symbol>
  <symbol id="i-arrow" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 6l6 6-6 6"/></symbol>
  <symbol id="i-chev" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 10l5 5 5-5"/></symbol>
  <symbol id="i-drop" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l6 6 4-4 6 6"/><path d="M15 14h5v-5"/></g></symbol>
  <symbol id="i-weekend" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/><path d="M13.5 14h3v3h-3z"/></g></symbol>
  <symbol id="i-weekend2" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/><path d="M8 15.5h8M13 13l3 2.5-3 2.5"/></g></symbol>
  <symbol id="i-wallet" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7.5A2.5 2.5 0 016.5 5H17v3"/><rect x="4" y="8" width="16" height="11" rx="2.5"/><circle cx="16" cy="13.5" r="1" fill="currentColor"/></g></symbol>
  <symbol id="i-wallet2" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="6" width="17" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.5"/><path d="M7 9.5v5M17 9.5v5"/></g></symbol>
  <symbol id="i-info" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></g></symbol>
  </svg>`;
  document.body.insertAdjacentHTML('afterbegin', SPRITE);
  const icon = (id, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"></use></svg>`;
  window.MK = { M, F, ROWS, icon };
})();

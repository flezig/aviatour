'use strict';
// Aviator web search. Rules mirror the iOS client (Aviator/Utilities/SearchRules.swift); the server stays the source of truth.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="icons.svg#${name}"></use></svg>`;

  const EUROPE = new Set('AL AD AT BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT LV LI LT LU MT MD MC ME NL MK NO PL PT RO SM RS SK SI ES SE CH TR UA GB VA XK'.split(' '));
  const REGIONS = { any: 'Куда угодно', europe: 'Поездка в Европу', usa: 'Поездка в США' };
  const SORTS = { price: 'Сначала дешевле', priceDescending: 'Сначала дороже', departure: 'Ближайший вылет', duration: 'Меньше времени в пути', stay: 'Больше времени на месте', value: 'Выгоднее час поездки', flightRating: 'По предварительной оценке перелёта' };
  const CHIPS = { cheap: 'До 20 000 ₽', direct: 'Прямые', noLeave: 'Без отпуска', russia: 'Россия', unique: 'Один вариант на город' };
  const TAGS = { sea: 'Море', culture: 'Музеи и культура', food: 'Гастрономия', architecture: 'Архитектура', nature: 'Природа', nightlife: 'Вечерняя жизнь' };
  const POPULAR = ['MOW', 'LED', 'SVX', 'OVB', 'KZN', 'GOJ', 'KUF', 'UFA', 'AER', 'KGD'];
  const DEFAULT_ZONE = 'Europe/Moscow';
  const PAGE = 60;
  const config = window.AVIATOR ?? {};
  // A/B: a variant is drawn once per browser and kept. #ab=A or #ab=B previews a variant without storing it.
  function variant(name) {
    const preview = /[#&]ab=([AB])\b/.exec(location.hash)?.[1];
    if (preview) return preview;
    if (!config.experiments?.[name]) return 'B';
    try {
      let value = localStorage.getItem('aviator.ab.' + name);
      if (value !== 'A' && value !== 'B') { value = Math.random() < 0.5 ? 'A' : 'B'; localStorage.setItem('aviator.ab.' + name, value); }
      return value;
    } catch { return 'B'; }
  }
  const homeVariant = variant('home');
  // Click label for Travelpayouts reports: the source and, while a test runs, the variant.
  const clickLabel = config.experiments?.home ? `web-home-${homeVariant.toLowerCase()}` : 'web';
  const inRegion = (region, country) => region === 'any' || (region === 'usa' ? country === 'US' : EUROPE.has(country));

  // --- dates and money, always in the airport's own zone ---
  const formatters = new Map();
  function formatter(zone, options, locale = 'ru-RU') {
    const key = locale + zone + JSON.stringify(options);
    if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat(locale, { timeZone: zone, ...options }));
    return formatters.get(key);
  }
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function zoned(date, zone) {
    const p = Object.fromEntries(formatter(zone, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }, 'en-US').formatToParts(date).map((part) => [part.type, part.value]));
    // weekday: 1 = Sunday … 7 = Saturday, as in the app's calendar.
    return { year: +p.year, month: +p.month, hour: +p.hour % 24, weekday: WEEKDAYS.indexOf(p.weekday) + 1, key: `${p.year}-${p.month}-${p.day}` };
  }
  const fmtDate = (date, zone, time = false) => formatter(zone, { day: 'numeric', month: 'short', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}) }).format(date).replace(' г.', '');
  const fmtTime = (date, zone) => formatter(zone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  const fmtMoney = (minor) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(minor / 100);
  function monthLabel(month) {
    const [year, number] = month.split('-').map(Number);
    const text = formatter('UTC', { month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, number - 1, 1))).replace(' г.', '');
    return text[0].toUpperCase() + text.slice(1);
  }
  function months(zone) {
    const now = zoned(new Date(), zone);
    return Array.from({ length: 6 }, (_, i) => {
      const date = new Date(Date.UTC(now.year, now.month - 1 + i, 1));
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    });
  }
  function defaultMonth(zone) {
    const now = zoned(new Date(), zone), list = months(zone);
    const left = new Date(Date.UTC(now.year, now.month, 0)).getUTCDate() - Number(now.key.slice(8));
    return left < 10 ? list[1] : list[0];
  }
  const addDays = (key, days) => new Date(Date.parse(key + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  function duration(minutes) {
    const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), rest = minutes % 60;
    return (days ? `${days} д ` : '') + (hours ? `${hours} ч ` : '') + `${rest} мин`;
  }
  function countLabel(count) {
    const tail = count % 100, last = count % 10;
    const word = tail >= 11 && tail <= 14 ? 'вариантов' : last === 1 ? 'вариант' : last >= 2 && last <= 4 ? 'варианта' : 'вариантов';
    return `${count} ${word}`;
  }

  // --- state ---
  const state = {
    query: { origin: 'SVO', originCity: 'MOW', destination: null, destinationCity: null, region: 'any', exact: false, month: defaultMonth(DEFAULT_ZONE), departure: null, returning: null, weekend: false, budget: 25000, direct: false },
    labels: { origin: 'Москва · все аэропорты', destination: null },
    performed: null, performedLabels: null, performedLabel: '', status: 'idle', error: '', result: null,
    // A first-time visitor asks «куда», so one best offer per city is on by default; «Все» shows every date and flight.
    filters: { cheap: false, direct: false, noLeave: false, russia: false, unique: true }, sort: 'price', limit: PAGE,
    airports: null, cities: null, byIata: new Map(), photos: new Set(), guides: {}, pickerTarget: 'origin', shown: new Map(),
  };
  let request = null;

  const originZone = () => state.byIata.get(state.query.origin)?.timezone || DEFAULT_ZONE;

  // --- offers ---
  const factCache = new WeakMap();
  function facts(offer) {
    if (factCache.has(offer)) return factCache.get(offer);
    const dep = new Date(offer.departure_at), ret = new Date(offer.return_at);
    // Arrival is estimated from the leg duration; unknown or zero duration means unknown arrival.
    const arr = offer.duration_to > 0 ? new Date(dep.getTime() + offer.duration_to * 60000) : null;
    const home = offer.duration_back > 0 ? new Date(ret.getTime() + offer.duration_back * 60000) : null;
    const stay = arr && ret > arr ? (ret - arr) / 3600000 : null;
    const value = {
      dep, ret, arr, home, stay, cost: stay ? Math.ceil(offer.price_minor / stay) : null,
      out: zoned(dep, offer.origin_timezone), homeZone: home ? zoned(home, offer.origin_timezone) : null,
      direct: offer.transfers === 0 && offer.return_transfers === 0,
      flight: offer.duration_to > 0 && offer.duration_back > 0 ? offer.duration_to + offer.duration_back : Infinity,
      score: offer.trip_rating?.score ?? offer.trip_rating?.preliminary_score ?? null,
    };
    factCache.set(offer, value);
    return value;
  }
  function accepts(offer) {
    const f = state.filters, x = facts(offer);
    if (x.dep <= Date.now()) return false;
    if (f.direct && !x.direct) return false;
    if (f.cheap && offer.price_minor > 2000000) return false;
    if (f.russia && offer.country_code !== 'RU') return false;
    if (f.noLeave) {
      const departureOK = (x.out.weekday === 6 && x.out.hour >= 18) || x.out.weekday === 7;
      const returnOK = x.homeZone && (x.homeZone.weekday === 1 || (x.homeZone.weekday === 2 && x.homeZone.hour < 9));
      if (!departureOK || !returnOK) return false;
    }
    return true;
  }
  function sortKey(offer) {
    const x = facts(offer);
    switch (state.sort) {
      case 'priceDescending': return -offer.price_minor;
      case 'departure': return x.dep.getTime();
      case 'duration': return x.flight;
      case 'stay': return x.stay == null ? Infinity : -x.stay;
      case 'value': return x.stay == null ? Infinity : offer.price_minor / x.stay;
      case 'flightRating': return offer.trip_rating?.preliminary_score == null ? Infinity : -offer.trip_rating.preliminary_score;
      default: return offer.price_minor;
    }
  }
  function visibleOffers() {
    const seen = new Set();
    return (state.result?.offers ?? []).filter(accepts).sort((a, b) => {
      const av = sortKey(a), bv = sortKey(b);
      if (av !== bv) return av < bv ? -1 : 1;
      if (a.price_minor !== b.price_minor) return a.price_minor - b.price_minor;
      if (a.city_code !== b.city_code) return a.city_code < b.city_code ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }).filter((offer) => !state.filters.unique || (!seen.has(offer.city_code) && seen.add(offer.city_code)));
  }
  const airlineLabel = (offer) => offer.airline_name ? `${offer.airline_name} (${offer.airline ?? ''})` : offer.airline || 'Авиакомпания не указана';
  const photo = (code) => `<div class="photo">${state.photos.has(code) ? `<img src="photos/${esc(code)}.jpg" alt="" loading="lazy" decoding="async">` : icon('plane')}</div>`;
  // Same allow-list as the app: only an HTTPS Aviasales search page may be opened, and only through /go.
  function handoff(offer) {
    try {
      const url = new URL(offer.search_url);
      const hosts = ['aviasales.com', 'www.aviasales.com', 'aviasales.ru', 'www.aviasales.ru'];
      if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password || (url.port && url.port !== '443') || !url.pathname.startsWith('/search/')) return null;
      return `/go?s=${clickLabel}&u=${encodeURIComponent(offer.search_url)}`;
    } catch { return null; }
  }

  function offerCard(offer) {
    const x = facts(offer), score = x.score;
    return `<article class="offer">
      ${photo(offer.city_code)}
      <div class="offer-body">
        <h3 class="offer-city"><button type="button" class="offer-open" data-offer="${esc(offer.id)}">${esc(offer.city)}</button></h3>
        ${state.guides[offer.city_code] ? `<p class="caption">${esc(state.guides[offer.city_code].summary)}</p>` : ''}
        <div><span class="offer-price">${esc(fmtMoney(offer.price_minor))}</span><p class="caption">туда-обратно</p></div>
        <p>${esc(fmtDate(x.dep, offer.origin_timezone))} — ${esc(fmtDate(x.ret, offer.destination_timezone))}</p>
        <p class="strong">LIVE · кешированная цена</p>
        <p class="tiny">Получено ${esc(fmtDate(new Date(offer.received_at), localZone, true))}</p>
        <p class="caption">${x.direct ? 'Прямые туда и обратно' : 'Условия пересадок — в карточке'}</p>
        <p>${esc(airlineLabel(offer))}</p>
        <p>Туда ${esc(fmtTime(x.dep, offer.origin_timezone))} → ${x.arr ? esc(fmtTime(x.arr, offer.destination_timezone)) : '—'}*</p>
        <p>Обратно ${esc(fmtTime(x.ret, offer.destination_timezone))} → ${x.home ? esc(fmtTime(x.home, offer.origin_timezone)) : '—'}*</p>
        <p class="tiny">* Прилёт расчётный · местное время</p>
        ${x.stay ? `<p class="offer-stay">${icon('sun')}≈ ${Math.floor(x.stay)} ч на месте</p><p>${esc(fmtMoney(x.cost))} / час поездки</p>` : ''}
        <div class="rating"><span>${offer.trip_rating?.score != null ? 'Рейтинг поездки' : 'Оценка перелёта*'}</span><b>${score != null ? `${esc(score)}/100` : '—'}</b></div>
      </div>
    </article>`;
  }

  function statusPanel(symbol, title, message) {
    return `<div class="status">${icon(symbol)}<h3>${esc(title)}</h3><p>${esc(message)}</p></div>`;
  }
  const action = (name, title, primary = true) => `<button type="button" class="${primary ? 'btn-primary' : 'btn-inline btn-inline--wide'}" data-action="${name}">${esc(title)}</button>`;

  function renderResults() {
    const section = $('results'), q = state.performed;
    section.hidden = state.status === 'idle';
    $('searchButton').disabled = state.status === 'loading';
    if (!q) return;
    let body = '';
    const announce = (text) => { $('resultsStatus').textContent = text; };
    if (state.status === 'loading') {
      body = `<div class="status"><div class="spinner" aria-hidden="true"></div><p>Ищем варианты поездки…</p></div>`;
      announce('Ищем варианты поездки');
    } else if (state.status === 'error') {
      body = statusPanel('alert', 'Поиск не завершён', state.error) + `<div class="status-actions">${action('retry', 'Попробовать ещё раз')}</div>`;
      announce('Поиск не завершён. ' + state.error);
    } else if (state.status === 'offline') {
      body = statusPanel('offline', 'Нет связи', 'Не удалось связаться с сервером. Проверьте подключение.') + `<div class="status-actions">${action('retry', 'Повторить поиск')}</div>`;
      announce('Нет связи с сервером');
    } else {
      const offers = visibleOffers(), active = Object.values(state.filters).some(Boolean);
      state.shown = new Map(offers.map((offer) => [offer.id, offer]));
      announce(offers.length ? `Найдено: ${countLabel(offers.length)}` : 'Подходящих вариантов нет');
      const chips = `<button type="button" class="chip" data-chip="all" aria-pressed="${!active}">Все</button>` + Object.entries(CHIPS)
        .filter(([name]) => name !== 'russia' || q.region === 'any')
        .map(([name, title]) => `<button type="button" class="chip" data-chip="${name}" aria-pressed="${state.filters[name]}">${title}</button>`).join('');
      const otherSort = state.sort !== 'price' && state.sort !== 'priceDescending';
      body = `<p class="caption">* Оценка перелёта — цена билетов и дорога. Жильё, безопасность и полный бюджет в неё не входят.</p>
        <div class="chips" role="group" aria-label="Быстрые фильтры">${chips}</div>
        <div class="results-bar"><p class="results-count">${esc(countLabel(offers.length))}</p></div>
        <div class="sort-row">
          <div class="segmented" role="radiogroup" aria-label="По цене">
            <label><input type="radio" name="priceSort" value="price" ${state.sort === 'price' ? 'checked' : ''}><span>Сначала дешевле</span></label>
            <label><input type="radio" name="priceSort" value="priceDescending" ${state.sort === 'priceDescending' ? 'checked' : ''}><span>Сначала дороже</span></label>
          </div>
          <select class="menu menu--plain" id="sort" aria-label="Сортировка">${Object.entries(SORTS).map(([name, title]) => `<option value="${name}" ${state.sort === name ? 'selected' : ''}>${title}</option>`).join('')}</select>
        </div>
        ${state.sort === 'flightRating' ? '<p class="caption">Варианты с неизвестной оценкой идут в конце.</p>' : ''}
        ${state.sort === 'stay' || state.sort === 'value' ? '<p class="caption">Время на месте — от расчётного прилёта до обратного вылета, включая ночи. Дорога из аэропорта и ожидание не вычтены.</p>' : ''}
        ${state.result.incomplete ? `<p class="footnote">Источник вернул часть вариантов; выдача может быть неполной</p>${state.result.warnings.map((text) => `<p class="caption">${esc(text)}</p>`).join('')}` : ''}`;
      if (!offers.length) {
        if (active) {
          body += statusPanel('send', 'Пока без вариантов', 'Дополнительные фильтры скрыли найденные варианты. Сбросьте их, чтобы увидеть результаты исходного поиска.')
            + `<div class="status-actions">${action('resetFilters', 'Сбросить фильтры')}</div>`;
        } else {
          body += statusPanel('send', 'Пока без вариантов', 'В кеше цен нет подходящих поездок для выбранных дат и бюджета. Это не означает, что билетов нет. Увеличьте бюджет или выберите другой месяц.' + (q.direct ? ' Попробуйте разрешить пересадки.' : ''))
            + `<div class="status-actions">
              ${!q.exact && q.weekend ? action('allTrips', 'Показать не только короткие выходные') : ''}
              ${q.budget < 500000 ? action('moreBudget', 'Увеличить бюджет на 10 000 ₽') : ''}
              ${q.direct ? action('allowTransfers', 'Разрешить пересадки') : ''}
              ${action('edit', 'Изменить даты и направление', false)}
            </div>`;
        }
      } else {
        body += `<div class="grid">${offers.slice(0, state.limit).map(offerCard).join('')}</div>`
          + (state.limit < offers.length ? `<div class="status-actions">${action('more', `Ещё варианты · ${offers.length - state.limit}`)}</div>` : '');
      }
    }
    section.innerHTML = `<h2>Варианты</h2><p class="summary">${esc(state.performedLabel)}</p>${body}`;
  }

  function endpoint(date, estimated, zone, city, airport, code) {
    return `<div class="endpoint">
      <div class="endpoint-time"><b>${date ? (estimated ? '≈ ' : '') + esc(fmtTime(date, zone)) : '—'}</b><span class="caption">${date ? esc(fmtDate(date, zone)) : 'Время не указано'}</span></div>
      <div class="endpoint-place"><b>${esc(city)}</b><span>${esc(airport)}, ${esc(code)}</span></div>
    </div>`;
  }
  function routeCard(offer, outbound) {
    const x = facts(offer), transfers = outbound ? offer.transfers : offer.return_transfers, minutes = outbound ? offer.duration_to : offer.duration_back;
    const from = outbound ? offer.origin_city : offer.city, to = outbound ? offer.city : offer.origin_city;
    return `<section class="card route">
      <div class="route-head"><span class="route-dir">${icon(outbound ? 'takeoff' : 'landing')}${outbound ? 'Туда' : 'Обратно'}</span>${minutes ? `<span class="caption">${esc(duration(minutes))} в пути</span>` : ''}</div>
      <h3>${esc(from)} → ${esc(to)}</h3>
      <div class="carrier"><span class="carrier-icon">${icon('plane')}</span><div><b>${esc(outbound ? airlineLabel(offer) : 'Обратный перевозчик не указан')}</b>${outbound && offer.flight_number ? `<p class="caption">Рейс ${esc(offer.flight_number)}</p>` : ''}</div></div>
      ${outbound
        ? endpoint(x.dep, false, offer.origin_timezone, from, offer.origin_name, offer.origin_airport) + endpoint(x.arr, true, offer.destination_timezone, to, offer.destination_name, offer.destination_airport)
        : endpoint(x.ret, false, offer.destination_timezone, from, offer.destination_name, offer.destination_airport) + endpoint(x.home, true, offer.origin_timezone, to, offer.origin_name, offer.origin_airport)}
      <div class="note">
        <b>${icon(transfers === 0 ? 'check' : 'swap')}${transfers == null ? 'Количество пересадок неизвестно' : transfers === 0 ? 'Без пересадок' : `Пересадок: ${esc(transfers)}`}</b>
        ${transfers !== 0 ? '<p class="footnote">Источник не сообщил аэропорты пересадок, время ожидания и перевозчиков отдельных участков. Полный маршрут уточните на Aviasales.</p>' : ''}
        ${outbound ? '<p class="caption">Указана авиакомпания из найденной цены. Фактический оператор каждого участка не подтверждён.</p>' : ''}
      </div>
      <p class="caption">Прилёт ≈ рассчитан по длительности. Время местное.</p>
    </section>`;
  }
  // Editorial city notes prepared for the app (backend/app/city_guides.json); shown only where they exist.
  function guideBlock(code) {
    const guide = state.guides[code];
    if (!guide) return '';
    const list = (items) => `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
    const link = /^https:\/\//.test(guide.tourism_url ?? '') ? guide.tourism_url : null;
    return `<section class="card guide">
      <h3>О городе</h3>
      <p>${esc(guide.summary)}</p>
      <div class="tags">${guide.tags.filter((tag) => TAGS[tag]).map((tag) => `<span class="tag">${TAGS[tag]}</span>`).join('')}</div>
      <div class="stack"><h4>Идеи прогулок</h4>${list(guide.places)}</div>
      <div class="stack"><h4>Районы для изучения</h4>${list(guide.areas)}</div>
      <p class="caption">${esc(guide.days)}</p>
      <p class="caption">Редакционные идеи от ${esc(fmtDate(new Date(guide.editorial_updated + 'T00:00:00Z'), 'UTC'))}. Доступность мест и транспорт уточните перед поездкой.</p>
      ${link ? `<a class="btn-inline btn-inline--wide" href="${esc(link)}" target="_blank" rel="noopener">Официальный туристический портал</a>` : ''}
    </section>`;
  }
  function openDetail(offer) {
    const x = facts(offer), past = x.dep <= Date.now(), link = past ? null : handoff(offer);
    $('detailBody').innerHTML = `<div class="detail">
      ${photo(offer.city_code)}
      <div class="stack"><h2>${esc(offer.city)}</h2><p class="footnote">${esc(offer.country ?? 'Страна не указана')}</p></div>
      <p class="eyebrow">LIVE · кешированные данные</p>
      ${past ? '<p class="footnote">Даты прошли. Выполните новый поиск.</p>' : ''}
      <div class="stack">
        <p class="detail-price">${esc(fmtMoney(offer.price_minor))}</p>
        <p class="footnote">Ориентировочно · туда-обратно · один взрослый</p>
        <p class="footnote">Класс тарифа не подтверждён источником. Поиск на Aviasales откроется для эконом-класса.</p>
        <p class="caption">Получено ${esc(fmtDate(new Date(offer.received_at), localZone, true))}</p>
      </div>
      ${guideBlock(offer.city_code)}
      ${routeCard(offer, true)}
      ${routeCard(offer, false)}
      ${x.stay ? `<section class="stay">
        <h3>${icon('sun')}Время для вашей поездки</h3>
        <p class="stay-hours">≈ ${Math.floor(x.stay)} часов в пункте назначения</p>
        <p class="stay-cost">${esc(fmtMoney(x.cost))} за час поездки</p>
        <p class="caption">От расчётного прилёта до обратного вылета, включая ночи. Дорога из аэропорта, ожидание, проживание и питание не учтены.</p>
      </section>` : ''}
      <div class="handoff">
        ${link ? `<a class="btn-primary" href="${esc(link)}" target="_blank" rel="noopener">Проверить цену на Aviasales →</a>` : `<span class="btn-primary" aria-disabled="true">Проверить цену на Aviasales →</span>`}
        ${!link && !past ? '<p class="footnote">Не удалось сформировать безопасную ссылку.</p>' : ''}
        <div class="trust">${icon('shield')}<p>Откроется сайт Aviasales в новой вкладке. Покупка и оплата проходят там. Aviator не принимает оплату и не запрашивает данные карты или паспорта. <a href="how-we-earn.html">Как мы зарабатываем</a></p></div>
        <p class="footnote">Цена ориентировочная и может измениться. Актуальную стоимость показывает Aviasales.</p>
        <p class="footnote">Проживание, питание и трансферы не включены. Условия багажа проверяйте у продавца.</p>
      </div>
    </div>`;
    $('detailBody').scrollTop = 0;
    $('detail').showModal();
  }

  // --- form ---
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_ZONE;
  function renderForm() {
    const q = state.query, zone = originZone(), list = months(zone), today = zoned(new Date(), zone).key;
    if (!q.exact && !list.includes(q.month)) q.month = list[0];
    $('originLabel').textContent = state.labels.origin;
    $('destinationLabel').textContent = state.labels.destination ?? (q.region === 'any' ? 'Куда угодно' : 'Все основные города');
    $('destinationClear').hidden = !q.destination;
    $('region').value = q.region;
    $('regionHint').hidden = q.region === 'any';
    document.querySelector(`input[name="dateMode"][value="${q.exact ? 'exact' : 'month'}"]`).checked = true;
    $('monthFields').hidden = q.exact;
    $('exactFields').hidden = !q.exact;
    $('month').innerHTML = list.map((month) => `<option value="${month}">${esc(monthLabel(month))}</option>`).join('');
    $('month').value = q.exact ? list[0] : q.month;
    $('weekendOnly').checked = q.weekend;
    if (q.exact) {
      const last = addDays(list[5].slice(0, 7) + '-01', 31).slice(0, 7) + '-01';
      $('departureDate').min = today; $('departureDate').max = addDays(last, -1); $('departureDate').value = q.departure;
      $('returnDate').min = addDays(q.departure, 1); $('returnDate').max = addDays(q.departure, 60); $('returnDate').value = q.returning;
    }
    $('budget').value = q.budget;
    $('budget').style.setProperty('--fill-to', `${((q.budget - 5000) / 495000) * 100}%`);
    $('budgetValue').textContent = fmtMoney(q.budget * 100);
    $('directOnly').checked = q.direct;
  }
  function setExact(enabled) {
    const q = state.query;
    q.exact = enabled;
    if (enabled) {
      q.departure = addDays(zoned(new Date(), originZone()).key, 1);
      q.returning = addDays(q.departure, 2);
      q.month = q.departure.slice(0, 7);
    } else { q.departure = q.returning = null; }
  }
  function setDeparture(key) {
    const q = state.query;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
    q.departure = key; q.month = key.slice(0, 7);
    const lower = addDays(key, 1), upper = addDays(key, 60);
    q.returning = !q.returning || q.returning < lower ? lower : q.returning > upper ? upper : q.returning;
  }
  function summary(q) {
    const day = (key) => fmtDate(new Date(key + 'T00:00:00Z'), 'UTC');
    const dates = q.exact ? `${day(q.departure)} — ${day(q.returning)}` : monthLabel(q.month);
    return `${state.labels.origin} → ${state.labels.destination ?? REGIONS[q.region]} · ${dates} · до ${fmtMoney(q.budget * 100)}`;
  }

  // --- search ---
  function payload(q) {
    return {
      origin: q.origin, origin_city_code: q.originCity, month: q.month, max_budget_minor: q.budget * 100, direct_only: q.direct,
      region: q.region, departure_date: q.exact ? q.departure : null, return_date: q.exact ? q.returning : null, weekend_only: q.weekend,
      destination: q.destination, destination_city_code: q.destinationCity,
    };
  }
  function toParams(q) {
    const params = new URLSearchParams({ from: q.origin, budget: q.budget });
    if (q.originCity) params.set('fc', q.originCity);
    if (q.destination) params.set('to', q.destination);
    if (q.destinationCity) params.set('tc', q.destinationCity);
    if (q.region !== 'any') params.set('region', q.region);
    if (q.exact) { params.set('dep', q.departure); params.set('ret', q.returning); } else { params.set('month', q.month); if (!q.weekend) params.set('weekend', '0'); }
    if (q.direct) params.set('direct', '1');
    return params;
  }
  // auto: the first screen loads the default search by itself; if that fails the page just stays a form.
  async function search({ scroll = true, auto = false } = {}) {
    request?.abort();
    request = new AbortController();
    const q = { ...state.query }, signal = request.signal;
    Object.assign(state, { performed: q, performedLabels: { ...state.labels }, performedLabel: summary(q), status: 'loading', limit: PAGE });
    if (!auto) history.replaceState(null, '', '?' + toParams(q));
    renderResults();
    if (scroll) $('results').scrollIntoView({ block: 'start' });
    try {
      const response = await fetch('/api/v1/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(q)), signal });
      const data = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(data?.offers)) {
        Object.assign(state, { status: auto ? 'idle' : 'error', error: data?.error?.message || 'Сервер вернул неожиданный ответ. Попробуйте позже.' });
      } else {
        Object.assign(state, { status: 'done', result: data });
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
      state.status = auto ? 'idle' : 'offline';
    }
    renderResults();
  }

  // --- airports ---
  async function loadAirports() {
    if (state.airports) return;
    const response = await fetch('/api/v1/airports');
    if (!response.ok) throw new Error('airports');
    // The search API accepts only three-letter Latin codes; the catalog also lists local Cyrillic ones.
    state.airports = (await response.json()).filter((airport) => airport.timezone && /^[A-Z]{3}$/.test(airport.iata) && /^[A-Z]{3}$/.test(airport.city_code));
    state.cities = new Map();
    for (const airport of state.airports) {
      state.byIata.set(airport.iata, airport);
      if (!state.cities.has(airport.city_code)) state.cities.set(airport.city_code, { id: airport.city_code, name: airport.city, country: airport.country, countryCode: airport.country_code, airports: [] });
      state.cities.get(airport.city_code).airports.push(airport);
    }
  }
  function airportLabel(iata, cityCode) {
    const airport = state.byIata.get(iata);
    if (!airport) return cityCode ?? iata;
    return cityCode ? `${airport.city} · все аэропорты` : `${airport.city} · ${airport.iata}`;
  }
  function pickerCities(term) {
    const region = state.pickerTarget === 'destination' ? state.query.region : 'any';
    const all = [...state.cities.values()].filter((city) => inRegion(region, city.countryCode));
    if (!term) {
      const popular = POPULAR.map((code) => state.cities.get(code)).filter((city) => city && all.includes(city));
      return popular.length ? popular : all.sort((a, b) => a.name.localeCompare(b.name, 'ru')).slice(0, 40);
    }
    const rank = (city) => city.name.toLowerCase().startsWith(term) ? 0 : city.id.toLowerCase() === term || city.airports.some((a) => a.iata.toLowerCase() === term) ? 1 : 2;
    return all.filter((city) => city.name.toLowerCase().includes(term) || city.id.toLowerCase().includes(term) || city.airports.some((a) => a.iata.toLowerCase().includes(term) || a.name.toLowerCase().includes(term)))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ru')).slice(0, 40);
  }
  function renderPicker() {
    const list = $('pickerList');
    if (!state.cities) { list.innerHTML = '<p class="picker-note">Загружаем справочник аэропортов…</p>'; return; }
    const cities = pickerCities($('pickerInput').value.trim().toLowerCase());
    list.innerHTML = cities.length ? cities.map((city) => `<div class="picker-city">${esc(city.name)} <span class="caption">${esc(city.country ?? '')}</span></div>`
      + (city.airports.length > 1 ? `<button type="button" class="picker-row" data-iata="${esc(city.airports[0].iata)}" data-city="${esc(city.id)}"><b>Все аэропорты города</b><span>${esc(city.airports.map((a) => a.iata).join(', '))}</span></button>` : '')
      + city.airports.map((airport) => `<button type="button" class="picker-row" data-iata="${esc(airport.iata)}"><b>${esc(airport.city)} · ${esc(airport.iata)}</b><span>${esc(airport.name)}</span></button>`).join('')).join('')
      : '<p class="picker-note">Ничего не найдено. Попробуйте название города или код аэропорта.</p>';
  }
  async function openPicker(target) {
    state.pickerTarget = target;
    $('pickerTitle').textContent = target === 'origin' ? 'Откуда летим' : 'Куда летим';
    $('pickerInput').value = '';
    renderPicker();
    $('picker').showModal();
    try { await loadAirports(); renderPicker(); }
    catch { $('pickerList').innerHTML = '<p class="picker-note">Не удалось загрузить справочник. Проверьте подключение и откройте список ещё раз.</p>'; }
  }
  function choose(iata, cityCode) {
    const q = state.query;
    if (state.pickerTarget === 'origin') {
      q.origin = iata; q.originCity = cityCode; state.labels.origin = airportLabel(iata, cityCode);
    } else {
      q.destination = iata; q.destinationCity = cityCode; state.labels.destination = airportLabel(iata, cityCode);
    }
    $('picker').close();
    renderForm();
  }

  // --- events ---
  $('originPick').addEventListener('click', () => openPicker('origin'));
  $('destinationPick').addEventListener('click', () => openPicker('destination'));
  $('destinationClear').addEventListener('click', () => { Object.assign(state.query, { destination: null, destinationCity: null }); state.labels.destination = null; renderForm(); });
  $('pickerInput').addEventListener('input', renderPicker);
  $('pickerList').addEventListener('click', (event) => {
    const row = event.target.closest('[data-iata]');
    if (row) choose(row.dataset.iata, row.dataset.city ?? null);
  });
  $('region').addEventListener('change', (event) => {
    const q = state.query;
    q.region = event.target.value;
    if (q.destination && !inRegion(q.region, state.byIata.get(q.destination)?.country_code)) { q.destination = q.destinationCity = null; state.labels.destination = null; }
    // Regional searches cover a handful of cities; weekend-only would leave almost nothing.
    if (q.region !== 'any') q.weekend = false;
    renderForm();
  });
  for (const input of document.querySelectorAll('input[name="dateMode"]')) input.addEventListener('change', () => { setExact(input.value === 'exact'); renderForm(); });
  $('month').addEventListener('change', (event) => { state.query.month = event.target.value; });
  $('weekendOnly').addEventListener('change', (event) => { state.query.weekend = event.target.checked; });
  $('departureDate').addEventListener('change', (event) => { setDeparture(event.target.value); renderForm(); });
  $('returnDate').addEventListener('change', (event) => { if (event.target.value) state.query.returning = event.target.value; renderForm(); });
  $('budget').addEventListener('input', (event) => { state.query.budget = +event.target.value; renderForm(); });
  $('directOnly').addEventListener('change', (event) => { state.query.direct = event.target.checked; });
  $('search').addEventListener('submit', (event) => { event.preventDefault(); search(); });

  $('results').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-chip]'), act = event.target.closest('[data-action]'), open = event.target.closest('[data-offer]');
    if (chip) {
      if (chip.dataset.chip === 'all') for (const name of Object.keys(state.filters)) state.filters[name] = false;
      else state.filters[chip.dataset.chip] = !state.filters[chip.dataset.chip];
      state.limit = PAGE;
      renderResults();
    } else if (act) {
      const name = act.dataset.action, q = state.query;
      if (name === 'more') { state.limit += PAGE; renderResults(); return; }
      if (name === 'resetFilters') { for (const key of Object.keys(state.filters)) state.filters[key] = false; renderResults(); return; }
      if (name === 'edit') { $('search').scrollIntoView({ block: 'start' }); return; }
      if (name !== 'retry') { Object.assign(q, state.performed); state.labels = { ...state.performedLabels }; }
      if (name === 'moreBudget') q.budget = Math.min(500000, q.budget + 10000);
      if (name === 'allowTransfers') q.direct = false;
      if (name === 'allTrips') q.weekend = false;
      renderForm();
      search({ scroll: false });
    } else if (open && state.shown.has(open.dataset.offer)) {
      openDetail(state.shown.get(open.dataset.offer));
    }
  });
  $('results').addEventListener('change', (event) => {
    if (event.target.name === 'priceSort' || event.target.id === 'sort') { state.sort = event.target.value; state.limit = PAGE; renderResults(); }
  });
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('click', (event) => { if (event.target === dialog || event.target.closest('[data-close]')) dialog.close(); });
  }

  // --- start ---
  async function restore() {
    const params = new URLSearchParams(location.search), q = state.query;
    const code = (name) => /^[A-Z]{3}$/.test(params.get(name) ?? '') ? params.get(name) : null;
    const day = (name) => /^\d{4}-\d{2}-\d{2}$/.test(params.get(name) ?? '') ? params.get(name) : null;
    if (!code('from')) return false;
    try { await loadAirports(); } catch { return false; }
    if (!state.byIata.has(code('from'))) return false;
    q.origin = code('from'); q.originCity = code('fc');
    state.labels.origin = airportLabel(q.origin, q.originCity);
    if (params.get('region') in REGIONS) q.region = params.get('region');
    if (code('to') && state.byIata.has(code('to'))) { q.destination = code('to'); q.destinationCity = code('tc'); state.labels.destination = airportLabel(q.destination, q.destinationCity); }
    const budget = Number(params.get('budget'));
    if (Number.isInteger(budget) && budget >= 5000 && budget <= 500000) q.budget = budget;
    q.direct = params.get('direct') === '1';
    if (day('dep') && day('ret')) { q.exact = true; q.departure = day('dep'); q.returning = day('ret'); q.month = q.departure.slice(0, 7); }
    else { if (months(originZone()).includes(params.get('month'))) q.month = params.get('month'); q.weekend = params.get('weekend') !== '0'; }
    return true;
  }
  (async () => {
    renderForm();
    fetch('photos/manifest.json').then((response) => response.ok ? response.json() : []).then((codes) => { state.photos = new Set(codes); if (state.status === 'done') renderResults(); }).catch(() => {});
    fetch('data/city-guides.json').then((response) => response.ok ? response.json() : {}).then((guides) => { state.guides = guides; if (state.status === 'done') renderResults(); }).catch(() => {});
    const restored = await restore();
    renderForm();
    // Variant A of the home test is the bare form: nothing loads until the visitor searches.
    if (restored || homeVariant === 'B') search({ scroll: false, auto: !restored });
  })();
})();

"""Страницы городов и маршрутов (этап 4 docs/site-rework.md): готовый HTML для людей и поисковиков.

Данные — файлы сайта: web/data/cities.json (собирает scripts/build_city_pages.py), origins.json, city-guides.json,
hotel-locations.json. Цены — поиск маршрута за месяц тем же кешем, что у выдачи. Тексты о городе берутся только
из этих файлов; чего в них нет, того нет и на странице.
"""
import html
import json
import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

SITE = 'https://aviatour.vercel.app'
DATA = Path(__file__).resolve().parents[2] / 'web' / 'data'
MONTHS_AHEAD = 6
MIN_NIGHTS, MAX_NIGHTS = 1, 14
MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
MONTH_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']
TAGS = {'sea': 'Море', 'culture': 'Музеи и культура', 'food': 'Гастрономия', 'architecture': 'Архитектура', 'nature': 'Природа', 'nightlife': 'Вечерняя жизнь'}
# Цены на страницах маршрутов показываем из этих городов вылета (ссылки внизу страницы города).
ROUTE_ORIGINS = ('MOW', 'LED', 'SVX', 'KZN', 'OVB', 'KRR')


def esc(value):
    return html.escape('' if value is None else str(value), quote=True)


@dataclass
class Catalog:
    cities: list
    origins: list
    guides: dict
    hotels: dict
    radius_km: float = 300
    default_origin: str = 'MOW'
    by_slug: dict = field(default_factory=dict)
    by_code: dict = field(default_factory=dict)
    origin_by_code: dict = field(default_factory=dict)
    origin_by_slug: dict = field(default_factory=dict)

    def __post_init__(self):
        self.by_slug = {city['slug']: city for city in self.cities}
        self.by_code = {city['code']: city for city in self.cities}
        self.origin_by_code = {origin['code']: origin for origin in self.origins}
        self.origin_by_slug = {slug(origin['name']): origin for origin in self.origins}

    @property
    def ostrovok_urls(self):
        return frozenset(city['ostrovok'] for city in self.cities if city.get('ostrovok'))

    def route(self, path):
        """«moskva-kazan» → (город вылета, город). Имена с дефисом («sankt-peterburg») разбираются по известным префиксам."""
        for origin_slug, origin in self.origin_by_slug.items():
            if path.startswith(origin_slug + '-') and path[len(origin_slug) + 1:] in self.by_slug:
                city = self.by_slug[path[len(origin_slug) + 1:]]
                if city['code'] != origin['code']:
                    return origin, city
        return None


def load(data=DATA):
    read = lambda name: json.loads((data / name).read_text()) if (data / name).exists() else {}
    origins = read('origins.json')
    return Catalog(cities=read('cities.json').get('cities', []), origins=origins.get('cities', []), guides=read('city-guides.json'),
                   hotels=read('hotel-locations.json'), radius_km=origins.get('radius_km', 300), default_origin=origins.get('default', 'MOW'))


TRANSLIT = dict(zip('абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
                    ['a', 'b', 'v', 'g', 'd', 'e', 'e', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u',
                     'f', 'kh', 'ts', 'ch', 'sh', 'shch', '', 'y', '', 'e', 'yu', 'ya']))


def slug(name):
    text = ''.join(TRANSLIT.get(ch, ch) for ch in re.sub(r'\s*\(.*\)', '', name).lower())
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')


def nearest_origin(lat, lon, origins, radius_km, default):
    """Ближайший город вылета не дальше radius_km; без координат или дальше — город по умолчанию. Вторым — найден ли город."""
    fallback = next((origin for origin in origins if origin['code'] == default), origins[0])
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return fallback, False
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return fallback, False
    def km(origin):
        p1, p2 = math.radians(lat), math.radians(origin['lat'])
        dp, dl = p2 - p1, math.radians(origin['lon'] - lon)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return 6371 * 2 * math.asin(math.sqrt(a))
    best = min(origins, key=km)
    return (best, True) if km(best) <= radius_km else (fallback, False)


def origin_public(origin):
    return {key: origin[key] for key in ('code', 'iata', 'all', 'name', 'from')}


def month_keys(today):
    return [f'{(today.year * 12 + today.month - 1 + i) // 12}-{(today.month - 1 + i) % 12 + 1:02d}' for i in range(MONTHS_AHEAD)]


def nights(offer):
    return (offer.return_at.date() - offer.departure_at.date()).days


def cheapest_by_month(results, now):
    """Месяц → самая дешёвая поездка на 1–14 ночей с вылетом в будущем. results: месяц → список предложений."""
    found = {}
    for month, offers in results.items():
        usable = [offer for offer in offers if offer.departure_at > now and MIN_NIGHTS <= nights(offer) <= MAX_NIGHTS
                  and offer.availability != 'unavailable' and (offer.expires_at is None or offer.expires_at > now)
                  and offer.departure_at.strftime('%Y-%m') == month]
        if usable:
            found[month] = min(usable, key=lambda offer: (offer.price_minor, offer.departure_at, offer.id))
    return found


NBSP = '\u00a0'


def group(number):
    return f'{number:,}'.replace(',', NBSP)


def money(minor):
    whole, rest = divmod(minor, 100)
    return group(whole) + (f',{rest:02d}' if rest else '') + NBSP + '₽'


def day(moment):
    return f'{moment.day} {MONTH_SHORT[moment.month - 1]}'


def date_range(start, end):
    if (start.year, start.month) == (end.year, end.month):
        return f'{start.day}–{day(end)}'
    return f'{day(start)} – {day(end)}'


def nights_label(count):
    tail, last = count % 100, count % 10
    word = 'ночей' if 11 <= tail <= 14 else 'ночь' if last == 1 else 'ночи' if 2 <= last <= 4 else 'ночей'
    return f'{count} {word}'


def search_link(origin, city, month, price_minor=None):
    budget = 500000 if price_minor is None else min(500000, max(5000, math.ceil(price_minor / 100 / 1000) * 1000))
    params = {'from': origin['iata']}
    if origin['all']:
        params['fc'] = origin['code']
    params.update({'to': city['airport'], 'tc': city['code'], 'month': month, 'weekend': '0', 'budget': budget})
    return '/?' + urlencode(params)


def go_link(url, label):
    """Как partnerLink в web/js/lib/links.js: только через /go, метка «город-страница-блок»."""
    return f'/go?s={label}&u={quote(url, safe="")}'


def stay_dates(offer):
    """Заезд в день расчётного прилёта, выезд в день обратного вылета — по времени города назначения."""
    zone = ZoneInfo(offer.destination_timezone)
    arrive = offer.departure_at + timedelta(minutes=offer.duration_to) if offer.duration_to else offer.departure_at
    checkin, checkout = arrive.astimezone(zone).date(), offer.return_at.astimezone(zone).date()
    return (checkin, checkout) if checkout > checkin else None


def received_html(moment):
    moscow = moment.astimezone(ZoneInfo('Europe/Moscow'))
    return f'<time data-local datetime="{esc(moment.isoformat())}">{day(moscow)}, {moscow:%H:%M} мск</time>'


def fares(catalog, city, origin, cheapest, received_at, fixed=False):
    """Части страницы, зависящие от города вылета: цена «от», месяцы, жильё. Тот же HTML отдаёт /api/v1/city/…"""
    code = city['code'].lower()
    pick = (f'из&nbsp;{esc(origin["from"])}' if fixed else
            f'<button type="button" class="origin" data-origin-pick aria-haspopup="dialog">из&nbsp;{esc(origin["from"])}'
            '<svg class="icon" aria-hidden="true"><use href="/icons.svg#chevron-down"></use></svg></button>')
    best = min(cheapest.values(), key=lambda offer: (offer.price_minor, offer.departure_at)) if cheapest else None
    if best:
        best_month = best.departure_at.strftime('%Y-%m')
        price = f'''<p class="fares-from">Билеты {pick}</p>
<p class="fares-price"><span>от</span> <b>{money(best.price_minor)}</b></p>
<p class="caption">туда и обратно на одного · {date_range(best.departure_at, best.return_at)}, {nights_label(nights(best))} · цены Aviasales на {received_html(received_at)}</p>
<a class="btn-primary" href="{esc(search_link(origin, city, best_month, best.price_minor))}">Выбрать даты<svg class="icon" aria-hidden="true"><use href="/icons.svg#arrow-right"></use></svg></a>'''
    else:
        price = f'''<p class="fares-from">Билеты {pick}</p>
<p class="fares-none">В кеше Aviasales нет найденных цен на ближайшие полгода. Это не значит, что билетов нет.</p>
<a class="btn-inline" href="{esc(search_link(origin, city, month_keys(datetime.now(ZoneInfo(city['timezone'])))[0]))}">Поискать на главной</a>'''
    rows = []
    top = max((offer.price_minor for offer in cheapest.values()), default=0)
    today = received_at.astimezone(ZoneInfo(city['timezone']))
    for month in month_keys(today):
        name = MONTH_NAMES[int(month[5:]) - 1]
        offer = cheapest.get(month)
        if offer:
            width = max(6, round(offer.price_minor / top * 100))
            mark = ' best' if offer is best else ''
            rows.append(f'''<li><a class="month{mark}" href="{esc(search_link(origin, city, month, offer.price_minor))}">
<span class="month-name">{name}</span><svg class="month-bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect width="{width}" height="8" rx="2"></rect></svg>
<b>{money(offer.price_minor)}</b><span class="caption">{date_range(offer.departure_at, offer.return_at)}</span></a></li>''')
        else:
            rows.append(f'<li><span class="month month--none"><span class="month-name">{name}</span><span class="caption">цен не нашли</span></span></li>')
    months = f'''<h2 id="monthsTitle">Когда лететь дешевле</h2>
<ol class="months-list">{''.join(rows)}</ol>
<p class="caption">Самая низкая найденная цена в месяце: туда и обратно на одного, поездки на 1–14 ночей, вылет {pick if fixed else 'из&nbsp;' + esc(origin['from'])}. <a href="/how-we-count.html#city">Как мы считаем</a></p>''' if cheapest else ''
    links = []
    location = catalog.hotels.get(city['code'])
    dates = stay_dates(best) if best and location else None
    if dates:
        url = f'https://www.aviasales.ru/hotels/search?location_id={location}&location_type=city&checkin={dates[0]}&checkout={dates[1]}&adults=1'
        links.append(f'<a class="btn-inline" href="{esc(go_link(url, f"{code}-city-stay"))}" target="_blank" rel="noopener" data-partner="aviasales" data-block="stay">'
                     f'Отели на {date_range(dates[0], dates[1])} — Aviasales<svg class="icon" aria-hidden="true"><use href="/icons.svg#arrow-right"></use></svg></a>')
    if city.get('ostrovok'):
        links.append(f'<a class="btn-inline" href="{esc(go_link(city["ostrovok"], f"{code}-city-stay"))}" target="_blank" rel="noopener" data-partner="ostrovok" data-block="stay">'
                     f'Отели и апартаменты — Островок<svg class="icon" aria-hidden="true"><use href="/icons.svg#arrow-right"></use></svg></a>')
    partners = (['aviasales'] if dates else []) + (['ostrovok'] if city.get('ostrovok') else [])
    stay = f'''<h2 id="stayTitle"><svg class="icon" aria-hidden="true"><use href="/icons.svg#bed"></use></svg>Где жить</h2>
<p>{'Aviasales — на даты самой дешёвой поездки, один взрослый. ' if dates else ''}{'Островок — даты и число гостей выберете на сайте.' if city.get('ostrovok') else ''}</p>
<div class="stay-links">{''.join(links)}</div>
{''.join(f'<p class="ad-mark" data-ad="{partner}">Реклама · {"Aviasales" if partner == "aviasales" else "Островок"}</p>' for partner in partners)}''' if links else ''
    return {'price': price, 'months': months, 'stay': stay, 'has_prices': bool(best), 'best': best}


def guide_block(guide):
    if not guide:
        return ''
    items = lambda values: ''.join(f'<li>{esc(value)}</li>' for value in values)
    tags = ''.join(f'<span class="tag">{TAGS[tag]}</span>' for tag in guide.get('tags', []) if tag in TAGS)
    updated = guide.get('editorial_updated', '')
    try:
        updated = day(datetime.fromisoformat(updated)) + f' {updated[:4]}'
    except ValueError:
        updated = ''
    portal = guide.get('tourism_url', '')
    return f'''<section class="card guide" aria-labelledby="guideTitle">
<h2 id="guideTitle">Что посмотреть</h2>
<p>{esc(guide.get('summary'))}</p>
<div class="tags">{tags}</div>
<h3>Идеи прогулок</h3><ul>{items(guide.get('places', []))}</ul>
<h3>Районы</h3><ul>{items(guide.get('areas', []))}</ul>
<p class="caption">{esc(guide.get('days'))}.{f' Заметки редакции от {updated}.' if updated else ''}</p>
{f'<a class="btn-inline" href="{esc(portal)}" target="_blank" rel="noopener">Официальный туристический портал</a>' if portal.startswith('https://') else ''}
</section>'''


HEAD = '''<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>{title}</title>
  <meta name="description" content="{description}">
  <meta name="theme-color" content="#f5f4f0">{robots}
  <link rel="canonical" href="{url}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Aviator">
  <meta property="og:locale" content="ru_RU">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{description}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{image}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/fonts/geologica-cyrillic-800-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/golos-text-cyrillic-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/styles.css">
  <link rel="modulepreload" href="/js/lib/ui.js">
  <link rel="modulepreload" href="/js/lib/format.js">
  <link rel="modulepreload" href="/js/lib/measure.js">
  <link rel="modulepreload" href="/js/lib/origin.js">
  <script type="application/ld+json">{ld}</script>
</head>
<body>
  <a class="skip" href="#main">К содержанию</a>
  <header class="top wrap">
    <a class="brand" href="/"><span class="brand-mark"><svg class="icon" aria-hidden="true"><use href="/icons.svg#plane"></use></svg></span>Aviator</a>
    <nav class="nav" aria-label="Разделы сайта">
      <a href="/">Билеты</a>
      <a href="/city/"{cities_current}>Города</a>
      <a href="/#fav">Избранное</a>
      <a href="/how-we-count.html">Как мы считаем</a>
    </nav>
    <a class="top-fav" href="/#fav" aria-label="Избранное"><svg class="icon" aria-hidden="true"><use href="/icons.svg#heart"></use></svg></a>
  </header>
'''
FOOT = '''
  <footer class="wrap footer">
    <nav aria-label="Информация">
      <a href="/city/">Города</a>
      <a href="/how-we-count.html">Как мы считаем</a>
      <a href="/how-we-earn.html">Как мы зарабатываем</a>
      <a href="/about.html">О проекте</a>
      <a href="/privacy.html" data-metrika hidden>Конфиденциальность</a>
      <a href="/credits.html">Авторы фото</a>
    </nav>
    <p class="caption">Цены — находки Aviasales, окончательную цену и наличие мест показывает Aviasales. Билеты продаёт Aviasales, жильё — партнёры, мы получаем комиссию.</p>
  </footer>
{dialog}
  <script src="/config.js" defer></script>
  <script type="module" src="{script}"></script>
</body>
</html>
'''


def breadcrumbs(items):
    data = {'@context': 'https://schema.org', '@type': 'BreadcrumbList',
            'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'name': name, 'item': SITE + path} for i, (name, path) in enumerate(items)]}
    # В JSON внутри <script> нельзя оставлять «</»: экранируем косую черту.
    ld = json.dumps(data, ensure_ascii=False).replace('</', '<\\/')
    visible = ' <span aria-hidden="true">/</span> '.join(
        f'<a href="{esc(path)}">{esc(name)}</a>' if i < len(items) - 1 else f'<span aria-current="page">{esc(name)}</span>' for i, (name, path) in enumerate(items))
    return ld, f'<nav class="crumbs" aria-label="Вы здесь">{visible}</nav>'


def origin_dialog(catalog, city):
    buttons = ''.join(
        f'<button type="button" class="picker-row" data-origin="{esc(origin["code"])}" data-iata="{esc(origin["iata"])}" data-all="{int(origin["all"])}" '
        f'data-name="{esc(origin["name"])}" data-from="{esc(origin["from"])}"><b>{esc(origin["name"])}</b></button>'
        for origin in sorted(catalog.origins, key=lambda origin: origin['name']) if origin['code'] != city['code'])
    return f'''  <dialog class="sheet" id="originSheet" aria-labelledby="originTitle">
    <div class="sheet-bar"><h2 id="originTitle">Откуда летим</h2><button class="sheet-done" type="button" data-close>Готово</button></div>
    <div class="sheet-body"><div class="picker-list">{buttons}</div></div>
  </dialog>'''


def population(city):
    value = city.get('population')
    if not value:
        return ''
    return f' · население {group(value["value"])} ({value["year"]}, <a href="https://www.wikidata.org/wiki/{esc(city["qid"])}" target="_blank" rel="noopener">Wikidata</a>)'


def page(catalog, city, origin, parts, route=False):
    name = city['name']
    url = f'{SITE}/route/{slug(origin["name"])}-{city["slug"]}' if route else f'{SITE}/city/{city["slug"]}'
    best = parts['best']
    price = f' от {money(best.price_minor)}' if best else ''
    if route:
        title = f'{origin["name"]} — {name}: билеты туда и обратно{price} · Aviator'
        description = f'Самые низкие найденные цены на билеты из {origin["from"]} {city["to"]} по месяцам, идеи прогулок и жильё. Покупка — на Aviasales.'
        crumbs = [('Aviator', '/'), ('Города', '/city/'), (name, f'/city/{city["slug"]}'), (f'Из {origin["from"]}', url[len(SITE):])]
        heading = f'{esc(origin["name"])} — {esc(name)}'
    else:
        title = f'{name}: билеты из {origin["from"]}{price}, когда лететь дешевле · Aviator'
        description = f'Когда лететь {city["to"]} дешевле: цены на билеты туда и обратно по месяцам, что посмотреть и где жить. Покупка — на Aviasales.'
        crumbs = [('Aviator', '/'), ('Города', '/city/'), (name, url[len(SITE):])]
        heading = esc(name)
    ld, visible = breadcrumbs(crumbs)
    photo = city.get('photo')
    credit = (f'<p class="caption photo-credit">Фото: <a href="{esc(photo["url"])}" target="_blank" rel="noopener">{esc(photo["title"])}</a> — {esc(photo["author"])}, '
              f'<a href="{esc(photo["license_url"])}" target="_blank" rel="noopener">{esc(photo["license"])}</a></p>') if photo else ''
    others = [catalog.origin_by_code[code] for code in ROUTE_ORIGINS if code in catalog.origin_by_code and code not in (city['code'], origin['code'])]
    routes = ''.join(f'<li><a href="/route/{slug(other["name"])}-{city["slug"]}">из {esc(other["from"])}</a></li>' for other in others)
    body = f'''
  <main class="wrap city" id="main" data-city="{esc(city['code'])}" data-origin="{esc(origin['code'])}" data-fixed="{int(route)}">
    {visible}
    <section class="city-hero">
      <div class="stamp stamp--hero"><div class="photo"><img src="/photos/{esc(city['code'])}.jpg" alt="{esc(name)}" width="720" height="480" fetchpriority="high"></div></div>
      <div class="city-head">
        <p class="city-code"><b>{esc(city['code'])}</b> · {esc(city['country'])}{population(city)}</p>
        <h1>{heading}</h1>
        <div class="fares" id="fares" aria-live="polite">{parts['price']}</div>
      </div>
    </section>
    {credit}
    <section class="card months" id="months" aria-labelledby="monthsTitle"{'' if parts['months'] else ' hidden'}>{parts['months']}</section>
    {guide_block(catalog.guides.get(city['code']))}
    <section class="card stay" id="stay" aria-labelledby="stayTitle"{'' if parts['stay'] else ' hidden'}>{parts['stay']}</section>
    {f'<section class="card routes"><h2>Билеты {esc(city["to"])} из других городов</h2><ul class="route-links">{routes}</ul></section>' if routes else ''}
  </main>'''
    robots = '' if parts['has_prices'] or not route else '\n  <meta name="robots" content="noindex">'
    return (HEAD.format(title=esc(title), description=esc(description), url=esc(url), image=esc(f'{SITE}/og/{city["slug"]}.jpg'), robots=robots, ld=ld, cities_current='')
            + body + FOOT.format(dialog='' if route else origin_dialog(catalog, city), script='/js/city.js'))


def country_caption(city):
    return '' if city['country_code'] == 'RU' else f'<span class="caption">{esc(city["country"])}</span>'


def index_page(catalog):
    groups = {'Россия': [city for city in catalog.cities if city['country_code'] == 'RU'], 'Другие страны': [city for city in catalog.cities if city['country_code'] != 'RU']}
    sections = ''.join(f'''<section class="city-group"><h2>{title}</h2><ul class="city-grid">{''.join(
        f'<li><a class="city-card" href="/city/{esc(city["slug"])}"><span class="stamp"><span class="photo"><img src="/photos/s/{esc(city["code"])}.jpg" alt="" loading="lazy" decoding="async"></span></span>'
        f'<b>{esc(city["name"])}</b>{country_caption(city)}</a></li>' for city in sorted(items, key=lambda city: city['name']))}</ul></section>'''
        for title, items in groups.items() if items)
    ld, visible = breadcrumbs([('Aviator', '/'), ('Города', '/city/')])
    body = f'''
  <main class="wrap" id="main">
    {visible}
    <header class="page-head"><h1>Города</h1><p>Цены на билеты по месяцам, заметки о городе и жильё. Сейчас здесь {len(catalog.cities)} городов, куда есть рейсы из больших городов России.</p></header>
    {sections}
  </main>'''
    return (HEAD.format(title='Города: когда лететь дешевле · Aviator', description='Страницы городов: цены на билеты туда и обратно по месяцам, что посмотреть и где жить.',
                        url=f'{SITE}/city/', image=f'{SITE}/og.jpg', robots='', ld=ld, cities_current=' aria-current="page"')
            + body + FOOT.format(dialog='', script='/js/site.js'))

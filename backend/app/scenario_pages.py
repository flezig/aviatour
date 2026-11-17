"""Страницы-сценарии (этап 4 docs/site-rework.md): «Куда улететь из Москвы до 10 000 ₽», «на выходные», «на праздники».

Готовый HTML для людей и поисковиков. Данные — та же сборка главной для города вылета (/api/v1/home), новых
запросов к источнику нет. Страница, где сейчас меньше трёх вариантов, закрыта от индексации (noindex).
"""
from datetime import datetime, timedelta
from urllib.parse import parse_qs
from zoneinfo import ZoneInfo

from .season_pages import badge

from .city_pages import FOOT, HEAD, SITE, breadcrumbs, date_range, esc, money, nights_label, received_html, slug
from .showcase import BUDGET_TIERS, ROW_MIN, plural

# Города вылета со страницами-сценариями — те же, что прогреваются после выкладки (scripts/warm_home.sh).
ORIGINS = ('MOW', 'LED', 'SVX', 'KZN', 'OVB', 'KRR', 'AER', 'UFA', 'KUF', 'GOJ')
SCENARIOS = {**{f'do-{upper}': ('budget', upper) for upper in BUDGET_TIERS}, 'na-vykhodnye': ('weekend', None), 'na-prazdniki': ('holidays', None)}


def group(number):
    return f'{number:,}'.replace(',', ' ')


def directions(count):
    return f'{count} {plural(count, "направление", "направления", "направлений")}'


def leave_text(note):
    days = lambda n: f'{n} {plural(n, "день", "дня", "дней")}'
    return f'{days(note["leave"])} отпуска — {days(note["trip"])} поездки' if note['leave'] else f'без отпуска · {days(note["trip"])}'


def sections(pages, kind, upper):
    """Разделы страницы: (заголовок, подпись, поездки). Поездки — словари из сборки главной, без порога в три варианта."""
    if kind == 'budget':
        return [(None, None, pages['budget'].get(upper, []))]
    keys = ('weekend1', 'weekend2') if kind == 'weekend' else ('holidays',)
    return [(pages['rows'][key]['title'], pages['rows'][key]['hint'], pages['rows'][key]['items']) for key in keys if key in pages['rows']]


def heading(kind, upper, origin, pages):
    if kind == 'budget':
        return f'Куда улететь из {origin["from"]} до {group(upper)}\u00a0₽'
    if kind == 'weekend':
        return f'Куда улететь из {origin["from"]} на выходные'
    holiday = pages['rows'].get('holidays')
    if holiday and holiday['title'] == 'Новогодние каникулы':
        return f'Куда улететь из {origin["from"]} на новогодние каникулы'
    return f'Куда улететь из {origin["from"]} на длинные выходные'


def intro(kind, upper):
    if kind == 'budget':
        return f'Самая дешёвая поездка на 1–7 ночей в каждый город в этом и следующем месяце — не дороже {group(upper)}\u00a0₽.'
    if kind == 'weekend':
        return 'Вылет в пятницу вечером или в субботу, дома в воскресенье — без дня отпуска.'
    return 'Поездки на 2–7 ночей, не больше четырёх дней отпуска. Нерабочие дни — по постановлениям Правительства № 1187 и № 1466.'


def item(offer, note, photos, cities):
    dep, ret = datetime.fromisoformat(offer['departure_at']), datetime.fromisoformat(offer['return_at'])
    nights = (ret.date() - dep.date()).days
    city = cities.get(offer['city_code'])
    arriving = dep + timedelta(minutes=offer.get("duration_to") or 0)
    query = parse_qs(offer['q'])
    departure = query.get('from', [None])[0]
    fc = query.get('fc', [None])[0]
    origin = {'iata': departure, 'all': bool(fc), 'code': fc} if departure else None
    month = arriving.astimezone(ZoneInfo(offer.get("destination_timezone") or "UTC")).month
    thumb = (f'<span class="stamp"><span class="photo"><img src="/photos/s/{esc(offer["city_code"])}.webp" alt="" loading="lazy" decoding="async"></span></span>'
             if offer['city_code'] in photos else '<span class="stamp"><span class="photo"></span></span>')
    extra = f'<span class="caption">{esc(leave_text(note))}</span>' if note else ''
    about = f'<a class="scenario-city" href="/city/{esc(city["slug"])}">Всё о городе</a>' if city else ''
    return f'''<li class="scenario-item">
  <a class="scenario-open" href="/?{esc(offer['q'])}#trip={esc(offer['id'])}">{thumb}
    <span class="scenario-text"><b>{esc(offer['city'])}</b><span class="caption">{esc(offer.get('country') or '')}</span>
      <span>{date_range(dep, ret)}, {nights_label(nights)}</span>{extra}</span>
    <b class="scenario-price">{money(offer['price_minor'])}</b></a>{about}{badge(offer["city_code"],month,origin)}
</li>'''


def page(kind, upper, origin, body, pages, photos, cities):
    parts = sections(pages, kind, upper)
    found = [offer for _, _, offers in parts for offer in offers]
    title_base = heading(kind, upper, origin, pages)
    cheapest = min((offer['price_minor'] for offer in found), default=None)
    unique = len({offer['city_code'] for offer in found})
    path = f'/kuda/{slug(origin["name"])}/{next(key for key, value in SCENARIOS.items() if value == (kind, upper))}'
    title = f'{title_base} — {directions(unique)} от {money(cheapest)} · Aviator' if cheapest else f'{title_base} · Aviator'
    description = f'{title_base}: {directions(unique)}, цены туда и обратно на одного от {money(cheapest)}, даты и ссылки на Aviasales.' if cheapest else f'{title_base}: цены и даты поездок.'
    short = title_base.replace('Куда улететь ', '')
    crumbs = [('Aviator', '/'), ('Куда улететь', '/kuda/'), (short[0].upper() + short[1:], path)]
    ld, visible = breadcrumbs(crumbs)
    notes = pages.get('notes', {})
    blocks = ''.join(f'''<section class="scenario-block">{f'<h2>{esc(name)}</h2><p class="caption">{esc(hint)}</p>' if name else ''}
<ol class="scenario-list">{''.join(item(offer, notes.get(offer['id']) if kind == 'holidays' else None, photos, cities) for offer in offers)}</ol></section>''' for name, hint, offers in parts if offers)
    enough = len(found) >= ROW_MIN
    empty = '' if enough else ('<div class="status"><h3>Пока мало вариантов</h3><p>В найденных ценах сейчас меньше трёх таких поездок. Это не значит, '
                               'что билетов нет: попробуйте поиск на главной или загляните позже.</p></div>')  # найденные — показываем всё равно
    others = ''.join(f'<li><a href="/kuda/{slug(origin["name"])}/{key}">{esc(label)}</a></li>' for key, label in scenario_labels() if key != path.rsplit('/', 1)[1])
    received = datetime.fromisoformat(body['received_at'])
    content = f'''
  <main class="wrap scenario" id="main">
    {visible}
    <header class="page-head"><h1>{esc(title_base)}</h1><p>{esc(intro(kind, upper))}</p>
      <p class="caption">Цены Aviasales на {received_html(received)} · туда и обратно на одного · нажмите на город — откроется поездка · <a href="/how-we-count.html#kuda">Как мы считаем</a></p></header>
    {empty}{blocks}
    <section class="card routes"><h2>Ещё из {esc(origin['from'])}</h2><ul class="route-links">{others}</ul></section>
  </main>'''
    robots = '' if enough else '\n  <meta name="robots" content="noindex">'
    return (HEAD.format(title=esc(title), description=esc(description), url=esc(SITE + path), image=esc(f'{SITE}/og.jpg'), robots=robots, ld=ld, cities_current='')
            + content + FOOT.format(dialog='', script='/js/site.js')), enough


def scenario_labels():
    return [(f'do-{upper}', f'до {group(upper)} ₽') for upper in BUDGET_TIERS] + [('na-vykhodnye', 'на выходные'), ('na-prazdniki', 'на праздники')]


def index_page(origins):
    ld, visible = breadcrumbs([('Aviator', '/'), ('Куда улететь', '/kuda/')])
    blocks = ''.join(f'''<section class="card" id="{esc(slug(origin['name']))}"><h2>Из {esc(origin['from'])}</h2>
<ul class="route-links">{''.join(f'<li><a href="/kuda/{slug(origin["name"])}/{key}">{esc(label)}</a></li>' for key, label in scenario_labels())}</ul></section>''' for origin in origins)
    content = f'''
  <main class="wrap" id="main">
    {visible}
    <header class="page-head"><h1>Куда улететь</h1><p>Подборки поездок из больших городов: по бюджету, на выходные и на праздники. Цены — найденные Aviasales, с датой.</p></header>
    <div class="prose">{blocks}</div>
  </main>'''
    return (HEAD.format(title='Куда улететь: по бюджету, на выходные и праздники · Aviator', description='Куда улететь дёшево из Москвы, Петербурга и других городов: до 5 000–20 000 ₽, на выходные и праздники.',
                        url=f'{SITE}/kuda/', image=f'{SITE}/og.jpg', robots='', ld=ld, cities_current='') + content + FOOT.format(dialog='', script='/js/site.js'))

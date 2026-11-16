"""Страницы городов (этап 4 docs/site-rework.md): список городов, факты, жильё, превью и sitemap.

Запуск из корня, локальный сервер должен работать на 127.0.0.1:8010:
    .venv/bin/python scripts/build_city_pages.py          # web/data/cities.json и web/sitemap.xml
    .venv/bin/python scripts/build_city_pages.py --og     # плюс превью web/og/<slug>.jpg (Google Chrome и sips, macOS)

Отбор: у города есть фото на сайте (web/photos/manifest.json) и он попадает в выдачу — поездки на 1–14 ночей из
нескольких больших городов вылета за текущий и следующий месяц. Пустых страниц нет: сервер рисует только эти города.
Факты: население из Wikidata (значение с самой поздней датой, год рядом). Ostrovok: ссылка на город берётся, только
если страница отвечает 200 — других проверок адреса у нас нет. Тексты о городах этот скрипт не пишет.
"""
import json, re, ssl, subprocess, sys, tempfile, time, unicodedata, urllib.parse, urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
import certifi

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from download_web_photos import TITLES, wikidata_item, get  # noqa: E402  (один способ найти город в Wikidata)

WEB = ROOT / 'web'
SITE = 'https://aviatour.vercel.app'
LOCAL = 'http://127.0.0.1:8010'
LIMIT = 80
ORIGINS = [('SVO', 'MOW'), ('LED', None), ('SVX', None), ('KZN', None), ('OVB', None), ('KRR', None)]
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
TODAY = date.today()

# Ostrovok: страна в адресе. Города проверяются запросом; страны без записи пропускаются.
OSTROVOK_COUNTRY = {'RU': 'russia', 'TR': 'turkey', 'GE': 'georgia', 'AE': 'united_arab_emirates', 'AM': 'armenia',
                    'AZ': 'azerbaijan', 'KZ': 'kazakhstan', 'UZ': 'uzbekistan', 'BY': 'belarus', 'TH': 'thailand',
                    'EG': 'egypt', 'CN': 'china', 'VN': 'vietnam', 'ID': 'indonesia', 'IN': 'india', 'LK': 'sri_lanka',
                    'MV': 'maldives', 'CY': 'cyprus', 'KG': 'kyrgyzstan', 'TJ': 'tajikistan', 'RS': 'serbia', 'ME': 'montenegro'}
OSTROVOK_CITY = {'LED': 'st._petersburg'}  # адрес, найденный вручную: из названия его не получить

TRANSLIT = dict(zip('абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
                    ['a', 'b', 'v', 'g', 'd', 'e', 'e', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u',
                     'f', 'kh', 'ts', 'ch', 'sh', 'shch', '', 'y', '', 'e', 'yu', 'ya']))


def short_name(name):
    return re.sub(r'\s*\(.*\)', '', name).strip()


def slug(name):
    text = ''.join(TRANSLIT.get(ch, ch) for ch in short_name(name).lower())
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')


def to_form(name):
    """«в Казань», «в Москву», «во Владивосток»: винительный падеж для обычных названий на -а/-я, остальное без изменений."""
    base = short_name(name)
    words = base.split(' ')
    if len(words) == 1 and '-' not in base:
        if base.endswith('а'):
            base = base[:-1] + 'у'
        elif base.endswith('я') and not base.endswith('ия'):
            base = base[:-1] + 'ю'
        elif base.endswith('ия'):
            base = base[:-1] + 'ю'
    vowels = 'аеёиоуыэюя'
    prep = 'во' if base[0] in 'ВФ' and len(base) > 1 and base[1].lower() not in vowels else 'в'
    return f'{prep} {base}'


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=120) as response:
        return json.load(response)


def months():
    first = TODAY.replace(day=1)
    nxt = date(first.year + first.month // 12, first.month % 12 + 1, 1)
    return [first.strftime('%Y-%m'), nxt.strftime('%Y-%m')]


def seen_cities():
    """Города из выдачи: сколько городов вылета их видят и какой аэропорт назначения встречается чаще."""
    origins, airports = defaultdict(set), defaultdict(Counter)
    for iata, fc in ORIGINS:
        for month in months():
            url = f'{LOCAL}/api/v1/search/web?from={iata}' + (f'&fc={fc}' if fc else '') + f'&budget=500000&month={month}&weekend=0'
            for offer in fetch_json(url)['offers']:
                nights = (datetime.fromisoformat(offer['return_at']).date() - datetime.fromisoformat(offer['departure_at']).date()).days
                if 1 <= nights <= 14:
                    origins[offer['city_code']].add(fc or iata)
                    airports[offer['city_code']][offer['destination_airport']] += 1
    return origins, airports


def credits():
    """Подписи к фото из web/photos/credits.md: файл, автор, лицензия."""
    found = {}
    for line in (WEB / 'photos/credits.md').read_text().splitlines():
        match = re.match(r'- \*\*([A-Z]{3})\*\*: \[([^\]]+)\]\((https://[^)\s]+(?:\([^)\s]*\))?[^)\s]*)\) — (.+?); \[([^\]]+)\]\((https?://[^)]+)\)', line)
        if match:
            code, title, url, author, license_name, license_url = match.groups()
            found[code] = {'title': title.removeprefix('File:'), 'url': url, 'author': author, 'license': license_name, 'license_url': license_url}
    return found


def wikidata(qids):
    """Население (значение с самой поздней датой) и английское название — для адреса Ostrovok."""
    result = {}
    for start in range(0, len(qids), 40):
        chunk = qids[start:start + 40]
        url = 'https://www.wikidata.org/w/api.php?' + urllib.parse.urlencode({'action': 'wbgetentities', 'ids': '|'.join(chunk), 'props': 'claims|labels', 'languages': 'en', 'format': 'json'})
        for qid, entity in json.loads(get(url))['entities'].items():
            best = None
            for claim in entity.get('claims', {}).get('P1082', []):
                if claim.get('rank') == 'deprecated' or 'datavalue' not in claim['mainsnak']:
                    continue
                amount = int(float(claim['mainsnak']['datavalue']['value']['amount']))
                when = claim.get('qualifiers', {}).get('P585', [{}])[0].get('datavalue', {}).get('value', {}).get('time', '')
                year = int(when[1:5]) if when else None
                if year and (best is None or year > best[1]):
                    best = (amount, year)
            result[qid] = {'population': best, 'en': entity.get('labels', {}).get('en', {}).get('value')}
        time.sleep(.5)
    return result


def ostrovok(code, country_code, names):
    country = OSTROVOK_COUNTRY.get(country_code)
    if not country:
        return None
    variants = [OSTROVOK_CITY[code]] if code in OSTROVOK_CITY else []
    for name in names:
        if not name:
            continue
        plain = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower().replace("'", '')
        variants += [re.sub(r'[^a-z0-9.]+', '_', plain).strip('_'), re.sub(r'[^a-z0-9]+', '-', plain).strip('-')]
    context = ssl.create_default_context(cafile=certifi.where())
    for variant in dict.fromkeys(v for v in variants if v):
        url = f'https://ostrovok.ru/hotel/{country}/{variant}/'
        try:
            request = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(request, timeout=25, context=context) as response:
                final = response.geturl()
                if response.status == 200 and re.fullmatch(rf'https://ostrovok\.ru/hotel/{country}/[a-z0-9._-]+/?', final):
                    return final
        except Exception:
            pass
        finally:
            time.sleep(.4)
    return None


def build():
    manifest = set(json.loads((WEB / 'photos/manifest.json').read_text()))
    guides = json.loads((WEB / 'data/city-guides.json').read_text())
    hotels = json.loads((WEB / 'data/hotel-locations.json').read_text())
    airports = json.loads((ROOT / 'backend/app/airports.json').read_text())
    city_info = {a['city_code']: a for a in airports if a['timezone']}
    origins, destination = seen_cities()
    old = {city['code']: city for city in json.loads((WEB / 'data/cities.json').read_text())['cities']} if (WEB / 'data/cities.json').exists() else {}
    # Опубликованные страницы не пропадают: город, который сегодня не встретился в выдаче, остаётся (иначе ссылки из
    # поисковиков ведут на 404). Новые города добавляются, пока всего не больше LIMIT.
    fresh = sorted((code for code in origins if code in manifest and code in city_info and code not in old),
                   key=lambda code: (-len(origins[code]), -sum(destination[code].values())))
    chosen = [code for code in old if code in city_info] + fresh[:max(0, LIMIT - len(old))]
    photo_credits = credits()
    qids = {}
    for code in chosen:
        if code in old and old[code].get('qid'):
            qids[code] = old[code]['qid']
            continue
        info = city_info[code]
        try:
            qids[code] = wikidata_item(TITLES.get(code) or short_name(info['city']), info['country'])
        except Exception as error:
            print('wikidata', code, error)
        time.sleep(.3)
    facts = wikidata([qid for qid in qids.values() if qid])
    cities, slugs = [], set()
    for code in chosen:
        info, qid = city_info[code], qids.get(code)
        fact = facts.get(qid, {})
        name = info['city']
        page = slug(name)
        assert page not in slugs, page
        slugs.add(page)
        link = old.get(code, {}).get('ostrovok') if code in old else None
        if link is None and code not in old:
            link = ostrovok(code, info['country_code'], [fact.get('en'), ''.join(TRANSLIT.get(ch, ch) for ch in short_name(name).lower()),
                                                         ''.join(TRANSLIT.get(ch, ch) for ch in short_name(name).lower()).replace('iy', 'y')])
        population = fact.get('population')
        cities.append({
            'code': code, 'slug': page, 'name': name, 'to': to_form(name), 'country': info['country'], 'country_code': info['country_code'],
            'airport': destination[code].most_common(1)[0][0] if destination[code] else old[code]['airport'], 'timezone': info['timezone'],
            'guide': code in guides, 'hotels': code in hotels, 'ostrovok': link,
            'qid': qid, 'population': {'value': population[0], 'year': population[1]} if population else None,
            'photo': photo_credits.get(code),
        })
        print(code, page, to_form(name), len(origins.get(code, ())), bool(link), population)
    data = {'about': 'Города со своей страницей /city/<slug>. Собирает scripts/build_city_pages.py: фото есть на сайте, город попадает в выдачу '
                     f'(поездки на 1–14 ночей) из {", ".join(fc or iata for iata, fc in ORIGINS)} за {" и ".join(months())}. '
                     'Население — Wikidata (CC0), значение с самой поздней датой. Ostrovok — адрес страницы города, проверен ответом 200.',
            'built': TODAY.isoformat(), 'sources': {'wikidata': 'https://www.wikidata.org/', 'photos': '/credits.html'}, 'cities': cities}
    (WEB / 'data/cities.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    # Страницы «Куда улететь» — для тех же городов вылета, что в backend/app/scenario_pages.py (ORIGINS).
    origins = {origin['code']: origin for origin in json.loads((WEB / 'data/origins.json').read_text())['cities']}
    scenarios = [f'do-{upper}' for upper in (5000, 10000, 15000, 20000)] + ['na-vykhodnye', 'na-prazdniki']
    kuda = [f'/kuda/{slug(origins[code]["name"])}/{scenario}' for code in ('MOW', 'LED', 'SVX', 'KZN', 'OVB', 'KRR', 'AER', 'UFA', 'KUF', 'GOJ') for scenario in scenarios]
    pages = ['/', '/city/', '/kuda/', '/how-we-count.html', '/how-we-earn.html', '/about.html', '/credits.html'] + [f'/city/{city["slug"]}' for city in cities] + kuda
    (WEB / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                                     + ''.join(f'  <url><loc>{SITE}{page}</loc></url>\n' for page in pages) + '</urlset>\n')
    return cities


OG = '''<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: G; font-weight: 800; src: url('{web}/fonts/geologica-cyrillic-800-normal.woff2'); unicode-range: U+0400-045F; }}
@font-face {{ font-family: G; font-weight: 800; src: url('{web}/fonts/geologica-latin-800-normal.woff2'); unicode-range: U+0000-00FF; }}
@font-face {{ font-family: T; font-weight: 400; src: url('{web}/fonts/golos-text-cyrillic-400-normal.woff2'); unicode-range: U+0400-045F; }}
@font-face {{ font-family: T; font-weight: 400; src: url('{web}/fonts/golos-text-latin-400-normal.woff2'); unicode-range: U+0000-00FF; }}
@font-face {{ font-family: M; font-weight: 700; src: url('{web}/fonts/martian-mono-latin-700-normal.woff2'); }}
html, body {{ margin: 0; width: 1200px; height: 630px; background: #f5f4f0; color: #0f1b3d; overflow: hidden; }}
.stamp {{ position: absolute; left: 64px; top: 64px; width: 560px; height: 502px; padding: 14px; box-sizing: border-box; background: #fffefb;
  filter: drop-shadow(0 2px 3px rgba(15,27,61,.2)); transform: rotate(-2deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, radial-gradient(circle, #0000 7px, #000 7.5px) -11px -11px / 22px 22px round; }}
.stamp img {{ width: 100%; height: 100%; object-fit: cover; border-radius: 4px; display: block; }}
.text {{ position: absolute; left: 680px; right: 56px; top: 64px; bottom: 64px; display: flex; flex-direction: column; }}
.brand {{ display: flex; align-items: center; gap: 14px; font: 800 34px G; }}
.mark {{ width: 52px; height: 52px; border-radius: 14px; background: #2346d8; color: #fff; display: grid; place-items: center; }}
.mark svg {{ width: 30px; height: 30px; }}
.code {{ margin-top: auto; font: 700 30px M; color: #2346d8; letter-spacing: -.02em; }}
h1 {{ margin: 8px 0 0; font: 800 {size}px/1.04 G; letter-spacing: -.02em; }}
p {{ margin: 18px 0 0; font: 400 26px/1.35 T; color: #565d70; }}
</style></head><body><div class="stamp"><img src="{web}/photos/{code}.jpg"></div>
<div class="text"><div class="brand"><span class="mark"><svg viewBox="0 0 24 24"><path fill="currentColor" d="{plane}"/></svg></span>Aviator</div><div class="code">{code}</div><h1>{name}</h1><p>Билеты, когда лететь дешевле, жильё</p></div></body></html>'''
PLANE = re.search(r'<symbol id="plane".*?<path d="([^"]+)"', (WEB / 'icons.svg').read_text()).group(1)
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


def previews(cities):
    out = WEB / 'og'
    out.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for city in cities:
            name = short_name(city['name'])
            page = Path(tmp) / 'card.html'
            page.write_text(OG.format(web=WEB.as_uri(), plane=PLANE, code=city['code'], name=name, size=76 if len(name) <= 12 else 60 if len(name) <= 18 else 48))
            png = Path(tmp) / 'card.png'
            subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files',
                            '--virtual-time-budget=3000', '--window-size=1200,630', f'--screenshot={png}', page.as_uri()], check=True, capture_output=True, timeout=60)
            subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '72', str(png), '--out', str(out / f'{city["slug"]}.jpg')], check=True, capture_output=True)
            print('og', city['slug'])


if __name__ == '__main__':
    built = build()
    if '--og' in sys.argv:
        previews(built)

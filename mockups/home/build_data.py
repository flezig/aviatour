"""Снимок живой выдачи для макетов главной (этап 1 docs/site-rework.md).

Берёт ответы локального сервера GET /api/v1/search/web за два месяца из одного города
и собирает подборки по ПРЕДВАРИТЕЛЬНЫМ правилам. Настоящие правила и тесты — этап 3.

    python3 -I mockups/home/build_data.py [http://127.0.0.1:8010] [SVO MOW]
"""
import json
import statistics
import sys
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB = HERE.parent.parent / 'web'
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8010'
ORIGIN, ORIGIN_CITY = (sys.argv[2], sys.argv[3]) if len(sys.argv) > 3 else ('SVO', 'MOW')
TODAY = date(2026, 11, 15)
MONTHS = ['2026-11', '2026-12']
HOME_TZ = timezone(timedelta(hours=3))
MONTH_IN = {11: 'ноябре', 12: 'декабре', 1: 'январе'}

# Предварительные пороги (обоснование и счёт — в docs/handoffs/web-mvp.md).
HOT_DAYS = 14          # вылет в ближайшие N дней
HOT_DISCOUNT = 0.20    # ниже «обычной» цены минимум на 20 %
MIN_OBS = 8            # «обычная» цена считается, только если наблюдений не меньше
LEVEL_BAND = 0.15      # ±15 % от обычной — «обычная цена»
ROW = 12


def fetch(month=None, dep=None, ret=None):
    when = f'dep={dep}&ret={ret}' if dep else f'month={month}&weekend=0'
    url = f'{BASE}/api/v1/search/web?from={ORIGIN}&fc={ORIGIN_CITY}&budget=500000&{when}'
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.load(response)


def day(value):
    return datetime.fromisoformat(value).date()


def nights(offer):
    return (day(offer['return_at']) - day(offer['departure_at'])).days


def length_bucket(n):
    return 0 if n <= 2 else 1 if n <= 4 else 2 if n <= 7 else 3


MIN_NIGHTS, MAX_NIGHTS = 1, 14  # в подборки не берём поездки «туда и обратно в один день» и дольше двух недель


def key(offer):
    return offer['city_code'], offer['departure_at'][:7], length_bucket(nights(offer))


def weekend(offer, friday):
    """Без отпуска: вылет в пятницу с 18:00 или в субботу, дома — в воскресенье или в понедельник до 09:00."""
    dep = datetime.fromisoformat(offer['departure_at'])
    if not ((dep.date() == friday and dep.hour >= 18) or dep.date() == friday + timedelta(days=1)):
        return False
    home = (datetime.fromisoformat(offer['return_at']) + timedelta(minutes=offer['duration_back'] or 0)).astimezone(HOME_TZ)
    monday = friday + timedelta(days=3)
    return home.date() == friday + timedelta(days=2) or (home.date() == monday and home.hour < 9)


def main():
    answers = [fetch(m) for m in MONTHS]
    offers = [o for a in answers for o in a['offers'] if day(o['departure_at']) > TODAY and MIN_NIGHTS <= nights(o) <= MAX_NIGHTS]
    # Поиск за месяц отдаёт ~900 самых дешёвых находок, выходных среди них почти нет.
    # Поэтому выходные ищутся отдельно по точным датам: пт/сб → вс/пн.
    fri1, fri2 = date(2026, 11, 20), date(2026, 11, 27)
    weekend_offers = {}
    for fri in (fri1, fri2):
        for d in (0, 1):
            for r in (2, 3):
                for o in fetch(dep=fri + timedelta(days=d), ret=fri + timedelta(days=r))['offers']:
                    if weekend(o, fri):
                        weekend_offers.setdefault(fri, []).append(o)
    photos = set(json.loads((WEB / 'photos/manifest.json').read_text()))
    guides = json.loads((WEB / 'data/city-guides.json').read_text())
    groups = defaultdict(list)
    for o in offers:
        groups[key(o)].append(o['price_minor'])
    usual = {k: statistics.median(v) for k, v in groups.items() if len(v) >= MIN_OBS}

    def card(o):
        n = nights(o)
        med = usual.get(key(o))
        diff = round((o['price_minor'] / med - 1) * 100) if med else None
        level = None if diff is None else 'low' if diff <= -LEVEL_BAND * 100 else 'high' if diff >= LEVEL_BAND * 100 else 'usual'
        dep = day(o['departure_at'])
        return {
            'id': o['id'], 'city': o['city'], 'code': o['city_code'], 'country': o['country'],
            'price': o['price_minor'] // 100, 'dep': o['departure_at'], 'ret': o['return_at'], 'nights': n,
            'direct': o['transfers'] == 0 and o['return_transfers'] == 0, 'airline': o['airline_name'],
            'from': o['origin_airport'], 'to': o['destination_airport'], 'durTo': o['duration_to'], 'durBack': o['duration_back'],
            'photo': o['city_code'] in photos, 'about': (guides.get(o['city_code']) or {}).get('summary'),
            'level': level, 'diff': diff, 'usual': int(med // 100) if med else None,
            'monthIn': MONTH_IN[dep.month], 'inDays': (dep - TODAY).days,
        }

    def one_per_city(items, order):
        best = {}
        for o in sorted(items, key=order):
            best.setdefault(o['city_code'], o)
        return list(best.values())

    hot = []
    for o in offers:
        med = usual.get(key(o))
        if med and 1 <= (day(o['departure_at']) - TODAY).days <= HOT_DAYS and o['price_minor'] <= med * (1 - HOT_DISCOUNT):
            hot.append(o)
    hot = one_per_city(hot, lambda o: o['price_minor'] / usual[key(o)])
    cheap = lambda o: o['price_minor']
    data = {
        'origin': {'code': ORIGIN_CITY, 'name': 'Москва', 'from': 'из Москвы'},
        'today': TODAY.isoformat(),
        'receivedAt': max(a['received_at'] for a in answers),
        'rules': {'hotDays': HOT_DAYS, 'hotDiscount': HOT_DISCOUNT, 'minObs': MIN_OBS, 'levelBand': LEVEL_BAND},
        'counts': {'offers': len(offers), 'cities': len({o['city_code'] for o in offers}), 'hot': len(hot)},
        'rows': {
            'hot': [card(o) for o in hot[:ROW]],
            'weekend': [card(o) for o in one_per_city(weekend_offers.get(fri1, []), cheap)[:ROW]],
            'nextWeekend': [card(o) for o in one_per_city(weekend_offers.get(fri2, []), cheap)[:ROW]],
            'under5': [card(o) for o in one_per_city([o for o in offers if o['price_minor'] <= 500000], cheap)[:ROW]],
            'under10': [card(o) for o in one_per_city([o for o in offers if 500000 < o['price_minor'] <= 1000000], cheap)[:ROW]],
            'cheapest': [card(o) for o in one_per_city(offers, cheap)[:30]],
        },
    }
    (HERE / 'data.js').write_text('// Снимок живой выдачи. Пересобрать: python3 -I mockups/home/build_data.py\nwindow.MOCK = '
                                  + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print({k: len(v) for k, v in data['rows'].items()}, data['counts'])


main()

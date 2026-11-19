import json
import re
from datetime import date, datetime, timezone
from decimal import Decimal
from itertools import count
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app import showcase as s
from app.main import create_app
from app.models import Offer
from app.settings import Settings

NOW = datetime(2026, 11, 16, 9, tzinfo=timezone.utc)
TODAY = date(2026, 11, 16)
CALENDAR = s.load_calendar(json.loads((Path(__file__).resolve().parents[2] / 'web/data/holidays.json').read_text()))
ids = count()


def trip(city='KZN', dep='2026-11-20T19:00:00+03:00', ret='2026-11-22T18:00:00+03:00', price=5000, **extra):
    fields = dict(id=f'{next(ids):032x}', city_code=city, city=city, country_code='RU', country='Россия', origin_airport='SVO', origin_city_code='MOW',
                  destination_airport=city, origin_city='Москва', origin_name='Шереметьево', destination_name=city, departure_at=dep, return_at=ret,
                  origin_timezone='Europe/Moscow', destination_timezone='Europe/Moscow', transfers=0, return_transfers=0, duration_to=90, duration_back=90,
                  price_minor=price * 100, search_url='https://www.aviasales.ru/search/X', received_at=NOW)
    return Offer(**(fields | extra))


def test_usual_price_counts_each_date_pair_once_and_needs_enough_pairs():
    offers = [trip(dep=f'2026-12-{day:02d}T10:00:00+03:00', ret=f'2026-12-{day + 2:02d}T10:00:00+03:00', price=1000 * day) for day in range(1, 9)]
    offers += [trip(dep='2026-12-01T18:00:00+03:00', ret='2026-12-03T10:00:00+03:00', price=50000)] * 3  # другие рейсы на те же даты
    usual = s.usual_prices(offers)
    assert usual == {('KZN', '2026-12', 0): (4500 * 100, 8)}  # медиана 1 000 … 8 000 ₽, дорогие рейсы на 1–3 дек. не считаются
    assert s.usual_prices(offers[:7]) == {}  # семь пар дат — мало


@pytest.mark.parametrize('price,kind,diff', [(8500, 'low', -15), (8600, 'usual', -14), (11500, 'high', 15), (11400, 'usual', 14), (11250, 'usual', 13)])
def test_price_level_band_and_rounding_like_the_site(price, kind, diff):
    assert s.price_level(price, 10000) == (kind, diff)  # 11 250 / 10 000 → 12,5 % → 13, как Math.round (round() дал бы 12)


def test_hot_tickets_rule():
    usual = {('KZN', '2026-11', 0): (500000, 20), ('LED', '2026-11', 0): (400000, 20), ('UFA', '2026-11', 0): (400000, 20), ('KZN', '2026-12', 0): (500000, 20)}
    offers = [trip(price=3900),                                                                            # −22 %: горячий
              trip(price=3500, dep='2026-11-27T19:00:00+03:00', ret='2026-11-29T18:00:00+03:00'),          # −30 %: лучший в Казань
              trip(price=3000, dep='2026-11-16T19:00:00+03:00', ret='2026-11-18T18:00:00+03:00'),          # сегодня — не берём
              trip(price=3000, dep='2026-12-01T19:00:00+03:00', ret='2026-12-03T18:00:00+03:00'),          # через 15 дней
              trip('LED', price=3300), trip('LED', price=3000, ret='2026-11-20T23:00:00+03:00'),          # −17 %; в тот же день
              trip('UFA', price=3200), trip('SVX', price=1000)]                                           # −20 %; нет обычной цены
    hot = s.hot_tickets(offers, usual, TODAY)
    assert [(offer.city_code, offer.price_minor) for offer in hot] == [('KZN', 350000), ('UFA', 320000)]


def test_calendar_matches_the_published_2027_days_off():
    assert CALENDAR.windows() == [(date(2026, 12, 31), date(2027, 1, 10)), (date(2027, 2, 21), date(2027, 2, 23)), (date(2027, 3, 6), date(2027, 3, 8)),
                                  (date(2027, 5, 1), date(2027, 5, 3)), (date(2027, 5, 8), date(2027, 5, 10)), (date(2027, 6, 12), date(2027, 6, 14)),
                                  (date(2027, 11, 4), date(2027, 11, 7))]
    assert not CALENDAR.is_off(date(2027, 2, 20))  # суббота 20 февраля — рабочая
    assert CALENDAR.is_off(date(2027, 2, 22)) and CALENDAR.is_off(date(2027, 11, 5)) and CALENDAR.is_off(date(2026, 12, 31))


@pytest.mark.parametrize('dep,ret,back,days', [
    ('2026-11-20T19:00:00+03:00', '2026-11-22T18:00:00+03:00', 90, 0),   # пт вечером → вс
    ('2026-11-20T10:00:00+03:00', '2026-11-22T18:00:00+03:00', 90, 1),   # пт днём
    ('2026-11-21T10:00:00+03:00', '2026-11-23T05:00:00+03:00', 90, 0),   # дома в пн в 06:30
    ('2026-11-21T10:00:00+03:00', '2026-11-23T10:00:00+03:00', 90, 1),   # дома в пн к полудню
    ('2026-11-21T10:00:00+03:00', '2026-11-23T05:00:00+03:00', None, 1), # прилёт неизвестен — день отпуска
    ('2027-03-06T10:00:00+03:00', '2027-03-08T20:00:00+03:00', 90, 0),   # 8 марта — выходной
    ('2027-02-20T10:00:00+03:00', '2027-02-23T20:00:00+03:00', 90, 1),   # рабочая суббота 20 февраля
    ('2027-03-06T10:00:00+03:00', '2027-03-14T20:00:00+03:00', 90, 4),   # «мостик»: 9–12 марта
])
def test_leave_days(dep, ret, back, days):
    assert s.leave_days(trip(dep=dep, ret=ret, duration_back=back), CALENDAR) == days


def test_weekends_and_windows_from_today():
    assert s.upcoming_fridays(date(2026, 11, 16)) == (date(2026, 11, 20), date(2026, 11, 27))
    assert s.upcoming_fridays(date(2026, 11, 20))[0] == date(2026, 11, 20)
    assert s.upcoming_fridays(date(2026, 11, 21))[0] == date(2026, 11, 27)  # в субботу ближайшие — следующие
    assert s.next_window(CALENDAR, TODAY) == (date(2026, 12, 31), date(2027, 1, 10))
    assert s.next_window(CALENDAR, date(2027, 1, 11)) == (date(2027, 2, 21), date(2027, 2, 23))
    assert s.next_window(CALENDAR, date(2027, 4, 20)) == (date(2027, 5, 1), date(2027, 5, 3))
    assert s.next_window(s.Calendar(), TODAY) is None


def test_window_search_dates():
    d = date
    assert s.window_pairs((d(2026, 12, 31), d(2027, 1, 10)), CALENDAR) == [(d(2026, 12, 31), d(2027, 1, 10)), (d(2026, 12, 31), d(2027, 1, 5)), (d(2027, 1, 5), d(2027, 1, 10))]
    assert s.window_pairs((d(2027, 2, 21), d(2027, 2, 23)), CALENDAR) == [(d(2027, 2, 21), d(2027, 2, 23)), (d(2027, 2, 20), d(2027, 2, 23)), (d(2027, 2, 21), d(2027, 2, 28))]
    assert s.window_pairs((d(2027, 3, 6), d(2027, 3, 8)), CALENDAR) == [(d(2027, 3, 6), d(2027, 3, 8)), (d(2027, 3, 5), d(2027, 3, 8)), (d(2027, 3, 6), d(2027, 3, 14))]


def test_weekend_and_window_trips():
    friday = date(2026, 11, 20)
    good, day, late = trip(), trip(dep='2026-11-20T10:00:00+03:00'), trip(ret='2026-11-24T18:00:00+03:00')
    same_day = trip(dep='2026-11-21T06:00:00+03:00', ret='2026-11-21T22:30:00+03:00', duration_back=120)  # дома в вс в 00:30, но ночей нет
    assert s.weekend_trips([good, day, late, same_day], friday, CALENDAR) == [good]
    window = (date(2026, 12, 31), date(2027, 1, 10))
    inside = trip(dep='2027-01-02T10:00:00+03:00', ret='2027-01-08T18:00:00+03:00')
    too_long = trip(dep='2026-12-31T10:00:00+03:00', ret='2027-01-10T18:00:00+03:00')  # 10 ночей — длиннее недели
    edge = trip(dep='2027-01-10T10:00:00+03:00', ret='2027-01-14T18:00:00+03:00')   # один день окна
    long_leave = trip(dep='2027-01-08T10:00:00+03:00', ret='2027-01-20T18:00:00+03:00')  # 8 дней отпуска
    assert [(offer.id, leave) for offer, leave in s.window_trips([inside, edge, long_leave, too_long], window, CALENDAR)] == [(inside.id, 0)]


def test_budget_tiers_one_city_once_and_city_break():
    offers = [trip('KZN', price=3000), trip('KZN', price=9000), trip('LED', price=4999), trip('UFA', price=5001), trip('AER', price=30000),
              trip('SVX', price=2000, ret='2026-12-20T18:00:00+03:00')]  # 30 ночей — не в подборках
    tiers = s.budget_tiers(offers)
    assert [(lower, upper, [offer.city_code for offer in items]) for lower, upper, items in tiers] == [
        (0, 5000, ['KZN', 'LED']), (5000, 10000, ['UFA']), (10000, 15000, []), (15000, 20000, [])]
    far = trip('LED', duration_to=300)
    assert [offer.city_code for offer in s.city_break([trip('KZN'), far, trip('UFA')], {'KZN': {}, 'LED': {}})] == ['KZN']


def test_date_span():
    assert s.date_span(date(2026, 11, 20), date(2026, 11, 22)) == '20–22 ноября'
    assert s.date_span(date(2026, 12, 31), date(2027, 1, 10)) == '31 декабря – 10 января'


def row(city, dep, ret, price, airport=None):
    return {'origin': 'MOW', 'destination': city, 'origin_airport': 'SVO', 'destination_airport': airport or city, 'price': str(price),
            'departure_at': dep, 'return_at': ret, 'duration_to': 90, 'duration_back': 90, 'transfers': 0, 'return_transfers': 0,
            'link': f'/search/MOW{dep[8:10]}{dep[5:7]}{city}{ret[8:10]}{ret[5:7]}1'}


def test_home_endpoint_builds_rows_hides_short_ones_and_checks_hot_with_route_searches():
    rows = [row(city, '2026-11-20T19:00:00+03:00', '2026-11-22T18:00:00+03:00', price) for city, price in (('KZN', 3000), ('LED', 3500), ('UFA', 4000), ('AER', 9000))]
    rows += [row('KZN', f'2026-11-{day}T10:00:00+03:00', f'2026-11-{day + 2}T10:00:00+03:00', 5000 + day) for day in range(17, 27)]
    calls = []
    def handler(request):
        params = dict(request.url.params)
        calls.append(params)
        found = [r for r in rows if r['departure_at'].startswith(params['departure_at']) and (not params.get('return_at') or r['return_at'].startswith(params['return_at']))
                 and r['destination'] == params.get('destination', r['destination'])]
        return httpx.Response(200, json={'success': True, 'data': found})
    with TestClient(create_app(Settings(token='fixture'), transport=httpx.MockTransport(handler), now=lambda: NOW)) as client:
        response = client.get('/api/v1/home', params={'from': 'SVO', 'fc': 'MOW'})
        body = response.json()
        assert response.status_code == 200 and 's-maxage' in response.headers['Cache-Control']
        keys = {r['key']: r for r in body['rows']}
        assert keys['weekend1']['items'] and keys['weekend1']['title'] == 'На эти выходные' and keys['weekend1']['hint'] == '20–22 ноября, без отпуска'
        assert 'budget20000' not in keys  # меньше трёх вариантов — подборки нет
        assert all(len(r['items']) >= 3 for r in body['rows'])
        kazan = body['offers'][keys['weekend1']['items'][0]]
        assert kazan['city_code'] == 'KZN' and 'trip_rating' not in kazan and kazan['q'].startswith('from=SVO&fc=MOW&') and ('dep=2026-11-20' in kazan['q'] or 'month=2026-11&weekend=0' in kazan['q'])
        # Поиск маршрута на месяц для Казани — обычная цена есть, 3 000 ₽ при обычной ~5 021 ₽ это −40 %.
        assert any(call.get('destination') == 'KZN' and call['departure_at'] == '2026-11' for call in calls)
        assert body['usual']['KZN|2026-11|0'][1] >= 8
        searches = len(calls)
        assert client.get('/api/v1/home', params={'from': 'SVO', 'fc': 'MOW'}).status_code == 200 and len(calls) == searches  # из кеша
        prices = client.get('/api/v1/home/prices', params={'from': 'SVO', 'fc': 'MOW', 'ids': ','.join([kazan['id'], 'f' * 32])}).json()['prices']
        assert prices == {kazan['id']: {'price_minor': 300000, 'received_at': prices[kazan['id']]['received_at']}}
        assert client.get('/api/v1/home/prices', params={'from': 'SVO', 'fc': 'MOW', 'ids': 'nope'}).status_code == 422
        assert client.get('/api/v1/home', params={'from': 'XXX'}).status_code == 422


def test_home_is_served_stale_at_once_and_rebuilt_in_background():
    import time
    from datetime import timedelta
    clock = {'now': NOW}
    price = {'value': 3000}
    def handler(request):
        params = dict(request.url.params)
        found = [r for r in [row('KZN', '2026-11-20T19:00:00+03:00', '2026-11-22T18:00:00+03:00', price['value']),
                             row('LED', '2026-11-20T19:00:00+03:00', '2026-11-22T18:00:00+03:00', 3500),
                             row('UFA', '2026-11-20T19:00:00+03:00', '2026-11-22T18:00:00+03:00', 4000)]
                 if r['departure_at'].startswith(params['departure_at']) and r['destination'] == params.get('destination', r['destination'])]
        return httpx.Response(200, json={'success': True, 'data': found})
    app = create_app(Settings(token='fixture', ttl=1), transport=httpx.MockTransport(handler), now=lambda: clock['now'])
    def kazan(client):
        body = client.get('/api/v1/home', params={'from': 'SVO', 'fc': 'MOW'}).json()
        return next(offer['price_minor'] for offer in body['offers'].values() if offer['city_code'] == 'KZN')
    with TestClient(app) as client:
        assert kazan(client) == 300000
        price['value'] = 2500
        time.sleep(1.1)  # кеш поисков (ttl=1 с) устарел, источник отдаст новую цену
        clock['now'] = NOW + timedelta(minutes=11)
        assert kazan(client) == 300000  # устаревшая главная — сразу, без ожидания сборки
        for _ in range(40):  # новая собирается в фоне
            if kazan(client) == 250000:
                break
            time.sleep(.05)
        assert kazan(client) == 250000
        price['value'] = 2000
        time.sleep(1.1)
        clock['now'] = NOW + timedelta(hours=7)  # дольше 6 часов — старую не отдаём, ждём новую
        assert kazan(client) == 200000
        response = client.get('/api/v1/home', params={'from': 'SVO', 'fc': 'MOW'})
        assert 'stale-while-revalidate=86400' in response.headers['Cache-Control']


def test_scenario_pages_budget_weekend_holidays():
    rows = [row(city, '2026-11-20T19:00:00+03:00', '2026-11-22T18:00:00+03:00', price) for city, price in (('KZN', 3000), ('LED', 4500), ('UFA', 8000), ('AER', 9000))]
    def handler(request):
        params = dict(request.url.params)
        found = [r for r in rows if r['departure_at'].startswith(params['departure_at']) and (not params.get('return_at') or r['return_at'].startswith(params['return_at']))
                 and r['destination'] == params.get('destination', r['destination'])]
        return httpx.Response(200, json={'success': True, 'data': found})
    with TestClient(create_app(Settings(token='fixture'), transport=httpx.MockTransport(handler), now=lambda: NOW)) as client:
        page = client.get('/kuda/moskva/do-10000')
        html = page.text
        assert page.status_code == 200 and 's-maxage' in page.headers['Cache-Control']
        assert '<title>Куда улететь из Москвы до 10 000 ₽: 4 направления от 3 000 ₽ — Aviator</title>' in html
        assert '<link rel="canonical" href="https://aviatour.vercel.app/kuda/moskva/do-10000">' in html and 'noindex' not in html
        # Дешевле — выше; ссылка открывает поездку на главной по её поиску.
        assert html.index('Казань') < html.index('Санкт-Петербург') < html.index('Уфа') < html.index('Сочи')
        assert re.search(r'href="/\?from=SVO&amp;fc=MOW&amp;[^"]*&amp;city=[A-Z]{3}&amp;trip=[0-9a-f]{32}"', html)
        assert 'href="/city/kazan"' in html and '"@type": "BreadcrumbList"' in html
        five = client.get('/kuda/moskva/do-5000').text  # два города — мало: страница честно говорит и закрыта от поисковиков
        assert 'noindex' in five and 'Пока мало вариантов' in five and 'Казань' in five and 'Уфа' not in five
        weekend = client.get('/kuda/moskva/na-vykhodnye').text
        assert 'Куда улететь из Москвы на выходные' in weekend and 'На эти выходные' in weekend
        holidays = client.get('/kuda/moskva/na-prazdniki')
        assert holidays.status_code == 200 and 'новогодние каникулы' in holidays.text and 'noindex' in holidays.text  # на каникулы поездок в данных нет
        assert client.get('/kuda/moskva/do-7000').status_code == 404 and client.get('/kuda/minsk/do-5000').status_code == 404
        assert client.get('/kuda/moskva', follow_redirects=False).headers['location'] == '/kuda/#moskva'
        assert 'Из Москвы' in client.get('/kuda/').text

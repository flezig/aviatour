import json
import re
from datetime import date, datetime, timezone
from decimal import Decimal
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi.testclient import TestClient

from app import city_pages
from app.main import create_app
from app.models import SearchRequest
from app.rules import normalize, safe_listed_url
from app.settings import Settings

NOW = datetime(2026, 10, 1, 9, tzinfo=timezone.utc)
CATALOG = city_pages.load()


def row(**overrides):
    return dict(origin='MOW', destination='KZN', origin_airport='SVO', destination_airport='KZN', price=Decimal('3181'),
                departure_at='2026-10-02T19:00:00+03:00', return_at='2026-10-04T18:00:00+03:00', duration_to=95, duration_back=95,
                transfers=0, return_transfers=0, link='/search/MOW0210KZN04101') | overrides


def offer(**overrides):
    request = SearchRequest(origin='SVO', origin_city_code='MOW', month='2026-10', destination='KZN', destination_city_code='KZN', weekend_only=False, max_budget_minor=50000000)
    return normalize(row(**overrides), request.model_copy(update={'month': overrides.get('departure_at', '2026-10')[:7]}), NOW)


def test_catalog_has_cities_with_photo_slug_and_checked_partner_links():
    assert 50 <= len(CATALOG.cities) <= 100
    for city in CATALOG.cities:
        assert re.fullmatch(r'[a-z0-9-]+', city['slug']) and re.fullmatch(r'[A-Z]{3}', city['code'])
        assert city['photo'] and city['photo']['url'].startswith('https://commons.wikimedia.org/')
        assert city['to'].startswith(('в ', 'во '))
        if city['ostrovok']:
            assert safe_listed_url(city['ostrovok'], CATALOG.ostrovok_urls, 'ostrovok.ru')
    assert CATALOG.by_slug['kazan']['to'] == 'в Казань' and CATALOG.by_slug['moskva']['to'] == 'в Москву'


@pytest.mark.parametrize('lat,lon,code,detected', [('55.80', '49.20', 'KZN', True), ('59.9', '30.4', 'LED', True), ('43.1', '131.9', 'VVO', True),
                                                     ('55.4', '37.9', 'MOW', True), ('60', '100', 'MOW', False), (None, None, 'MOW', False),
                                                     ('abc', '1', 'MOW', False), ('95', '10', 'MOW', False)])
def test_nearest_origin_within_radius_else_moscow(lat, lon, code, detected):
    origin, found = city_pages.nearest_origin(lat, lon, CATALOG.origins, CATALOG.radius_km, CATALOG.default_origin)
    assert (origin['code'], found) == (code, detected)


def test_months_cross_the_year():
    assert city_pages.month_keys(date(2026, 11, 16)) == ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04']


def test_cheapest_by_month_takes_1_to_14_nights_in_the_future():
    trips = [offer(price=Decimal('3000'), return_at='2026-10-02T23:00:00+03:00'),  # тот же день
             offer(price=Decimal('3500')),
             offer(price=Decimal('3100'), departure_at='2026-10-03T07:00:00+03:00', return_at='2026-10-20T18:00:00+03:00'),  # 17 ночей
             offer(price=Decimal('3200'), departure_at='2026-10-01T07:00:00+03:00', return_at='2026-10-03T18:00:00+03:00')]  # уже улетел
    found = city_pages.cheapest_by_month({'2026-10': [trip for trip in trips if trip]}, datetime(2026, 10, 1, 9, 30, tzinfo=timezone.utc))
    assert found['2026-10'].price_minor == 350000


def test_route_paths_with_hyphenated_names():
    origin, city = CATALOG.route('sankt-peterburg-kazan')
    assert (origin['code'], city['code']) == ('LED', 'KZN')
    assert CATALOG.route('moskva-moskva') is None and CATALOG.route('moskva-nowhere') is None and CATALOG.route('kazan') is None


def test_money_and_dates_like_the_site():
    assert city_pages.money(318100) == '3 181 ₽' and city_pages.money(12345050) == '123 450,50 ₽'
    assert city_pages.date_range(datetime(2026, 11, 20), datetime(2026, 11, 22)) == '20–22 нояб.'
    assert city_pages.date_range(datetime(2026, 12, 30), datetime(2027, 1, 3)) == '30 дек. – 3 янв.'


def app_with(rows):
    calls = []
    def handler(request):
        calls.append(dict(request.url.params))
        if request.url.path.endswith('links/v1/create'):
            return httpx.Response(200, json={'result': {'links': [{'code': 'success', 'partner_url': 'https://tp.media/r?x=1'}]}})
        month = request.url.params.get('departure_at')
        return httpx.Response(200, json={'success': True, 'data': [r | {'price': str(r['price'])} for r in rows if r['departure_at'].startswith(month) and r['destination'] == request.url.params.get('destination')]})
    return create_app(Settings(token='fixture', marker='123', trs='456'), transport=httpx.MockTransport(handler), now=lambda: NOW), calls


def test_city_page_is_ready_html_with_price_months_seo_and_partner_links():
    app, calls = app_with([row(), row(price=Decimal('4500'), departure_at='2026-11-06T19:00:00+03:00', return_at='2026-11-08T18:00:00+03:00', link='/search/MOW0611KZN08111')])
    with TestClient(app) as client:
        response = client.get('/city/kazan')
        page = response.text
        assert response.status_code == 200 and 's-maxage' in response.headers['Cache-Control']
        assert '<title>Казань: билеты из Москвы от 3 181 ₽' in page
        assert '<link rel="canonical" href="https://aviatour.vercel.app/city/kazan">' in page
        assert 'og/kazan.jpg' in page and '"@type": "BreadcrumbList"' in page
        assert 'Октябрь' in page and 'Ноябрь' in page and '4 500 ₽' in page and 'цен не нашли' in page
        assert 'Что посмотреть' in page and 'Казанский кремль' in page  # заметки редакции есть только у 25 городов
        links = re.findall(r'href="(/go\?[^"]+)"', page)
        assert links and all(parse_qs(urlsplit(link.replace('&amp;', '&')).query)['s'] == ['kzn-city-stay'] for link in links)
        assert 'Реклама · Aviasales' in page and 'Реклама · Островок' in page
        # Поиск маршрута на каждый из шести месяцев, тот же запрос, что делает выдача сайта.
        searches = [call for call in calls if 'departure_at' in call]
        assert len(searches) == 6 and {call['destination'] for call in searches} == {'KZN'} and {call['origin'] for call in searches} == {'MOW'}
        # Повторный показ — из кеша, без новых запросов к источнику.
        client.get('/city/kazan')
        assert len([call for call in calls if 'departure_at' in call]) == 6
        assert client.get('/city/nowhere').status_code == 404


def test_city_page_without_prices_says_so_and_route_page_is_noindex():
    app, _ = app_with([])
    with TestClient(app) as client:
        page = client.get('/city/kazan').text
        assert 'нет найденных цен' in page and 'id="months" aria-labelledby="monthsTitle" hidden' in page
        route = client.get('/route/sankt-peterburg-kazan').text
        assert 'noindex' in route and 'Санкт-Петербург — Казань' in route
        assert client.get('/route/moskva-moskva').status_code == 404


def test_moscow_page_uses_petersburg_and_fares_endpoint_switches_origin():
    rows = [row(origin='LED', origin_airport='LED', destination='MOW', destination_airport='SVO', link='/search/LED0210MOW04101'),
            row(origin='LED', origin_airport='LED', link='/search/LED0210KZN04101', price=Decimal('5100'))]
    app, _ = app_with(rows)
    with TestClient(app) as client:
        assert 'Москва: билеты из Петербурга' in client.get('/city/moskva').text
        body = client.get('/api/v1/city/KZN', params={'from': 'LED'}).json()
        assert body['origin']['code'] == 'LED' and '5 100 ₽' in body['price'] and body['has_prices']
        assert client.get('/api/v1/city/KZN', params={'from': 'KZN'}).status_code == 422
        assert client.get('/api/v1/city/XXX', params={'from': 'LED'}).status_code == 422
        assert client.get('/api/v1/city/KZN', params={'from': 'SVO', 'fc': 'LED'}).status_code == 422


def test_visitor_origin_from_hosting_headers_is_private():
    app, _ = app_with([])
    with TestClient(app) as client:
        response = client.get('/api/v1/origin', headers={'x-vercel-ip-latitude': '56.84', 'x-vercel-ip-longitude': '60.6'})
        assert response.json() == {'code': 'SVX', 'iata': 'SVX', 'all': False, 'name': 'Екатеринбург', 'from': 'Екатеринбурга', 'detected': True, 'located': True}
        assert response.headers['Cache-Control'] == 'private, no-store'
        assert client.get('/api/v1/origin').json() | {} == {'code': 'MOW', 'iata': 'SVO', 'all': True, 'name': 'Москва', 'from': 'Москвы', 'detected': False, 'located': False}


def test_go_accepts_only_listed_ostrovok_pages():
    app, calls = app_with([])
    listed = CATALOG.by_slug['kazan']['ostrovok']
    with TestClient(app, follow_redirects=False) as client:
        response = client.get('/go', params={'u': listed, 's': 'kzn-city-stay'})
        assert response.status_code == 302 and response.headers['location'] == 'https://tp.media/r?x=1'
        for url in [listed + '?utm=1', listed.replace('https', 'http'), listed + '#x', 'https://ostrovok.ru/hotel/russia/nowhere/',
                    'https://ostrovok.ru.example.com/hotel/russia/kazan/', 'https://ostrovok.ru/']:
            assert client.get('/go', params={'u': url}).status_code == 422, url

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import json
import httpx
import pytest
from fastapi.testclient import TestClient
from app.rating import (Evidence, MoneyRange, Component, DestinationData, TripPreferences,
                        ExchangeRate, affordability, evaluate, road_score)
from app.rating_sources import RatingSources, load_reviewed_data
from app.food_basket import unit_price, basket, BASKET
from app.main import create_app
from app.models import SearchRequest
from app.settings import Settings
from app.rules import normalize

NOW = datetime(2026, 10, 5, 10, tzinfo=timezone.utc)

def evidence(**updates):
    args = dict(source='Проверочный источник (синтетические данные)', source_url='https://example.org/data',
                geography='city', period_start=date(2026, 10, 4), period_end=date(2026, 10, 4),
                fetched_at=NOW, estimated=True, method='Только тест расчёта; не реальные цены')
    args.update(updates)
    return Evidence(**args)

def offer(**updates):
    row = dict(origin='MOW', destination='LED', origin_airport='SVO', destination_airport='LED',
        price=Decimal('10000'), departure_at='2026-10-09T10:00:00+03:00', return_at='2026-10-11T18:00:00+03:00',
        duration_to=120, duration_back=120, transfers=0, return_transfers=0, link='/search/SVO0910LED11101')
    value = normalize(row, SearchRequest(origin='SVO', month='2026-10'), NOW)
    return value.model_copy(update=updates)

def money(low=100000, high=120000, currency='RUB'):
    return MoneyRange(low_minor=low, high_minor=high, currency=currency, evidence=evidence())

def data(preferences=None, **updates):
    args = dict(city_code='LED', check_in=date(2026, 10, 9), check_out=date(2026, 10, 11),
                preferences=preferences or TripPreferences(), housing_total=money(600000, 800000),
                food_per_day=money(), transport_per_day=money(20000, 30000),
                theft=Component(score=80, evidence=evidence()), violence=Component(score=90, evidence=evidence()),
                advisory='none', advisory_evidence=evidence(), conditions=Component(score=75, evidence=evidence()))
    args.update(updates)
    return DestinationData(**args)

def test_budget_days_nights_and_shared_housing():
    prefs = TripPreferences(travelers=2)
    r = evaluate(offer(), prefs, NOW, data(prefs))
    assert (r.days, r.nights) == (3, 2)
    assert (r.stay_low_minor, r.stay_high_minor) == (660000, 850000)
    assert (r.total_low_minor, r.total_high_minor) == (1660000, 1850000)
    assert r.score is not None and r.version == 'trip-v1.0'
    assert r.completeness == 'medium'
    assert r.entry_status == 'Условия въезда не проверены'

def test_missing_is_not_free_or_safe():
    r = evaluate(offer(), TripPreferences(), NOW)
    assert r.score is None and r.total_low_minor is None and r.safety_score is None
    assert len(r.lines) == 1 and r.completeness == 'low'

@pytest.mark.parametrize('field', ['housing_total', 'food_per_day', 'transport_per_day', 'theft', 'violence', 'conditions', 'advisory_evidence'])
def test_any_missing_component_blocks_full_rating(field):
    r = evaluate(offer(), TripPreferences(), NOW, data(**{field: None}))
    assert r.score is None and r.missing

def test_stale_and_future_data():
    old = money().model_copy(update={'evidence': evidence(fetched_at=NOW-timedelta(days=8))})
    assert evaluate(offer(), TripPreferences(), NOW, data(food_per_day=old)).total_high_minor is None
    future = money().model_copy(update={'evidence': evidence(fetched_at=NOW+timedelta(minutes=1))})
    assert evaluate(offer(), TripPreferences(), NOW, data(food_per_day=future)).score is None
    assert evaluate(offer(received_at=NOW-timedelta(days=2)), TripPreferences(), NOW, data()).score is None

def test_currency_requires_fresh_rate():
    d = data(housing_total=money(10000, 20000, 'EUR'))
    assert evaluate(offer(), TripPreferences(), NOW, d).total_high_minor is None
    fx = ExchangeRate(currency='EUR', rub_per_unit=Decimal('100.005'), evidence=evidence())
    d.rates = [fx]
    r = evaluate(offer(), TripPreferences(), NOW, d)
    assert r.lines[1].high_minor == 2000100
    d.rates = [fx.model_copy(update={'evidence': evidence(fetched_at=NOW-timedelta(days=4))})]
    assert evaluate(offer(), TripPreferences(), NOW, d).total_high_minor is None

def test_serious_advisory_cannot_be_compensated():
    r = evaluate(offer(price_minor=1), TripPreferences(), NOW, data(advisory='avoid'))
    assert r.score is None and r.suitability == 'avoid'
    r = evaluate(offer(), TripPreferences(), NOW, data(advisory='caution'))
    assert r.safety_score == 50 and r.suitability == 'warning'

@pytest.mark.parametrize('updates', [{'city_code':'PAR'}, {'check_in':date(2026,10,8)}, {'preferences':TripPreferences(travelers=3)}])
def test_exact_quote_scope(updates):
    assert evaluate(offer(), TripPreferences(), NOW, data(**updates)).total_high_minor is None

def test_list_independent_fixed_scale():
    assert affordability(50000, 100000) == 100
    assert affordability(100000, 100000) == 67
    assert affordability(200000, 100000) == 0
    a = evaluate(offer(), TripPreferences(), NOW, data())
    evaluate(offer(price_minor=40000000), TripPreferences(), NOW, data())
    assert evaluate(offer(), TripPreferences(), NOW, data()).score == a.score

def test_road_unknown_connections_and_overnight():
    assert road_score(offer(transfers=None)) is None
    assert road_score(offer(duration_to=None)) is None
    assert road_score(offer(transfers=2, return_transfers=2)) < road_score(offer())
    long = offer(duration_to=1200, duration_back=1200)
    assert road_score(long) < road_score(offer())

def test_bad_feed_does_not_break_search(tmp_path):
    path = tmp_path/'data.json'; path.write_text('{bad')
    assert load_reviewed_data(str(path))[1] == 'unavailable'
    with TestClient(create_app(Settings(rating_data_file=str(path)), now=lambda: NOW)) as client:
        assert client.get('/health').status_code == 200
        assert client.get('/api/v1/rating/status').json()['evidence_feed'] == 'unavailable'

@pytest.mark.asyncio
async def test_source_error_cached_without_secrets():
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(429, json={'secret': 'never-return'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        source = RatingSources(client)
        one = await source.food_observations(48.86, 2.35)
        two = await source.food_observations(48.86, 2.35)
        assert one == two == {'status':'unavailable', 'data':None}
        assert len(calls) == 1
        assert (await source.municipal_context('portugal', 'lisbon'))['status'] == 'needs_key'

@pytest.mark.asyncio
async def test_source_request_contract():
    def handler(request):
        assert request.url.params['size'] == '100'
        assert request.url.params['radius_km'] == '15'
        return httpx.Response(200, json={'items': []})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert (await RatingSources(client).food_observations(1, 2))['status'] == 'ok'

def test_normalize_food_and_require_entire_basket():
    assert unit_price({'price':2, 'price_per':'KILOGRAM'}, 'kg') == 2
    assert unit_price({'price':2, 'product':{'product_quantity':500, 'product_quantity_unit':'g'}}, 'kg') == 4
    assert unit_price({'price':2, 'product':{'product_quantity':1000, 'product_quantity_unit':'ml'}}, 'l') == 2
    assert unit_price({'price':2}, 'kg') is None
    assert unit_price({'price':2, 'product':{'product_quantity':0, 'product_quantity_unit':'g'}}, 'kg') is None
    assert basket([], 'EUR', 'Paris', NOW.date())['daily_cost'] is None
    rows = []
    for category, (unit, _) in BASKET.items():
        for i in range(5):
            rows.append(dict(price=2, product_code=f'{category}-{i}', category_tag=category,
                product={'product_quantity':1,'product_quantity_unit':{'kg':'kg','unit':'unit','l':'l'}[unit]},
                location_id=i%3, location={'osm_address_city':'Paris'}, date='2026-10-04', currency='EUR',
                price_is_discounted=False, duplicate_of=None))
    assert basket(rows, 'EUR', 'Paris', NOW.date())['daily_cost'] is not None
    assert basket(rows+rows, 'EUR', 'Paris', NOW.date()) == basket(rows, 'EUR', 'Paris', NOW.date())
    for row in rows: row['price_is_discounted'] = True
    assert basket(rows, 'EUR', 'Paris', NOW.date())['daily_cost'] is None

@pytest.mark.asyncio
async def test_hotel_adapter_requires_access_and_exact_dates():
    from app.hotel_source import AmadeusHotels
    calls = []
    def handler(request):
        calls.append(request)
        if request.method == 'POST':
            return httpx.Response(200, json={'access_token':'test-secret', 'expires_in':1800})
        assert request.url.params['checkInDate'] == '2026-10-09'
        assert request.url.params['checkOutDate'] == '2026-10-11'
        assert request.url.params['adults'] == '2'
        assert request.url.params['roomQuantity'] == '1'
        assert request.url.host == 'test.api.amadeus.com'
        return httpx.Response(200, json={'data': []})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert (await AmadeusHotels(client).offers(['TEST'], date(2026,10,9), date(2026,10,11), 2))['status'] == 'needs_key'
        source = AmadeusHotels(client, 'test-id', 'test-secret')
        r = await source.offers(['TEST'], date(2026,10,9), date(2026,10,11), 2)
        assert r == {'status':'test_only', 'data':{'data':[]}}
        assert await source.offers(['TEST'], date(2026,10,9), date(2026,10,11), 2) == r
        assert len(calls) == 2

def test_enrichment_never_poison_shared_airfare_cache(tmp_path):
    path = tmp_path/'data.json'
    path.write_text(json.dumps([data().model_dump(mode='json')]))
    calls = []
    def handler(request):
        calls.append(request)
        # Contract supported by the existing flight adapter.
        return httpx.Response(200, json={'success':True, 'data':[
            {'origin':'MOW','destination':'LED','origin_airport':'SVO','destination_airport':'LED',
             'price':10000,'departure_at':'2026-10-09T10:00:00+03:00','return_at':'2026-10-11T18:00:00+03:00',
             'duration_to':120,'duration_back':120,'transfers':0,'return_transfers':0,
             'link':'/search/SVO0910LED11101'}]})
    with TestClient(create_app(Settings(token='test', pages=1, rating_data_file=str(path)), transport=httpx.MockTransport(handler), now=lambda:NOW)) as client:
        query={'origin':'SVO','month':'2026-10','weekend_only':False,'destination':'LED'}
        first=client.post('/api/v1/search',json=query)
        assert first.status_code == 200
        one=first.json()['offers'][0]['trip_rating']
        assert one['score'] is not None
        query['trip_preferences']={'travelers':2}
        two=client.post('/api/v1/search',json=query).json()['offers'][0]['trip_rating']
        assert two['score'] is None and two['travelers']==2
        assert len(calls)==1


def test_serious_advisory_independent_of_hotel_occupancy():
    r = evaluate(offer(), TripPreferences(travelers=2), NOW, data(advisory='avoid'))
    assert r.suitability == 'avoid' and r.score is None

def test_more_complete_quote_does_not_erase_active_warning(tmp_path):
    path=tmp_path/'data.json'
    rows=[data(preferences=TripPreferences(travelers=2), advisory='avoid'), data()]
    path.write_text(json.dumps([r.model_dump(mode='json') for r in rows]))
    def handler(request):
        return httpx.Response(200, json={'success':True, 'data':[
            {'origin':'MOW','destination':'LED','origin_airport':'SVO','destination_airport':'LED',
             'price':10000,'departure_at':'2026-10-09T10:00:00+03:00','return_at':'2026-10-11T18:00:00+03:00',
             'duration_to':120,'duration_back':120,'transfers':0,'return_transfers':0,
             'link':'/search/SVO0910LED11101'}]})
    with TestClient(create_app(Settings(token='test',pages=1,rating_data_file=str(path)),transport=httpx.MockTransport(handler),now=lambda:NOW)) as client:
        r=client.post('/api/v1/search',json={'origin':'SVO','month':'2026-10','destination':'LED','weekend_only':False}).json()['offers'][0]['trip_rating']
        assert r['suitability']=='avoid' and r['score'] is None
        assert r['total_high_minor'] is not None

def test_preliminary_is_separate_from_full_and_has_own_version():
    r=evaluate(offer(),TripPreferences(),NOW)
    assert r.score is None and r.preliminary_score is not None
    assert r.preliminary_version == 'flight-v1.0'
    assert evaluate(offer(transfers=None),TripPreferences(),NOW).preliminary_score is None
    assert evaluate(offer(received_at=NOW-timedelta(days=2)),TripPreferences(),NOW).preliminary_score is None
    assert evaluate(offer(),TripPreferences(),NOW,data(advisory='avoid')).preliminary_score is None
    assert evaluate(offer(price_minor=3000000),TripPreferences(),NOW).preliminary_score < r.preliminary_score

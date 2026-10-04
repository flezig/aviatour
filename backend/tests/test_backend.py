import asyncio
from datetime import datetime, timezone
from decimal import Decimal
import json
import httpx
import pytest
from fastapi.testclient import TestClient
from app.models import SearchRequest
from app.rules import normalize, rubles_to_minor, safe_search_url
from app.runtime import TTLCache, RateLimiter
from app.settings import Settings
from app.errors import SearchError
from app.main import create_app
from app.upstream import Travelpayouts

NOW = datetime(2026, 10, 1, 9, tzinfo=timezone.utc)
QUERY = SearchRequest(origin='SVO', month='2026-10')

def record(**overrides):
    return dict(origin='MOW', destination='LED', origin_airport='SVO', destination_airport='LED',
        price=Decimal('8500'), departure_at='2026-10-02T10:00:00+03:00', return_at='2026-10-04T18:00:00+03:00',
        transfers=0, return_transfers=0, link='/search/SVO0210LED04101', **overrides)

@pytest.mark.parametrize('price,accepted', [('24999.99',True),('25000',True),('25000.01',False)])
def test_inclusive_budget(price, accepted):
    row=record();row['price']=Decimal(price)
    assert (normalize(row, QUERY, NOW) is not None) == accepted

@pytest.mark.parametrize('rub,minor', [('8500',850000),('0.01',1),('1.001',101),('25000.0001',2500001)])
def test_decimal_currency(rub,minor): assert rubles_to_minor(Decimal(rub)) == minor

@pytest.mark.parametrize('value,currency',[(Decimal('2'),'eur'),(float('2.1'),'rub'),(True,'rub'),(Decimal('NaN'),'rub'),(Decimal('-1'),'rub')])
def test_invalid_money(value,currency):
    with pytest.raises(ValueError): rubles_to_minor(value,currency)

@pytest.mark.parametrize('dep,ret,accepted',[
    ('2026-10-02','2026-10-04',True),('2026-10-02','2026-10-05',True),('2026-10-03','2026-10-05',True),
    ('2026-10-02','2026-10-11',False),('2026-10-01','2026-10-04',False),('2026-10-31','2026-11-02',True)])
def test_weekends(dep,ret,accepted):
    row=record();row.update(departure_at=dep+'T10:00:00+03:00',return_at=ret+'T18:00:00+03:00')
    assert (normalize(row,QUERY,NOW) is not None) == accepted

def test_year_boundary():
    row=record();row.update(departure_at='2027-12-31T10:00:00+03:00',return_at='2028-01-02T18:00:00+03:00')
    assert normalize(row,QUERY.model_copy(update={'month':'2027-12'}),NOW)

@pytest.mark.parametrize('back',[None,1])
def test_both_legs_direct(back):
    row=record();row['return_transfers']=back
    assert normalize(row,QUERY.model_copy(update={'direct_only':True}),NOW) is None
    assert normalize(row,QUERY,NOW).return_transfers == back

def test_past_and_exact_airport():
    assert normalize(record(),QUERY,datetime(2026,10,2,8,tzinfo=timezone.utc)) is None
    row=record();row['origin_airport']='DME'
    assert normalize(row,QUERY,NOW) is None
    row.pop('origin_airport')
    with pytest.raises(ValueError): normalize(row,QUERY,NOW)

def test_missing_optional_fields_and_identity():
    row=record();row.pop('transfers');row.pop('return_transfers')
    offer=normalize(row,QUERY,NOW)
    assert offer.transfers is None and offer.duration_to is None
    row['price']=Decimal('9000'); assert normalize(row,QUERY,NOW).id == offer.id

@pytest.mark.parametrize('url',['http://aviasales.com/search/a','https://aviasales.com.evil/search/a','//evil/search/a','https://u:p@aviasales.com/search/a','https://aviasales.com:444/search/a'])
def test_unsafe_url(url):
    with pytest.raises(ValueError): safe_search_url(url)

def test_health_no_token_and_validation():
    with TestClient(create_app(Settings(),now=lambda:NOW)) as client:
        assert client.get('/health').json() == {'status':'ok','live_configured':False}
        assert client.post('/api/v1/search',json=QUERY.model_dump()).status_code == 503
        for updates in [{'origin':'MOW'},{'month':'2026-09'},{'month':'2027-04'},{'max_budget_minor':499999},{'max_budget_minor':True}]:
            assert client.post('/api/v1/search',json=QUERY.model_dump()|updates).status_code == 422
        airports=client.get('/api/v1/airports').json()
        assert next(x for x in airports if x['iata']=='SVO')['name']=='Шереметьево'

@pytest.mark.asyncio
async def test_cache_ttl_capacity_singleflight_and_failures():
    time=[0];cache=TTLCache(10,2,lambda:time[0]);calls=0
    async def load():
        nonlocal calls;calls+=1; await asyncio.sleep(.01); return []
    result=await asyncio.gather(*(cache.get_or_create('a',load) for _ in range(5)))
    assert calls==1 and result==[[]]*5
    await cache.get_or_create('a',load);assert calls==1
    await cache.get_or_create('b',load);await cache.get_or_create('c',load);assert list(cache.entries)==['b','c']
    time[0]=11;await cache.get_or_create('c',load);assert calls==4
    async def fail(): raise SearchError('x','failure')
    for _ in range(2):
        with pytest.raises(SearchError): await cache.get_or_create('bad',fail)
    assert 'bad' not in cache.entries


def test_rate_limit():
    time=[0];limiter=RateLimiter(2,lambda:time[0]);limiter.check();limiter.check()
    with pytest.raises(SearchError) as err: limiter.check()
    assert err.value.status==429
    time[0]=60;limiter.check()

async def run_upstream(handler,settings=None):
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        return await Travelpayouts(client,settings or Settings(token='fixture'),now=lambda:NOW,sleep=lambda _:asyncio.sleep(0)).search(QUERY)

@pytest.mark.asyncio
async def test_empty_success():
    result=await run_upstream(lambda req:httpx.Response(200,json={'success':True,'data':[]}))
    assert result.offers==[] and not result.incomplete

@pytest.mark.asyncio
@pytest.mark.parametrize('status,body,code',[(401,{},'upstream_auth'),(403,{},'upstream_auth'),(400,{},'upstream_http'),(200,{'success':False,'data':None},'upstream_failure'),(200,{'success':True,'data':{}},'upstream_json'),(200,{'success':True,'data':[],'currency':'eur'},'upstream_json')])
async def test_upstream_errors_no_retry(status,body,code):
    count=0
    def handler(req):
        nonlocal count;count+=1;return httpx.Response(status,json=body)
    with pytest.raises(SearchError) as error:await run_upstream(handler)
    assert error.value.code==code and count==1

@pytest.mark.asyncio
async def test_timeout_and_json():
    def timeout(req): raise httpx.ReadTimeout('fixture')
    with pytest.raises(SearchError) as error: await run_upstream(timeout)
    assert error.value.code=='timeout'
    with pytest.raises(SearchError) as error: await run_upstream(lambda req:httpx.Response(200,text='{bad'))
    assert error.value.code=='upstream_json'

@pytest.mark.asyncio
async def test_retry_after_and_temporary_errors():
    calls=0
    def handler(req):
        nonlocal calls;calls+=1
        if calls==1:return httpx.Response(429,headers={'Retry-After':'0'})
        return httpx.Response(200,json={'success':True,'data':[]})
    assert not (await run_upstream(handler)).incomplete and calls==2
    with pytest.raises(SearchError): await run_upstream(lambda req:httpx.Response(429,headers={'Retry-After':'60'}))

@pytest.mark.asyncio
async def test_pagination_duplicates_and_partial():
    row=record();row['price']=8500
    calls=[]
    def handler(req):
        assert req.headers['X-Access-Token']=='fixture'
        assert req.url.params['origin']=='SVO' and req.url.params['currency']=='rub' and req.url.params['one_way']=='false'
        page=int(req.url.params['page']);calls.append(page)
        return httpx.Response(200,json={'success':True,'data':[row]*1000 if page==1 else [row]})
    result=await run_upstream(handler)
    assert calls==[1,2] and len(result.offers)==1 and not result.incomplete
    result=await run_upstream(handler,Settings(token='fixture',pages=1))
    assert result.incomplete and len(result.offers)==1
    def partial(req):
        if req.url.params['page']=='1':return httpx.Response(200,json={'success':True,'data':[row]*1000})
        return httpx.Response(401)
    assert (await run_upstream(partial)).incomplete

@pytest.mark.asyncio
async def test_bad_records_and_currency_mismatch():
    row=record();row['price']=8500
    bad=row|{'currency':'EUR'}
    result=await run_upstream(lambda req:httpx.Response(200,json={'success':True,'data':[{},bad,row]}))
    assert result.incomplete and len(result.offers)==1


def test_http_rate_limit_and_contract():
    row=record();row['price']=8500
    transport=httpx.MockTransport(lambda req:httpx.Response(200,json={'success':True,'data':[row]}))
    with TestClient(create_app(Settings(token='fixture',rate=1),transport=transport,now=lambda:NOW)) as client:
        response=client.post('/api/v1/search',json=QUERY.model_dump())
        assert response.status_code==200 and response.json()['offers'][0]['price_minor']==850000
        response=client.post('/api/v1/search',json=QUERY.model_dump());assert response.status_code==429 and response.headers['Retry-After']

@pytest.mark.parametrize('value',['not-a-price','', 'NaN', 'Infinity'])
def test_invalid_decimal_strings(value):
    with pytest.raises(ValueError): rubles_to_minor(value)

@pytest.mark.asyncio
async def test_total_time_budget_and_partial_timeout():
    row=record();row['price']=8500
    async def slow(req):
        await asyncio.sleep(.1)
        return httpx.Response(200,json={'success':True,'data':[]})
    with pytest.raises(SearchError) as error:
        await run_upstream(slow,Settings(token='fixture',timeout=.02))
    assert error.value.code=='timeout'
    async def partial(req):
        if req.url.params['page']=='1':
            return httpx.Response(200,json={'success':True,'data':[row]*1000})
        await asyncio.sleep(.2)
        return httpx.Response(200,json={'success':True,'data':[]})
    result=await run_upstream(partial,Settings(token='fixture',timeout=.08))
    assert result.incomplete and len(result.offers)==1

@pytest.mark.asyncio
async def test_cancelled_consumer_does_not_duplicate_inflight():
    cache=TTLCache();calls=0
    async def load():
        nonlocal calls;calls+=1;await asyncio.sleep(.02);return 'ok'
    task=asyncio.create_task(cache.get_or_create('a',load));await asyncio.sleep(.001);task.cancel()
    with pytest.raises(asyncio.CancelledError):await task
    assert await cache.get_or_create('a',load)=='ok' and calls==1


def test_partner_links_only_generated_exact_urls(tmp_path):
    path=tmp_path/'links.json'
    path.write_text(json.dumps({'https://www.aviasales.com/search/SVO0210LED04101':'https://tp.media/generated','https://www.aviasales.com/search/bad':'https://tp.media.evil.test/generated'}))
    adapter=Travelpayouts(None,Settings(partner_links_file=str(path),marker='12345'))
    assert adapter.partner('https://www.aviasales.com/search/SVO0210LED04101')=='https://tp.media/generated'
    assert adapter.partner('https://www.aviasales.com/search/bad') is None
    assert adapter.partner('https://www.aviasales.com/search/unmapped') is None


def test_contract_fixture_stays_in_sync():
    from pathlib import Path
    from app.models import SearchResponse
    response=SearchResponse.model_validate_json(Path(__file__).with_name('contract-response.json').read_text())
    assert response.offers[0].price_minor==850001 and response.offers[0].return_transfers is None

@pytest.mark.parametrize('airport',['SVO','DME','VKO'])
def test_city_search_accepts_each_moscow_airport(airport):
    query=QUERY.model_copy(update={'origin_city_code':'MOW'})
    row=record(); row['origin_airport']=airport
    offer=normalize(row,query,NOW)
    assert offer.origin_airport==airport and offer.origin_city_code=='MOW'
    row['origin_airport']='LED'
    assert normalize(row,query,NOW) is None


def test_city_validation_and_cache_separation():
    calls=[]
    def handler(req):
        calls.append(req.url.params['origin'])
        row=record();row['price']=8500;row['origin_airport']='DME'
        return httpx.Response(200,json={'success':True,'data':[row]})
    with TestClient(create_app(Settings(token='test'),transport=httpx.MockTransport(handler),now=lambda:NOW)) as client:
        query=QUERY.model_dump()
        assert client.post('/api/v1/search',json=query|{'origin_city_code':'LED'}).status_code==422
        assert client.post('/api/v1/search',json=query).json()['offers']==[]
        result=client.post('/api/v1/search',json=query|{'origin_city_code':'MOW'}).json()
        assert result['offers'][0]['origin_airport']=='DME'
        client.post('/api/v1/search',json=query|{'origin_city_code':'MOW'})
        assert calls==['SVO','MOW']


@pytest.mark.parametrize('origin,zone',[('LED','+03:00'),('KZN','+03:00'),('OVB','+07:00')])
def test_other_city_local_weekend(origin,zone):
    row=record();row.update(origin_airport=origin,destination_airport='SVO',
        departure_at='2026-10-02T01:00:00'+zone,return_at='2026-10-04T18:00:00+03:00')
    offer=normalize(row,QUERY.model_copy(update={'origin':origin}),NOW)
    assert offer and offer.origin_airport==origin

# Exact date search is independent of the weekend-only discovery mode.
def test_exact_dates_accept_weekdays_and_cross_month_returns():
    exact = SearchRequest(origin='SVO', month='2026-10', departure_date='2026-10-06', return_date='2026-11-01')
    row = record(); row.update(departure_at='2026-10-06T23:30:00+03:00', return_at='2026-11-01T01:30:00+03:00', airline='SU', flight_number=123)
    offer = normalize(row, exact, NOW)
    assert offer and offer.airline == 'SU' and offer.flight_number == '123'
    row['return_at'] = '2026-11-02T01:30:00+03:00'
    assert normalize(row, exact, NOW) is None

@pytest.mark.parametrize('updates', [
    {'departure_date': '2026-10-06'},
    {'departure_date': '2026-10-06', 'return_date': '2026-10-05'},
    {'departure_date': '2026-10-06', 'return_date': '2026-10-06'},
    {'departure_date': '2026-10-06', 'return_date': '2027-01-01'},
    {'departure_date': '2026-10-32', 'return_date': '2026-11-01'},
    {'departure_date': '2026-11-01', 'return_date': '2026-11-03'},
    {'destination_city_code': 'LED'},
])
def test_invalid_exact_date_contract(updates):
    from pydantic import ValidationError
    with pytest.raises(ValidationError): SearchRequest.model_validate(QUERY.model_dump() | updates)


def test_month_all_trips_and_destination_filter():
    row = record(); row['return_at'] = '2026-10-10T18:00:00+03:00'
    assert normalize(row, QUERY, NOW) is None
    broad = QUERY.model_copy(update={'weekend_only': False, 'destination': 'LED'})
    assert normalize(row, broad, NOW)
    assert normalize(row, broad.model_copy(update={'destination': 'KZN'}), NOW) is None
    assert normalize(row, broad.model_copy(update={'destination': 'LED', 'destination_city_code': 'LED'}), NOW)


def test_unknown_airline_and_zero_duration_are_not_invented():
    row = record(); row.update(airline={'bad': True}, flight_number=True, duration_to=0)
    offer = normalize(row, QUERY, NOW)
    assert offer.airline is None and offer.flight_number is None and offer.duration_to == 0


def test_source_cache_reused_across_budget_direct_and_weekend_filters():
    calls = []
    def handler(req):
        calls.append(dict(req.url.params))
        row = record(); row['price'] = 9000
        stopped = row | {'flight_number': '2', 'transfers': 1, 'price': 26000}
        long = row | {'flight_number': '3', 'return_at': '2026-10-10T18:00:00+03:00'}
        return httpx.Response(200, json={'success': True, 'data': [row, stopped, long]})
    with TestClient(create_app(Settings(token='fixture'), transport=httpx.MockTransport(handler), now=lambda: NOW)) as client:
        query = QUERY.model_dump()
        assert len(client.post('/api/v1/search', json=query).json()['offers']) == 1
        assert len(client.post('/api/v1/search', json=query | {'max_budget_minor': 3000000}).json()['offers']) == 2
        assert len(client.post('/api/v1/search', json=query | {'max_budget_minor': 3000000, 'direct_only': True}).json()['offers']) == 1
        assert len(client.post('/api/v1/search', json=query | {'weekend_only': False}).json()['offers']) == 2
        assert len(calls) == 1 and calls[0]['direct'] == 'false'


def test_exact_params_and_cache_separation():
    calls = []
    def handler(req):
        calls.append(dict(req.url.params))
        return httpx.Response(200, json={'success': True, 'data': []})
    with TestClient(create_app(Settings(token='fixture'), transport=httpx.MockTransport(handler), now=lambda: NOW)) as client:
        query = QUERY.model_dump() | {'departure_date': '2026-10-06', 'return_date': '2026-10-08', 'destination': 'LED', 'destination_city_code': 'LED'}
        assert client.post('/api/v1/search', json=query).status_code == 200
        assert client.post('/api/v1/search', json=query | {'return_date': '2026-10-09'}).status_code == 200
        assert client.post('/api/v1/search', json=QUERY.model_dump()).status_code == 200
        assert len(calls) == 3
        assert calls[0]['departure_at'] == '2026-10-06' and calls[0]['return_at'] == '2026-10-08' and calls[0]['destination'] == 'LED'
        assert 'return_at' not in calls[2] and 'destination' not in calls[2]
        assert client.post('/api/v1/search', json=query | {'destination_city_code': 'MOW'}).status_code == 422
        assert client.post('/api/v1/search', json=query | {'destination': 'DME', 'destination_city_code': 'MOW'}).status_code == 422
        assert client.post('/api/v1/search', json=query | {'departure_date': '2026-09-30', 'month': '2026-09'}).status_code == 422

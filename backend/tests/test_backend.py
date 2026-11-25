import asyncio
from datetime import datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
from zoneinfo import ZoneInfo
import httpx
import pytest
from fastapi.testclient import TestClient
from app.catalog import AIRPORTS
from app.models import SearchRequest
from app.regions import DESTINATION_SCOPES
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
        # A cached answer does not count against the limit; only another trip to the source does.
        assert client.post('/api/v1/search',json=QUERY.model_dump()|{'max_budget_minor':3000000}).status_code==200
        assert client.get('/api/v1/search/web',params={'from':'SVO','month':'2026-10','budget':25000}).status_code==200
        response=client.post('/api/v1/search',json=QUERY.model_dump()|{'month':'2026-11'});assert response.status_code==429 and response.headers['Retry-After']

def test_web_search_is_cacheable_and_compact():
    row=record();row['price']=8500
    transport=httpx.MockTransport(lambda req:httpx.Response(200,json={'success':True,'data':[row]}))
    with TestClient(create_app(Settings(token='fixture'),transport=transport,now=lambda:NOW)) as client:
        response=client.get('/api/v1/search/web',params={'from':'SVO','fc':'MOW','month':'2026-10','budget':25000,'weekend':'0'})
        assert response.status_code==200 and 's-maxage' in response.headers['Cache-Control']
        offer=response.json()['offers'][0]
        assert offer['price_minor']==850000 and set(offer['trip_rating'])=={'score','preliminary_score'}
        assert client.get('/api/v1/search/web',params={'from':'SVO','month':'2026-10','budget':25000,'dep':'2026-10-02','ret':'2026-10-04'}).json()['offers']
        bad=client.get('/api/v1/search/web',params={'from':'svo','month':'2026-10','budget':25000})
        assert bad.status_code==422 and 'Cache-Control' not in bad.headers

def test_web_search_without_budget_includes_fares_above_slider_maximum():
    rows = [
        record() | {'price': price, 'departure_at': f'2026-10-02T{hour}:00:00+03:00'}
        for price, hour in [(25000, '08'), (35000, '10'), (510001, '12')]
    ]
    transport = httpx.MockTransport(lambda req: httpx.Response(200, json={'success': True, 'data': rows}))
    params = {'from': 'SVO', 'month': '2026-10', 'weekend': '0'}
    with TestClient(create_app(Settings(token='fixture'), transport=transport, now=lambda: NOW)) as client:
        for budget, expected in [(25000, [25000]), (500000, [25000, 35000]), (None, [25000, 35000, 510001])]:
            query = params if budget is None else params | {'budget': budget}
            response = client.get('/api/v1/search/web', params=query)
            assert response.status_code == 200
            assert sorted(offer['price_minor'] for offer in response.json()['offers']) == [rub * 100 for rub in expected]

def test_web_search_suggests_longer_cheaper_trip():
    # Friday 2 Oct → Sunday 4 Oct is the weekend trip; coming back later is cheaper in some cases.
    rows=[record()|{'price':8500},
          record()|{'price':7000,'return_at':'2026-10-06T18:00:00+03:00'},  # +2 days, 1500 ₽ less: the hint
          record()|{'price':6000,'return_at':'2026-10-07T18:00:00+03:00','transfers':1},  # cheaper but with a transfer
          record()|{'price':8400,'return_at':'2026-10-08T18:00:00+03:00'},  # saves only 100 ₽
          record()|{'price':5000,'return_at':'2026-10-10T18:00:00+03:00'}]  # 6 days later: a different trip
    transport=httpx.MockTransport(lambda req:httpx.Response(200,json={'success':True,'data':rows}))
    with TestClient(create_app(Settings(token='fixture'),transport=transport,now=lambda:NOW)) as client:
        body=client.get('/api/v1/search/web',params={'from':'SVO','fc':'MOW','month':'2026-10','budget':25000}).json()
        assert [o['price_minor'] for o in body['offers']]==[850000]
        trip=body['longer'][body['offers'][0]['id']]
        assert trip['price_minor']==700000 and trip['return_at'].startswith('2026-10-06')
        direct=client.get('/api/v1/search/web',params={'from':'SVO','fc':'MOW','month':'2026-10','budget':25000,'weekend':'0'}).json()
        assert all(o['id'] not in direct['longer'] or direct['longer'][o['id']]['price_minor']<o['price_minor'] for o in direct['offers'])

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


SEARCH_URL='https://www.aviasales.com/search/SVO0210LED04101?t=abc&expected_price=8500'

def link_app(handler,**settings):
    calls=[]
    def transport(request):
        calls.append(request)
        return handler(request)
    options=dict(token='secret',marker='12345',trs='678')|settings
    return create_app(Settings(**options),httpx.MockTransport(transport),now=lambda:NOW),calls

FAMILY_SEARCH_URL = 'https://www.aviasales.com/search/SVO0210LED0410211'

@pytest.mark.parametrize('destination', [SEARCH_URL, FAMILY_SEARCH_URL])
def test_go_redirects_through_generated_partner_link_once(destination):
    def handler(request):
        body=json.loads(request.content)
        assert str(request.url)=='https://api.travelpayouts.com/links/v1/create' and request.headers['X-Access-Token']=='secret'
        assert body=={'trs':678,'marker':12345,'shorten':False,'links':[{'url':destination}]}
        return httpx.Response(200,json={'result':{'links':[{'url':destination,'code':'success','partner_url':'https://tp.media/r?marker=12345&trs=678&u=x'}]}})
    app,calls=link_app(handler)
    with TestClient(app,follow_redirects=False) as client:
        for _ in range(2):
            response=client.get('/go',params={'u':destination})
            assert response.status_code==302 and response.headers['location']=='https://tp.media/r?marker=12345&trs=678&u=x'
            assert response.headers['cache-control']=='no-store'
    assert len(calls)==1

@pytest.mark.parametrize('reply',[
    httpx.Response(500),
    httpx.Response(200,json={'result':{'links':[{'code':'failed','message':'Invalid url'}]}}),
    httpx.Response(200,json={'result':{'links':[{'code':'success','partner_url':'https://tp.media.evil.test/r'}]}}),
    httpx.Response(200,json={'unexpected':True}),
    httpx.Response(200,text='not json')])
def test_go_falls_back_to_ordinary_link_and_pauses_attempts(reply):
    app,calls=link_app(lambda request:reply)
    with TestClient(app,follow_redirects=False) as client:
        for _ in range(2):
            response=client.get('/go',params={'u':SEARCH_URL})
            assert response.status_code==302 and response.headers['location']==SEARCH_URL
    assert len(calls)==1

def test_go_passes_click_label_and_drops_unsafe_ones():
    seen=[]
    def handler(request):
        link=json.loads(request.content)['links'][0];seen.append(link.get('sub_id'))
        return httpx.Response(200,json={'result':{'links':[{'code':'success','partner_url':'https://tp.media/r?sub_id='+str(link.get('sub_id'))}]}})
    app,calls=link_app(handler)
    with TestClient(app,follow_redirects=False) as client:
        for label,expected in [('web-home-a','web-home-a'),('web-home-a','web-home-a'),('web-home-b','web-home-b'),('Bad Label!','None'),('x'*33,'None')]:
            assert client.get('/go',params={'u':SEARCH_URL,'s':label}).headers['location']=='https://tp.media/r?sub_id='+expected
    assert seen==['web-home-a','web-home-b',None]

@pytest.mark.parametrize('settings',[{'marker':''},{'trs':''},{'token':''},{'marker':'12345.sub'}])
def test_go_without_partner_settings_never_calls_converter(settings):
    app,calls=link_app(lambda request:httpx.Response(500),**settings)
    with TestClient(app,follow_redirects=False) as client:
        assert client.get('/go',params={'u':SEARCH_URL}).headers['location']==SEARCH_URL
        assert client.get('/go',params={'u':FAMILY_SEARCH_URL}).headers['location']==FAMILY_SEARCH_URL
        assert client.get('/go',params={'u':'/search/SVO0210LED04101'}).headers['location']=='https://www.aviasales.com/search/SVO0210LED04101'
    assert calls==[]

@pytest.mark.parametrize('url',['','https://evil.test/search/a','https://aviasales.com.evil.test/search/a','//evil.test/search/a','https://www.aviasales.com/','javascript:alert(1)','https://www.aviasales.com/search/'+'A'*1000])
def test_go_rejects_anything_but_aviasales_search(url):
    app,calls=link_app(lambda request:httpx.Response(500))
    with TestClient(app,follow_redirects=False) as client:
        response=client.get('/go',params={'u':url})
        assert response.status_code==422 and response.json()['error']['code']=='validation'
    assert calls==[]

def test_russia_region_is_one_search_filtered_by_country():
    calls=[]
    def handler(request):
        calls.append(request)
        return httpx.Response(200,json={'success':True,'data':[record()|{'price':8500},
            record()|{'price':9000,'destination':'IST','destination_airport':'IST','link':'/search/SVO0210IST04101'}]})
    with TestClient(create_app(Settings(token='fixture'),transport=httpx.MockTransport(handler),now=lambda:NOW)) as client:
        body=client.get('/api/v1/search/web',params={'from':'SVO','fc':'MOW','month':'2026-10','budget':25000,'region':'russia'}).json()
        assert [o['country_code'] for o in body['offers']]==['RU'] and len(calls)==1

HOTEL_URL='https://www.aviasales.ru/hotels/search?location_id=1993&location_type=city&checkin=2026-12-26&checkout=2026-12-31&adults=1'

def test_go_accepts_aviasales_hotel_search_for_a_city_and_dates():
    app,calls=link_app(lambda request:httpx.Response(500),token='')
    with TestClient(app,follow_redirects=False) as client:
        assert client.get('/go',params={'u':HOTEL_URL,'s':'web-hotel'}).headers['location']==HOTEL_URL

@pytest.mark.parametrize('url',[
    HOTEL_URL+'&utm=x', HOTEL_URL.replace('&adults=1',''), HOTEL_URL.replace('adults=1','adults=1&adults=2'),
    HOTEL_URL.replace('checkin=2026-12-26','checkin=tomorrow'), HOTEL_URL.replace('/hotels/search','/hotels/search/x'),
    HOTEL_URL.replace('www.aviasales.ru','aviasales.ru.evil.test'), HOTEL_URL.replace('https:','http:'), HOTEL_URL+'#x',
    HOTEL_URL.replace('location_type=city','location_type=hotel')])
def test_go_rejects_other_hotel_links(url):
    app,calls=link_app(lambda request:httpx.Response(500))
    with TestClient(app,follow_redirects=False) as client:
        assert client.get('/go',params={'u':url}).status_code==422
    assert calls==[]

def test_site_is_served_without_shadowing_api():
    with TestClient(create_app(Settings(),now=lambda:NOW)) as client:
        page=client.get('/')
        assert page.status_code==200 and 'text/html' in page.headers['content-type'] and 'Aviator' in page.text
        assert client.get('/health').json()['status']=='ok'
        assert client.get('/missing-page.html').status_code==404


def test_deploy_dependencies_match_local_pins():
    import tomllib
    from pathlib import Path
    root=Path(__file__).resolve().parents[2]
    pinned=set(root.joinpath('backend/requirements.txt').read_text().split())
    deployed=tomllib.loads(root.joinpath('pyproject.toml').read_text())['project']['dependencies']
    assert {item.split('==')[0] for item in deployed}=={'fastapi','httpx','pydantic','python-dotenv','tzdata'}
    assert all(item in pinned for item in deployed if '==' in item)


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

@pytest.mark.parametrize('region,airport,accepted', [
    ('europe', 'CDG', True), ('europe', 'JFK', False), ('europe', 'LED', False),
    ('europe', 'IST', True), ('europe', 'LCA', True), ('europe', 'MSQ', False),
    ('usa', 'JFK', True), ('usa', 'LAX', True), ('usa', 'CDG', False),
    ('turkey', 'SAW', True), ('turkey', 'LCA', False),
    ('egypt', 'HRG', True), ('egypt', 'IST', False),
    ('tunisia', 'MIR', True), ('tunisia', 'CAI', False),
    ('thailand', 'BKK', True), ('thailand', 'DXB', False),
    ('uae', 'AUH', True), ('uae', 'HKT', False),
    ('asia', 'DXB', True), ('asia', 'MNL', True), ('asia', 'JFK', False),
])
def test_region_country_filter(region, airport, accepted):
    row=record(); row['destination_airport']=airport
    assert (normalize(row,QUERY.model_copy(update={'region':region}),NOW) is not None) == accepted

def test_region_invalid_value_and_destination():
    with pytest.raises(ValueError): SearchRequest(origin='SVO',month='2026-10',region='antarctica')
    with TestClient(create_app(Settings(token='test'),now=lambda:NOW)) as client:
        response=client.post('/api/v1/search',json={'origin':'SVO','month':'2026-10','region':'usa','destination':'CDG'})
        assert response.status_code == 422

def test_destination_scopes_match_web_schema_and_provider_catalog():
    root = Path(__file__).resolve().parents[2]
    module = root.joinpath('web/js/lib/destination-scopes.js').read_text(encoding='utf-8')
    web_scopes = json.loads(module.split('export const DESTINATION_SCOPES = ', 1)[1].removesuffix(';\n'))
    assert web_scopes == DESTINATION_SCOPES
    assert list(web_scopes) == list(DESTINATION_SCOPES) == SearchRequest.model_json_schema()['properties']['region']['enum']
    for scope in DESTINATION_SCOPES.values():
        assert len(set(scope['cities'])) == len(scope['cities']) <= 24
        for city in scope['cities']:
            eligible = [
                airport for airport in AIRPORTS
                if airport['city_code'] == city and airport['country_code'] in scope['countries'] and airport['timezone']
            ]
            assert eligible, city
            for airport in eligible:
                ZoneInfo(airport['timezone'])


@pytest.mark.parametrize('region,city,airport,country', [
    ('turkey', 'IZM', 'ADB', 'TR'), ('egypt', 'CAI', 'SPX', 'EG'),
    ('tunisia', 'DJE', 'DJE', 'TN'), ('asia', 'DXB', 'DWC', 'AE'),
    ('thailand', 'BKK', 'DMK', 'TH'), ('uae', 'DXB', 'DWC', 'AE'),
])
def test_new_region_web_search_targets_and_country_filter(region, city, airport, country):
    calls = []

    def handler(request):
        target = request.url.params['destination']
        calls.append(target)
        assert request.url.params['limit'] == '100'
        rows = [
            record() | {'price': 8500, 'destination': city, 'destination_airport': airport},
            record() | {'price': 8500, 'destination': city, 'destination_airport': 'LED'},
        ] if target == city else []
        return httpx.Response(200, json={'success': True, 'data': rows})

    transport = httpx.MockTransport(handler)
    with TestClient(create_app(Settings(token='fixture'), transport=transport, now=lambda: NOW)) as client:
        response = client.get('/api/v1/search/web', params={
            'from': 'SVO', 'month': '2026-10', 'budget': 25000, 'weekend': '0', 'region': region,
        })
        assert response.status_code == 200
        assert sorted(calls) == sorted(DESTINATION_SCOPES[region]['cities'])
        body = response.json()
        assert [(o['city_code'], o['destination_airport'], o['country_code']) for o in body['offers']] == [(city, airport, country)]
        assert body['offers'][0]['received_at'] == '2026-10-01T09:00:00Z'

def test_regional_search_targets_and_price_order():
    seen=[]
    def handler(request):
        target=request.url.params['destination']; seen.append(target)
        row=record(); row.update(destination_airport='JFK' if target=='NYC' else 'LAX',price='20000' if target=='NYC' else '30000')
        return httpx.Response(200,json={'success':True,'data':[row],'currency':'rub'})
    with TestClient(create_app(Settings(token='test'),transport=httpx.MockTransport(handler),now=lambda:NOW)) as client:
        q={'origin':'SVO','month':'2026-10','region':'usa','weekend_only':False,'max_budget_minor':10000000}
        data=client.post('/api/v1/search',json=q).json()
        assert 'NYC' in seen and 'LAX' in seen and 'PAR' not in seen
        assert {o['country_code'] for o in data['offers']} == {'US'}
        assert [o['price_minor'] for o in data['offers']] == sorted(o['price_minor'] for o in data['offers'])
        assert data['incomplete'] and data['warnings']
        calls=len(seen);client.post('/api/v1/search',json=dict(q,max_budget_minor=5000000))
        assert len(seen)==calls

def test_regional_search_partial_failure_keeps_results():
    def handler(request):
        if request.url.params['destination'] != 'NYC': return httpx.Response(401)
        row=record();row.update(destination_airport='JFK',price='20000')
        return httpx.Response(200,json={'success':True,'data':[row]})
    with TestClient(create_app(Settings(token='test'),transport=httpx.MockTransport(handler),now=lambda:NOW)) as client:
        data=client.post('/api/v1/search',json={'origin':'SVO','month':'2026-10','region':'usa','weekend_only':False}).json()
        assert len(data['offers'])==1 and data['incomplete']
        assert len(data['warnings'])==2


@pytest.mark.parametrize('failed', [False, True])
def test_regional_search_distinguishes_empty_from_total_failure(failed):
    def handler(request):
        if failed:
            return httpx.Response(401)
        return httpx.Response(200, json={'success': True, 'data': []})

    transport = httpx.MockTransport(handler)
    with TestClient(create_app(Settings(token='fixture'), transport=transport, now=lambda: NOW)) as client:
        response = client.get('/api/v1/search/web', params={
            'from': 'SVO', 'month': '2026-10', 'budget': 25000, 'region': 'egypt',
        })
        if failed:
            assert response.status_code == 502 and response.json()['error']['code'] == 'upstream_auth'
        else:
            assert response.status_code == 200 and response.json()['offers'] == []
            assert len(response.json()['warnings']) == 1

def test_regional_deadline_reports_timeout_without_results():
    async def handler(request):
        await asyncio.sleep(.3)
        return httpx.Response(200,json={'success':True,'data':[]})
    with TestClient(create_app(Settings(token='test',timeout=.03),transport=httpx.MockTransport(handler),now=lambda:NOW)) as client:
        response=client.post('/api/v1/search',json={'origin':'SVO','month':'2026-10','region':'usa'})
        assert response.status_code==504 and response.json()['error']['code']=='timeout'

def test_region_cache_is_separate_from_anywhere():
    seen=[]
    def handler(request):
        seen.append(request.url.params.get('destination'))
        row=record();row['price']='8500'
        return httpx.Response(200,json={'success':True,'data':[row]})
    with TestClient(create_app(Settings(token='test'),transport=httpx.MockTransport(handler),now=lambda:NOW)) as client:
        q={'origin':'SVO','month':'2026-10'}
        assert len(client.post('/api/v1/search',json=q).json()['offers'])==1
        assert client.post('/api/v1/search',json=dict(q,region='usa')).json()['offers']==[]
        assert len(seen)>1

@pytest.mark.parametrize('availability,expiry,accepted', [
    ('unavailable', None, False), ('unknown', None, True),
    ('available', NOW, False), ('available', datetime(2026, 10, 1, 10, tzinfo=timezone.utc), True),
])
def test_availability_and_price_expiry(availability, expiry, accepted):
    from app.rules import matches
    offer = normalize(record(), QUERY, NOW).model_copy(update={'availability': availability, 'expires_at': expiry})
    assert matches(offer, QUERY, NOW) == accepted


def test_segment_chronology_and_local_zones():
    from app.models import FlightSegment
    segment = dict(id='segment', origin_airport='SVO', destination_airport='EVN',
        origin_city='Москва', destination_city='Ереван', origin_name='Шереметьево', destination_name='Звартноц',
        origin_timezone='Europe/Moscow', destination_timezone='Asia/Yerevan',
        departure_at='2026-10-06T20:00:00+03:00', arrival_at='2026-10-07T00:00:00+04:00',
        operating_airline='Example Operator', marketing_airline='Example Seller')
    parsed = FlightSegment(**segment)
    assert (parsed.arrival_at - parsed.departure_at).total_seconds() == 3 * 3600
    with pytest.raises(ValueError):
        FlightSegment(**dict(segment, arrival_at='2026-10-06T19:00:00+04:00'))
    with pytest.raises(ValueError):
        FlightSegment(**dict(segment, departure_at='2026-10-06T20:00:00'))

@pytest.mark.asyncio
async def test_cache_manual_refresh_singleflight():
    cache = TTLCache()
    calls = 0
    async def load():
        nonlocal calls
        calls += 1
        await asyncio.sleep(.01)
        return calls
    assert await cache.get_or_create('route', load) == 1
    assert await cache.get_or_create('route', load) == 1
    assert await asyncio.gather(*(cache.get_or_create('route', load, refresh=True) for _ in range(3))) == [2, 2, 2]
    assert await cache.get_or_create('route', load) == 2


def test_batch_order_partial_errors_bounds_and_one_user_action():
    calls = []
    def transport(request):
        calls.append(request.url.params.get('departure_at'))
        return httpx.Response(200, json={'success': True, 'data': [], 'currency': 'rub'})
    app = create_app(Settings(token='fixture', rate=1), transport=httpx.MockTransport(transport), now=lambda: NOW)
    valid = dict(origin='SVO', month='2026-10', max_budget_minor=2500000,
                 departure_date='2026-10-06', return_date='2026-10-08', destination='LED', weekend_only=False)
    invalid = dict(valid, origin='ZZZ')
    with TestClient(app) as client:
        response = client.post('/api/v1/search/batch', json={'queries': [valid, invalid, dict(valid, departure_date='2026-10-07', return_date='2026-10-09')]})
        assert response.status_code == 200
        items = response.json()['results']
        assert items[0]['result']['offers'] == [] and items[0]['error'] is None
        assert items[1]['result'] is None and items[1]['error']
        assert items[2]['result']['offers'] == []
        assert sorted(calls) == ['2026-10-06', '2026-10-07']
        assert client.post('/api/v1/search/batch', json={'queries': [valid]}).status_code == 429
    with TestClient(create_app(now=lambda: NOW)) as client:
        assert client.post('/api/v1/search/batch', json={'queries': []}).status_code == 422
        assert client.post('/api/v1/search/batch', json={'queries': [valid] * 8}).status_code == 422


def test_force_refresh_refetches_source_without_changing_cache_key():
    calls = 0
    def transport(request):
        nonlocal calls
        calls += 1
        row = record(); row['price'] = 8500 + calls * 100
        return httpx.Response(200, json={'success': True, 'data': [row], 'currency': 'rub'})
    app = create_app(Settings(token='fixture'), transport=httpx.MockTransport(transport), now=lambda: NOW)
    query = dict(origin='SVO', month='2026-10', max_budget_minor=2500000)
    with TestClient(app) as client:
        first = client.post('/api/v1/search', json=query).json()['offers'][0]
        second = client.post('/api/v1/search', json=query).json()['offers'][0]
        fresh = client.post('/api/v1/search', json=dict(query, force_refresh=True)).json()['offers'][0]
        assert calls == 2 and first['price_minor'] == second['price_minor'] < fresh['price_minor']
        assert first['id'] == fresh['id']

@pytest.mark.parametrize('url, photo', [
    ('/?from=SVO&region=usa&city=LAS&trip=' + 'e' * 32, '/photos/LAS.jpg'),
    ('/trip.html?city=LAS&trip=' + 'e' * 32, '/photos/LAS.jpg'),
    ('/?from=SVO&to=JFK', '/photos/NYC.jpg'),
    ('/?region=usa', '/og.jpg'),
    ('/trip.html?city=INVALID', '/og.jpg'),
])
def test_destination_photo_in_initial_html(url, photo):
    with TestClient(create_app(Settings(token='test'))) as client:
        page = client.get(url, headers={'User-Agent': 'TelegramBot'})
        assert page.status_code == 200
        assert page.text.count('property="og:image"') == 1
        assert f'property="og:image" content="https://aviatour.vercel.app{photo}"' in page.text
        assert client.get(photo).headers['content-type'] == 'image/jpeg'

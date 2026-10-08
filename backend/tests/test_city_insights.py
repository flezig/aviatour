import asyncio
import copy
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import json
import httpx
import pytest
from fastapi.testclient import TestClient
from app.city_insights import CityInsights, InsightRequest, GUIDES, HDI, shopping_basket, BASKET
from app.main import create_app
from app.settings import Settings

NOW = datetime(2026, 10, 8, 10, tzinfo=timezone.utc)

def request(**changes):
    args = dict(city_code='PAR', start_date='2026-10-10', end_date='2026-10-12', citizenship='RU', residence='GE', interests=['culture', 'sea'])
    args.update(changes)
    return InsightRequest(**args)

def rows():
    result = []
    for category, (unit, _) in BASKET.items():
        for i in range(5):
            result.append(dict(id=category+str(i), date='2026-10-01', price='2.00', price_per='KILOGRAM' if unit=='kg' else 'UNIT',
                currency='EUR', price_is_discounted=False, duplicate_of=None, product_code=category+str(i),
                product=dict(categories_tags=[category], product_quantity=1, product_quantity_unit=unit),
                location_id=i%3+1, location=dict(osm_lat=48.86, osm_lon=2.35, osm_address_country_code='FR')))
    return result

def test_basket_medians_fixed_quantities_and_evidence():
    raw=rows(); value=shopping_basket(raw,GUIDES['PAR'],NOW.date())
    assert value['status']=='ok' and value['total']=='32.00'
    assert all(i['observations']==5 and i['shops']==3 for i in value['items'])
    assert value['period_start']=='2026-10-01'
    # An extreme observation does not turn the median into an arithmetic mean.
    raw[0]['price']='1000';assert shopping_basket(raw,GUIDES['PAR'],NOW.date())['total']=='32.00'

@pytest.mark.parametrize('mutation', [
    {'currency':'USD'}, {'date':'2020-01-01'}, {'date':'2027-01-01'},
    {'price_is_discounted':True}, {'price':'NaN'}, {'price':'-1'}, {'duplicate_of':5},
    {'location':{'osm_lat':0,'osm_lon':0,'osm_address_country_code':'FR'}},
    {'location':{'osm_lat':48.86,'osm_lon':2.35,'osm_address_country_code':'DE'}},
])
def test_basket_rejects_bad_observation_without_zero_total(mutation):
    raw=rows();raw[0].update(mutation)
    value=shopping_basket(raw,GUIDES['PAR'],NOW.date())
    assert value['total'] is None and value['status']=='insufficient'
    assert len(value['items'])==8

def test_basket_deduplication_and_minimum_stores():
    raw=rows();assert shopping_basket(raw+raw,GUIDES['PAR'],NOW.date())['total']=='32.00'
    for row in raw: row['location_id']=1
    assert shopping_basket(raw,GUIDES['PAR'],NOW.date())['total'] is None

@pytest.mark.asyncio
async def test_partial_failures_do_not_invent_context_or_break_other_data():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(503))) as client:
        value=await CityInsights(client,lambda:NOW).build(request())
    assert value['weather']['status']=='unavailable' and value['basket']['total'] is None
    assert value['safety']['status']=='unavailable'
    assert value['hdi']['year']==2023 and 0 < value['hdi']['value'] <= 1
    assert value['interest_score']==50 and value['entry']['status']=='unknown'
    assert value['entry']['citizenship']=='RU' and value['entry']['residence']=='GE'

@pytest.mark.asyncio
async def test_forecast_horizon_and_history_label_and_cache():
    hits=[]
    def handler(req):
        hits.append(req)
        start=req.url.params['start_date'];end=req.url.params['end_date']
        dates=[];day=datetime.fromisoformat(start).date()
        while day<=datetime.fromisoformat(end).date():dates.append(day.isoformat());day+=timedelta(days=1)
        return httpx.Response(200,json=dict(daily_units={'temperature_2m_max':'°C','temperature_2m_min':'°C','precipitation_sum':'mm'},
            daily=dict(time=dates,temperature_2m_max=[20]*len(dates),temperature_2m_min=[10]*len(dates),precipitation_sum=[0]*len(dates))))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        service=CityInsights(client,lambda:NOW)
        a=await service.weather(GUIDES['PAR'],request());b=await service.weather(GUIDES['PAR'],request())
        assert a==b and len(hits)==1 and a['kind']=='forecast' and len(a['days'])==3
        history=await service.weather(GUIDES['PAR'],request(start_date='2026-12-31',end_date='2027-01-02'))
        assert history['kind']=='historical_analogue' and history['days'][0]['date']=='2025-12-31'
        assert 'archive-api' in str(hits[-1].url)

@pytest.mark.asyncio
async def test_invalid_weather_is_unknown_and_unknown_advisory_needs_review():
    def handler(req):
        if req.url.host=='www.gov.uk':return httpx.Response(200,json={'details':{'alert_status':['new-alert'], 'parts':[]},'public_updated_at':'2026-10-01'})
        return httpx.Response(200,json={'daily':{'time':['wrong']},'daily_units':{}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        service=CityInsights(client,lambda:NOW)
        assert (await service.weather(GUIDES['PAR'],request()))['status']=='unavailable'
        assert (await service.safety(GUIDES['PAR']))['status']=='review'

@pytest.mark.asyncio
async def test_unknown_city_never_fetches_and_domestic_is_not_visa_permission():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:pytest.fail('unexpected request'))) as client:
        service=CityInsights(client,lambda:NOW)
        value=await service.build(request(city_code='XXX'))
        assert value['status']=='no_guide' and value['hdi'] is None and value['interest_score'] is None
        entry=service.entry(request(citizenship='FR'),GUIDES['PAR'])
        assert entry['status']=='citizen_destination' and 'транзита' in entry['note']

@pytest.mark.parametrize('changes',[{'citizenship':'ZZ'},{'city_code':'../'},{'end_date':'2026-10-09'}, {'interests':['unknown']}, {'end_date':'2027-12-01'}])
def test_insight_endpoint_validates_before_external_calls(changes):
    params=request().model_dump(mode='json');params.update(changes)
    with TestClient(create_app(Settings(),transport=httpx.MockTransport(lambda r:pytest.fail('unexpected request')),now=lambda:NOW)) as c:
        assert c.post('/api/v1/cities/insights',json=params).status_code==422

def test_endpoint_returns_partial_data_without_airfare_token():
    with TestClient(create_app(Settings(),transport=httpx.MockTransport(lambda r:httpx.Response(429)),now=lambda:NOW)) as c:
        response=c.post('/api/v1/cities/insights',json=request().model_dump(mode='json'))
        assert response.status_code==200
        assert response.json()['hdi']['publication']=='HDR 2025'


def test_editorial_catalog_and_official_snapshot_consistent():
    from pathlib import Path
    assert len(GUIDES)>=25
    assert GUIDES==json.loads((Path(__file__).parents[2]/'Aviator/Resources/city-guides.json').read_text())
    assert all(g['hdi_value']==HDI['values'][g['iso3']]['value'] for g in GUIDES.values())
    assert all(set(g['tags']) <= {'culture','nature','sea','food','nightlife','architecture'} for g in GUIDES.values())

@pytest.mark.asyncio
async def test_actual_fcdo_whole_country_enum_and_passport_link():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,json={'details':{'alert_status':['avoid_all_travel_to_whole_country'],'parts':[]}}))) as client:
        service=CityInsights(client,lambda:NOW)
        assert (await service.safety(GUIDES['LED']))['status']=='warning'
        entry=service.entry(request(),GUIDES['PAR'])
        assert entry['check_url'].endswith('destinations=FRA&passport=RUS')
        assert entry['status']=='unknown' # External link is not an API-confirmed result.

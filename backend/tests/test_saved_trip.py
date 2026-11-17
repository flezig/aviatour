import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.rules import safe_tour_url, safe_stay_url


def test_trip_partner_dates():
    base = 'https://experience.tripster.ru/experience/Kazan/'
    paths = {'/experience/Kazan/'}
    valid = base + '?start_date=2027-01-01&end_date=2027-01-01'
    assert safe_tour_url(valid, paths) == valid
    for other in [valid.replace('Kazan', 'Elsewhere'), valid + '&extra=1', valid.replace('01-01', '02-30'), valid + '#other']:
        with pytest.raises(ValueError):
            safe_tour_url(other, paths)
    hotel = 'https://ostrovok.ru/hotel/russia/kazan/'
    dated = hotel + '?dates=01.01.2027-02.01.2027&guests=4'
    assert safe_stay_url(dated, {hotel}) == dated
    for other in [dated.replace('02.01', '01.01'), dated + '&guests=3', dated.replace('kazan', 'another')]:
        with pytest.raises(ValueError):
            safe_stay_url(other, {hotel})


def test_weather_groups_in_city_time_and_reuses_forecast():
    calls = []
    def respond(request):
        calls.append(request)
        assert request.url.host == 'api.met.no' and 'aviatour' in request.headers['user-agent']
        rows = [{'time': t, 'data': {'instant': {'details': {'air_temperature': temp}}}} for t, temp in
                [('2026-11-17T22:00:00Z', 2), ('2026-11-18T01:00:00Z', -1)]]
        return httpx.Response(200, json={'properties': {'meta': {'updated_at':'2026-11-17T21:00:00Z'}, 'timeseries':rows}})
    with TestClient(create_app(transport=httpx.MockTransport(respond))) as client:
        path = '/api/v1/trip-weather/LED'
        assert client.get(path).json()['days'] == [{'date':'2026-11-18', 'low':-1, 'high':2}]
        assert client.get(path).status_code == 200
        assert client.get('/api/v1/trip-weather/ZZZ').json() is None
        assert len(calls) == 1

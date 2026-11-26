from datetime import UTC, datetime

from app import city_pages
from app import season_pages as season
from app.main import create_app
from fastapi.testclient import TestClient


def test_scores_keep_season_and_scope():
    assert season.CITIES.keys() == season.NORMALS.keys()
    assert all(
        season.traffic(code)[1]
        for code, city in season.CITIES.items()
        if city["country_code"] == "RU"
    )
    catalog = city_pages.load()
    for city in catalog.cities:
        values = season.monthly_scores(city["code"])
        assert len(values) == 12 and all(0 <= score <= 10 for score in values)
    for code, encoded in season.score_index().items():
        assert [int(c, 16) for c in encoded] == season.monthly_scores(code)
    assert season.monthly_scores("DXB")[0] == 10
    assert season.monthly_scores("DXB")[6] == 2
    assert season.traffic("DXB") == (
        "Объединенные Арабские Эмираты",
        [616172, 489085, 417065, 759971],
    )
    assert season.traffic("AER")[0] == "Краснодарский край"
    assert season.monthly_scores("DXB", True) != season.monthly_scores("DXB")


def test_season_pages_serve_without_fare_requests():
    with TestClient(
        create_app(now=lambda: datetime(2026, 11, 17, tzinfo=UTC))
    ) as client:
        page = client.get("/season/DXB?month=7")
        assert (
            client.get("/api/v1/season/БНГ/fares?from=SVO&fc=MOW").json()["month_fares"]
            == {}
        )
        assert page.status_code == 200 and "+41,5 °C" in page.text
        assert "Поездки граждан России в страну" in page.text
        assert 'aria-label="Январь, 10 из 10"' in page.text
        assert "united-arab-emirates/" in page.text
        assert client.get("/season/DXB?month=13").status_code == 422
        assert client.get("/season/QQ0").status_code == 404
        assert "/season/KZN?month=5" in client.get("/season/?q=Казань&month=5").text
        assert (
            'aria-current="true">Погода и турпоток'
            in client.get("/season/DXB?month=7&mode=quiet").text
        )
        assert 'id="seasonValue">—' in client.get("/season/DXB?month=1&mode=trip").text


def test_rating_directory_search_filters_and_month_links():
    with TestClient(create_app(now=lambda: datetime(2026, 11, 18, tzinfo=UTC))) as client:
        cities = client.get("/season/", params={"q": "Питер", "month": 12}).text
        assert cities.index('data-rating-city="LED"') < cities.index("Питерборо")
        moscow = client.get("/season/?q=SVO&month=12&full=1").text
        assert 'data-rating-city="MOW"' in moscow and '6,5<small>/10' in moscow
        partial = client.get("/season/?q=SAW&month=12").text
        assert "/season/IST?" in partial and 'data-rating-city="IST"' not in partial
        assert 'data-rating-city="IST"' not in client.get("/season/?q=SAW&month=12&full=1").text
        assert "/season/KZN?month=1&amp;year=2027" in client.get("/season/?q=KZN&month=1").text
        assert "Город не найден" in client.get("/season/?q=KZN&month=1&full=1").text
        first = client.get("/season/?month=12").text
        following = client.get("/season/?month=12&page=2").text
        assert "Дальше" in first and "Назад" in following and 'data-rating-city="LED"' not in following

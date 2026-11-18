from copy import deepcopy
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient

from app import city_rating as rating
from app.main import create_app

TODAY = date(2026, 11, 18)


def test_real_components_explicit_gaps_and_time_limits():
    november = rating.report("KZN", 11, None, TODAY)
    activities, costs, climate, routes = november["components"]
    assert [c["weight"] for c in november["components"]] == [35, 25, 25, 15]
    assert november["available"] == 4 and november["score"] == 7.4
    assert activities["score"] == 10 and len(activities["sources"]) == 10
    assert climate["score"] == 5.2 and "45,3 мм" in climate["detail"]
    assert routes["score"] == 10 and "20" in routes["detail"]
    assert costs["score"] == 4.3 and "184 ₽" in costs["trip_detail"]
    assert len(costs["comparison"]) == 42 and not costs["missing"]
    assert "8 034,98 ₽" in costs["detail"] and "7 286,28 ₽" in costs["detail"]
    december = rating.report("KZN", 12, 2026, TODAY)
    assert december["score"] == 7.0 and "10 784 ₽" in december["components"][1]["trip_detail"]
    assert rating.survey_cost("Казань", 2026, 12, date(2027, 1, 1)) is None
    assert rating.survey_cost("Казань", 2026, 8, TODAY) is None
    january = rating.report("KZN", 1, None, TODAY)
    assert january["year"] == 2027 and january["available"] == 3
    assert "46 ₽" not in january["components"][1]["detail"]
    assert any("тариф" in m for m in january["components"][1]["missing"])
    assert rating.report("KZN", 6, 2027, TODAY)["available"] == 1
    assert rating.report("KZN", 11, 2027, TODAY)["available"] == 1


def test_basket_uses_medians_and_requires_all_samples(monkeypatch):
    city = deepcopy(rating.EVIDENCE["KZN"])
    monkeypatch.delitem(rating.SURVEY_CITIES, "KZN")
    # Test fixture only. All amounts include fees and are in the fare currency.
    city["baskets"] = {"2026-11": {
        "hotel_weekends": {str(w): {str(i): 816 for i in range(10)} for w in range(3)},
        "meal_prices": {str(i): 250 for i in range(5)},
        "cohort_baskets": {str(i): 2000 for i in range(20)},
        "currency": "₽", "as_of": TODAY.isoformat(), "valid_until": "2026-11-30",
        "sources": [{"label": "Test sample", "url": "https://example.test"}],
    }}
    monkeypatch.setitem(rating.EVIDENCE, "KZN", city)
    complete = rating.report("KZN", 11, 2026, TODAY)
    assert complete["available"] == 4 and complete["score"] == 7.5
    assert complete["components"][1]["score"] == 5
    city["baskets"]["2026-11"]["cohort_baskets"] = {"one": 2000}
    assert rating.report("KZN", 11, 2026, TODAY)["score"] is None


def test_activity_deduplication_and_unknown_transport_are_not_zero():
    observations = rating.EVIDENCE["KZN"]["activities"]
    counts, _ = rating.activity_observations([observations[0]] * 10, 11, 2026, TODAY)
    assert sum(counts.values()) == 1
    routes = deepcopy(rating.ROUTES["KZN"])
    routes["walk_minutes"][0][0] = 50
    part = rating.mobility(routes, 11, 2026, TODAY)
    assert part["score"] is None and "2 из 20" in part["missing"][0]
    routes["transit_minutes"] = {t: [[45] * 5, [45] * 5] for t in routes["saturday_local_times"]}
    assert rating.mobility(routes, 11, 2026, TODAY)["score"] == 9


@pytest.mark.parametrize(("status", "alerts", "allowed"), [
    ("published", [], True), ("warning", ["avoid_all_travel_to_parts"], True),
    ("unavailable", [], False), ("review", [], False),
    ("warning", ["avoid_all_travel_to_whole_country"], False),
])
@pytest.mark.anyio
async def test_foreign_advisory_applies_to_complete_ratings(status, alerts, allowed):
    class Insights:
        async def safety(self, guide):
            return {"status": status, "alerts": alerts}
    data = await rating.check_advice({"code": "IST", "score": 7.2, "notice": None}, Insights())
    assert (data["score"] is not None) is allowed
    assert bool(data["notice"]) is (status != "published")


def test_api_directory_and_fallback_match():
    with TestClient(create_app(now=lambda: datetime(2026, 11, 18, tzinfo=UTC))) as client:
        index = client.get("/api/v1/city-rating-index").json()
        assert len(index) == len(rating.season.CITIES)
        assert index["KZN"][0] == "3" and index["KZN"][5] == "1"
        response = client.get("/api/v1/city-rating/KZN?month=11")
        assert response.status_code == 200 and response.json()["available"] == 4
        assert client.get("/api/v1/city-rating/БНГ?month=6").json()["available"] == 1
        assert client.get("/api/v1/city-rating/QQ0?month=6").status_code == 404
        assert client.get("/api/v1/city-rating/KZN?month=13").status_code == 422
        page = client.get("/season/KZN?month=11&year=2026&from=SVO&fc=MOW").text
        assert 'id="city-rating"' in page and "184 ₽" in page and "Сравнить расходы в 42 городах" in page
        assert 'data-rating-city="KZN"' in client.get("/season/?q=Казань&month=11").text


def test_petersburg_and_kazan_pilot_comparison():
    with TestClient(create_app(now=lambda: datetime(2026, 11, 18, tzinfo=UTC))) as client:
        for month, score in [(11, 7.7), (12, 7.5)]:
            report = client.get(f"/api/v1/city-rating/LED?month={month}&year=2026").json()
            assert (report["available"], report["score"]) == (4, score)
            assert report["components"][1]["score"] == 4.9
            assert report["components"][3]["score"] == 10
            assert "3,6–25,1 мин" in report["components"][3]["detail"]
        page = client.get("/season/LED?month=11&year=2026").text
        assert 'id="city-weekend-comparison"' in page and "Спас на Крови" in page
        assert all(s in page for s in ("7,7/10", "7,5/10", "7,4/10", "7,0/10"))
        assert 'id="city-weekend-comparison"' not in client.get("/season/LED?month=11&year=2027").text


@pytest.mark.parametrize(("month", "score"), [(11, 6.8), (12, 6.5)])
def test_moscow_weekends_with_scheduled_bus(month, score):
    report = rating.report("MOW", month, 2026, TODAY)
    assert (report["available"], report["score"]) == (4, score)
    activities, cost, _, mobility = report["components"]
    assert activities["score"] == mobility["score"] == 10
    assert cost["score"] == 1.6 and "11 658,90 ₽" in cost["detail"]
    assert "17 мин 37 с" in mobility["detail"] and "20 мин 37 с" in mobility["detail"]
    assert any("transport.mos.ru" in src["url"] for src in mobility["sources"])
    assert rating.report("MOW", month, 2027, TODAY)["score"] is None


def test_national_price_coverage_and_fixed_reference():
    costs = [rating.survey_cost(city, 2026, 11, TODAY) for city in rating.SURVEY_CITIES.values()]
    assert sum(cost["score"] is not None for cost in costs) == 93
    assert sum(cost["score"] is None for cost in costs) == 15
    assert not {"KVK", "NBC", "ЖЕЗ", "YAE", "IST"}.intersection(rating.SURVEY_CITIES)
    abakan = rating.report("ABA", 11, 2026, TODAY)["components"][1]
    assert abakan["score"] is not None and len(abakan["comparison"]) == 43
    anadyr = rating.report("DYR", 11, 2026, TODAY)["components"][1]
    assert anadyr["score"] is None and "8 750 ₽" in anadyr["detail"]
    assert anadyr["missing"] == ["Нет цены в обследовании: поездка на городском автобусе."]


def test_catalogue_comparison_search_pagination_and_partial_city():
    with TestClient(create_app(now=lambda: datetime(2026, 11, 18, tzinfo=UTC))) as client:
        directory = client.get("/season/compare/").text
        assert all(label in directory for label in ("6,8/10", "6,5/10", "7,7/10", "7,0/10", "Дальше"))
        assert "Назад" in client.get("/season/compare/?page=2").text
        partial = client.get("/season/compare/?q=Абакан").text
        assert "направлений: 1" in partial and partial.count("Данные: 2 из 4") == 2
        assert "/season/ABA?month=12&amp;year=2026#city-rating" in partial
        foreign = client.get("/season/IST?month=12&year=2026").text
        panel = foreign.split('id="city-weekend-comparison"', 1)[1].split("</section>", 1)[0]
        assert panel.count('<th scope="row">') == 4
        assert "Стамбул" in panel and panel.count("Данные: 1 из 4") == 2

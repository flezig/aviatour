from datetime import date

from app.stay_page import comparison


def test_compares_each_hotel_with_the_three_selected_places():
    page = comparison(["kremlin", "cat", "marjani"], date(2026, 11, 20))
    assert page.count("www.openstreetmap.org/directions?") == 6
    assert "≈ 38 мин суммарно" in page and "≈ 54 мин суммарно" in page
    assert page.index("Ногай") < page.index("ТатарИнн")
    assert page.count('type="checkbox"') == 5


def test_expired_routes_and_invalid_selections_do_not_produce_estimates():
    page = comparison(["marjani"], date(2027, 3, 1))
    assert "Время уточняется" in page and "мин суммарно" not in page
    for selection in ([], ["unknown"], ["cat", "kremlin", "marjani", "freedom"]):
        assert 'role="status"' in comparison(selection, date(2026, 11, 20))

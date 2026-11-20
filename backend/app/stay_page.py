"""A walk from two real Kazan hotels to the traveler's chosen places."""
from datetime import date
from math import ceil
from urllib.parse import urlencode

from . import city_rating, season_pages
from .city_pages import esc

PLACE_IDS = ("kremlin", "cat", "cathedral", "freedom", "marjani")


def comparison(selection, today):
    data = city_rating.ROUTES["KZN"]
    requested = ["kremlin", "cat", "marjani"] if selection is None else selection
    selected = [i for i, code in enumerate(PLACE_IDS) if code in requested]
    fresh = today <= date.fromisoformat(data["valid_until"])
    options = "".join(
        f'<label><input type="checkbox" name="place" value="{code}"'
        f'{" checked" if i in selected else ""}> {esc(place["name"])}</label>'
        for i, (code, place) in enumerate(zip(PLACE_IDS, data["places"]))
    )
    hotels = []
    if 1 <= len(selected) <= 3:
        for start, times in zip(data["starts"], data["walk_seconds"]):
            rows = []
            for i in selected:
                place = data["places"][i]
                points = f'{start["lat"]},{start["lon"]};{place["lat"]},{place["lon"]}'
                url = "https://www.openstreetmap.org/directions?" + urlencode({"engine": "fossgis_osrm_foot", "route": points})
                minutes = f'≈ {ceil(times[i] / 60)} мин' if fresh and times[i] is not None else "Время уточняется"
                rows.append(f'<tr><th scope="row">{esc(place["name"])}</th><td><a href="{esc(url)}">{minutes}</a></td></tr>')
            complete = fresh and all(times[i] is not None for i in selected)
            total = sum(times[i] for i in selected) if complete else float("inf")
            summary = f'≈ {ceil(total / 60)} мин суммарно' if complete else 'Полное время неизвестно'
            hotels.append((total, f'<article class="card"><p class="caption">{esc(start["area"])}</p>'
                          f'<h3><a href="{esc(start["url"])}">{esc(start["name"])}</a></h3>'
                          f'<table><caption>{summary}</caption><tbody>{"".join(rows)}</tbody></table></article>'))
        result = '<div class="stay-hotels">' + ''.join(item for _, item in sorted(hotels)) + '</div>'
    else:
        result = '<p role="status">Выберите от одного до трёх мест для сравнения.</p>'
    observed = date.fromisoformat(data["checked"]).strftime("%d.%m.%Y")
    body = (f'<div class="stay-page"><header class="page-head"><p class="label">Казань</p><h1>Где остановиться</h1>'
            '<p>Выберите до трёх мест и сравните, сколько идти от каждой гостиницы.</p></header>'
            '<form action="/stay.html" class="card"><fieldset><legend>Что хотите посетить?</legend>'
            f'<input type="hidden" name="pick" value="1">{options}</fieldset><button class="btn-primary">Сравнить гостиницы</button></form>'
            + result + '<p class="caption">Для каждого места указан отдельный путь от гостиницы в одну сторону. '
            f'Маршруты проверены {observed}. <a href="{esc(data["url"])}">FOSSGIS</a>, '
            '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>. Цены и свободные номера уточняйте на сайте гостиницы.</p></div>')
    return season_pages.layout("Где остановиться в Казани", "Две гостиницы и пешие маршруты до выбранных мест.",
                               "/stay.html", [("Aviator", "/"), ("Где остановиться в Казани", "/stay.html")], body)

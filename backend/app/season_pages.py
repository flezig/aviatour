"""Seasonal city comparison. Climate and tourist demand use offline source snapshots."""

import json
import math
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlencode

from .catalog import AIRPORTS, BY_IATA
from .city_pages import FOOT, HEAD, MONTH_NAMES, SITE, breadcrumbs, esc, group

HERE = Path(__file__).parent
NORMALS = json.loads((HERE / "season_normals.json").read_text())
FLOW = json.loads((HERE / "season_flow.json").read_text())
ADVICE = json.loads((HERE / "season_advice.json").read_text())
CITIES = {a["city_code"]: a for a in AIRPORTS if a.get("city_code") and a.get("city")}
SHORT = [
    "Янв",
    "Фев",
    "Мар",
    "Апр",
    "Май",
    "Июн",
    "Июл",
    "Авг",
    "Сен",
    "Окт",
    "Ноя",
    "Дек",
]
QUARTERS = ["Январь — март", "Апрель — июнь", "Июль — сентябрь", "Октябрь — декабрь"]
WMO = "https://www.ncei.noaa.gov/products/wmo-climate-normals"
ROS = "https://www.rosstat.gov.ru/statistics/turizm"
MFA = "https://www.kdmid.ru/docs/"
MCHS = "https://mchs.gov.ru/deyatelnost/press-centr/operativnaya-informaciya"


def tenth(value):
    return math.floor(max(0, min(10, value)) + 0.5)


def walk_score(temp, rain):
    # Editorial city-walking scale. Use unrounded components until the final result.
    thermal = max(0, 10 - max(0, 16 - temp) / 3 - max(0, temp - 25) / 1.7)
    dry = max(0, 10 - rain / 18)
    return 0.8 * thermal + 0.2 * dry


def traffic(code):
    cc = CITIES[code]["country_code"]
    domestic = cc == "RU"
    name = FLOW["regions"].get(code) if domestic else FLOW["countries"].get(cc)
    counts = FLOW["regional" if domestic else "outbound"].get(name)
    return (name, counts) if counts else (None, None)


def monthly_scores(code, quiet=False):
    normal = NORMALS.get(code)
    if not normal:
        return []
    _, counts = traffic(code)
    scores = [
        walk_score(t, p) for t, p in zip(normal["temperature"], normal["precipitation"])
    ]
    if quiet and counts:
        # Reference is the busiest quarter. A half-sized flow earns five points.
        scores = [
            0.7 * s + 0.3 * 10 * (1 - counts[i // 3] / max(counts))
            for i, s in enumerate(scores)
        ]
    return [tenth(s) for s in scores]


@lru_cache(maxsize=1)
def score_index():
    return {
        code: "".join(format(n, "x") for n in monthly_scores(code)) for code in NORMALS
    }


def link(code, month, origin=None, mode=None, year=None):
    query = {"month": month}
    if year is not None:
        query["year"] = year
    if mode in ("quiet", "trip"):
        query["mode"] = mode
    if origin:
        query["from"] = origin["iata"]
        if origin["all"]:
            query["fc"] = origin["code"]
    return "/season/" + code + "?" + urlencode(query)


def layout(title, description, path, crumbs, main, script="/js/site.js"):
    ld, visible = breadcrumbs(crumbs)
    return (
        HEAD.format(
            title=esc(title + " · Aviator"),
            description=esc(description),
            url=esc(SITE + path),
            image=SITE + "/og.jpg",
            robots="",
            ld=ld,
            cities_current="",
        )
        + f'<main id="main" class="wrap season-page">{visible}{main}</main>'
        + FOOT.format(dialog="", script=script)
    )


def directory(catalog, month, query):
    from .city_rating import badge

    def norm(s):
        return s.casefold().replace("ё", "е").strip()

    needle = norm(query)
    matched_airport = BY_IATA.get(query.strip().upper(), {}).get("city_code")
    codes = [
        c
        for c, a in CITIES.items()
        if needle in norm(a["city"]) or needle in c.lower() or c == matched_airport
    ]
    codes.sort(
        key=lambda c: (
            not norm(CITIES[c]["city"]).startswith(needle),
            c not in catalog.by_code,
            c not in NORMALS,
            CITIES[c]["city"],
            c,
        )
    )
    items = "".join(
        f'<li><a class="season-city-link" href="{esc(link(c, month))}"><span><b>{esc(CITIES[c]["city"])}</b>'
        f"<small>{esc(CITIES[c]['country'])} · {c}</small></span></a>{badge(c, month)}</li>"
        for c in codes[:60]
    )
    options = "".join(
        f'<option value="{i}"{" selected" if i == month else ""}>{n}</option>'
        for i, n in enumerate(MONTH_NAMES, 1)
    )
    body = f'''<header class="page-head"><h1>Сезонный рейтинг городов</h1><p>Выберите город и месяц, чтобы узнать, какая погода обычно бывает во время поездки.</p></header>
<form class="season-find" action="/season/"><label>Город или код аэропорта<input type="search" name="q" maxlength="100" value="{esc(query)}" placeholder="Например, Казань или DXB"></label>
<label>Месяц<select name="month">{options}</select></label><button class="btn-inline" type="submit">Найти</button></form>
<h2>{"Результаты поиска" if query else "Города"} · {MONTH_NAMES[month - 1].lower()}</h2><ul class="season-directory">{items}</ul>
{("<p>Уточните название города, чтобы сузить список.</p>" if len(codes) > 60 else "") if codes else "<p>Такого города в справочнике пока нет.</p>"}'''
    return layout(
        "Сезонный рейтинг городов",
        "Погода для прогулок, турпоток и цены по месяцам.",
        "/season/",
        [("Aviator", "/"), ("Города", "/city/"), ("Сезонный рейтинг", "/season/")],
        body,
    )


def source_info(n):
    if n["source"] == "NOAA CPC":
        return (
            "Ячейка сетки NOAA CPC (0,5°)",
            "https://psl.noaa.gov/data/gridded/data.cpc.globaltemp.html",
        )
    if n["source"] == "NASA POWER":
        return (
            "Расчёт по ячейке сетки NASA MERRA-2",
            "https://power.larc.nasa.gov/docs/services/api/temporal/daily/",
        )
    if n["source"] == "Meteostat":
        return (
            f"Станция {n['name']} · {n['km']} км от координат города · Meteostat (CC BY 4.0)",
            "https://meteostat.net/en/station/" + n["id"],
        )
    return f"Станция {n['name']} · {n['km']} км от координат города · ВМО", WMO


def city_page(catalog, code, month, requested_mode, origin, rating, year, today):
    from .city_rating import badge, report_html

    city = CITIES[code]
    title, cc = city["city"], city["country_code"]
    idx, quarter = month - 1, (month - 1) // 3
    official = catalog.by_code.get(code)
    name, counts = traffic(code)
    mode = requested_mode if counts and requested_mode in ("trip", "quiet") else "walk"
    trip = mode == "trip"
    quiet = mode == "quiet"
    normal = NORMALS.get(code)
    scores = monthly_scores(code, quiet)
    back = f'<a href="/city/{esc(official["slug"])}">О городе</a>' if official else ""
    tabs = f'<nav class="season-tabs" aria-label="Разделы города">{back}<a aria-current="page" href="{esc(link(code, month, origin, mode, year))}">Сезонный рейтинг</a></nav>'
    choice = ""
    if counts and scores:
        choice = (
            '<nav class="season-mode" aria-label="Что важнее">'
            + "".join(
                f'<a href="{esc(link(code, month, origin, v, year))}"'
                + (' aria-current="true"' if v == mode else "")
                + f">{s}</a>"
                for v, s in [
                    ("walk", "Для прогулок"),
                    ("quiet", "Погода и турпоток"),
                    ("trip", "С учётом перелёта"),
                ]
            )
            + "</nav>"
        )
    mode_name = {
        "walk": "Погода для прогулок",
        "quiet": "Погода и турпоток",
        "trip": "Поездка с перелётом",
    }[mode]
    value = f"{scores[idx]}<small>/10</small>" if scores and not trip else "—"
    chart = (
        "".join(
            f'<a href="{esc(link(code, i + 1, origin, mode, year))}" aria-label="{n}, {scores[i]} из 10"'
            + (' aria-current="date"' if i == idx else "")
            + f'><span>{SHORT[i]}</span><svg aria-hidden="true" viewBox="0 0 12 40"><rect x="1" y="{36 - scores[i] * 3}" width="10" height="{4 + scores[i] * 3}" rx="2"/></svg><b>{scores[i]}</b></a>'
            for i, n in enumerate(MONTH_NAMES)
        )
        if scores and not trip
        else "".join(
            f'<a href="{esc(link(code, i + 1, origin, mode, year))}"'
            + (' aria-current="date"' if i == idx else "")
            + f">{s}</a>"
            for i, s in enumerate(SHORT)
        )
    )
    if normal:
        temp, precip = normal["temperature"][idx], normal["precipitation"][idx]
        src, url = source_info(normal)
        temp_label = f"{temp:+g}".replace(".", ",") + " °C"
        climate = f'''<article><h2>Погода днём</h2><strong>{temp_label}</strong><p>Средний дневной максимум. Осадки за месяц — {str(precip).replace(".", ",")} мм.</p>
        <small>1991–2020 · <a href="{esc(url)}">{esc(src)}</a></small></article>'''
        note = (
            "Обычно жарко для долгой прогулки."
            if temp > 30
            else "Днём часто нужна тёплая одежда."
            if temp < 10
            else "Обычно прохладно для долгой прогулки."
            if temp < 16
            else "Днём обычно тепло."
        )
        if precip >= 120:
            note += " На этот месяц приходится много осадков."
    else:
        climate = "<article><h2>Погода днём</h2><p>Для этого города пока нет полного климатического ряда.</p></article>"
        note = "Пока недостаточно данных для балла."
    if counts:
        percent = round(counts[quarter] / sum(counts) * 100)
        scope = (
            "Туристские поездки по региону"
            if cc == "RU"
            else "Поездки граждан России в страну"
        )
        area = {"г.Москва": "Москва", "г.Санкт-Петербург": "Санкт-Петербург"}.get(
            name, name
        )
        demand = f'''<article><h2>Туристический спрос</h2><strong>{percent}% годового потока</strong><p>{QUARTERS[quarter]} 2025 · {group(counts[quarter])} поездок. {scope} · {esc(area)}.</p>
        <small><a href="{ROS}">Росстат</a> · доля поездок за квартал. Очереди в городе в эту статистику не входят.</small></article>'''
    else:
        demand = "<article><h2>Туристический спрос</h2><p>Сопоставимых данных о поездках за квартал пока нет.</p></article>"
    advice = ADVICE.get(cc, {})
    safe_url = (
        MCHS if cc == "RU" else MFA + (advice["mid"] + "/" if advice.get("mid") else "")
    )
    safe_label = (
        "Оперативная информация МЧС России" if cc == "RU" else "Информация МИД России"
    )
    safety = f'''<article><h2>Безопасность</h2><p id="seasonSafety">Перед поездкой проверьте действующие предупреждения по направлению.</p><small><a href="{esc(safe_url)}">{safe_label}</a></small></article>'''
    price_text = "Проверяем цены Aviasales…"
    fare = f'<article><h2>Билеты туда и обратно</h2><strong id="seasonPrice" aria-live="polite"></strong><p id="seasonFareNote">{price_text}</p><small id="seasonFareLink"></small></article>'
    hero = (
        f'<img src="/photos/s/{code}.webp" width="260" height="168" alt="">'
        if official and official.get("photo")
        else ""
    )
    body = f'''{tabs}<header class="season-heading"><div><p>{esc(city["country"])} · {code}</p><h1>{esc(title)}</h1>{badge(code, month, origin, rating["year"], checked_report=rating)}</div>{hero}</header>
<section class="season-panel" id="season" data-code="{code}" data-month="{month}" data-domestic="{int(cc == "RU")}" data-mode="{mode}" data-walk="{esc(json.dumps([walk_score(t, p) for t, p in zip(normal["temperature"], normal["precipitation"])] if normal else []))}" data-counts="{esc(json.dumps(counts or []))}" data-fcdo="{int(bool(advice.get("fcdo")) and cc != "RU")}" data-origin="{esc(origin["iata"])}" data-all="{esc(origin["code"] if origin["all"] else "")}">
{choice}<div class="season-summary"><div><p>{esc(mode_name)} · {MONTH_NAMES[idx].lower()}</p><h2 id="seasonVerdict" aria-live="polite">{"Проверяем цены и сведения по направлению…" if trip else esc(note)}</h2></div><strong id="seasonValue">{value}</strong></div>
<nav class="season-months" aria-label="Сравнить месяцы">{chart}</nav></section>
<div class="season-facts">{climate}{demand}{fare}{safety}</div>
{report_html(rating, today, origin)}
<details class="season-method"><summary>Как сравниваются сезоны</summary><p>Шкала Aviator рассчитана на прогулки по городу. Температура даёт 80% балла, месячная сумма осадков — 20%. Для пляжа и горнолыжных трасс условия могут отличаться.</p>
<p>От 16 до 25 °C температура получает 10 баллов. За каждые 3 °C ниже или 1,7 °C выше снимаем один балл. За каждые 18 мм осадков за месяц снимаем один из 10 баллов. Минимум каждого показателя — ноль. Итог округляем один раз.</p>
<p>В режиме «Погода и турпоток» погода даёт 70%, спрос — 30%. Балл спроса равен десяти, умноженным на долю снижения числа поездок относительно самого загруженного квартала 2025 года. Меньший поток повышает оценку. </p><p>В режиме «С учётом перелёта» погода даёт 50%, турпоток — 20%, цена — 30%. Сравниваем найденные цены за три или больше месяцев на одном маршруте. Медиана получает 5 баллов, цена на 50% дешевле — 10, на 50% дороже — ноль. При отсутствии цены или серьёзном предупреждении по всей стране итог скрывается. Официальные предупреждения о безопасности проверяйте перед покупкой.</p></details>
<a class="btn-inline" href="/season/?month={month}">Проверить другой город</a>'''
    path = "/season/" + code
    return layout(
        title + " · сезонный рейтинг",
        "Сравните месяцы для прогулок, туристический спрос и стоимость перелёта.",
        path,
        [("Aviator", "/"), ("Сезонный рейтинг", "/season/"), (title, path)],
        body,
        "/js/season.js",
    )

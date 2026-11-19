"""Seasonal city comparison. Climate and tourist demand use offline source snapshots."""

import json
import math
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlencode

from .catalog import AIRPORTS, BY_IATA
from .city_pages import FOOT, HEAD, MONTH_NAMES, SITE, breadcrumbs, esc, group, slug

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


# Published city photos have varying dimensions. The shared default cover is 1200 × 630.
PHOTO_HEAD = '\n'.join(line for line in HEAD.splitlines()
                      if '"og:image:width"' not in line and '"og:image:height"' not in line)


def layout(title, description, path, crumbs, main, script="/js/site.js", photo=None):
    ld, visible = breadcrumbs(crumbs)
    head = PHOTO_HEAD if photo else HEAD
    return (
        head.format(
            title=esc(title + " — Aviator"),
            description=esc(description),
            url=esc(SITE + path),
            image=SITE + (f"/photos/{photo}.jpg" if photo else "/og.jpg"),
            robots="",
            ld=ld,
            cities_current="",
        )
        + f'<main id="main" class="wrap season-page">{visible}{main}</main>'
        + FOOT.format(dialog="", script=script)
    )


def search_term(value):
    return " ".join(value.casefold().replace("ё", "е").replace("-", " ").split())


CITY_SEARCH_ALIASES = {
    "LED": ("питер", "спб", "петербург", "saint petersburg", "pulkovo"),
    "KZN": ("kazan", "казани"), "MOW": ("moscow", "москве"), "IST": ("istanbul", "стамбуле"),
}


@lru_cache(maxsize=1)
def city_search_terms():
    terms = {c: [a["city"], c, slug(a["city"]), *CITY_SEARCH_ALIASES.get(c, ())]
             for c, a in CITIES.items()}
    for airport in AIRPORTS:
        if airport["city_code"] in terms:
            terms[airport["city_code"]].extend((airport["iata"], airport["name"] or ""))
    return {c: search_term(" ".join(words)) for c, words in terms.items()}


def matching_codes(query):
    needle = search_term(query)
    if not needle:
        return list(CITIES)
    return [c for c, terms in city_search_terms().items() if needle in terms]


def directory(catalog, month, query, today, photos, full=False, page=1, checked=None):
    from .city_rating import badge, coverage_index, target_year

    year = target_year(month, None, today)
    coverage = coverage_index(year, today)
    checked = checked or {}
    codes = matching_codes(query)
    if full:
        codes = [c for c in codes if coverage[c][month - 1] == "4"
                 and (CITIES[c]["country_code"] == "RU" or checked.get(c, {}).get("score") is not None)]
    airport_match = BY_IATA.get(query.strip().upper(), {}).get("city_code")
    needle = search_term(query)
    featured = ("LED", "KZN", "MOW", "IST")
    codes.sort(key=lambda c: (
        bool(needle) and c != airport_match and needle not in (c.lower(), search_term(CITIES[c]["city"]), *CITY_SEARCH_ALIASES.get(c, ())),
        bool(needle) and not search_term(CITIES[c]["city"]).startswith(needle),
        featured.index(c) if c in featured else len(featured),
        -int(coverage[c][month - 1]), c not in photos, c not in catalog.by_code,
        CITIES[c]["city"], c,
    ))
    page_size = 24
    pages = max(1, math.ceil(len(codes) / page_size))
    page = min(page, pages)
    items = []
    for code in codes[(page - 1) * page_size:page * page_size]:
        city = CITIES[code]
        url = esc(link(code, month, year=year))
        photo = (f'<img src="/photos/s/{esc(code)}.webp" alt="" width="320" height="155" loading="lazy">'
                 if code in photos else "")
        items.append(f'<article class="rating-tile"><a class="rating-tile-city" href="{url}">{photo}'
                     f'<h2>{esc(city["city"])}</h2></a><p>{esc(city["country"])}, {esc(code)}</p>'
                     f'{badge(code, month, year=year, today=today, checked_report=checked.get(code))}</article>')
    params = {"month": month}
    if query:
        params["q"] = query
    if full:
        params["full"] = 1
    navigation = []
    for target, label in ((page - 1, "Назад"), (page + 1, "Дальше")):
        if 1 <= target <= pages:
            href = "/season/?" + urlencode({**params, "page": target})
            navigation.append(f'<a href="{esc(href)}">{label}</a>')
    options = "".join(
        f'<option value="{i}"{" selected" if i == month else ""}>{name} {target_year(i, None, today)}</option>'
        for i, name in enumerate(MONTH_NAMES, 1)
    )
    results = ('<div class="rating-tiles">' + "".join(items) + '</div>') if items else (
        '<div class="rating-empty"><h2>Город не найден</h2><p>'
        + ("Попробуйте снять фильтр общей оценки или изменить запрос." if full
           else "Попробуйте название города или код аэропорта.")
        + f'</p><a href="/season/?month={month}">Сбросить поиск</a></div>')
    pagination = (f'<nav class="rating-pages" aria-label="Страницы каталога"><span>{page} из {pages}</span>'
                  + "".join(navigation) + '</nav>') if pages > 1 else ""
    body = f'''<header class="rating-directory-head"><p id="rating-period">{MONTH_NAMES[month - 1]} {year}</p>
<h1>Рейтинги городов</h1></header><div class="rating-directory">
<section aria-label="Поиск по городам"><form class="rating-filters" action="/season/">
<label class="rating-query"><svg class="icon" aria-hidden="true"><use href="/icons.svg#search"></use></svg>
<span class="sr-only">Город или код аэропорта</span><input type="search" name="q" maxlength="100" value="{esc(query)}" placeholder="Город или код аэропорта"></label>
<label><span class="sr-only">Месяц</span><select name="month">{options}</select></label>
<label class="rating-only"><input type="checkbox" name="full" value="1"{" checked" if full else ""}>Только с общей оценкой</label>
<button type="submit" class="btn-inline">Найти город</button></form>
<div id="rating-results"><p class="sr-only" role="status">Найдено городов: {len(codes)}</p>{results}{pagination}</div></section>
<aside class="rating-slot" aria-label="Подробности рейтинга"></aside></div>
<a class="rating-compare-link" href="/season/compare/">Сравнить города за ноябрь и декабрь 2026</a>'''
    return layout("Рейтинги городов", "Рейтинг на выходные по городу и месяцу, цены, погода и источники.",
                  "/season/", [("Aviator", "/"), ("Города", "/city/"), ("Рейтинги городов", "/season/")], body,
                  script="/js/rating-directory.js")


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
            f"Станция {n['name']}, в {n['km']} км от координат города, Meteostat (CC BY 4.0)",
            "https://meteostat.net/en/station/" + n["id"],
        )
    return f"Станция {n['name']}, в {n['km']} км от координат города, ВМО", WMO


def city_page(catalog, code, month, requested_mode, origin, rating, year, today, other_month, *, photo=False):
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
        <small>Нормы за 1991–2020 годы. <a href="{esc(url)}">{esc(src)}</a></small></article>'''
        note = f"Средний дневной максимум {temp_label}"
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
        demand = f'''<article><h2>Туристический спрос</h2><strong>{percent}% годового потока</strong><p>{QUARTERS[quarter]} 2025 года — {group(counts[quarter])} поездок. {scope} ({esc(area)}).</p>
        <small>Доля поездок за квартал по данным <a href="{ROS}">Росстата</a>. Очереди в городе в эту статистику не входят.</small></article>'''
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
    body = f'''{tabs}<header class="season-heading"><div><p>{esc(city["country"])}, {code}</p><h1>{esc(title)}</h1>{badge(code, month, origin, rating["year"], checked_report=rating)}</div>{hero}</header>
<section class="season-panel" id="season" data-code="{code}" data-month="{month}" data-domestic="{int(cc == "RU")}" data-mode="{mode}" data-walk="{esc(json.dumps([walk_score(t, p) for t, p in zip(normal["temperature"], normal["precipitation"])] if normal else []))}" data-counts="{esc(json.dumps(counts or []))}" data-fcdo="{int(bool(advice.get("fcdo")) and cc != "RU")}" data-origin="{esc(origin["iata"])}" data-all="{esc(origin["code"] if origin["all"] else "")}">
{choice}<div class="season-summary"><div><p>{esc(mode_name)}, {MONTH_NAMES[idx].lower()}</p><h2 id="seasonVerdict" aria-live="polite">{"Проверяем цены и сведения по направлению…" if trip else esc(note)}</h2></div><strong id="seasonValue">{value}</strong></div>
<nav class="season-months" aria-label="Сравнить месяцы">{chart}</nav></section>
<div class="season-facts">{climate}{demand}{fare}{safety}</div>
{report_html(rating, today, origin, other_month)}
<details class="season-method"><summary>Как сравниваются сезоны</summary><p>Шкала Aviator рассчитана на прогулки по городу. Температура даёт 80% балла, месячная сумма осадков — 20%. Для пляжа и горнолыжных трасс условия могут отличаться.</p>
<p>От 16 до 25 °C температура получает 10 баллов. За каждые 3 °C ниже или 1,7 °C выше снимаем один балл. За каждые 18 мм осадков за месяц снимаем один из 10 баллов. Минимум каждого показателя — ноль. Итог округляем один раз.</p>
<p>В режиме «Погода и турпоток» погода даёт 70%, спрос — 30%. Балл спроса равен десяти, умноженным на долю снижения числа поездок относительно самого загруженного квартала 2025 года. Меньший поток повышает оценку. </p><p>В режиме «С учётом перелёта» погода даёт 50%, турпоток — 20%, цена — 30%. Сравниваем найденные цены за три или больше месяцев на одном маршруте. Медиана получает 5 баллов, цена на 50% дешевле — 10, на 50% дороже — ноль. При отсутствии цены или серьёзном предупреждении по всей стране итог скрывается. Официальные предупреждения о безопасности проверяйте перед покупкой.</p></details>
<a class="btn-inline" href="/season/?month={month}">Проверить другой город</a>'''
    path = "/season/" + code
    return layout(
        title + ": сезонный рейтинг",
        "Сравните месяцы для прогулок, туристический спрос и стоимость перелёта.",
        path,
        [("Aviator", "/"), ("Сезонный рейтинг", "/season/"), (title, path)],
        body,
        "/js/season.js",
        photo=code if photo else None,
    )

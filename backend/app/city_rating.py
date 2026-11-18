"""Monthly city-weekend rating. Incomplete observations never acquire a score."""
import calendar
import json
import math
from collections import Counter
from datetime import date
from functools import lru_cache
from statistics import median

from . import season_pages as season
from .city_insights import GUIDES
from .city_pages import MONTH_NAMES, esc

CATEGORIES = {
    "museums": "музеи и выставки", "history": "архитектура и история",
    "nature": "парки и природа", "food": "местная кухня и рынки", "stage": "сцена и события",
}
WEIGHTS = {"activities": 35, "cost": 25, "climate": 25, "mobility": 15}
LABELS = {"activities": "Чем заняться", "cost": "Расходы на месте",
          "climate": "Комфорт сезона", "mobility": "Передвижение"}


def load_snapshot(name):
    return json.loads((season.HERE / name).read_text())


def target_year(month, year, today):
    return year if year is not None else today.year + (month < today.month)


def applicable(record, month, year, today):
    checked = date.fromisoformat(record["checked"])
    until = date.fromisoformat(record["valid_until"])
    last = date(year, month, calendar.monthrange(year, month)[1])
    start = date.fromisoformat(record.get("valid_from", record["checked"]))
    if not (checked <= today <= until and start <= last and last >= date(today.year, today.month, 1)):
        return False
    dates = record.get("weekend_dates")
    if dates is not None:
        return any(d.startswith(f"{year:04}-{month:02}-") and d >= today.isoformat() for d in dates)
    return last <= until


def number(value):
    return f"{value:g}".replace(".", ",")


def result(key, score=None, detail="", missing=(), sources=()):
    return dict(key=key, label=LABELS[key], weight=WEIGHTS[key], score=score,
                detail=detail, missing=list(missing), sources=list(sources))


def source(label, url):
    return {"label": label, "url": url}


def activity_observations(records, month, year, today):
    seen = set()
    counts = Counter()
    items = []
    for item in records:
        category = item["category"]
        name = item["name"]
        if (month in item["months"] and applicable(item, month, year, today)
                and name not in seen and counts[category] < 2):
            seen.add(name)
            counts[category] += 1
            items.append(item)
    return counts, items


def activities(code, evidence, month, year, today):
    counts, items = activity_observations(evidence.get("activities", []), month, year, today)
    audits = [a for a in evidence.get("category_reviews", [])
              if month in a["months"] and applicable(a, month, year, today)]
    reviewed = {a["category"] for a in audits}
    # Two verified venues in every category attain the cap without assuming an
    # unlisted venue is closed. An incomplete inventory cannot establish a lower score.
    missing_categories = [label for key, label in CATEGORIES.items() if counts[key] < 2 and key not in reviewed]
    links = [source(i["name"], i["url"]) for i in items]
    links.extend(source(a["source"], a["url"]) for a in audits)
    if items or audits:
        checked = min(i["checked"] for i in items + audits)
        detail = f"Подтверждено занятий: {len(items)}. По одному баллу за место, до двух в каждой из пяти категорий. Проверка расписаний от {checked}."
    else:
        guide = GUIDES.get("GYD" if code == "BAK" else code, {})
        places = guide.get("places", [])
        if places:
            detail = "В городском гиде есть " + ", ".join(places) + ". Доступность по выходным в выбранном месяце требует проверки."
            links = [source("Городской гид · " + guide["editorial_updated"], guide["tourism_url"])]
        else:
            detail = "Проверяем, куда можно сходить в городе в обычные выходные."
    missing = ["Нужны подтверждённые расписания по категориям: " + ", ".join(missing_categories) + "."] if missing_categories else []
    return result("activities", None if missing else len(items), detail, missing, links)


def costs(evidence, month, year, today):
    detail = "Корзина на человека: две ночи, четыре приёма пищи и четыре поездки по городу."
    # Reviewed price sets share one currency, collection date and comparison cohort.
    sample = evidence.get("baskets", {}).get(f"{year:04}-{month:02}", {})
    if sample and not (sample.get("sources") and sample.get("as_of") and sample["as_of"] <= today.isoformat()
                       <= sample.get("valid_until", "")):
        sample = {}
    fare = evidence.get("fare", {})
    missing, links = [], list(sample.get("sources", []))
    stays = [median(prices.values()) for prices in sample.get("hotel_weekends", {}).values()
             if len(prices) >= 10 and all(price > 0 for price in prices.values())]
    if len(stays) < 3:
        missing.append("Цены номеров в десяти гостиницах на каждые из трёх выходных.")
    meals = sample.get("meal_prices", {})
    if len(meals) < 5 or not all(price > 0 for price in meals.values()):
        missing.append("Цены блюд в пяти заведениях или сопоставимые городские данные о питании.")
    if fare.get("year") == year and fare["checked"] <= today.isoformat():
        price = fare["amount"]
        detail += f' Тариф {year} года — {number(price)} {fare["currency"]} за поездку, {number(price * 4)} {fare["currency"]} за четыре.'
        detail += " " + fare["note"]
        links.append(source(fare["source"], fare["url"]))
        if sample and sample["currency"] != fare["currency"]:
            missing.append("Пересчёт проезда в валюту сравнения на дату сбора.")
    else:
        missing.append("Подтверждённый городской тариф на выбранный год.")
    cohort = sample.get("cohort_baskets", {})
    if len(cohort) < 20 or not all(price > 0 for price in cohort.values()):
        missing.append("Сопоставимые корзины минимум для 20 городов за тот же месяц.")
    score = None
    if not missing:
        basket = median(stays) + 4 * median(meals.values()) + 4 * price
        reference = median(cohort.values())
        score = min(10, max(0, 5 + 5 * math.log2(reference / basket)))
        detail += (f' Корзина — {number(basket)} {sample["currency"]}, медиана сравнения — '
                   f'{number(reference)} {sample["currency"]} ({len(cohort)} городов, {sample["as_of"]}).')
    part = result("cost", score, detail, missing, links)
    if len(stays) < 3 and len(meals) < 5:
        part["gap"] = "Нет сопоставимых цен на жильё и питание."
    return part


def climate(code, month):
    normal = season.NORMALS.get(code)
    if not normal:
        return result("climate", missing=["Средний дневной максимум температуры и сумма осадков за месяц."])
    temp = normal["temperature"][month - 1]
    rain = normal["precipitation"][month - 1]
    label, url = season.source_info(normal)
    detail = (f'Днём {"+" if temp > 0 else ""}{number(temp)} °C · {number(rain)} мм осадков за месяц. '
              'Нормы 1991–2020. Температура даёт 80% оценки, осадки — 20%.')
    return result("climate", season.walk_score(temp, rain), detail, sources=[source(label, url)])


def mobility(routes, month, year, today):
    detail = "Два района проживания, пять мест, суббота в 10:00 и 15:00. Учитываем путь пешком или на транспорте с ожиданием."
    if not routes or not applicable(routes, month, year, today):
        return result("mobility", detail=detail, missing=["Время в пути по 20 маршрутам в выбранном месяце."])
    checks = []
    for slot in routes["saturday_local_times"]:
        transit = routes.get("transit_minutes", {}).get(slot)
        for i, row in enumerate(routes["walk_minutes"]):
            for j, walk in enumerate(row):
                ride = transit[i][j] if transit else None
                if walk is not None and walk <= 30:
                    checks.append(True)
                elif ride is not None and (ride <= 30 or walk is not None):
                    checks.append(ride <= 30)
    count = sum(checks)
    areas = " и ".join(p["area"] for p in routes["starts"])
    detail = (f'Исторический центр · {areas}. Из двух отелей до пяти мест за 30 минут '
              f'можно добраться в {count} из 20 случаев. Модель на субботу в 10:00 и 15:00, '
              f'при открытом проходе, без учёта погоды. Проверено {routes["checked"]}.')
    links = [source("Расчёт маршрутов OSRM", routes["url"]),
             source("© Участники OpenStreetMap", routes["attribution_url"]),
             source("Исправить карту", routes["map_feedback_url"])]
    missing = [] if len(checks) == 20 else [f"Время пути с учётом транспорта для {20 - len(checks)} из 20 маршрутов."]
    return result("mobility", count / 2 if not missing else None, detail, missing, links)


def available_score(components):
    if any(c["score"] is None for c in components):
        return None
    total = sum(c["score"] * c["weight"] / 100 for c in components)
    return math.floor(total * 10 + 0.5) / 10


def report(code, month, year, today):
    evidence = EVIDENCE.get(code, {})
    year = target_year(month, year, today)
    components = [activities(code, evidence, month, year, today),
                  costs(evidence, month, year, today), climate(code, month),
                  mobility(ROUTES.get(code), month, year, today)]
    score = available_score(components)
    for c in components:
        if c["score"] is not None:
            c["score"] = math.floor(c["score"] * 10 + 0.5) / 10
    return dict(city=season.CITIES[code]["city"], code=code, month=month, year=year, score=score,
                available=sum(c["score"] is not None for c in components), components=components, notice=None)


async def check_advice(data, insights):
    cc = season.CITIES[data["code"]]["country_code"]
    if data["score"] is None or cc == "RU":
        return data
    slug = season.ADVICE.get(cc, {}).get("fcdo")
    advice = await insights.safety({"advice_slug": slug}) if slug else {}
    alerts = advice.get("alerts", [])
    if advice.get("status") == "published":
        return data
    if advice.get("status") == "warning" and alerts:
        if all(a.endswith("_to_parts") for a in alerts):
            data["notice"] = "Есть предупреждение британского МИД для отдельных районов. Сверьте его с маршрутом поездки."
            return data
        data["notice"] = "Общий балл скрыт. Действует предупреждение британского МИД по направлению."
    else:
        data["notice"] = "Общий балл скрыт. Не удалось проверить предупреждения по стране."
    data["score"] = None
    return data


@lru_cache(maxsize=16)
def coverage_index(year, today):
    # The climate snapshot covers the catalogue. Only cities with reviewed evidence
    # need twelve detailed calculations. No external requests on listing pages.
    counts = {code: ("1" if code in season.NORMALS else "0") * 12 for code in season.CITIES}
    for code in EVIDENCE.keys() | ROUTES.keys():
        if code in counts:
            counts[code] = "".join(str(report(code, m, year, today)["available"]) for m in range(1, 13))
    return counts


def badge(code, month, origin=None, year=None, today=None, checked_report=None):
    if code not in season.CITIES:
        return ""
    today = today or date.today()
    value = coverage_index(year, today)[code][month - 1]
    numeric = None
    if checked_report is not None:
        numeric = checked_report["score"]
        value = str(checked_report["available"])
    elif value == "4" and season.CITIES[code]["country_code"] == "RU":
        numeric = report(code, month, year, today)["score"]
    display = f"{number(numeric)}<small>/10</small>" if numeric is not None else f"{value} из 4"
    year_attr = f' data-rating-year="{year}"' if year is not None else ""
    href = season.link(code, month, origin, year=year) + "#city-rating"
    return (f'<a class="city-rating" data-rating-city="{esc(code)}" data-rating-month="{month}"{year_attr} '
            f'data-rating-name="{esc(season.CITIES[code]["city"])}" href="{esc(href)}">'
            '<svg class="icon" aria-hidden="true"><use href="/icons.svg#plane"></use></svg>'
            '<span class="city-rating-label">Рейтинг города</span>'
            f'<span class="city-rating-value">{display}</span>'
            '<svg class="icon" aria-hidden="true"><use href="/icons.svg#chevron-down"></use></svg></a>')


def report_html(data):
    def row(c):
        score = f'{number(c["score"])}/10' if c["score"] is not None else "Недостаточно данных"
        links = " · ".join(f'<a href="{esc(s["url"])}">{esc(s["label"])}</a>' for s in c["sources"])
        missing = " ".join(c["missing"])
        return (f'<div><dt>{esc(c["label"])} · {c["weight"]}% · {score}</dt><dd>{esc(c["detail"])}'
                + (f' {esc(missing)}' if missing else "") + (f'<p>{links}</p>' if links else "") + '</dd></div>')
    verdict = (f'Общий балл {number(data["score"])}/10' if data["score"] is not None
               else f'Показателей с оценкой: {data["available"]} из 4')
    rows = "".join(row(c) for c in data["components"])
    return (f'<section class="season-method city-rating-report" id="city-rating"><h2>Рейтинг города</h2>'
            f'<p>{esc(data["city"])} · {MONTH_NAMES[data["month"] - 1].lower()} {data["year"]} · {verdict}</p>'
            '<details open><summary>Из чего складывается балл</summary><p>Оценка для поездки на выходные. '
            'Каждый показатель оцениваем от 0 до 10. Общий балл публикуем, когда собраны все четыре.</p>'
            + (f'<p>{esc(data["notice"])}</p>' if data["notice"] else "") + f'<dl>{rows}</dl></details></section>')


EVIDENCE = load_snapshot("city_rating_evidence.json")
ROUTES = load_snapshot("city_rating_routes.json")

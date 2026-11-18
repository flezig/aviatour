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


def rubles(amount):
    return f"{amount:,.2f}".replace(",", " ").replace(".", ",").removesuffix(",00") + " ₽"


def survey_cost(city, year, month, today):
    if city not in PRICES["cities"] or not (PRICES["checked"] <= today.isoformat() <= PRICES["review_by"]):
        return None
    observed = date.fromisoformat(PRICES["observed"])
    age = 12 * (year - observed.year) + month - observed.month
    if not 0 <= age <= 3 or date(year, month, 1) > date.fromisoformat(PRICES["review_by"]):
        return None
    rows = []
    for name, prices in PRICES["cities"].items():
        rates = [prices.get(key) for key in ("hotel", "meal", "bus")]
        if any(rate is None or rate <= 0 for rate in rates):
            return None  # Never silently change the fixed peer group.
        hotel, meal, bus = rates
        rows.append((name, 2 * hotel + 4 * meal + 4 * bus))
    peers = [amount for name, amount in rows if name != city]
    if len(peers) < 20:
        return None
    reference = median(peers)
    basket = dict(rows)[city]
    period = observed.strftime("%d.%m.%Y")
    rates = PRICES["cities"][city]
    score = min(10, max(0, 5 + 5 * math.log2(reference / basket)))
    detail = (f'Средние городские цены Росстата на {period}. Две ночи в гостинице 3★ по '
              f'{rubles(rates["hotel"])} с человека, четыре обеда в столовой или кафе по {rubles(rates["meal"])} '
              f'и четыре поездки на автобусе по {rubles(rates["bus"])}. Корзина — {rubles(basket)}, '
              f'медиана группы сравнения — {rubles(reference)} (других городов: {len(peers)}). '
              'На уровне медианы расходы получают 5/10, вдвое дешевле — 10/10, вдвое дороже — 0/10.')
    part = result("cost", score, detail, sources=[source("Росстат · ЕМИСС", PRICES["source"])])
    part["budget_label"] = f"Росстат · {period} · {rubles(basket)}"
    part["comparison_period"] = period
    part["comparison"] = []
    for name, total in sorted(rows, key=lambda row: row[1]):
        prices = PRICES["cities"][name]
        part["comparison"].append(dict(city=name, total=round(total, 2), hotel=round(2 * prices["hotel"], 2),
                                       meals=round(4 * prices["meal"], 2), bus=round(4 * prices["bus"], 2)))
    return part


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
    dates = sample.get("hotel_weekends", {})
    if dates:
        observations = [f"{d}: {number(median(prices.values()))} ₽ ({len(prices)} гостиниц)" for d, prices in sorted(dates.items()) if prices]
        detail += f' Цены на {sample["as_of"]}. Медианы за две ночи в отдельном стандартном номере без питания, заезды ' + ", ".join(observations) + "."
    if sample.get("fees_confirmed") is False:
        missing.append("Подтверждение всех обязательных сборов в цене номера.")
    if len(stays) < 3:
        missing.append("Цены номеров в десяти гостиницах на каждые из трёх выходных.")
    meals = sample.get("meal_prices", {})
    if len(meals) < 5 or not all(price > 0 for price in meals.values()):
        missing.append("Цены блюд в пяти заведениях или сопоставимые городские данные о питании.")
    elif sample.get("meal_unit"):
        meal = median(meals.values())
        detail += f' Еда в {len(meals)} заведениях: {sample["meal_unit"]}, медиана {number(meal)} ₽, четыре порции — {number(meal * 4)} ₽.'
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
    estimate = None
    if len(stays) >= 3 and len(meals) >= 5 and fare.get("year") == year and fare.get("checked", "") <= today.isoformat() and sample["currency"] == fare.get("currency"):
        estimate = median(stays) + 4 * median(meals.values()) + 4 * fare["amount"]
        detail += f' Ориентир по опубликованным ценам — {rubles(estimate)} на человека за выходные, без перелёта.'
    if sample.get("comparison_note"):
        detail += " " + sample["comparison_note"]
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
    if estimate is not None:
        part["budget_label"] = f"Около {estimate:,.0f} ₽ за выходные".replace(",", " ")
    survey = survey_cost(evidence.get("price_survey_city"), year, month, today)
    if survey:
        survey["trip_detail"] = detail + (" Включение всех обязательных сборов продавец отдельно не подтвердил." if dates and sample.get("fees_confirmed") is False else "")
        survey["sources"].extend(links)
        return survey
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
    times = [t for row in routes["walk_minutes"] for t in row if t is not None]
    if len(times) == 10 and max(times) <= 30:
        detail += (f' Все десять путей укладываются в порог пешком. Расчётное время — '
                   f'{number(round(min(times), 1))}–{number(round(max(times), 1))} мин.')
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


def city_pair_html(data, today, origin):
    if data["code"] not in ("LED", "KZN") or data["year"] != 2026 or data["month"] not in (11, 12):
        return ""
    rows = []
    for code in ("LED", "KZN"):
        cells = []
        for month in (11, 12):
            item = data if (code, month) == (data["code"], data["month"]) else report(code, month, 2026, today)
            href = season.link(code, month, origin, year=2026) + "#city-rating"
            label = (f'{item["score"]:.1f}/10'.replace(".", ",") if item["score"] is not None
                     else f'Данные: {item["available"]} из 4')
            cells.append(f'<td><a href="{esc(href)}">{esc(label)}</a></td>')
        rows.append(f'<tr><th scope="row">{esc(season.CITIES[code]["city"])}</th>{"".join(cells)}</tr>')
    return ('<section class="rating-comparison" id="city-weekend-comparison"><h3>Петербург и Казань</h3>'
            '<table><caption>Рейтинг для поездки на выходные · 2026</caption>'
            '<thead><tr><th scope="col">Город</th><th scope="col">Ноябрь</th><th scope="col">Декабрь</th></tr></thead>'
            f'<tbody>{"".join(rows)}</tbody></table></section>')


def walking_table(routes):
    cells = []
    for j, place in enumerate(routes["places"]):
        durations = "".join("<td>—</td>" if row[j] is None else f'<td>{number(round(row[j], 1))} мин</td>'
                            for row in routes["walk_minutes"])
        cells.append(f'<tr><th scope="row">{esc(place["name"])}</th>{durations}</tr>')
    headers = "".join(f'<th scope="col">{esc(p["name"])}</th>' for p in routes["starts"])
    return ('<details class="rating-comparison"><summary>Посмотреть время пешком по маршрутам</summary>'
            '<div class="rating-comparison-scroll"><table><caption>Путь от отеля до места</caption>'
            f'<thead><tr><th scope="col">Место</th>{headers}</tr></thead><tbody>{"".join(cells)}</tbody>'
            f'</table></div><p>{esc(routes["scope"])}</p></details>')


def report_html(data, today, origin):
    def row(c):
        score = f'{number(c["score"])}/10' if c["score"] is not None else "Недостаточно данных"
        links = " · ".join(f'<a href="{esc(s["url"])}">{esc(s["label"])}</a>' for s in c["sources"])
        missing = " ".join(c["missing"])
        routes = ROUTES.get(data["code"])
        walking = walking_table(routes) if c["key"] == "mobility" and routes and applicable(routes, data["month"], data["year"], today) else ""
        return (f'<div><dt>{esc(c["label"])} · {c["weight"]}% · {score}</dt><dd>{esc(c["detail"])}'
                + (f'<p><b>Ориентир на даты поездки.</b> {esc(c["trip_detail"])}</p>' if c.get("trip_detail") else "")
                + (f' {esc(missing)}' if missing else "") + (f'<p>{links}</p>' if links else "") + walking + '</dd></div>')
    cost = next(c for c in data["components"] if c["key"] == "cost")
    comparison = ""
    if cost.get("comparison"):
        items = "".join(f'<tr><th scope="row">{esc(r["city"])}</th>'
                        + "".join(f'<td>{rubles(r[k])}</td>' for k in ("hotel", "meals", "bus", "total"))
                        + "</tr>" for r in cost["comparison"])
        comparison = (f'<details class="rating-comparison"><summary>Сравнить расходы в {len(cost["comparison"])} городах</summary>'
                      f'<div class="rating-comparison-scroll"><table><caption id="rating-comparison">Стоимость одной корзины · {esc(cost["comparison_period"])}</caption>'
                      '<thead><tr><th scope="col">Город</th><th scope="col">2 ночи</th><th scope="col">4 обеда</th><th scope="col">4 поездки</th><th scope="col">Итого</th></tr></thead>'
                      f'<tbody>{items}</tbody></table></div></details>')
    verdict = (f'Общий балл {number(data["score"])}/10 · 4 из 4 показателей' if data["score"] is not None
               else f'Показателей с оценкой: {data["available"]} из 4')
    rows = "".join(row(c) for c in data["components"])
    return (f'<section class="season-method city-rating-report" id="city-rating"><h2>Рейтинг города</h2>'
            f'<p>{esc(data["city"])} · {MONTH_NAMES[data["month"] - 1].lower()} {data["year"]} · {verdict}</p>'
            + city_pair_html(data, today, origin)
            + '<details open><summary>Из чего складывается балл</summary><p>Оценка для поездки на выходные. '
            'Каждый показатель оцениваем от 0 до 10. Общий балл публикуем, когда собраны все четыре.</p>'
            + (f'<p>{esc(data["notice"])}</p>' if data["notice"] else "") + f'<dl>{rows}</dl></details>{comparison}</section>')


EVIDENCE = load_snapshot("city_rating_evidence.json")
ROUTES = load_snapshot("city_rating_routes.json")
PRICES = load_snapshot("city_rating_prices.json")

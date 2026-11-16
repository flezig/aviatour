"""Главная-витрина (этап 3 docs/site-rework.md): правила подборок для города вылета.

Чистые функции: предложения, сегодняшняя дата и календарь приходят аргументами, сети и часов здесь нет.
Пороги подобраны на живых данных 15.11.2026 (docs/handoffs/web-mvp.md, этап 3).
"""
import math
import statistics
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from zoneinfo import ZoneInfo

MIN_NIGHTS, MAX_NIGHTS = 1, 14   # подборки не предлагают «туда и обратно в один день» и поездки дольше двух недель
HOT_DAYS = 14                    # «горячий» билет: вылет через 1–14 дней …
HOT_DISCOUNT = 20                # … и цена ниже обычной минимум на 20 %
LEVEL_BAND = 15                  # ±15 % от обычной — «обычная цена»
MIN_PAIRS = 8                    # обычная цена считается, если найдено не меньше 8 пар дат
PRELIM_PAIRS, PRELIM_DISCOUNT = 4, 15  # предварительный отбор кандидатов по общим поискам
ROW_MIN, ROW_MAX = 3, 20         # подборка короче трёх не показывается; в «Все» — до 20
BUDGET_TIERS = (5000, 10000, 15000, 20000)
MAX_LEAVE = 4                    # «Длинные выходные»: не больше 4 дней отпуска
SHORT_FLIGHT = 240               # «Город на два дня»: каждый перелёт не дольше 4 часов
MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']


def js_round(value):
    """Как Math.round на сайте: половина — вверх. Иначе проценты на сервере и в браузере разойдутся на единицу."""
    return math.floor(value + .5)


def nights(offer):
    """Ночей между датой вылета (в городе вылета) и датой обратного вылета (в городе назначения) — как на сайте."""
    return (offer.return_at.date() - offer.departure_at.date()).days


def bucket(count):
    return 0 if count <= 2 else 1 if count <= 4 else 2 if count <= 7 else 3


def usual_key(offer):
    return offer.city_code, offer.departure_at.strftime('%Y-%m'), bucket(nights(offer))


def short_trip(offer):
    return MIN_NIGHTS <= nights(offer) <= MAX_NIGHTS


def cheapest_per_dates(offers):
    """Одна цена на пару дат — самая низкая. Разные рейсы на одни даты — не разные наблюдения."""
    best = {}
    for offer in offers:
        key = (offer.city_code, offer.departure_at.date(), offer.return_at.date())
        if key not in best or offer.price_minor < best[key].price_minor:
            best[key] = offer
    return list(best.values())


def usual_prices(offers, min_pairs=MIN_PAIRS):
    """Обычная цена: медиана самых низких цен по парам дат в тот же город, в том же месяце, той же длины поездки."""
    groups = defaultdict(list)
    for offer in cheapest_per_dates(offer for offer in offers if short_trip(offer)):
        groups[usual_key(offer)].append(offer.price_minor)
    return {key: (js_round(statistics.median(prices)), len(prices)) for key, prices in groups.items() if len(prices) >= min_pairs}


def price_level(price, usual):
    diff = js_round((price / usual - 1) * 100)
    return ('low' if diff <= -LEVEL_BAND else 'high' if diff >= LEVEL_BAND else 'usual'), diff


def discounted(offers, usual, today, discount, days=HOT_DAYS):
    """Вылет через 1–days дней, цена ниже обычной минимум на discount %. По билету на город — с самой большой скидкой."""
    best = {}
    for offer in offers:
        ahead = (offer.departure_at.date() - today).days
        found = usual.get(usual_key(offer))
        if not short_trip(offer) or not 1 <= ahead <= days or not found:
            continue
        diff = price_level(offer.price_minor, found[0])[1]
        rank = (diff, offer.price_minor, offer.id)
        if diff <= -discount and (offer.city_code not in best or rank < best[offer.city_code][0]):
            best[offer.city_code] = (rank, offer)
    return [offer for _, offer in sorted(best.values(), key=lambda item: item[0])]


def hot_candidates(pool, today, limit=12):
    """Кандидаты в «Горячие билеты» по общим поискам. Их обычная цена ненадёжна (в общих поисках у города мало дат),
    поэтому каждый кандидат перепроверяется отдельным поиском маршрута на месяц."""
    return discounted(pool, usual_prices(pool, PRELIM_PAIRS), today, PRELIM_DISCOUNT)[:limit]


def hot_tickets(offers, usual, today):
    return discounted(offers, usual, today, HOT_DISCOUNT)


# --- Календарь: выходные, праздники, переносы (web/data/holidays.json) ---
@dataclass(frozen=True)
class Calendar:
    off_days: frozenset = frozenset()   # нерабочие будни: праздники и перенесённые выходные
    work_days: frozenset = frozenset()  # рабочие субботы и воскресенья
    period: tuple = None                # где календарь известен; вне его — обычные субботы и воскресенья

    def is_off(self, day):
        return day not in self.work_days and (day.weekday() >= 5 or day in self.off_days)

    def windows(self, min_days=3):
        """Длинные выходные: подряд не меньше трёх нерабочих дней, среди них праздник или перенос.
        Окна на краях известного периода пропускаются — продолжение неизвестно."""
        if not self.period:
            return []
        start, end = self.period
        runs, run, day = [], [], start
        while day <= end:
            if self.is_off(day):
                run.append(day)
            elif run:
                runs.append(run)
                run = []
            day += timedelta(days=1)
        if run:
            runs.append(run)
        return [(run[0], run[-1]) for run in runs if len(run) >= min_days and run[0] > start and run[-1] < end and any(d in self.off_days for d in run)]


def load_calendar(data):
    holidays = {date.fromisoformat(day) for day in data['holidays']}
    start, end = map(date.fromisoformat, data['period'])
    off, work = set(holidays), set()
    for transfer in data['transfers']:
        source, target = date.fromisoformat(transfer['from']), date.fromisoformat(transfer['to'])
        off.add(target)
        if source.weekday() >= 5 and source not in holidays:
            work.add(source)
    # ТК РФ, ст. 112: праздник в субботу или воскресенье (кроме 1–8 января) переносит выходной на следующий рабочий день.
    for holiday in sorted(holidays):
        if holiday.weekday() >= 5 and not (holiday.month == 1 and holiday.day <= 8):
            day = holiday + timedelta(days=1)
            while day.weekday() >= 5 or day in off:
                day += timedelta(days=1)
            off.add(day)
    return Calendar(frozenset(day for day in off if start <= day <= end), frozenset(work), (start, end))


def home_arrival(offer):
    """Расчётное возвращение домой (по времени города вылета) и известно ли оно."""
    zone = ZoneInfo(offer.origin_timezone)
    if offer.duration_back:
        return (offer.return_at + timedelta(minutes=offer.duration_back)).astimezone(zone), True
    return offer.return_at.astimezone(zone), False


def leave_days(offer, calendar):
    """Сколько рабочих дней занимает поездка. День вылета не считается, если вылет с 18:00; день возвращения —
    если дома до 09:00. Неизвестное время прилёта считается днём отпуска."""
    departure = offer.departure_at.astimezone(ZoneInfo(offer.origin_timezone))
    home, known = home_arrival(offer)
    count, day = 0, departure.date()
    while day <= home.date():
        free = (day == departure.date() and departure.hour >= 18) or (day == home.date() and known and home.hour < 9)
        if not calendar.is_off(day) and not free:
            count += 1
        day += timedelta(days=1)
    return count


def upcoming_fridays(today):
    """Пятницы ближайших и следующих выходных. В субботу и воскресенье «ближайшие» — уже следующие."""
    first = today + timedelta(days=(4 - today.weekday()) % 7)
    return first, first + timedelta(days=7)


def weekend_pairs(friday):
    """Пятница → воскресенье и суббота → воскресенье. Возвращение в понедельник «без отпуска» — только ночным рейсом
    (дома до 09:00), такие поездки найдутся в общих поисках за месяц; отдельный поиск на них не тратим."""
    sat, sun = friday + timedelta(days=1), friday + timedelta(days=2)
    return [(friday, sun), (sat, sun)]


def weekend_trips(offers, friday, calendar):
    """Вылет в пятницу или субботу, дома в воскресенье или понедельник, и ни одного дня отпуска."""
    leave_on = {friday, friday + timedelta(days=1)}
    back_on = {friday + timedelta(days=2), friday + timedelta(days=3)}
    return [offer for offer in offers if offer.departure_at.date() in leave_on and home_arrival(offer)[0].date() in back_on
            and leave_days(offer, calendar) == 0]


def next_window(calendar, today, horizon=5):
    """Ближайшие длинные выходные, которые ещё не начались и попадают в поиск (текущий месяц и пять следующих)."""
    for start, end in calendar.windows():
        if start <= today:
            continue
        return (start, end) if (start.year * 12 + start.month) - (today.year * 12 + today.month) <= horizon else None
    return None


def window_pairs(window, calendar):
    """Даты поисков для окна: всё окно; для длинного (от 5 дней) — ещё две половины; для короткого — с вечера накануне
    и «мостик» до следующих выходных, если рабочих дней между ними не больше MAX_LEAVE."""
    start, end = window
    pairs = [(start, end)]
    length = (end - start).days + 1
    if length >= 5:
        middle = start + timedelta(days=length // 2)
        pairs += [(start, middle), (middle, end)]
    else:
        eve = start - timedelta(days=1)
        if not calendar.is_off(eve):
            pairs.append((eve, end))
        day, gap = end + timedelta(days=1), 0
        while not calendar.is_off(day) and gap <= MAX_LEAVE:
            gap, day = gap + 1, day + timedelta(days=1)
        if 1 <= gap <= MAX_LEAVE:
            while calendar.is_off(day + timedelta(days=1)):
                day += timedelta(days=1)
            pairs.append((start, day))
    return [(a, b) for a, b in pairs if MIN_NIGHTS <= (b - a).days <= MAX_NIGHTS][:3]


def window_trips(offers, window, calendar):
    """Поездки на 2–14 ночей, которые захватывают хотя бы два дня окна и требуют не больше MAX_LEAVE дней отпуска.
    Возвращает (поездка, дней отпуска)."""
    start, end = window
    found = []
    for offer in offers:
        if not 2 <= nights(offer) <= MAX_NIGHTS:
            continue
        overlap = (min(offer.return_at.date(), end) - max(offer.departure_at.date(), start)).days + 1
        if overlap >= 2 and (leave := leave_days(offer, calendar)) <= MAX_LEAVE:
            found.append((offer, leave))
    return found


def one_per_city(offers, key=lambda offer: offer.price_minor):
    best = {}
    for offer in sorted(offers, key=lambda offer: (key(offer), offer.price_minor, offer.id)):
        best.setdefault(offer.city_code, offer)
    return list(best.values())


def budget_tiers(offers):
    """Лучшая поездка каждого города на 1–14 ночей → ступени бюджета: до 5 000, 5–10 тысяч и так далее."""
    best = one_per_city([offer for offer in offers if short_trip(offer)])
    tiers, lower = [], 0
    for upper in BUDGET_TIERS:
        tiers.append((lower, upper, [offer for offer in best if lower * 100 < offer.price_minor <= upper * 100]))
        lower = upper
    return tiers


def tagged(offers, cities):
    return one_per_city([offer for offer in offers if short_trip(offer) and offer.city_code in cities])


def city_break(offers, guides):
    """«Город на два дня»: 1–2 ночи, каждый перелёт известен и не дольше 4 часов, у города есть наши заметки."""
    return one_per_city([offer for offer in offers if 1 <= nights(offer) <= 2 and offer.city_code in guides
                         and 0 < (offer.duration_to or 0) <= SHORT_FLIGHT and 0 < (offer.duration_back or 0) <= SHORT_FLIGHT])


def date_span(start, end):
    """«20–22 ноября», «31 декабря – 10 января»."""
    if (start.year, start.month) == (end.year, end.month):
        return f'{start.day}–{end.day} {MONTHS_GEN[end.month - 1]}'
    return f'{start.day} {MONTHS_GEN[start.month - 1]} – {end.day} {MONTHS_GEN[end.month - 1]}'


def plural(count, one, few, many):
    tail, last = count % 100, count % 10
    return many if 11 <= tail <= 14 else one if last == 1 else few if 2 <= last <= 4 else many

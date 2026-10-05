"""Versioned, list-independent trip suitability. Unknown is never zero."""
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal
from zoneinfo import ZoneInfo
from pydantic import BaseModel, ConfigDict, Field, model_validator

VERSION = 'trip-v1.0'

class TripPreferences(BaseModel):
    model_config = ConfigDict(extra='forbid')
    travelers: int = Field(default=1, ge=1, le=8, strict=True)
    housing: Literal['budget', 'standard', 'comfort'] = 'standard'
    food: Literal['groceries', 'mixed', 'restaurants'] = 'mixed'
    # Separate from the existing airfare filter. Per person, RUB kopecks.
    full_budget_minor: int | None = Field(default=None, ge=10000, le=500000000, strict=True)

class Evidence(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source: str = Field(min_length=1)
    source_url: str = Field(pattern=r'^https://')
    geography: Literal['city', 'region', 'country', 'route']
    period_start: date | None
    period_end: date | None
    fetched_at: datetime
    estimated: bool
    method: str = Field(min_length=1)
    @model_validator(mode='after')
    def dates(self):
        if (self.period_start is not None and self.period_end is not None and self.period_end < self.period_start) or self.fetched_at.utcoffset() is None:
            raise ValueError('Invalid evidence dates')
        return self

class MoneyRange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    low_minor: int = Field(ge=0, strict=True)
    high_minor: int = Field(ge=0, strict=True)
    currency: str = Field(pattern=r'^[A-Z]{3}$')
    evidence: Evidence
    @model_validator(mode='after')
    def bounds(self):
        if self.high_minor < self.low_minor:
            raise ValueError('Invalid range')
        return self

class ExchangeRate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    currency: str = Field(pattern=r'^[A-Z]{3}$')
    rub_per_unit: Decimal = Field(gt=0, allow_inf_nan=False)
    evidence: Evidence

class Component(BaseModel):
    model_config = ConfigDict(extra='forbid')
    score: int = Field(ge=0, le=100, strict=True)
    evidence: Evidence

class DestinationData(BaseModel):
    """Reviewed provider output, keyed to exact dates and occupancy; no monthly rent."""
    model_config = ConfigDict(extra='forbid')
    city_code: str = Field(pattern=r'^[A-Z]{3}$')
    check_in: date
    check_out: date
    preferences: TripPreferences
    housing_total: MoneyRange | None = None  # Entire party for all nights, all reported taxes.
    food_per_day: MoneyRange | None = None   # Per person, matching food scenario.
    transport_per_day: MoneyRange | None = None
    theft: Component | None = None
    violence: Component | None = None
    advisory: Literal['none', 'caution', 'avoid', 'unknown'] = 'unknown'
    advisory_evidence: Evidence | None = None
    conditions: Component | None = None
    rates: list[ExchangeRate] = Field(default_factory=list)
    @model_validator(mode='after')
    def stay(self):
        if self.check_out <= self.check_in:
            raise ValueError('Housing needs at least one night')
        return self

class BudgetLine(BaseModel):
    title: str
    low_minor: int
    high_minor: int
    evidence: Evidence

class TripRating(BaseModel):
    version: str = VERSION
    score: int | None = None
    preliminary_score: int | None = None
    preliminary_version: str = 'flight-v1.0'
    budget_score: int | None = None
    road_score: int | None = None
    safety_score: int | None = None
    conditions_score: int | None = None
    stay_score: int | None = None
    total_low_minor: int | None = None
    total_high_minor: int | None = None
    stay_low_minor: int | None = None
    stay_high_minor: int | None = None
    currency: Literal['RUB'] = 'RUB'
    days: int | None = None
    nights: int | None = None
    travelers: int
    full_budget_minor: int | None = None
    housing: str
    food: str
    completeness: Literal['high', 'medium', 'low'] = 'low'
    suitability: Literal['unknown', 'warning', 'avoid'] = 'unknown'
    entry_status: str = 'Условия въезда не проверены'
    updated_at: datetime
    reasons: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    lines: list[BudgetLine] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)


def round_int(value):
    return int(Decimal(str(value)).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def affordability(high_minor: int, reference_minor: int) -> int:
    # 100 at <= half the reference; 0 at >= twice the reference.
    return round_int(max(Decimal(0), min(Decimal(100), (Decimal(2) - Decimal(high_minor) / reference_minor) / Decimal('1.5') * 100)))


def fresh(e: Evidence, now: datetime, max_days: int, *, allow_unknown_period=False) -> bool:
    if not timedelta(0) <= now - e.fetched_at <= timedelta(days=max_days):
        return False
    if e.period_end is None:
        return allow_unknown_period
    return e.period_end <= now.date() and now.date() - e.period_end <= timedelta(days=max_days)


def road_score(offer):
    values = (offer.duration_to, offer.duration_back, offer.transfers, offer.return_transfers)
    if any(x is None for x in values) or offer.duration_to <= 0 or offer.duration_back <= 0:
        return None
    arrival = offer.departure_at + timedelta(minutes=offer.duration_to)
    hours = (offer.return_at - arrival).total_seconds() / 3600
    if hours <= 0:
        return None
    # Both shoulders, connections, fraction of trip spent on the road, late schedule.
    duration = max(0, 100 - max(0, offer.duration_to + offer.duration_back - 120) / 12)
    connections = max(0, 100 - 25 * (offer.transfers + offer.return_transfers))
    time_on_site = min(100, hours / (hours + (offer.duration_to + offer.duration_back) / 60) * 100)
    times = [arrival.astimezone(ZoneInfo(offer.destination_timezone)),
             offer.return_at.astimezone(ZoneInfo(offer.destination_timezone))]
    schedule = 100 - 30 * sum(t.hour < 6 or t.hour >= 23 for t in times)
    return round_int(.4 * duration + .25 * connections + .25 * time_on_site + .1 * schedule)


def evaluate(offer, preferences: TripPreferences, now: datetime, data: DestinationData | None = None):
    r = TripRating(full_budget_minor=preferences.full_budget_minor, travelers=preferences.travelers, housing=preferences.housing, food=preferences.food, updated_at=now)
    r.road_score = road_score(offer)
    flight_e = Evidence(source='Travelpayouts Data API', source_url='https://travelpayouts.github.io/slate/',
        geography='route', period_start=None, period_end=None,
        fetched_at=offer.received_at, estimated=True, method='Кешированная находка для одного взрослого; период наблюдения цены неизвестен, наличие и групповая цена не подтверждены')
    r.lines.append(BudgetLine(title='Билеты туда-обратно на человека', low_minor=offer.price_minor, high_minor=offer.price_minor, evidence=flight_e))
    r.evidence.append(flight_e)
    if r.road_score is not None:
        r.evidence.append(flight_e.model_copy(update={'source': 'Расчёт дороги по Travelpayouts',
            'method': 'Оба плеча, пересадки, расписание и доля времени на месте; прилёт расчётный, трансфер из аэропорта неизвестен'}))
    if r.road_score is not None and fresh(flight_e, now, 1, allow_unknown_period=True):
        r.preliminary_score = round_int(.65 * affordability(offer.price_minor, 2000000) + .35 * r.road_score)
    if not fresh(flight_e, now, 1, allow_unknown_period=True):
        r.missing.append('Свежая цена билетов (не старше 24 часов)')
    if offer.duration_to:
        arrival = (offer.departure_at + timedelta(minutes=offer.duration_to)).astimezone(ZoneInfo(offer.destination_timezone))
        returning = offer.return_at.astimezone(ZoneInfo(offer.destination_timezone))
        if returning > arrival:
            r.nights = (returning.date() - arrival.date()).days
            r.days = r.nights + 1
    if r.days is None:
        r.missing.append('Даты пребывания: неизвестно время прилёта')
    # Active warnings are independent of occupancy, food, and hotel quote dates.
    if data and data.city_code == offer.city_code and data.advisory_evidence and fresh(data.advisory_evidence, now, 1):
        r.evidence.append(data.advisory_evidence)
        if data.advisory == 'avoid':
            r.suitability = 'avoid'
            r.reasons.append('Действует серьёзное предупреждение: поездка не рекомендована')
        elif data.advisory == 'caution':
            r.suitability = 'warning'
            r.reasons.append('Действует предупреждение для путешественников')
    if data and (data.city_code != offer.city_code or r.nights is None
                 or data.check_in != arrival.date() or data.check_out != returning.date()
                 or data.preferences.model_dump(exclude={'full_budget_minor'}) != preferences.model_dump(exclude={'full_budget_minor'})):
        data = None
    def money(value, multiplier=1, divisor=1, title=''):
        if value is None or not fresh(value.evidence, now, 7):
            return None
        rate = Decimal(1)
        if value.currency != 'RUB':
            fx = next((x for x in (data.rates if data else []) if x.currency == value.currency and fresh(x.evidence, now, 3)), None)
            if fx is None:
                return None
            rate = fx.rub_per_unit
            r.evidence.append(fx.evidence)
        # Currency minor units supported here are 2 decimals only.
        if value.currency not in {'RUB', 'EUR', 'USD', 'GBP', 'TRY', 'AED', 'GEL'}:
            return None
        low = round_int(Decimal(value.low_minor) * rate * multiplier / divisor)
        high = round_int(Decimal(value.high_minor) * rate * multiplier / divisor)
        r.lines.append(BudgetLine(title=title, low_minor=low, high_minor=high, evidence=value.evidence))
        r.evidence.append(value.evidence)
        return low, high
    housing = money(data.housing_total if data else None, divisor=preferences.travelers, title='Проживание на человека за все ночи')
    food = money(data.food_per_day if data else None, multiplier=r.days or 1, title='Питание на человека за все дни')
    transport = money(data.transport_per_day if data else None, multiplier=r.days or 1, title='Местный транспорт на человека за все дни')
    for label, value in [('Проживание на выбранные даты и состав группы', housing), ('Питание по выбранному сценарию', food), ('Местный транспорт', transport)]:
        if value is None:
            r.missing.append(label)
    if r.days is not None and all(v is not None for v in (housing, food, transport)):
        r.stay_low_minor = sum(v[0] for v in (housing, food, transport))
        r.stay_high_minor = sum(v[1] for v in (housing, food, transport))
        r.total_low_minor = r.stay_low_minor + offer.price_minor
        r.total_high_minor = r.stay_high_minor + offer.price_minor
        r.stay_score = affordability(r.stay_high_minor, r.days * 500000)
        r.budget_score = affordability(r.total_high_minor, preferences.full_budget_minor or (2000000 + r.days * 500000))
    if data:
        for item in [data.theft, data.violence, data.conditions]:
            if item:
                r.evidence.append(item.evidence)
        if (data.theft and data.violence and fresh(data.theft.evidence, now, 365)
            and fresh(data.violence.evidence, now, 365) and data.advisory != 'unknown'
            and data.advisory_evidence and fresh(data.advisory_evidence, now, 1)):
            r.safety_score = round_int(.5 * data.theft.score + .5 * data.violence.score)
            if data.advisory == 'caution':
                r.safety_score = min(50, r.safety_score)
        if data.conditions and fresh(data.conditions.evidence, now, 7):
            r.conditions_score = data.conditions.score
    for label, value in [('Удобство дороги', r.road_score), ('Сопоставимая безопасность и действующие предупреждения', r.safety_score), ('Условия отдыха на выбранные даты', r.conditions_score)]:
        if value is None:
            r.missing.append(label)
    if r.road_score is not None:
        r.reasons.append(f'Удобство дороги: {r.road_score}/100; оба плеча, пересадки и время на месте')
    if r.nights is not None:
        r.reasons.append(f'{r.nights} ночей и {r.days} дней питания и транспорта')
    if r.suitability == 'avoid':
        r.preliminary_score = None
    if not r.missing and r.suitability != 'avoid':
        r.score = round_int(.45 * r.budget_score + .25 * r.road_score + .2 * r.safety_score + .1 * r.conditions_score)
        r.completeness = 'medium' if any(e.estimated for e in r.evidence) else 'high'
    else:
        r.completeness = 'medium' if r.total_high_minor is not None else 'low'
    return r

"""Independent city evidence. Missing facts never become zero cost or safety scores."""
import asyncio
import json
import math
from datetime import date, timedelta
from pathlib import Path
from statistics import median
from decimal import Decimal
import httpx
from pydantic import BaseModel, Field, model_validator
from typing import Literal
from .catalog import AIRPORTS
from .food_basket import BASKET, unit_price
from .runtime import TTLCache

ROOT = Path(__file__).parent
GUIDES = json.loads((ROOT / 'city_guides.json').read_text())
ISO3 = json.loads((ROOT / 'country_iso3.json').read_text())
HDI = json.loads((ROOT / 'hdi.json').read_text())
COUNTRIES = {a['country_code'] for a in AIRPORTS if a.get('country_code')}
INTERESTS = {'sea', 'culture', 'food', 'architecture', 'nature', 'nightlife'}
SHOPPING = {'en:rice': ('Рис', Decimal('1')), 'en:breads': ('Хлеб', Decimal('.5')),
 'en:eggs': ('Яйца', Decimal('10')), 'en:milks': ('Молоко', Decimal('1')),
 'en:apples': ('Яблоки', Decimal('1')), 'en:tomatoes': ('Помидоры', Decimal('1')),
 'en:chicken-breasts': ('Куриная грудка', Decimal('1')), 'en:yogurts': ('Йогурт', Decimal('.5'))}

class InsightRequest(BaseModel):
    city_code: str = Field(pattern=r'^[A-Z]{3}$')
    citizenship: str | None = Field(default=None, pattern=r'^[A-Z]{2}$')
    residence: str | None = Field(default=None, pattern=r'^[A-Z]{2}$')
    start_date: date
    end_date: date
    interests: list[Literal['sea', 'culture', 'food', 'architecture', 'nature', 'nightlife']] = Field(default_factory=list, max_length=6)

    @model_validator(mode='after')
    def valid(self):
        if not 0 <= (self.end_date - self.start_date).days <= 60:
            raise ValueError('invalid dates')
        if any(code is not None and code not in COUNTRIES for code in (self.citizenship, self.residence)):
            raise ValueError('unknown country')
        self.interests = sorted(set(self.interests))
        return self


def shopping_basket(rows, guide, today):
    """Fixed shopping bag; median of normalized non-discounted observations, 5/3 minimum."""
    groups = {c: [] for c in BASKET}; shops = {c: set() for c in BASKET}; dates = []; seen = set()
    for row in rows:
        try:
            observed = date.fromisoformat(row['date'])
            loc = row.get('location') or {}
            lat, lon = float(loc['osm_lat']), float(loc['osm_lon'])
            # Verify upstream geography even if a filter is ignored by the supplier.
            if not -90 <= lat <= 90 or not -180 <= lon <= 180: continue
            dy = math.radians(lat - guide['latitude']); dx = math.radians(lon - guide['longitude'])
            hav = math.sin(dy/2)**2 + math.cos(math.radians(lat))*math.cos(math.radians(guide['latitude']))*math.sin(dx/2)**2
            distance = 6371 * 2 * math.asin(min(1, math.sqrt(max(0, hav))))
            if not math.isfinite(distance) or distance > 15 or loc.get('osm_address_country_code') != guide['country']:
                continue
            if not 0 <= (today - observed).days <= 90 or row.get('currency') != guide['currency']:
                continue
            if row.get('price_is_discounted') is not False or row.get('duplicate_of') is not None or not row.get('location_id'):
                continue
            identity = (row.get('id'), row.get('product_code'), row.get('category_tag'), row['location_id'], row['date'])
            if identity in seen: continue
            seen.add(identity)
            categories = set((row.get('product') or {}).get('categories_tags') or []) | {row.get('category_tag')}
            for category, (unit, _) in BASKET.items():
                if category in categories:
                    value = unit_price(row, unit)
                    if value is not None and Decimal(".0001") <= value <= Decimal("1000000000"):
                        groups[category].append(value); shops[category].add(row['location_id']); dates.append(observed)
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
    items = []
    for category, (unit, _) in BASKET.items():
        name, quantity = SHOPPING[category]
        enough = len(groups[category]) >= 5 and len(shops[category]) >= 3
        value = median(groups[category]) * quantity if enough else None
        items.append(dict(name=name, quantity=str(quantity), unit=unit, observations=len(groups[category]),
            shops=len(shops[category]), cost=str(value.quantize(Decimal('.01'))) if value is not None else None))
    complete = all(item['cost'] is not None for item in items)
    return dict(status='ok' if complete else 'insufficient', currency=guide['currency'], items=items,
        known_subtotal=str(sum(Decimal(i['cost']) for i in items if i['cost'] is not None).quantize(Decimal('.01'))) if any(i['cost'] is not None for i in items) else None,
        total=str(sum(Decimal(i['cost']) for i in items).quantize(Decimal('.01'))) if complete else None,
        period_start=min(dates).isoformat() if dates else None, period_end=max(dates).isoformat() if dates else None,
        source_url='https://prices.openfoodfacts.org/',
        note='Фиксированный набор покупок, не суточный рацион. Медианы цен за 90 дней в радиусе 15 км; минимум 5 наблюдений из 3 магазинов на товар. Выборка не представляет все магазины. Open Prices, ODbL.')


class CityInsights:
    def __init__(self, client, now):
        self.client, self.now = client, now
        self.cache = TTLCache(3600, 256)
        self.slots = asyncio.Semaphore(4)
        self.blocked_until = {}

    async def get(self, url, params=None):
        async def fetch():
            async with self.slots:
                loop = asyncio.get_running_loop()
                host = httpx.URL(url).host
                if self.blocked_until.get(host, 0) > loop.time(): return None
                try:
                    response = await self.client.get(url, params=params, timeout=4)
                    if response.status_code == 429:
                        try: delay = min(3600, max(60, float(response.headers.get('Retry-After', '60'))))
                        except ValueError: delay = 60
                        self.blocked_until[host] = loop.time() + delay
                    response.raise_for_status()
                    return response.json()
                except (httpx.HTTPError, ValueError):
                    return None
        return await self.cache.get_or_create((url, tuple(sorted((params or {}).items()))), fetch)

    async def weather(self, guide, request):
        today = self.now().date()
        base = dict(status='unavailable', kind='forecast', days=[], source_url='https://open-meteo.com/', note='Open-Meteo, CC BY 4.0; бесплатный endpoint только для некоммерческого пилота.')
        if today <= request.start_date <= request.end_date <= today + timedelta(days=15):
            url = 'https://api.open-meteo.com/v1/forecast'
            params = dict(latitude=guide['latitude'], longitude=guide['longitude'], start_date=request.start_date.isoformat(), end_date=request.end_date.isoformat(),
                daily='temperature_2m_max,temperature_2m_min,precipitation_sum', timezone='auto')
            expected = [(request.start_date + timedelta(days=i)).isoformat() for i in range((request.end_date-request.start_date).days+1)]
        else:
            # A recent historical analogue, explicitly NOT a future forecast or climate normal.
            year = today.year - 1
            start = request.start_date.replace(year=year, day=min(request.start_date.day, 28)) if request.start_date.month == 2 else request.start_date.replace(year=year)
            end = start + (request.end_date-request.start_date)
            if end > today - timedelta(days=7):
                start = start.replace(year=year-1); end = start+(request.end_date-request.start_date)
            url = 'https://archive-api.open-meteo.com/v1/archive'
            params = dict(latitude=guide['latitude'], longitude=guide['longitude'], start_date=start.isoformat(), end_date=end.isoformat(),
                daily='temperature_2m_max,temperature_2m_min,precipitation_sum', timezone='auto')
            expected = [(start + timedelta(days=i)).isoformat() for i in range((end-start).days+1)]
            base['kind'] = 'historical_analogue'
            base['note'] += ' Погода аналогичных дат прошлого года — сезонный ориентир, не прогноз и не климатическая норма.'
        raw = await self.get(url, params)
        try:
            daily = raw['daily']; times = daily['time']
            keys = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum']
            units = raw['daily_units']
            if times != expected or any(len(daily[k]) != len(times) for k in keys): return base
            if units.get('temperature_2m_max') != '°C' or units.get('precipitation_sum') != 'mm': return base
            days = []
            for i, day in enumerate(times):
                values = [daily[k][i] for k in keys]
                if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in values): return base
                high, low, rain = values
                if not -100 <= low <= high <= 65 or rain < 0: return base
                days.append(dict(date=day, high=high, low=low, rain=rain))
            return dict(base, status='ok', days=days)
        except (KeyError, TypeError, ValueError): return base

    async def food(self, guide):
        async def category(tag, raw_product):
            params = dict(lat=guide['latitude'], lon=guide['longitude'], radius_km=15,
                currency=guide['currency'], date__gte=(self.now().date()-timedelta(days=90)).isoformat(),
                size=100, page=1, order_by='-date')
            params['category_tag' if raw_product else 'product__categories_tags__contains'] = tag
            return await self.get('https://prices.openfoodfacts.org/api/v1/prices', params)
        responses = await asyncio.gather(*(category(c, raw) for c in BASKET for raw in (False, True)))
        rows = [row for raw in responses if isinstance(raw, dict) and isinstance(raw.get('items'), list) for row in raw['items'][:100] if isinstance(row, dict)]
        result = shopping_basket(rows, guide, self.now().date())
        result['sample_limited'] = True
        if all(raw is None for raw in responses): result['status'] = 'unavailable'
        return result

    async def safety(self, guide):
        slug = guide['advice_slug']; url = 'https://www.gov.uk/foreign-travel-advice/' + slug
        base = dict(status='unavailable', alerts=[], updated_at=None, source_url=url,
            note='FCDO: рекомендации для британских граждан, на уровне страны/регионов. Это не оценка преступности города и не персональная рекомендация для другого гражданства.')
        raw = await self.get('https://www.gov.uk/api/content/foreign-travel-advice/' + slug)
        try:
            details = raw['details']; alerts = details['alert_status']
            if not isinstance(alerts, list) or not isinstance(details.get('parts'), list): return base
            known = {'avoid_all_travel_to_whole_country', 'avoid_all_but_essential_travel_to_whole_country', 'avoid_all_travel_to_parts', 'avoid_all_travel', 'avoid_all_but_essential_travel_to_parts', 'avoid_all_but_essential_travel'}
            # Unknown alert enums must not silently appear clear.
            status = 'warning' if alerts else 'published'
            if any(a not in known for a in alerts): status = 'review'
            return dict(base, status=status, alerts=alerts, updated_at=raw.get('public_updated_at'))
        except (KeyError, TypeError): return base

    async def build(self, request):
        guide = GUIDES.get(request.city_code)
        if not guide:
            return dict(city_code=request.city_code, status='no_guide', guide=None, weather=None, basket=None, safety=None, hdi=None,
                entry=self.entry(request, None), interest_score=None, matched_interests=[], fetched_at=self.now().isoformat())
        weather, food, safety = await asyncio.gather(self.weather(guide, request), self.food(guide), self.safety(guide))
        matched = sorted(set(request.interests) & set(guide['tags']))
        hdi = HDI['values'].get(guide['iso3'])
        return dict(city_code=request.city_code, status='ok', guide=guide, weather=weather, basket=food, safety=safety,
            hdi=dict(hdi, source_url=HDI['source'], publication=HDI['publication'], retrieved=HDI['retrieved'], note='Индекс развития страны, не безопасность и не качество отдыха.') if hdi else None,
            entry=self.entry(request, guide), interest_score=round(len(matched)/len(request.interests)*100) if request.interests else None,
            matched_interests=matched, fetched_at=self.now().isoformat())

    def entry(self, request, guide):
        country = guide['country'] if guide else None
        domestic = request.citizenship is not None and request.citizenship == country
        check_url = 'https://apply.joinsherpa.com/travel-restrictions'
        if guide:
            check_url += '?destinations=' + guide['iso3']
            if request.citizenship in ISO3: check_url += '&passport=' + ISO3[request.citizenship]
        return dict(check_url=check_url, status='citizen_destination' if domestic else 'unknown', citizenship=request.citizenship, residence=request.residence,
            source_url=guide['tourism_url'] if guide else None,
            note='Выбрано гражданство страны назначения. Проверьте действительность документов и правила транзита.' if domestic else
                'Укажите гражданство и проверьте правила по паспорту в консульстве. Персональный визовый источник ещё не подключён; страна проживания не заменяет гражданство. Транзит и имеющиеся визы могут менять требования.')

import asyncio
import os
import json
import math
import re
from urllib.parse import urlencode
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import httpx
from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from .catalog import AIRPORTS, BY_IATA
from .errors import SearchError
from .models import SearchRequest, SearchResponse, BatchSearchRequest, BatchSearchItem, BatchSearchResponse
from .runtime import TTLCache, RateLimiter
from .settings import Settings
from .upstream import Travelpayouts
from .rules import matches, safe_search_url, safe_hotel_url, safe_listed_url, longer_stays
from . import city_pages, showcase
from .regions import includes, REGION_CITIES
from .rating import evaluate, round_int
from .rating_sources import RatingSources, load_reviewed_data
from .hotel_source import AmadeusHotels
from .city_insights import CityInsights, InsightRequest

WEB_DIR = Path(__file__).resolve().parents[2] / 'web'


def create_app(settings=None, transport=None, now=lambda: datetime.now(timezone.utc)):
    settings = settings or Settings.env()
    cache, limiter = TTLCache(settings.ttl, settings.capacity), RateLimiter(settings.rate)
    # Страницы городов читают поисковики: свой предел обращений к источнику, чтобы не отнимать его у посетителей.
    catalog, pages_limiter = city_pages.load(), RateLimiter(120)
    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(transport=transport, follow_redirects=False, timeout=5, headers={'Accept-Encoding': 'gzip, deflate'}) as client:
            app.state.upstream = Travelpayouts(client, settings, now)
            app.state.hotel_source = AmadeusHotels(client, settings.amadeus_client_id, settings.amadeus_client_secret)
            app.state.rating_sources = RatingSources(client, settings.gpm_key)
            app.state.city_insights = CityInsights(client, now)
            data, app.state.rating_data_status = load_reviewed_data(settings.rating_data_file)
            app.state.rating_data = {}
            for item in data:
                app.state.rating_data.setdefault(item.city_code, []).append(item)
            yield
    app = FastAPI(title='Aviator', lifespan=lifespan)
    # Сжатие — только вне Vercel. На Vercel ответы сжимает его CDN; если сжимать здесь, ответ получает «Vary: Accept-Encoding»
    # и CDN хранит отдельную копию на каждую строку Accept-Encoding (у Chrome, Safari и curl они разные) — прогретая копия
    # не достаётся другим браузерам, и они ждут сборку главной заново.
    if not os.getenv('VERCEL'):
        app.add_middleware(GZipMiddleware, minimum_size=1024)
    @app.exception_handler(SearchError)
    async def search_error(_, error):
        return JSONResponse(status_code=error.status, content={'error': {'code': error.code, 'message': error.message}}, headers={'Retry-After': str(error.retry_after)} if error.retry_after else None)
    @app.exception_handler(RequestValidationError)
    async def validation_error(_, error):
        return JSONResponse(status_code=422, content={'error': {'code': 'validation', 'message': 'Проверьте аэропорты, даты и бюджет.'}})
    @app.get('/health')
    async def health():
        return {'status': 'ok', 'live_configured': bool(settings.token)}
    @app.get('/api/v1/airports')
    async def airports():
        return JSONResponse(AIRPORTS, headers={'Cache-Control': 'public, max-age=3600, s-maxage=86400'})
    async def source(request: SearchRequest, check=None):
        """Проверенный запрос → кешированный ответ источника без фильтров посетителя (бюджет, прямые, выходные)."""
        airport = BY_IATA.get(request.origin)
        if not airport or not airport['timezone']:
            raise SearchError('validation', 'Выберите аэропорт из справочника.', 422)
        if request.origin_city_code and request.origin_city_code != airport['city_code']:
            raise SearchError('validation', 'Город не соответствует выбранному аэропорту.', 422)
        if request.destination:
            destination = BY_IATA.get(request.destination)
            if not destination or (request.destination_city_code and request.destination_city_code != destination['city_code']):
                raise SearchError('validation', 'Выберите направление из справочника.', 422)
            if not includes(request.region, destination['country_code']):
                raise SearchError('validation', 'Выберите город в выбранном регионе или измените регион.', 422)
            if destination['city_code'] == airport['city_code']:
                raise SearchError('validation', 'Города вылета и назначения должны различаться.', 422)
        local_now = now().astimezone(ZoneInfo(airport['timezone']))
        year, month = map(int, request.month.split('-'))
        distance = year * 12 + month - (local_now.year * 12 + local_now.month)
        if not 0 <= distance <= 5:
            raise SearchError('validation', 'Выберите текущий месяц или один из следующих пяти.', 422)
        if request.departure_date and request.departure_date < local_now.date().isoformat():
            raise SearchError('validation', 'Дата вылета уже прошла.', 422)
        # Share source data across budgets/direct/weekend toggles; filter after cache.
        key = (request.origin, request.origin_city_code, request.month, request.departure_date,
               request.return_date, request.destination, request.destination_city_code, request.region, settings.market, 'rub')
        broad = request.model_copy(update={'max_budget_minor': 50000000, 'direct_only': False, 'weekend_only': False})
        def load():
            # check is the rate limit: only a cache miss reaches Travelpayouts, so a cached answer costs nothing.
            if check:
                check()
            # Russia is one ordinary search filtered by country; Europe and the USA go city by city.
            return app.state.upstream.search_region(broad) if request.region in REGION_CITIES and not request.destination else app.state.upstream.search(broad)
        return await cache.get_or_create(key, load, refresh=request.force_refresh)

    async def search(request: SearchRequest, check=None, pool=None):
        result = await source(request, check)
        if pool is not None:
            # Unfiltered trips of this search (any budget, length or transfers), for hints beyond the visitor's filters.
            pool.extend(result.offers)
        # A valid cached response can become stale before TTL expires.
        offers = []
        for offer in result.offers:
            if not matches(offer, request, now()):
                continue
            candidates = app.state.rating_data.get(offer.city_code, [])
            values = [evaluate(offer, request.trip_preferences, now())]
            values.extend(evaluate(offer, request.trip_preferences, now(), candidate) for candidate in candidates)
            rating = min(values, key=lambda value: len(value.missing))
            # A cheaper/more complete quote must not erase a serious active warning.
            warnings = [value for value in values if value.suitability in ('avoid', 'warning')]
            if warnings:
                strongest = min(warnings, key=lambda value: 0 if value.suitability == 'avoid' else 1)
                rating.suitability = strongest.suitability
                rating.reasons = list(dict.fromkeys(strongest.reasons[:1] + rating.reasons))
                rating.evidence.extend(e for e in strongest.evidence if e not in rating.evidence)
                if rating.suitability == 'avoid':
                    rating.score = None
                    rating.preliminary_score = None
                elif rating.safety_score is not None:
                    rating.safety_score = min(50, rating.safety_score)
                    if rating.score is not None:
                        rating.score = round_int(.45 * rating.budget_score + .25 * rating.road_score + .2 * rating.safety_score + .1 * rating.conditions_score)
            offers.append(offer.model_copy(update={'trip_rating': rating}))
        return result.model_copy(update={'offers': offers})
    @app.get('/api/v1/rating/status')
    async def rating_status():
        return {'version': 'trip-v1.0', 'evidence_feed': app.state.rating_data_status,
                'gpm_city_configured': bool(settings.gpm_key),
                'entry_status': 'Условия въезда не проверены'}

    @app.post('/api/v1/cities/insights')
    async def city_insights(request: InsightRequest):
        limiter.check()
        # Separate from airfare search; partial source failures remain visible.
        return await app.state.city_insights.build(request)

    @app.post('/api/v1/search', response_model=SearchResponse)
    async def search_endpoint(request: SearchRequest):
        return await search(request, limiter.check)

    @app.get('/api/v1/search/web')
    async def web_search_endpoint(budget: int, month: str = '', dep: str | None = None, ret: str | None = None, region: str = 'any',
                                  weekend: str = '1', direct: str = '0', fc: str | None = None, to: str | None = None, tc: str | None = None,
                                  origin: str = Query(alias='from')):
        # The site's search: the page's own URL parameters, a GET so the CDN shares one answer per query among visitors,
        # and only the rating fields the page shows (the full rating is ~80% of an offer).
        try:
            request = SearchRequest(origin=origin, origin_city_code=fc, destination=to, destination_city_code=tc, region=region,
                month=dep[:7] if dep else month, departure_date=dep, return_date=ret, max_budget_minor=budget * 100,
                weekend_only=weekend != '0', direct_only=direct == '1')
        except ValidationError:
            raise SearchError('validation', 'Проверьте аэропорты, даты и бюджет.', 422) from None
        pool = []
        result = await search(request, limiter.check, pool)
        compact = {'outbound_segments', 'inbound_segments'}
        body = result.model_dump(mode='json', exclude={'offers': {'__all__': compact}})
        for offer in body['offers']:
            if offer['trip_rating']:
                offer['trip_rating'] = {key: offer['trip_rating'][key] for key in ('score', 'preliminary_score')}
        # Hint «back later, cheaper»: offer id → the longer, cheaper trip. Not tied to the weekend filter on purpose.
        body['longer'] = {offer_id: trip.model_dump(mode='json', exclude=compact) for offer_id, trip in longer_stays(result.offers, pool, request, now()).items()}
        return JSONResponse(body, headers={'Cache-Control': 'public, max-age=60, s-maxage=600, stale-while-revalidate=600'})

    @app.post('/api/v1/search/batch', response_model=BatchSearchResponse)
    async def batch_endpoint(request: BatchSearchRequest):
        # One bounded user action: up to seven route/date pairs, two in parallel.
        limiter.check()
        slots = asyncio.Semaphore(2)
        async def one(query):
            async with slots:
                try:
                    return BatchSearchItem(result=await search(query))
                except SearchError as error:
                    return BatchSearchItem(error=error.message)
        return BatchSearchResponse(results=await asyncio.gather(*(one(query) for query in request.queries)))

    @app.get('/go')
    async def go(u: str = '', s: str = ''):
        # The only outbound redirect: an exact Aviasales flight or hotel search URL, or its Travelpayouts partner link.
        # s is an optional click label for partner reports; anything but a short slug is dropped.
        try:
            if len(u) > 1000:
                raise ValueError('link')
            try:
                url = safe_search_url(u)
            except ValueError:
                try:
                    url = safe_hotel_url(u)
                except ValueError:
                    url = safe_listed_url(u, catalog.ostrovok_urls, 'ostrovok.ru')
        except ValueError:
            raise SearchError('validation', 'Ссылка должна вести на поиск Aviasales.', 422) from None
        label = s if re.fullmatch(r'[a-z0-9-]{1,32}', s) else ''
        return RedirectResponse(await app.state.upstream.partner_link(url, label) or url, status_code=302, headers={'Cache-Control': 'no-store'})

    # --- Главная-витрина (этап 3): один адрес на город вылета, кешируется как поиск ---
    def data_file(name, default):
        path = WEB_DIR / 'data' / name
        return json.loads(path.read_text()) if path.exists() else default
    holidays = data_file('holidays.json', None)
    calendar_ru = showcase.load_calendar(holidays) if holidays else showcase.Calendar()
    city_tags, guides = data_file('city-tags.json', {}), data_file('city-guides.json', {})
    compact = {'outbound_segments', 'inbound_segments', 'trip_rating', 'partner_url', 'source', 'currency', 'availability', 'expires_at'}

    def web_query(origin, request, price_minor):
        """Параметры поиска сайта, который находит эту поездку: для «Поделиться» и открытия по ссылке."""
        params = {'from': origin['iata']}
        if origin['all']:
            params['fc'] = origin['code']
        if request.destination:
            params.update(to=request.destination, tc=request.destination_city_code)
        if request.departure_date:
            params.update(dep=request.departure_date, ret=request.return_date)
        else:
            params.update(month=request.month, weekend='0')
        params['budget'] = min(500000, max(5000, math.ceil(price_minor / 100000) * 1000))
        return urlencode(params)

    async def build_home(origin):
        moment = now()
        airport = BY_IATA[origin['iata']]
        today = moment.astimezone(ZoneInfo(airport['timezone'])).date()
        calendar = calendar_ru if airport['country_code'] == 'RU' else showcase.Calendar()
        base = dict(origin=origin['iata'], origin_city_code=origin['code'] if origin['all'] else None, max_budget_minor=50000000, weekend_only=False)
        horizon = today.year * 12 + today.month + 5
        def exact(start, end):
            if start < today or start.year * 12 + start.month > horizon:
                return None
            return SearchRequest(month=start.strftime('%Y-%m'), departure_date=start.isoformat(), return_date=end.isoformat(), **base)
        fridays = showcase.upcoming_fridays(today)
        window = showcase.next_window(calendar, today) if calendar.period else None
        requests = [SearchRequest(month=month, **base) for month in city_pages.month_keys(today)[:2]]
        requests += [exact(a, b) for friday in fridays for a, b in showcase.weekend_pairs(friday)]
        requests += [exact(a, b) for a, b in (showcase.window_pairs(window, calendar) if window else [])]
        slots = asyncio.Semaphore(6)
        async def fetch(request):
            async with slots:
                try:
                    return request, await source(request)
                except SearchError:
                    return request, None
        async def run(batch, timeout):
            done, pending = await asyncio.wait([asyncio.create_task(fetch(request)) for request in batch if request], timeout=timeout)
            return [task.result() for task in done], bool(pending)
        found, late = await run(requests, 15)
        if not any(result for _, result in found):
            raise SearchError('upstream_http', 'Не удалось собрать подборки. Попробуйте позже.', 503)
        live = lambda offer: offer.departure_at > moment and offer.availability != 'unavailable' and (offer.expires_at is None or offer.expires_at > moment)
        pool, origin_of, received = {}, {}, []
        def collect(results):
            for request, result in results:
                if not result:
                    continue
                received.append(result.received_at)
                for offer in result.offers:
                    if live(offer) and (offer.id not in pool or offer.price_minor < pool[offer.id].price_minor):
                        pool[offer.id], origin_of[offer.id] = offer, request
        collect(found)
        offers = list(pool.values())
        rows, notes = [], {}
        for number, friday in enumerate(fridays):
            title = ('На эти выходные' if today.weekday() < 5 else 'На ближайшие выходные') if number == 0 else 'На следующие выходные'
            rows.append(dict(key=f'weekend{number + 1}', title=title, hint=f'{showcase.date_span(friday, friday + timedelta(days=2))}, без отпуска',
                             items=showcase.one_per_city(showcase.weekend_trips(offers, friday, calendar))))
        if window:
            trips = showcase.window_trips(offers, window, calendar)
            leave = {offer.id: days for offer, days in trips}
            items = showcase.one_per_city([offer for offer, _ in trips])
            notes.update({offer.id: {'leave': leave[offer.id], 'trip': showcase.nights(offer) + 1} for offer in items})
            length = (window[1] - window[0]).days + 1
            title = 'Новогодние каникулы' if any(day.month == 1 and day.day == 1 for day in (window[0] + timedelta(days=n) for n in range(length))) else 'Длинные выходные'
            rows.append(dict(key='holidays', title=title, hint=f'{showcase.date_span(*window)}: {length} {showcase.plural(length, "день", "дня", "дней")} отдыха подряд', items=items))
        tiers = showcase.budget_tiers(offers)
        budget = [dict(key=f'budget{upper}', title=f'До {upper:,} ₽'.replace(',', '\u00a0'),
                       hint='Туда и обратно на одного' if not lower else f'От {lower:,} до {upper:,} ₽ туда и обратно'.replace(',', '\u00a0'), items=items)
                  for lower, upper, items in tiers]
        goals = {key: dict(key=key, title=title, hint=hint, items=showcase.tagged(offers, set(city_tags.get(key, []))))
                 for key, title, hint in (('sea', 'К морю', 'Города на морском побережье'), ('mountains', 'Горы и природа', 'Горы, озёра, заповедная природа рядом'),
                                          ('food', 'Гастрономия', 'Где стоит попробовать местную кухню'))}
        city_break = dict(key='city2', title='Город на два дня', hint='1–2 ночи, перелёт до 4 часов, есть наши заметки о городе', items=showcase.city_break(offers, guides))
        rows += [budget[0], goals['sea'], budget[1], goals['mountains'], city_break, goals['food'], budget[2], budget[3]]
        rows = [row for row in rows if len(row['items']) >= showcase.ROW_MIN]
        # Вторая ступень: поиск маршрута на месяц — для кандидатов в «Горячие билеты» и первых карточек подборок.
        targets = {}
        for offer in showcase.hot_candidates(offers, today) + [offer for depth in range(6) for row in rows for offer in row['items'][depth:depth + 1]]:
            key = (offer.city_code, offer.departure_at.strftime('%Y-%m'))
            if key not in targets and len(targets) < 24:
                targets[key] = SearchRequest(month=key[1], destination=offer.destination_airport, destination_city_code=offer.city_code, **base)
        routes, late_routes = await run(list(targets.values()), 6)
        route_offers = [offer for _, result in routes if result for offer in result.offers if live(offer)]
        usual = showcase.usual_prices(route_offers)
        collect(routes)
        hot = showcase.hot_tickets(list(pool.values()), usual, today)
        if len(hot) >= showcase.ROW_MIN:
            rows.insert(0, dict(key='hot', title='Горячие билеты', hint='Вылет в ближайшие две недели, цена заметно ниже обычной', items=hot, kind='pass'))
        shown = {offer.id: offer for row in rows for offer in row['items'][:showcase.ROW_MAX]}
        body = {
            'origin': city_pages.origin_public(origin), 'today': today.isoformat(), 'complete': not late and not late_routes,
            'received_at': min(received).isoformat(),
            'rows': [{'key': row['key'], 'title': row['title'], 'hint': row['hint'], 'kind': row.get('kind', 'stamp'),
                      'items': [offer.id for offer in row['items'][:showcase.ROW_MAX]]} for row in rows],
            'offers': {offer_id: offer.model_dump(mode='json', exclude=compact) | {'q': web_query(origin, origin_of[offer_id], offer.price_minor)} for offer_id, offer in shown.items()},
            'notes': {offer_id: note for offer_id, note in notes.items() if offer_id in shown},
            'usual': {f'{city}|{month}|{part}': list(value) for (city, month, part), value in usual.items()},
        }
        prices = {offer.id: (offer.price_minor, offer.received_at.isoformat()) for offer in pool.values()}
        return body, prices

    # Готовая главная живёт дольше, чем считается свежей: первые 10 минут — свежая; до 6 часов (в пределах тех же суток)
    # её отдают сразу, а новую собирают в фоне. Сборка без кеша — 4–8 секунд; ждёт её только первый посетитель
    # после перезапуска сервера (после выкладки сайт прогревается: scripts/warm_home.sh).
    HOME_FRESH, HOME_KEEP, HOME_ORIGINS = timedelta(minutes=10), timedelta(hours=6), 20
    home_store, home_builds = {}, {}

    def rebuild_home(origin, key, today):
        if key not in home_builds:
            async def run():
                try:
                    limiter.check()  # одна сборка главной — одно действие посетителя
                    body, prices = await build_home(origin)
                    home_store.pop(key, None)
                    home_store[key] = (now(), today, body, prices)
                    while len(home_store) > HOME_ORIGINS:
                        home_store.pop(next(iter(home_store)))
                finally:
                    home_builds.pop(key, None)
            task = asyncio.create_task(run())
            # Фоновую сборку никто не ждёт: её ошибка не должна теряться молча в журнале как «не прочитанная».
            task.add_done_callback(lambda done: done.cancelled() or done.exception())
            home_builds[key] = task
        return home_builds[key]

    async def home_for(origin):
        key = (origin['iata'], origin['all'])
        today = now().astimezone(ZoneInfo(BY_IATA[origin['iata']]['timezone'])).date().isoformat()
        entry = home_store.get(key)
        usable = entry is not None and entry[1] == today and now() - entry[0] < HOME_KEEP
        if usable and now() - entry[0] < HOME_FRESH:
            return entry[2], entry[3]
        task = rebuild_home(origin, key, today)
        if usable:
            return entry[2], entry[3]  # устаревшая, но сегодняшняя — сразу; дата цен в ней своя и показывается
        await asyncio.shield(task)
        return home_store[key][2], home_store[key][3]

    @app.get('/api/v1/home')
    async def home_endpoint(origin: str = Query(alias='from'), fc: str | None = None):
        chosen = origin_for(origin, fc)
        if not chosen:
            raise SearchError('validation', 'Выберите город вылета из справочника.', 422)
        body, _ = await home_for(chosen)
        # CDN: 10 минут свежая, потом сутки отдаёт прежнюю и сам обновляет её в фоне.
        cache_control = 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400' if body['complete'] else 'public, max-age=30, s-maxage=60, stale-while-revalidate=600'
        return JSONResponse(body, headers={'Cache-Control': cache_control})

    @app.get('/api/v1/home/prices')
    async def home_prices(origin: str = Query(alias='from'), fc: str | None = None, ids: str = ''):
        """Цены тех же самых поездок сейчас — для «Продолжить планирование». Не найдена — значит, её нет в свежих находках."""
        chosen, wanted = origin_for(origin, fc), [value for value in ids.split(',') if value][:8]
        if not chosen or not wanted or not all(re.fullmatch(r'[0-9a-f]{32}', value) for value in wanted):
            raise SearchError('validation', 'Проверьте список поездок.', 422)
        _, prices = await home_for(chosen)
        found = {value: {'price_minor': prices[value][0], 'received_at': prices[value][1]} for value in wanted if value in prices}
        return JSONResponse({'prices': found}, headers={'Cache-Control': 'private, max-age=300'})

    # --- Страницы городов и маршрутов: готовый HTML (этап 4) ---
    page_cache = 'public, max-age=60, s-maxage=600, stale-while-revalidate=600'
    def not_found():
        missing = WEB_DIR / '404.html'
        return HTMLResponse(missing.read_text() if missing.exists() else 'Не найдено', status_code=404)

    def origin_for(iata, fc=None):
        airport = BY_IATA.get(iata or '')
        if not airport or not airport['timezone'] or (fc and fc != airport['city_code']):
            return None
        known = catalog.origin_by_code.get(airport['city_code'])
        if known and known['iata'] == iata and known['all'] == bool(fc):
            return known
        return {'code': airport['city_code'], 'iata': iata, 'all': bool(fc), 'name': airport['city'], 'from': (known or {}).get('from') or f'города {airport["city"]}'}

    async def city_fares(city, origin, fixed=False):
        moment = now()
        months = city_pages.month_keys(moment.astimezone(ZoneInfo(BY_IATA[origin['iata']]['timezone'])))
        async def one(month):
            request = SearchRequest(origin=origin['iata'], origin_city_code=origin['code'] if origin['all'] else None, destination=city['airport'],
                                    destination_city_code=city['code'], month=month, weekend_only=False, max_budget_minor=50000000)
            try:
                return month, await source(request, pages_limiter.check)
            except SearchError:
                return month, None
        done, pending = await asyncio.wait([asyncio.create_task(one(month)) for month in months], timeout=8)
        results = dict(task.result() for task in done)
        found = {month: result.offers for month, result in results.items() if result}
        received = [result.received_at for result in results.values() if result]
        parts = city_pages.fares(catalog, city, origin, city_pages.cheapest_by_month(found, moment), min(received) if received else moment, fixed)
        # Не все месяцы ответили — короткий кеш, чтобы недостающее появилось быстро.
        return parts, page_cache if not pending and len(found) == len(results) == len(months) else 'public, max-age=30, s-maxage=60'

    def default_origin(city):
        return catalog.origin_by_code['LED' if city['code'] == catalog.default_origin else catalog.default_origin]

    @app.get('/city/', response_class=HTMLResponse)
    async def city_index():
        return HTMLResponse(city_pages.index_page(catalog), headers={'Cache-Control': page_cache})

    @app.get('/city/{name}', response_class=HTMLResponse)
    async def city_page(name: str):
        city = catalog.by_slug.get(name)
        if not city:
            return not_found()
        origin = default_origin(city)
        parts, cache_control = await city_fares(city, origin)
        return HTMLResponse(city_pages.page(catalog, city, origin, parts), headers={'Cache-Control': cache_control})

    @app.get('/route/{path}', response_class=HTMLResponse)
    async def route_page(path: str):
        found = catalog.route(path)
        if not found:
            return not_found()
        origin, city = found
        parts, cache_control = await city_fares(city, origin, fixed=True)
        return HTMLResponse(city_pages.page(catalog, city, origin, parts, route=True), headers={'Cache-Control': cache_control})

    @app.get('/api/v1/city/{code}')
    async def city_fares_endpoint(code: str, origin: str = Query(alias='from'), fc: str | None = None):
        city, chosen = catalog.by_code.get(code), origin_for(origin, fc)
        if not city or not chosen:
            raise SearchError('validation', 'Выберите город из списка.', 422)
        if chosen['code'] == city['code']:
            raise SearchError('validation', 'Города вылета и назначения должны различаться.', 422)
        parts, cache_control = await city_fares(city, chosen)
        return JSONResponse({'origin': city_pages.origin_public(chosen), **{key: parts[key] for key in ('price', 'months', 'stay', 'has_prices')}},
                            headers={'Cache-Control': cache_control})

    @app.get('/api/v1/origin')
    async def visitor_origin(request: Request):
        # Город по IP определяет хостинг (заголовки Vercel); мы берём только ближайший город вылета и ничего не храним.
        origin, detected = city_pages.nearest_origin(request.headers.get('x-vercel-ip-latitude'), request.headers.get('x-vercel-ip-longitude'),
                                                     catalog.origins, catalog.radius_km, catalog.default_origin)
        # located — пришло ли местоположение от хостинга вообще (без координат): так видно, работает ли подсказка на тарифе.
        located = bool(request.headers.get('x-vercel-ip-latitude'))
        return JSONResponse(city_pages.origin_public(origin) | {'detected': detected, 'located': located}, headers={'Cache-Control': 'private, no-store'})

    @app.get('/favicon.ico', include_in_schema=False)
    async def favicon():
        # Браузеры сами спрашивают /favicon.ico; значок сайта — SVG.
        return RedirectResponse('/favicon.svg', status_code=301)

    # Registered last so the site never shadows API routes.
    if WEB_DIR.is_dir():
        app.mount('/', StaticFiles(directory=WEB_DIR, html=True), name='web')

    return app

app = create_app()

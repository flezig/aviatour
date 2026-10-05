import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import httpx
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from .catalog import AIRPORTS, BY_IATA
from .errors import SearchError
from .models import SearchRequest, SearchResponse, BatchSearchRequest, BatchSearchItem, BatchSearchResponse
from .runtime import TTLCache, RateLimiter
from .settings import Settings
from .upstream import Travelpayouts
from .rules import matches
from .regions import includes
from .rating import evaluate, round_int
from .rating_sources import RatingSources, load_reviewed_data
from .hotel_source import AmadeusHotels


def create_app(settings=None, transport=None, now=lambda: datetime.now(timezone.utc)):
    settings = settings or Settings.env()
    cache, limiter = TTLCache(settings.ttl, settings.capacity), RateLimiter(settings.rate)
    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(transport=transport, follow_redirects=False, timeout=5, headers={'Accept-Encoding': 'gzip, deflate'}) as client:
            app.state.upstream = Travelpayouts(client, settings, now)
            app.state.hotel_source = AmadeusHotels(client, settings.amadeus_client_id, settings.amadeus_client_secret)
            app.state.rating_sources = RatingSources(client, settings.gpm_key)
            data, app.state.rating_data_status = load_reviewed_data(settings.rating_data_file)
            app.state.rating_data = {}
            for item in data:
                app.state.rating_data.setdefault(item.city_code, []).append(item)
            yield
    app = FastAPI(title='Aviator', lifespan=lifespan)
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
        return AIRPORTS
    async def search(request: SearchRequest):
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
        result = await cache.get_or_create(key, lambda: app.state.upstream.search_region(broad) if request.region != 'any' and not request.destination else app.state.upstream.search(broad), refresh=request.force_refresh)
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

    @app.post('/api/v1/search', response_model=SearchResponse)
    async def search_endpoint(request: SearchRequest):
        limiter.check()
        return await search(request)

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

    return app

app = create_app()

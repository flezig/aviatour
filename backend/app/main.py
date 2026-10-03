from contextlib import asynccontextmanager
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import httpx
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from .catalog import AIRPORTS, BY_IATA
from .errors import SearchError
from .models import SearchRequest, SearchResponse
from .runtime import TTLCache, RateLimiter
from .settings import Settings
from .upstream import Travelpayouts


def create_app(settings=None, transport=None, now=lambda: datetime.now(timezone.utc)):
    settings = settings or Settings.env()
    cache, limiter = TTLCache(settings.ttl, settings.capacity), RateLimiter(settings.rate)
    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(transport=transport, follow_redirects=False, timeout=5, headers={'Accept-Encoding': 'gzip, deflate'}) as client:
            app.state.upstream = Travelpayouts(client, settings, now)
            yield
    app = FastAPI(title='Aviator', lifespan=lifespan)
    @app.exception_handler(SearchError)
    async def search_error(_, error):
        return JSONResponse(status_code=error.status, content={'error': {'code': error.code, 'message': error.message}}, headers={'Retry-After': str(error.retry_after)} if error.retry_after else None)
    @app.exception_handler(RequestValidationError)
    async def validation_error(_, error):
        return JSONResponse(status_code=422, content={'error': {'code': 'validation', 'message': 'Проверьте аэропорт, месяц и бюджет.'}})
    @app.get('/health')
    async def health():
        return {'status': 'ok', 'live_configured': bool(settings.token)}
    @app.get('/api/v1/airports')
    async def airports():
        return AIRPORTS
    @app.post('/api/v1/search', response_model=SearchResponse)
    async def search(request: SearchRequest):
        limiter.check()
        airport = BY_IATA.get(request.origin)
        if not airport or not airport['timezone']:
            raise SearchError('validation', 'Выберите аэропорт из справочника.', 422)
        if request.origin_city_code and request.origin_city_code != airport['city_code']:
            raise SearchError('validation', 'Город не соответствует выбранному аэропорту.', 422)
        local_now = now().astimezone(ZoneInfo(airport['timezone']))
        year, month = map(int, request.month.split('-'))
        distance = year * 12 + month - (local_now.year * 12 + local_now.month)
        if not 0 <= distance <= 5:
            raise SearchError('validation', 'Выберите текущий месяц или один из следующих пяти.', 422)
        key = (request.origin, request.month, request.max_budget_minor, request.direct_only, request.origin_city_code, settings.market, 'rub')
        result = await cache.get_or_create(key, lambda: app.state.upstream.search(request))
        # A valid cached response can become stale before TTL expires.
        return result.model_copy(update={'offers': [o for o in result.offers if o.departure_at > now()]})
    return app

app = create_app()

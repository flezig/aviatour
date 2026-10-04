import asyncio
import json
import time
from datetime import datetime, timezone
from decimal import Decimal
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlsplit
import httpx
from .errors import SearchError
from .models import SearchResponse
from .rules import normalize
from .runtime import RateLimiter
from .regions import REGION_CITIES
from .catalog import AIRPORTS

class Travelpayouts:
    def __init__(self, client, settings, now=lambda: datetime.now(timezone.utc), clock=time.monotonic, sleep=asyncio.sleep):
        self.client, self.settings, self.now, self.clock, self.sleep = client, settings, now, clock, sleep
        self.limiter = RateLimiter(550, clock)  # below documented 600/min
        self.blocked_until = 0
        self.region_slots = asyncio.Semaphore(4)
        self.partner_links = json.loads(Path(settings.partner_links_file).read_text()) if settings.partner_links_file else {}

    def partner(self, url):
        value = self.partner_links.get(url)
        if not isinstance(value, str):
            return None
        parts = urlsplit(value)
        # Only pre-generated links from the official cabinet, never invent parameters.
        if parts.scheme == 'https' and parts.hostname in {'tp.media', 'avs.io'} and not parts.username and not parts.password and parts.port in (None, 443):
            return value
        return None

    def retry_delay(self, response):
        raw = response.headers.get('Retry-After', '1')
        try:
            return max(0, float(raw))
        except ValueError:
            try:
                return max(0, (parsedate_to_datetime(raw) - self.now()).total_seconds())
            except (ValueError, TypeError):
                return 1

    async def page(self, params, deadline):
        for attempt in range(3):
            remaining = deadline - self.clock()
            if remaining <= 0:
                raise SearchError('timeout', 'Источник не ответил за отведённое время.', 504)
            delay = max(0, self.blocked_until - self.clock())
            if delay >= remaining:
                raise SearchError('rate_limit', 'Источник ограничил запросы. Повторите позже.', 429, int(delay) + 1)
            if delay:
                await self.sleep(delay)
            self.limiter.check()
            try:
                response = await self.client.get('https://api.travelpayouts.com/aviasales/v3/prices_for_dates', params=params,
                    headers={'X-Access-Token': self.settings.token}, timeout=min(5, max(.01, deadline-self.clock())))
            except httpx.RequestError:
                if attempt < 2 and self.clock() + .25 < deadline:
                    await self.sleep(.25)
                    continue
                raise SearchError('timeout', 'Не удалось получить ответ источника.', 504) from None
            if response.status_code in (401, 403):
                raise SearchError('upstream_auth', 'Источник отклонил авторизацию backend.')
            if response.status_code == 429 or response.status_code in (500, 502, 503, 504):
                wait = self.retry_delay(response)
                if response.status_code == 429:
                    self.blocked_until = self.clock() + wait
                if attempt < 2 and self.clock() + wait < deadline:
                    await self.sleep(wait)
                    continue
                raise SearchError('upstream_http', 'Источник временно недоступен. Попробуйте позже.')
            if not response.is_success:
                raise SearchError('upstream_http', 'Ошибка ответа источника.')
            if response.headers.get('X-Rate-Limit-Remaining') == '0':
                try:
                    self.blocked_until = self.clock() + max(0, float(response.headers.get('X-Rate-Limit-Reset', '60')))
                except ValueError:
                    self.blocked_until = self.clock() + 60
            try:
                payload = await asyncio.to_thread(json.loads, response.text, parse_float=Decimal)
            except (ValueError, TypeError):
                raise SearchError('upstream_json', 'Источник вернул некорректный JSON.') from None
            if not isinstance(payload, dict) or not isinstance(payload.get('success'), bool):
                raise SearchError('upstream_json', 'Источник вернул некорректную структуру.')
            if payload['success'] is False:
                raise SearchError('upstream_failure', 'Источник сообщил об ошибке поиска.')
            if not isinstance(payload.get('data'), list):
                raise SearchError('upstream_json', 'Источник вернул некорректный список.')
            if str(payload.get('currency', 'rub')).upper() != 'RUB':
                raise SearchError('upstream_json', 'Валюта источника не соответствует RUB.')
            return payload

    @staticmethod
    def normalize_page(rows, request, received, currency):
        offers, invalid, seen = [], False, set()
        for row in rows:
            identity = json.dumps(row, sort_keys=True, default=str)
            if identity in seen:
                continue
            seen.add(identity)
            try:
                offer = normalize(row, request, received, currency)
                if offer:
                    offers.append(offer)
            except (ValueError, TypeError, KeyError, OverflowError):
                invalid = True
        return offers, invalid

    async def search(self, request, *, page_limit=None, row_limit=1000):
        if not self.settings.token:
            raise SearchError('configuration', 'LIVE не настроен: добавьте токен Travelpayouts на backend.', 503)
        deadline = self.clock() + self.settings.timeout
        offers, warnings, pages_read = {}, [], 0
        async def collect():
            nonlocal pages_read
            for page in range(1, (page_limit or self.settings.pages) + 1):
                try:
                    params = dict(origin=request.origin_city_code or request.origin, departure_at=request.departure_date or request.month,
                        one_way='false', currency='rub', market=self.settings.market,
                        direct=str(request.direct_only).lower(), unique='false', sorting='price', limit=row_limit, page=page)
                    if request.return_date:
                        params['return_at'] = request.return_date
                    if request.destination:
                        params['destination'] = request.destination_city_code or request.destination
                    payload = await self.page(params, deadline)
                except SearchError as error:
                    if not pages_read:
                        raise
                    warnings.append('Не удалось получить следующую страницу: ' + error.code)
                    break
                pages_read += 1
                received = self.now()
                # Parsing thousands of records must not block other HTTP requests.
                page_offers, invalid = await asyncio.to_thread(self.normalize_page, payload['data'], request, received, payload.get('currency', 'rub'))
                if invalid and 'Некорректные записи исключены.' not in warnings:
                    warnings.append('Некорректные записи исключены.')
                for offer in page_offers:
                    offer.partner_url = self.partner(offer.search_url)
                    previous = offers.get(offer.id)
                    if previous is None or offer.price_minor < previous.price_minor:
                        offers[offer.id] = offer
                if len(payload['data']) < row_limit:
                    break
                if page == (page_limit or self.settings.pages):
                    warnings.append('Достигнут предел страниц.')
        try:
            async with asyncio.timeout(self.settings.timeout):
                await collect()
        except TimeoutError:
            if not pages_read:
                raise SearchError('timeout', 'Поиск превысил 20 секунд.', 504) from None
            warnings.append('Достигнут предел времени.')
        return SearchResponse(offers=sorted(offers.values(), key=lambda o: (o.price_minor, o.city_code, o.id)), received_at=self.now(), incomplete=bool(warnings), warnings=warnings)

    async def search_region(self, request):
        # A bounded selection of popular cities, not a complete inventory of the region.
        cities = REGION_CITIES[request.region]
        targets = {a['city_code']: a['iata'] for a in AIRPORTS if a['city_code'] in cities and a['timezone']}
        completed, errors = [], []
        async def fetch(city):
            async with self.region_slots:
                target = request.model_copy(update={'destination': targets[city], 'destination_city_code': city})
                try:
                    completed.append(await self.search(target, page_limit=2, row_limit=100))
                except SearchError as error:
                    errors.append(error)
        tasks = [asyncio.create_task(fetch(city)) for city in cities if city in targets and city != request.origin_city_code]
        try:
            await asyncio.wait(tasks, timeout=self.settings.timeout)
        finally:
            unfinished = [task for task in tasks if not task.done()]
            for task in unfinished:
                task.cancel()
            outcomes = await asyncio.gather(*tasks, return_exceptions=True)
            for outcome in outcomes:
                if isinstance(outcome, Exception):
                    raise outcome
        if not completed:
            if errors:
                raise errors[0]
            raise SearchError('timeout', 'Не удалось проверить города за отведённое время. Попробуйте конкретный город.', 504)
        offers = {offer.id: offer for result in completed for offer in result.offers}
        warnings = ['Поиск по основным городам региона; другие города доступны через выбор направления.']
        if unfinished or errors or any(result.incomplete for result in completed):
            warnings.append('Часть городов или дат не удалось проверить полностью. Попробуйте конкретный город.')
        return SearchResponse(offers=sorted(offers.values(), key=lambda o: (o.price_minor, o.city_code, o.id)),
            received_at=self.now(), incomplete=True, warnings=warnings)

"""Small read-only adapters. Raw observations never become a trip quote implicitly."""
import asyncio
from collections import deque
import json
from pathlib import Path
from datetime import datetime, timezone
import httpx
from .rating import DestinationData
from .runtime import TTLCache

class RatingSources:
    def __init__(self, client, gpm_key='', ttl=86400):
        self.client, self.gpm_key = client, gpm_key
        self.cache = TTLCache(ttl, 64)
        self.slots = asyncio.Semaphore(1)
        self.last_request = 0.0
        self.gpm_hits = deque()
        self.blocked_until = {}

    async def get(self, name, url, params=None, headers=None):
        key = (name, tuple(sorted((params or {}).items())))
        async def fetch():
            async with self.slots:
                loop = asyncio.get_running_loop()
                await asyncio.sleep(max(0, 1.1 - (loop.time() - self.last_request)))
                family = 'gpm' if name.startswith('gpm') else name
                current = loop.time()
                if self.blocked_until.get(family, 0) > current:
                    return {'status': 'unavailable', 'data': None}
                if family == 'gpm':
                    while self.gpm_hits and self.gpm_hits[0] <= current - 86400:
                        self.gpm_hits.popleft()
                    if len(self.gpm_hits) >= 1000:
                        return {'status': 'unavailable', 'data': None}
                    self.gpm_hits.append(current)
                self.last_request = current
                try:
                    response = await self.client.get(url, params=params, headers=headers, timeout=5)
                    if response.status_code == 429:
                        try:
                            delay = min(86400, max(60, float(response.headers.get('Retry-After', 60))))
                        except ValueError:
                            delay = 60
                        self.blocked_until[family] = loop.time() + delay
                    response.raise_for_status()
                    data = response.json()
                    return {'status': 'ok', 'data': data, 'fetched_at': datetime.now(timezone.utc).isoformat()}
                except (httpx.HTTPError, ValueError):
                    # Never return response body, credentials, or exception URLs to the client.
                    return {'status': 'unavailable', 'data': None}
        return await self.cache.get_or_create(key, fetch)

    async def food_observations(self, latitude, longitude):
        return await self.get('open_prices', 'https://prices.openfoodfacts.org/api/v1/prices',
            {'lat': latitude, 'lon': longitude, 'radius_km': 15, 'size': 100, 'page': 1, 'order_by': '-date'})

    async def property_context(self):
        return await self.get('gpm', 'https://globalpropertymetrics.com/api/global-baseline', {'limit': 100})

    async def municipal_context(self, country, city):
        if not self.gpm_key:
            return {'status': 'needs_key', 'data': None}
        return await self.get('gpm_city', 'https://globalpropertymetrics.com/api/municipal-housing',
            {'country': country, 'city': city, 'observations': 'true'}, {'X-API-Key': self.gpm_key})


def load_reviewed_data(path):
    """An unavailable/malformed evidence feed must not break airfare search."""
    if not path:
        return [], 'not_configured'
    try:
        raw = json.loads(Path(path).read_text())
        if not isinstance(raw, list) or len(raw) > 10000:
            return [], 'invalid'
        return [DestinationData.model_validate(row) for row in raw], 'ok'
    except (OSError, ValueError, TypeError):
        return [], 'unavailable'

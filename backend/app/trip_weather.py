"""Destination forecast from MET Norway, cached per city, shared across all travel dates."""
import math
from datetime import datetime
from zoneinfo import ZoneInfo
import httpx

from .catalog import AIRPORTS
from .city_insights import GUIDES
from .runtime import RateLimiter, TTLCache


class TripWeather:
    def __init__(self, client, origins):
        self.client = client
        self.cache = TTLCache(3 * 3600, 160)
        self.limit = RateLimiter(30)
        self.places = {o['code']: (o['lat'], o['lon']) for o in origins}
        self.places.update({code: (g['latitude'], g['longitude']) for code, g in GUIDES.items()})
        self.zones = {a['city_code']: a['timezone'] for a in AIRPORTS if a.get('timezone')}

    async def forecast(self, code):
        if code not in self.places or code not in self.zones:
            return None

        async def fetch():
            self.limit.check()
            lat, lon = self.places[code]
            response = await self.client.get('https://api.met.no/weatherapi/locationforecast/2.0/compact',
                params={'lat': round(lat, 3), 'lon': round(lon, 3)}, timeout=5,
                headers={'User-Agent': 'Aviator/1.0 (https://aviatour.vercel.app/about.html)'})
            response.raise_for_status()
            props = response.json()['properties']
            days = {}
            for row in props['timeseries']:
                day = datetime.fromisoformat(row['time'].replace('Z', '+00:00')).astimezone(ZoneInfo(self.zones[code])).date().isoformat()
                temp = row['data']['instant']['details']['air_temperature']
                if math.isfinite(temp):
                    days.setdefault(day, []).append(temp)
            return {'updated': props['meta']['updated_at'], 'days': [
                {'date': day, 'low': round(min(values)), 'high': round(max(values))} for day, values in sorted(days.items())]}
        try:
            return await self.cache.get_or_create(code, fetch)
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            return None

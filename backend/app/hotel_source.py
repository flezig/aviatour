"""Prepared Amadeus test adapter. No account creation, paid calls, or booking."""
import asyncio
from datetime import date
import httpx
from .runtime import TTLCache

class AmadeusHotels:
    def __init__(self, client, client_id='', client_secret=''):
        self.client, self.client_id, self.client_secret = client, client_id, client_secret
        self.tokens = TTLCache(300, 1)
        self.quotes = TTLCache(300, 64)
        self.slots = asyncio.Semaphore(1)
        # Production must be explicitly reviewed before adding a paid host.
        self.host = 'https://test.api.amadeus.com'

    async def token(self):
        async def fetch():
            response = await self.client.post(self.host + '/v1/security/oauth2/token', data={
                'grant_type':'client_credentials', 'client_id':self.client_id, 'client_secret':self.client_secret}, timeout=5)
            response.raise_for_status()
            value = response.json()
            if value.get('expires_in', 0) < 300:
                raise ValueError('Unexpected token lifetime')
            return value['access_token']
        return await self.tokens.get_or_create('token', fetch)

    async def offers(self, hotel_ids: list[str], check_in: date, check_out: date, adults: int):
        if not self.client_id or not self.client_secret:
            return {'status':'needs_key', 'data':None}
        if not 1 <= adults <= 8 or not 1 <= len(hotel_ids) <= 10 or check_out <= check_in:
            return {'status':'invalid', 'data':None}
        key = (tuple(hotel_ids), check_in, check_out, adults)
        async def fetch():
            async with self.slots:
                try:
                    token = await self.token()
                    response = await self.client.get(self.host + '/v3/shopping/hotel-offers', headers={'Authorization':'Bearer '+token},
                        params={'hotelIds':','.join(hotel_ids), 'checkInDate':check_in.isoformat(),
                                'checkOutDate':check_out.isoformat(), 'adults':adults, 'roomQuantity':1}, timeout=5)
                    response.raise_for_status()
                    # Raw test response is never inserted as a real price in the rating.
                    return {'status':'test_only', 'data':response.json()}
                except (httpx.HTTPError, ValueError, KeyError, TypeError):
                    return {'status':'unavailable', 'data':None}
        return await self.quotes.get_or_create(key, fetch)

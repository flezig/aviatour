import hashlib
import json
from datetime import datetime
from decimal import Decimal, DecimalException, ROUND_CEILING
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo
from functools import lru_cache
import re
from .catalog import BY_IATA, AIRLINE_NAMES
from .models import Offer
from .regions import includes


def rubles_to_minor(value, currency='rub'):
    if not isinstance(currency, str) or currency.upper() != 'RUB':
        raise ValueError('currency')
    if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
        raise ValueError('price must use Decimal')
    try:
        amount = Decimal(value)
    except DecimalException:
        raise ValueError("price") from None
    if not amount.is_finite() or amount <= 0:
        raise ValueError('price')
    return int((amount * 100).to_integral_value(rounding=ROUND_CEILING))


def safe_search_url(link):
    if not isinstance(link, str):
        raise ValueError('link')
    if link.startswith('/search/') and not link.startswith('//'):
        link = 'https://www.aviasales.com' + link
    parts = urlsplit(link)
    if parts.scheme != 'https' or parts.hostname not in {'www.aviasales.com', 'aviasales.com', 'www.aviasales.ru', 'aviasales.ru'} or parts.username or parts.password or parts.port not in (None, 443) or not parts.path.startswith('/search/'):
        raise ValueError('link')
    return link


# An Aviasales hotel search for one city and dates; every parameter must be present, once, in this shape.
HOTEL_PARAMS = {'location_id': r'\d{1,10}', 'location_type': r'city', 'checkin': r'\d{4}-\d{2}-\d{2}', 'checkout': r'\d{4}-\d{2}-\d{2}', 'adults': r'[1-9]'}


def safe_hotel_url(link):
    if not isinstance(link, str):
        raise ValueError('link')
    parts = urlsplit(link)
    if parts.scheme != 'https' or parts.hostname not in {'www.aviasales.com', 'aviasales.com', 'www.aviasales.ru', 'aviasales.ru'} or parts.username or parts.password or parts.port not in (None, 443) or parts.path != '/hotels/search' or parts.fragment:
        raise ValueError('link')
    query = parse_qs(parts.query, keep_blank_values=True, strict_parsing=True)
    if set(query) != set(HOTEL_PARAMS) or any(len(values) != 1 or not re.fullmatch(HOTEL_PARAMS[key], values[0]) for key, values in query.items()):
        raise ValueError('link')
    return link


def count(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError('count')
    return value


def aware(value):
    if not isinstance(value, str):
        raise ValueError('date')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.utcoffset() is None:
        raise ValueError('offset required')
    return result


@lru_cache(maxsize=512)
def zone(name):
    return ZoneInfo(name)


def matches(offer, request, now):
    if offer.availability == "unavailable" or (offer.expires_at is not None and offer.expires_at <= now):
        return False
    if not includes(request.region, offer.country_code):
        return False
    dep, ret = offer.departure_at, offer.return_at
    if dep <= now or ret <= dep or offer.price_minor > request.max_budget_minor:
        return False
    if request.destination_city_code:
        if offer.city_code != request.destination_city_code:
            return False
    elif request.destination and offer.destination_airport != request.destination:
        return False
    if request.departure_date:
        if dep.date().isoformat() != request.departure_date or ret.date().isoformat() != request.return_date:
            return False
    else:
        if dep.strftime('%Y-%m') != request.month:
            return False
        days = (ret.date() - dep.date()).days
        if request.weekend_only and (dep.weekday(), ret.weekday(), days) not in {(4, 6, 2), (4, 0, 3), (5, 0, 2)}:
            return False
    if request.direct_only and (offer.transfers != 0 or offer.return_transfers != 0):
        return False
    return True


def normalize(row, request, received_at, envelope_currency='rub'):
    if not isinstance(row, dict):
        raise ValueError('record')
    price = rubles_to_minor(row.get('price'), row.get('currency', envelope_currency))
    origin = BY_IATA.get(row.get('origin_airport'))
    destination = BY_IATA.get(row.get('destination_airport'))
    if not origin or not destination or not origin['timezone'] or not destination['timezone']:
        raise ValueError('airport or timezone unavailable')
    # Do not reinterpret city codes as specific airports.
    if request.origin_city_code:
        if origin['city_code'] != request.origin_city_code:
            return None
    elif origin['iata'] != request.origin:
        return None
    dep = aware(row.get('departure_at')).astimezone(zone(origin['timezone']))
    ret = aware(row.get('return_at')).astimezone(zone(destination['timezone']))
    transfers, back = count(row.get('transfers')), count(row.get('return_transfers'))
    # Endpoint has no documented cabin filter. Reject explicit non-economy metadata.
    if row.get('trip_class', 0) != 0:
        return None
    identity = [origin['iata'], destination['iata'], dep.isoformat(), ret.isoformat(), row.get('airline'), str(row.get('flight_number', '')), 'LIVE']
    airline = row.get('airline')
    airline = airline.upper() if isinstance(airline, str) and re.fullmatch(r'[A-Za-z0-9]{2,3}', airline) else None
    number = row.get('flight_number')
    number = str(number) if isinstance(number, (str, int)) and not isinstance(number, bool) else None
    offer = Offer(id=hashlib.sha256(json.dumps(identity).encode()).hexdigest()[:32],
        city_code=destination['city_code'], city=destination['city'], country_code=destination['country_code'], country=destination['country'],
        origin_airport=origin['iata'], origin_city_code=origin['city_code'], destination_airport=destination['iata'], origin_city=origin['city'], origin_name=origin['name'], destination_name=destination['name'],
        departure_at=dep, return_at=ret, origin_timezone=origin['timezone'], destination_timezone=destination['timezone'],
        transfers=transfers, return_transfers=back, duration_to=count(row.get('duration_to')), duration_back=count(row.get('duration_back')),
        price_minor=price, search_url=safe_search_url(row.get('link')), received_at=received_at, airline=airline, airline_name=AIRLINE_NAMES.get(airline), flight_number=number)
    return offer if matches(offer, request, received_at) else None


def longer_stays(offers, pool, request, now):
    """For each offer: the cheapest trip from the same city on the same day that comes back 1–4 days later,
    costs at least 5% and 300 ₽ less and has no more transfers. A longer trip with cheaper tickets is a real
    saving; the extra nights of housing are not included, and the site says so."""
    def no_worse(candidate, current):
        return current is None or (candidate is not None and candidate <= current)
    groups = {}
    for candidate in pool:
        if candidate.departure_at <= now or candidate.availability == 'unavailable':
            continue
        if request.direct_only and (candidate.transfers != 0 or candidate.return_transfers != 0):
            continue
        groups.setdefault((candidate.origin_city_code, candidate.city_code, candidate.departure_at.date()), []).append(candidate)
    found = {}
    for offer in offers:
        best = None
        for candidate in groups.get((offer.origin_city_code, offer.city_code, offer.departure_at.date()), ()):
            extra = (candidate.return_at.date() - offer.return_at.date()).days
            saving = offer.price_minor - candidate.price_minor
            if not 1 <= extra <= 4 or saving < max(30000, offer.price_minor * 0.05):
                continue
            if not no_worse(candidate.transfers, offer.transfers) or not no_worse(candidate.return_transfers, offer.return_transfers):
                continue
            if best is None or candidate.price_minor < best.price_minor:
                best = candidate
        if best:
            found[offer.id] = best
    return found

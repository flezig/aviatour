import hashlib
import json
from datetime import datetime
from decimal import Decimal, DecimalException, ROUND_CEILING
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo
from .catalog import BY_IATA
from .models import Offer


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


def normalize(row, request, received_at, envelope_currency='rub'):
    if not isinstance(row, dict):
        raise ValueError('record')
    price = rubles_to_minor(row.get('price'), row.get('currency', envelope_currency))
    origin = BY_IATA.get(row.get('origin_airport'))
    destination = BY_IATA.get(row.get('destination_airport'))
    if not origin or not destination or not origin['timezone'] or not destination['timezone']:
        raise ValueError('airport or timezone unavailable')
    # Do not reinterpret city codes as specific airports.
    if origin['iata'] != request.origin:
        return None
    dep = aware(row.get('departure_at')).astimezone(ZoneInfo(origin['timezone']))
    ret = aware(row.get('return_at')).astimezone(ZoneInfo(destination['timezone']))
    days = (ret.date() - dep.date()).days
    weekend = (dep.weekday(), ret.weekday(), days) in {(4, 6, 2), (4, 0, 3), (5, 0, 2)}
    transfers, back = count(row.get('transfers')), count(row.get('return_transfers'))
    if dep <= received_at or dep.strftime('%Y-%m') != request.month or not weekend or ret <= dep or price > request.max_budget_minor or (request.direct_only and (transfers != 0 or back != 0)):
        return None
    # Endpoint has no documented cabin filter. Reject explicit non-economy metadata.
    if row.get('trip_class', 0) != 0:
        return None
    identity = [origin['iata'], destination['iata'], dep.isoformat(), ret.isoformat(), row.get('airline'), str(row.get('flight_number', '')), 'LIVE']
    return Offer(id=hashlib.sha256(json.dumps(identity).encode()).hexdigest()[:32],
        city_code=destination['city_code'], city=destination['city'], country_code=destination['country_code'], country=destination['country'],
        origin_airport=origin['iata'], destination_airport=destination['iata'], origin_city=origin['city'], origin_name=origin['name'], destination_name=destination['name'],
        departure_at=dep, return_at=ret, origin_timezone=origin['timezone'], destination_timezone=destination['timezone'],
        transfers=transfers, return_transfers=back, duration_to=count(row.get('duration_to')), duration_back=count(row.get('duration_back')),
        price_minor=price, search_url=safe_search_url(row.get('link')), received_at=received_at)

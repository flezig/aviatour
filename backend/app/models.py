from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

class SearchRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    origin: str = Field(pattern=r'^[A-Z]{3}$')
    origin_city_code: str | None = Field(default=None, pattern=r'^[A-Z]{3}$')
    month: str = Field(pattern=r'^\d{4}-(0[1-9]|1[0-2])$')
    max_budget_minor: int = Field(default=2500000, ge=500000, le=50000000)
    direct_only: bool = False
    force_refresh: bool = False
    region: Literal['any', 'europe', 'usa'] = 'any'
    departure_date: str | None = Field(default=None, pattern=r'^\d{4}-\d{2}-\d{2}$')
    return_date: str | None = Field(default=None, pattern=r'^\d{4}-\d{2}-\d{2}$')
    weekend_only: bool = True
    destination: str | None = Field(default=None, pattern=r'^[A-Z]{3}$')
    destination_city_code: str | None = Field(default=None, pattern=r'^[A-Z]{3}$')

    @model_validator(mode='after')
    def dates(self):
        if (self.departure_date is None) != (self.return_date is None):
            raise ValueError('Обе даты обязательны')
        if self.departure_date:
            departure, returning = date.fromisoformat(self.departure_date), date.fromisoformat(self.return_date)
            if departure.strftime('%Y-%m') != self.month or not 1 <= (returning - departure).days <= 60:
                raise ValueError('Выберите даты поездки длительностью от 1 до 60 дней')
        if self.destination_city_code and not self.destination:
            raise ValueError('Для города нужен аэропорт')
        return self


class FlightSegment(BaseModel):
    id: str
    origin_airport: str = Field(pattern=r'^[A-Z]{3}$')
    destination_airport: str = Field(pattern=r'^[A-Z]{3}$')
    origin_city: str
    destination_city: str
    origin_name: str
    destination_name: str
    origin_timezone: str
    destination_timezone: str
    departure_at: datetime
    arrival_at: datetime
    operating_airline: str | None = None
    marketing_airline: str | None = None
    flight_number: str | None = None

    @model_validator(mode='after')
    def schedule(self):
        from zoneinfo import ZoneInfo
        try:
            ZoneInfo(self.origin_timezone)
            ZoneInfo(self.destination_timezone)
        except KeyError:
            raise ValueError('Invalid segment timezone') from None
        if self.departure_at.utcoffset() is None or self.arrival_at.utcoffset() is None or self.arrival_at <= self.departure_at:
            raise ValueError('Invalid segment times')
        return self


class Offer(BaseModel):
    id: str
    city_code: str
    city: str
    country_code: str | None
    country: str | None
    origin_airport: str
    origin_city_code: str | None = None
    destination_airport: str
    origin_city: str
    origin_name: str
    destination_name: str
    departure_at: datetime
    return_at: datetime
    origin_timezone: str
    destination_timezone: str
    transfers: int | None
    return_transfers: int | None
    duration_to: int | None
    duration_back: int | None
    price_minor: int
    currency: Literal['RUB'] = 'RUB'
    search_url: str
    partner_url: str | None = None
    source: Literal['LIVE'] = 'LIVE'
    received_at: datetime
    airline: str | None = None
    airline_name: str | None = None
    flight_number: str | None = None
    outbound_segments: list[FlightSegment] | None = None
    inbound_segments: list[FlightSegment] | None = None
    availability: Literal['available', 'unavailable', 'unknown'] | None = None
    expires_at: datetime | None = None

    @model_validator(mode='after')
    def itinerary(self):
        if self.expires_at is not None and self.expires_at.utcoffset() is None:
            raise ValueError('Expiry needs timezone')
        for segments, origin, destination, departure in [
            (self.outbound_segments, self.origin_airport, self.destination_airport, self.departure_at),
            (self.inbound_segments, self.destination_airport, self.origin_airport, self.return_at),
        ]:
            if not segments:
                continue
            if segments[0].origin_airport != origin or segments[-1].destination_airport != destination or segments[0].departure_at != departure:
                raise ValueError('Itinerary does not match offer')
            if any(a.arrival_at > b.departure_at for a, b in zip(segments, segments[1:])):
                raise ValueError('Overlapping segments')
        return self

class SearchResponse(BaseModel):
    offers: list[Offer]
    received_at: datetime
    incomplete: bool = False
    warnings: list[str] = Field(default_factory=list)


class BatchSearchRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    queries: list[SearchRequest] = Field(min_length=1, max_length=7)

class BatchSearchItem(BaseModel):
    result: SearchResponse | None = None
    error: str | None = None

class BatchSearchResponse(BaseModel):
    results: list[BatchSearchItem]

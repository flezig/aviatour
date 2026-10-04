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

class SearchResponse(BaseModel):
    offers: list[Offer]
    received_at: datetime
    incomplete: bool = False
    warnings: list[str] = Field(default_factory=list)

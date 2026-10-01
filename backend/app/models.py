from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

class SearchRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    origin: str = Field(pattern=r'^[A-Z]{3}$')
    month: str = Field(pattern=r'^\d{4}-(0[1-9]|1[0-2])$')
    max_budget_minor: int = Field(default=2500000, ge=500000, le=10000000)
    direct_only: bool = False

class Offer(BaseModel):
    id: str
    city_code: str
    city: str
    country_code: str | None
    country: str | None
    origin_airport: str
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

class SearchResponse(BaseModel):
    offers: list[Offer]
    received_at: datetime
    incomplete: bool = False
    warnings: list[str] = Field(default_factory=list)

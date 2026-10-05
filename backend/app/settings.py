import os
from dataclasses import dataclass
from dotenv import load_dotenv
load_dotenv()

@dataclass
class Settings:
    token: str = ''
    market: str = 'ru'
    marker: str = ''
    ttl: int = 900
    capacity: int = 200
    pages: int = 10
    timeout: float = 20
    rate: int = 10
    partner_links_file: str = ''
    rating_data_file: str = ''
    gpm_key: str = ''
    amadeus_client_id: str = ''
    amadeus_client_secret: str = ''

    @classmethod
    def env(cls):
        return cls(amadeus_client_id=os.getenv('AMADEUS_CLIENT_ID', ''), amadeus_client_secret=os.getenv('AMADEUS_CLIENT_SECRET', ''), rating_data_file=os.getenv('RATING_DATA_FILE', ''), gpm_key=os.getenv('GPM_API_KEY', ''), token=os.getenv('TRAVELPAYOUTS_API_TOKEN', ''), market=os.getenv('TRAVELPAYOUTS_MARKET', 'ru') or 'ru', marker=os.getenv('TRAVELPAYOUTS_MARKER', ''),
            ttl=max(1, int(os.getenv('CACHE_TTL_SECONDS', '900'))), capacity=max(1, int(os.getenv('CACHE_MAX_ENTRIES', '200'))),
            pages=max(1, min(10, int(os.getenv('SEARCH_MAX_PAGES', '10')))), timeout=max(.1, min(20, float(os.getenv('SEARCH_TIMEOUT_SECONDS', '20')))),
            rate=max(1, int(os.getenv('RATE_LIMIT_REQUESTS_PER_MINUTE', '10'))), partner_links_file=os.getenv('PARTNER_LINKS_FILE', ''))

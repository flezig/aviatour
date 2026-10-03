"""Реальная проверка backend: выводит только условия и сводку, без токена."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from dotenv import load_dotenv
load_dotenv(ROOT / 'backend' / '.env')
from fastapi.testclient import TestClient
from app.main import create_app
from app.settings import Settings

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--month', required=True, help='YYYY-MM')
parser.add_argument('--budget-rub', type=int, default=25000)
args = parser.parse_args()
settings = Settings.env()
if not settings.token:
    sys.exit('LIVE не настроен: добавьте токен в backend/.env.')
failed = False
with TestClient(create_app(settings)) as client:
    for origin, city in [('LED', None), ('KZN', None), ('OVB', None), ('SVO', 'MOW')]:
        query = dict(origin=origin, month=args.month, max_budget_minor=args.budget_rub * 100, direct_only=False)
        if city:
            query['origin_city_code'] = city
        try:
            response = client.post('/api/v1/search', json=query)
            data = response.json()
            offers = data.get('offers', [])
            summary = dict(query=query, status=response.status_code, offers=len(offers),
                destinations=len({o['city_code'] for o in offers}),
                airports=sorted({o['origin_airport'] for o in offers}),
                cheapest_rub=min((o['price_minor'] for o in offers), default=0) / 100 if offers else None,
                incomplete=data.get('incomplete'), warnings=data.get('warnings', []), error=data.get('error'))
            failed |= response.status_code != 200 or bool(data.get('incomplete'))
            print(json.dumps(summary, ensure_ascii=False), flush=True)
        except Exception:
            failed = True
            print(json.dumps(dict(query=query, error='Проверка не завершена'), ensure_ascii=False), flush=True)
sys.exit(1 if failed else 0)

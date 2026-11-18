"""Bounded read-only source audit. Does not infer food baskets or hotel costs."""
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
import httpx
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app.rating_sources import RatingSources
from app.settings import Settings

PILOT = [
    ('LED', 'Санкт-Петербург', 59.94, 30.31), ('KZN', 'Казань', 55.79, 49.12),
    ('AER', 'Сочи', 43.60, 39.73), ('TBS', 'Тбилиси', 41.72, 44.79),
    ('EVN', 'Ереван', 40.18, 44.51), ('IST', 'Стамбул', 41.01, 28.98),
    ('PAR', 'Париж', 48.86, 2.35), ('ROM', 'Рим', 41.90, 12.50),
    ('BCN', 'Барселона', 41.39, 2.17), ('BER', 'Берлин', 52.52, 13.41),
    ('LON', 'Лондон', 51.51, -.13), ('NYC', 'Нью-Йорк', 40.71, -74.01),
]
async def main():
    settings = Settings.env()
    report = {'checked_at': datetime.now(timezone.utc).isoformat(), 'cities': []}
    async with httpx.AsyncClient(follow_redirects=False, headers={'User-Agent': 'Aviatour-source-audit/1.0'}, timeout=5) as client:
        source = RatingSources(client, settings.gpm_key)
        gpm = await source.property_context()
        report['gpm'] = {'status': gpm['status'], 'generated_at': (gpm.get('data') or {}).get('meta', {}).get('generatedAt'), 'tourist_housing': False}
        for code, name, lat, lon in PILOT:
            result = await source.food_observations(lat, lon)
            data = result.get('data') or {}
            items = data.get('items', []) if isinstance(data, dict) else []
            dates = [i['date'] for i in items if i.get('date')]
            report['cities'].append({'city_code': code, 'city': name, 'status': result['status'],
                'sample_count': len(items), 'reported_total': data.get('total') if isinstance(data, dict) else None,
                'newest_observation': max(dates) if dates else None,
                'normalized_units': sum(i.get('price_per') in ('KILOGRAM', 'UNIT') for i in items),
                'basket_status': 'not_verified', 'housing': 'needs_dated_provider',
                'safety': 'needs_reviewed_method', 'transport': 'needs_local_tariffs', 'conditions': 'not_connected'})
    path = Path(sys.argv[1] if len(sys.argv) > 1 else 'docs/rating-source-probe.json')
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(f'Сохранён аудит {len(PILOT)} городов: {path}')
if __name__ == '__main__':
    asyncio.run(main())

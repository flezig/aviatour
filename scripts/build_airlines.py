"""Обновляет локальные названия авиакомпаний из официального справочника Travelpayouts."""
import json
from pathlib import Path
import httpx

SOURCE = 'https://api.travelpayouts.com/data/airlines.json'
ROOT = Path(__file__).resolve().parents[1]
response = httpx.get(SOURCE, timeout=20, follow_redirects=True)
response.raise_for_status()
rows = response.json()
names = {}
for row in sorted(rows, key=lambda row: bool(row.get('is_active'))):
    code, name = row.get('iata') or row.get('code'), row.get('name')
    if isinstance(code, str) and code and isinstance(name, str) and name:
        names[code] = name
if not names:
    raise ValueError('Справочник пуст; предыдущий снимок сохранён')
(ROOT / 'backend/app/airlines.json').write_text(json.dumps(names, ensure_ascii=False, sort_keys=True, indent=2) + '\n')
print(f'Сохранено {len(names)} названий авиакомпаний; секреты не используются.')

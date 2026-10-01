"""Build bundled airport catalog from documented Travelpayouts dictionaries."""
import json
from pathlib import Path
cities = {x['code']: x for x in json.load(open('/tmp/aviator-cities.json'))}
countries = {x['code']: x['name'] for x in json.load(open('/tmp/aviator-countries.json'))}
items = []
for airport in json.load(open('/tmp/aviator-airports.json')):
    city = cities.get(airport['city_code'])
    if not city or not airport.get('flightable') or airport.get('iata_type') != 'airport':
        continue
    items.append(dict(iata=airport['code'], city_code=city['code'], city=city['name'],
                      name=airport.get('name') or airport['name_translations'].get('en', airport['code']),
                      country_code=airport.get('country_code'), country=countries.get(airport.get('country_code')),
                      timezone=airport.get('time_zone')))
items.sort(key=lambda x: (x['iata'] != 'SVO', x['city'], x['iata']))
for path in ['Aviator/Resources/airports.json', 'backend/app/airports.json']:
    Path(path).write_text(json.dumps(items, ensure_ascii=False, indent=2)+'\n')
print(len(items), 'airports')

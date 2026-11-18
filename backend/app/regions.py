import json
from pathlib import Path


DESTINATION_SCOPES = json.loads(Path(__file__).with_name('destination_scopes.json').read_text(encoding='utf-8'))
REGION_CITIES = {
    region: tuple(scope['cities']) for region, scope in DESTINATION_SCOPES.items() if scope['cities']
}
_REGION_COUNTRIES = {region: frozenset(scope['countries']) for region, scope in DESTINATION_SCOPES.items()}


def includes(region, country):
    return region == 'any' or country in _REGION_COUNTRIES.get(region, ())

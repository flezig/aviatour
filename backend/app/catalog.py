import json
from pathlib import Path
AIRPORTS = json.loads(Path(__file__).with_name('airports.json').read_text())
BY_IATA = {a['iata']: a for a in AIRPORTS}

# Official Travelpayouts snapshot, updated 2026-10-04; no runtime network lookup.
AIRLINE_NAMES = json.loads(Path(__file__).with_name('airlines.json').read_text())

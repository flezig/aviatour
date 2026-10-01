import json
from pathlib import Path
AIRPORTS = json.loads(Path(__file__).with_name('airports.json').read_text())
BY_IATA = {a['iata']: a for a in AIRPORTS}

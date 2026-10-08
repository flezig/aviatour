"""Rebuild the pinned UNDP HDR 2025 snapshot. Review new publications before changing URL/year."""
import csv
import io
import json
from datetime import date
from pathlib import Path
from urllib.request import urlopen

URL = 'https://hdr.undp.org/sites/default/files/2025_HDR/HDR25_Composite_indices_complete_time_series.csv'
root=Path(__file__).resolve().parent.parent
with urlopen(URL,timeout=30) as response:
    rows=csv.DictReader(io.StringIO(response.read().decode('utf-8-sig')))
    values={r['iso3']:dict(value=float(r['hdi_2023']),year=2023,country=r['country']) for r in rows if r.get('hdi_2023') not in (None,'','..')}
assert all(0<=r['value']<=1 for r in values.values()) and len(values)>190
(root/'backend/app/hdi.json').write_text(json.dumps(dict(source=URL,publication='HDR 2025',retrieved=date.today().isoformat(),values=values),ensure_ascii=False,indent=2)+'\n')
guide_path=root/'backend/app/city_guides.json'
guides=json.loads(guide_path.read_text())
for guide in guides.values():
    hdi=values.get(guide['iso3'])
    guide.update(hdi_value=hdi['value'] if hdi else None,hdi_year=hdi['year'] if hdi else None)
content=json.dumps(guides,ensure_ascii=False,indent=2)+'\n'
guide_path.write_text(content);(root/'Aviator/Resources/city-guides.json').write_text(content)
print(f'UNDP: {len(values)} countries; {len(guides)} city guides updated')

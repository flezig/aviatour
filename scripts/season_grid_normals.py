"""Calculate 1991–2020 normals from NASA POWER daily grid cells for missing city pages."""

import argparse
import calendar
import json
import statistics
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def fetch_normal(point, cache):
    params = {
        "latitude": point["lat"],
        "longitude": point["lon"],
        "start": 19910101,
        "end": 20201231,
        "parameters": "T2M_MAX,PRECTOTCORR",
        "community": "RE",
        "format": "JSON",
    }
    url = "https://power.larc.nasa.gov/api/temporal/daily/point?" + urlencode(params)
    for attempt in range(3):
        try:
            if not cache.exists():
                with urlopen(url, timeout=75) as response:
                    raw = response.read()
                json.loads(raw)
                cache.write_bytes(raw)
            break
        except OSError:
            if attempt == 2:
                raise
            time.sleep(2**attempt)
    data = json.loads(cache.read_bytes())["properties"]["parameter"]
    temps, rain = defaultdict(list), defaultdict(list)
    for key, t in data["T2M_MAX"].items():
        p = data["PRECTOTCORR"].get(key, -999)
        if -65 <= t <= 65 and 0 <= p <= 2000:
            temps[key[:6]].append(t)
            rain[key[:6]].append(p)
    normals, totals = [], []
    for month in range(1, 13):
        keys = [
            f"{year}{month:02}"
            for year in range(1991, 2021)
            if len(temps[f"{year}{month:02}"]) == calendar.monthrange(year, month)[1]
        ]
        if len(keys) < 24:
            raise ValueError("Insufficient complete years")
        normals.append(
            round(statistics.mean(statistics.mean(temps[k]) for k in keys), 1)
        )
        totals.append(round(statistics.mean(sum(rain[k]) for k in keys), 1))
    return {
        "source": "NASA POWER",
        "name": "MERRA-2",
        "temperature": normals,
        "precipitation": totals,
        "lat": point["lat"],
        "lon": point["lon"],
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("cities", type=Path)
    p.add_argument("cache", type=Path)
    p.add_argument("output", type=Path)
    p.add_argument("--all-airports", action="store_true")
    p.add_argument(
        "--merge",
        action="store_true",
        help="Merge successful results into the offline catalogue",
    )
    args = p.parse_args()
    coords = {s["code"]: s["coordinates"] for s in json.loads(args.cities.read_bytes())}
    existing = json.loads((ROOT / "backend/app/season_normals.json").read_bytes())
    needed = {
        s["code"]
        for s in json.loads((ROOT / "web/data/cities.json").read_bytes())["cities"]
    }
    if args.all_airports:
        needed = {
            a["city_code"]
            for a in json.loads((ROOT / "backend/app/airports.json").read_bytes())
        }

    def one(code):
        try:
            result = fetch_normal(coords[code], args.cache / (code + "-daily.json"))
            return code, result
        except (KeyError, OSError, ValueError) as error:
            print(code, type(error).__name__, flush=True)
            return code, None

    with ThreadPoolExecutor(4) as pool:
        args.output.write_text(
            json.dumps(
                {c: n for c, n in pool.map(one, sorted(needed - existing.keys())) if n}
            )
        )

    if args.merge:
        existing.update(json.loads(args.output.read_bytes()))
        (ROOT / "backend/app/season_normals.json").write_text(
            json.dumps(
                dict(sorted(existing.items())),
                ensure_ascii=False,
                separators=(",", ":"),
            )
            + "\n"
        )

"""Build the offline city climate catalogue. See docs/season-rating.md for inputs."""

import argparse
import csv
import gzip
import json
import math
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "backend/app"
WEB = ROOT / "web"
RADIUS = 35


def distance(lat, lon, station):
    a, b = math.radians(lat), math.radians(station["lat"])
    d = (
        math.sin((a - b) / 2) ** 2
        + math.cos(a)
        * math.cos(b)
        * math.sin(math.radians(lon - station["lon"]) / 2) ** 2
    )
    return 12742 * math.asin(min(1, math.sqrt(d)))


def series(path, low, high):
    out = {}
    with open(path, encoding="latin1") as file:
        for row in list(csv.reader(file))[1:]:
            try:
                values = [float(x) for x in row[9:21]]
                if len(values) == 12 and all(low <= x <= high for x in values):
                    out[row[3].strip()] = (row, values)
            except (ValueError, IndexError):
                continue
    return out


def compact(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def build(args):
    cities = {
        a["city_code"]: a
        for a in json.loads((APP / "airports.json").read_text())
        if a["city_code"]
    }
    coords = {a["code"]: a["coordinates"] for a in json.loads(args.cities.read_text())}
    featured = {
        c["code"] for c in json.loads((WEB / "data/cities.json").read_text())["cities"]
    }
    photos = {p.stem for p in (WEB / "photos").glob("*.jpg")}
    rain = series(args.precip, 0, 3500)
    stations = []
    for wigos, (r, temp) in series(args.tmax, -65, 60).items():
        if wigos in rain:
            stations.append(
                {
                    "id": wigos,
                    "lat": float(r[4]),
                    "lon": float(r[5]),
                    "name": r[8].strip(),
                    "temperature": temp,
                    "precipitation": rain[wigos][1],
                    "source": "WMO",
                    "country": r[7].strip(),
                }
            )
    extra = []
    for s in json.loads(gzip.decompress(args.stations.read_bytes())):
        if (s["inventory"]["normals"].get("end") or 0) >= 2020:
            extra.append(
                {
                    "id": s["id"],
                    "name": s["name"]["en"],
                    "lat": s["location"]["latitude"],
                    "lon": s["location"]["longitude"],
                    "country": s["country"],
                }
            )

    def nearby(lat, lon, items):
        return sorted(
            (distance(lat, lon, s), s["id"], s)
            for s in items
            if abs(lat - s["lat"]) < 0.33 and distance(lat, lon, s) <= RADIUS
        )

    def load_extra(s):
        cache = args.cache / (s["id"] + ".gz")
        if not cache.exists():
            try:
                with urlopen(
                    "https://bulk.meteostat.net/v2/normals/" + s["id"] + ".csv.gz",
                    timeout=12,
                ) as resp:
                    cache.write_bytes(resp.read())
            except OSError:
                return None
        rows = [
            r
            for r in csv.reader(
                gzip.decompress(cache.read_bytes()).decode().splitlines()
            )
            if r[:2] == ["1991", "2020"]
        ]
        if [r[2] for r in rows] != list(map(str, range(1, 13))):
            return None
        try:
            temp, rain = [float(r[4]) for r in rows], [float(r[5]) for r in rows]
        except ValueError:
            return None
        if all(-65 <= x <= 60 for x in temp) and all(0 <= x <= 3500 for x in rain):
            return dict(s, temperature=temp, precipitation=rain, source="Meteostat")

    def one(code):
        point = coords.get(code) or {}
        lat, lon = point.get("lat"), point.get("lon")
        if lat is None or lon is None or (lat, lon) == (0, 0):
            return code, None
        ru = cities[code]["country_code"] == "RU"
        matches = nearby(lat, lon, stations)
        if ru:
            matches = [
                m for m in matches if m[2]["country"].startswith("Russian_Federation")
            ]
        if matches:
            km, _, station = matches[0]
        else:
            station = None
            if code in photos | featured:
                for km, _, s in nearby(lat, lon, extra):
                    if s["country"] != cities[code]["country_code"] and code != "SUI":
                        continue
                    station = load_extra(s)
                    if station:
                        break
        if station:
            return code, {
                **{
                    k: station[k]
                    for k in ("name", "id", "source", "temperature", "precipitation")
                },
                "km": round(km),
            }
        return code, None

    with ThreadPoolExecutor(6) as pool:
        out = {c: s for c, s in pool.map(one, sorted(cities)) if s}
    if args.supplement:
        out.update(json.loads(args.supplement.read_text()))
    print(
        len(out),
        "cities with climate normals. Missing featured:",
        sorted(featured - out.keys()),
    )
    compact(APP / "season_normals.json", out)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    for name in ("cities", "tmax", "precip", "stations", "cache"):
        p.add_argument("--" + name, required=True, type=Path)
    p.add_argument("--supplement", type=Path)
    build(p.parse_args())

"""Fill gaps in station normals with 0.5-degree NOAA CPC land cells. Build-time only."""

import calendar
import json
import sys
from pathlib import Path

import numpy as np
from netCDF4 import Dataset

root = Path(__file__).resolve().parents[1]
normals_path = root / "backend/app/season_normals.json"
normals = json.loads(normals_path.read_bytes())
codes = {
    a["city_code"]
    for a in json.loads((root / "backend/app/airports.json").read_bytes())
}
points = {
    c["code"]: c["coordinates"] for c in json.loads(Path(sys.argv[1]).read_bytes())
}
codes = sorted(
    c
    for c in codes
    if c not in normals
    and points.get(c)
    and all(points[c].get(k) is not None for k in ["lat", "lon"])
    and any(points[c].values())
)
data = {c: {} for c in codes}
for var, path, field in [
    ("tmax", sys.argv[2], "temperature"),
    ("precip", sys.argv[3], "precipitation"),
]:
    with Dataset(path) as ds:
        lats, lons = ds["lat"][:].data, ds["lon"][:].data
        x = np.array(
            [np.argmin(abs((lons - points[c]["lon"] + 180) % 360 - 180)) for c in codes]
        )
        y = np.array([np.argmin(abs(lats - points[c]["lat"])) for c in codes])
        start = 0
        monthly = []
        for m in range(1, 13):
            end = start + calendar.monthrange(2001, m)[1]
            v = ds[var][start:end][:, y, x].filled(np.nan)
            counts = ds["valid_yr_count"][start:end][:, y, x].filled(0)
            v[counts < 24] = np.nan
            monthly.append(
                np.round(v.mean(axis=0) if var == "tmax" else v.sum(axis=0), 1)
            )
            start = end
        for i, c in enumerate(codes):
            values = [round(float(m[i]), 1) for m in monthly]
            if all(np.isfinite(values)):
                data[c][field] = values
            data[c].update(
                source="NOAA CPC",
                name="CPC",
                lat=float(lats[y[i]]),
                lon=float(lons[x[i]]),
            )
for c, n in data.items():
    if "temperature" in n and "precipitation" in n:
        normals[c] = n
normals_path.write_text(
    json.dumps(dict(sorted(normals.items())), ensure_ascii=False, separators=(",", ":"))
    + "\n"
)
print(
    "Added",
    sum("temperature" in n and "precipitation" in n for n in data.values()),
    "total",
    len(normals),
)

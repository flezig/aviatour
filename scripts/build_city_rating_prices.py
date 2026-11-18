"""Build the domestic weekend basket from weekly EMISS 37426 dataGrid exports."""

import argparse
import json
from datetime import date
from decimal import Decimal
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "backend" / "app"
LABELS = {
    "Проживание в гостинице 3*, сутки с человека": "hotel",
    "Обед в столовой, кафе, закусочной (кроме столовой в организации), на 1 человека": "meal",
    "Проезд в городском автобусе, поездка": "bus",
}
ALIASES = {
    "Москва": "Город Москва столица Российской Федерации город федерального значения",
    "Санкт-Петербург": "Город Санкт-Петербург город федерального значения",
    "Олёкминск": "Олекминск",
}
AMBIGUOUS = {"Железногорск", "Ярцево", "Кировск (Апатиты)", "Набережные Челны (Нижнекамск)"}


def read_rates(files, week_key):
    rates = {}
    for path in files:
        batch = json.loads(path.read_text())
        if len(batch["results"]) != int(batch["__count"]):
            raise ValueError(f"Неполная выгрузка: {path}")
        for row in batch["results"]:
            metric = LABELS.get(row["dim58273"])
            if not metric or row["dim30611"] != "рубль":
                continue
            fields = [key for key in row if key.startswith(week_key + "_")]
            if len(fields) != 1:
                raise ValueError(f"Проверьте ключ недели {week_key}: {path}")
            value = row[fields[0]]
            if value in (None, "", "-", "…"):
                continue
            price = Decimal(value.replace(",", "."))
            if not price.is_finite() or price <= 0:
                raise ValueError(f"Некорректная цена в {path}")
            city = rates.setdefault(row["dim57831"], {})
            if metric in city:
                raise ValueError(f"Повтор города и показателя в {path}")
            city[metric] = float(price)
    return rates


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", type=Path, nargs="+")
    parser.add_argument("--week-key", required=True, help="Префикс столбца ЕМИСС, например dim2026_1859442")
    parser.add_argument("--observed", type=date.fromisoformat, required=True)
    parser.add_argument("--checked", type=date.fromisoformat, required=True)
    parser.add_argument("--review-by", type=date.fromisoformat, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not args.observed <= args.checked <= args.review_by:
        parser.error("Проверьте даты наблюдения, проверки и пересмотра.")
    rates = read_rates(args.files, args.week_key)
    snapshot = json.loads((APP / "city_rating_prices.json").read_text())
    airports = json.loads((APP / "airports.json").read_text())
    domestic = {a["city"] for a in airports if a.get("city") and a["country_code"] == "RU"}
    snapshot.update(observed=str(args.observed), checked=str(args.checked), review_by=str(args.review_by))
    reference = snapshot["cities"]
    extra, partial = {}, {}
    for city in sorted((domestic | set(reference)) - AMBIGUOUS):
        values = rates.get(ALIASES.get(city, city), {})
        ordered = {k: values[k] for k in LABELS.values() if k in values}
        if city in reference:
            if len(ordered) != len(LABELS):
                raise ValueError(f"Нет полной корзины города фиксированной группы: {city}")
            reference[city] = ordered
        elif len(ordered) == len(LABELS):
            extra[city] = ordered
        elif ordered:
            partial[city] = ordered
    snapshot.update(additional_cities=extra, partial_cities=partial)
    args.output.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()

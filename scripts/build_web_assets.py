"""Готовит данные сайта из каталога приложения и backend. macOS: использует системный sips.

Запуск из корня: python3 scripts/build_web_assets.py
Источники одни и те же, что у приложения: фото уменьшаются для сети, атрибуция копируется без изменений,
из гидов по городам берутся только поля, которые показывает сайт.
"""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'Aviator/Resources/Assets.xcassets'
OUT = ROOT / 'web/photos'
GUIDE_FIELDS = ('summary', 'tags', 'places', 'areas', 'days', 'tourism_url', 'editorial_updated')
# The site keys photos by the offer's city code; a few app assets are named by an airport.
CITY_CODES = {'GYD': 'BAK'}


def longest_side(path):
    out = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', str(path)], check=True, capture_output=True, text=True).stdout
    return max(int(line.split(':')[1]) for line in out.splitlines() if 'pixel' in line)


def inline_home_icons():
    """Keep first-paint controls independent of a separate icon request."""
    web = ROOT / 'web'
    page = web / 'index.html'
    start, end = '<!-- icons:start -->', '<!-- icons:end -->'
    before, block = page.read_text().split(start, 1)
    _, after = block.split(end, 1)
    svg = (web / 'icons.svg').read_text().replace('<svg ', '<svg class="symbol-bank" id="home-icons" width="0" height="0" aria-hidden="true" ', 1)
    svg = svg.replace('<symbol id="', '<symbol id="ui-')
    page.write_text(before + start + '\n' + svg.rstrip() + '\n' + end + after)


def write_portrait_index(cities):
    airports = json.loads((ROOT / 'backend/app/airports.json').read_text())
    countries = {row['city_code']: (row['country_code'], row['country']) for row in airports}
    index = {}
    for city in cities:
        country = countries.get(city)
        flag = ROOT / 'web/flags' / (country[0].lower() + '.svg') if country else None
        index[city] = country if flag and flag.is_file() and country[0] != 'RU' else None
    (ROOT / 'web/data/portrait-index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n')


def web_photo_credits():
    path = OUT / 'credits-web.md'
    web_credits = path.read_text() if path.exists() else ''
    overrides = set(re.findall(r'^- \*\*([A-Z]{3})\*\*:', web_credits, re.M))
    shared = (ROOT / 'Aviator/Resources/credits.md').read_text().replace('**GYD**', '**BAK**')
    # A credit can include multiple paragraphs, e.g. separate authors of a sculpture and its photo.
    blocks = re.split(r'(?=^- |^## )', shared, flags=re.M)
    kept = []
    for block in blocks:
        city = re.match(r'- \*\*([A-Z]{3})\*\*:', block)
        if city is None or city[1] not in overrides:
            kept.append(block)
    credits = ''.join(kept)
    if 'MRV' in overrides:
        credits = credits.replace(' MRV иллюстрирует регион Кавказских Минеральных Вод.', '')
    return overrides, credits.rstrip() + '\n\n' + web_credits


def main():
    inline_home_icons()
    OUT.mkdir(parents=True, exist_ok=True)
    overrides, credits = web_photo_credits()
    for source in sorted(ASSETS.glob('*.imageset/photo.*')):
        name = CITY_CODES.get(source.parent.stem, source.parent.stem)
        if name in overrides:
            if not (OUT / f'{name}.jpg').is_file():
                raise FileNotFoundError(f'Восстановите фото: python scripts/download_web_photos.py {name}')
            continue
        # The hero fills the first screen; city photos are card-sized. Never upscale a smaller source.
        limit = min(1600 if name == 'hero' else 720, longest_side(source))
        subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '62', '-Z', str(limit), str(source), '--out', str(OUT / f'{name}.jpg')],
                       check=True, capture_output=True)
    # Web-only city photos (scripts/download_web_photos.py) stay next to the app's and share the manifest and credits page.
    cities = sorted(path.stem for path in OUT.glob('*.jpg') if len(path.stem) == 3 and path.stem.isupper())
    (OUT / 'manifest.json').write_text(json.dumps(cities) + '\n')
    write_portrait_index(cities)
    (OUT / 'credits.md').write_text(credits)
    # Link preview for messengers: the hero cropped to the 1200x630 card format.
    preview = ROOT / 'web/og.jpg'
    subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '--resampleWidth', '1200', str(ASSETS / 'hero.imageset/photo.jpg'), '--out', str(preview)], check=True, capture_output=True)
    subprocess.run(['sips', '-c', '630', '1200', str(preview)], check=True, capture_output=True)
    guides = json.loads((ROOT / 'backend/app/city_guides.json').read_text())
    data = ROOT / 'web/data'
    data.mkdir(exist_ok=True)
    (data / 'city-guides.json').write_text(json.dumps({code: {field: guide[field] for field in GUIDE_FIELDS} for code, guide in guides.items()}, ensure_ascii=False) + '\n')
    total = sum(path.stat().st_size for path in OUT.glob('*.jpg'))
    print(f'{len(cities)} городов + hero, {total // 1024} КБ; гидов: {len(guides)}')


if __name__ == '__main__':
    main()

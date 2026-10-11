"""Готовит данные сайта из каталога приложения и backend. macOS: использует системный sips.

Запуск из корня: python3 scripts/build_web_assets.py
Источники одни и те же, что у приложения: фото уменьшаются для сети, атрибуция копируется без изменений,
из гидов по городам берутся только поля, которые показывает сайт.
"""
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'Aviator/Resources/Assets.xcassets'
OUT = ROOT / 'web/photos'
GUIDE_FIELDS = ('summary', 'tags', 'places', 'areas', 'days', 'tourism_url', 'editorial_updated')


def longest_side(path):
    out = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', str(path)], check=True, capture_output=True, text=True).stdout
    return max(int(line.split(':')[1]) for line in out.splitlines() if 'pixel' in line)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*.jpg'):
        old.unlink()
    names = []
    for source in sorted(ASSETS.glob('*.imageset/photo.*')):
        name = source.parent.stem
        # The hero fills the first screen; city photos are card-sized. Never upscale a smaller source.
        limit = min(1600 if name == 'hero' else 720, longest_side(source))
        subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '62', '-Z', str(limit), str(source), '--out', str(OUT / f'{name}.jpg')],
                       check=True, capture_output=True)
        names.append(name)
    cities = [name for name in names if name != 'hero']
    (OUT / 'manifest.json').write_text(json.dumps(cities) + '\n')
    shutil.copyfile(ROOT / 'Aviator/Resources/credits.md', OUT / 'credits.md')
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

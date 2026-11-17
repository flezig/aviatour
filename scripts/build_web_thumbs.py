"""Уменьшенные копии фото сайта для узких мест (карточки выдачи): web/photos/s/<код>.jpg, до 480 px по большей стороне.

Исходные файлы web/photos/*.jpg не меняются. Нужны macOS (sips) и cwebp. Запускать после build_web_assets.py:
    python3 -I scripts/build_web_thumbs.py
"""
import json
import subprocess
from pathlib import Path

PHOTOS = Path(__file__).resolve().parents[1] / 'web' / 'photos'
SIZE, QUALITY = 480, 50


def longest(path):
    out = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', str(path)], capture_output=True, text=True, check=True).stdout.split()
    return max(int(out[-3]), int(out[-1]))


def main():
    out = PHOTOS / 's'
    out.mkdir(exist_ok=True)
    codes = json.loads((PHOTOS / 'manifest.json').read_text())
    for code in codes:
        source, target = PHOTOS / f'{code}.jpg', out / f'{code}.jpg'
        if longest(source) <= SIZE:
            target.write_bytes(source.read_bytes())
        else:
            subprocess.run(['sips', '-Z', str(SIZE), '-s', 'format', 'jpeg', '-s', 'formatOptions', str(QUALITY), str(source), '--out', str(target)], capture_output=True, check=True)
        subprocess.run(['cwebp', '-quiet', '-q', '68', str(target), '-o', str(target.with_suffix('.webp'))], check=True)
    for width in (960, 1920):
        hero = PHOTOS / f'hero-{width}.jpg'
        subprocess.run(['cwebp', '-quiet', '-q', '70', str(hero), '-o', str(hero.with_suffix('.webp'))], check=True)
    for extra in out.iterdir():
        if extra.suffix in {'.webp', '.jpg'} and extra.stem not in codes:
            extra.unlink()
    total = sum(p.stat().st_size for p in out.glob('*.jpg'))
    print(f'{len(codes)} копий, {total // 1024} КБ')


main()

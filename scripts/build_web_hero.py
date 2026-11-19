"""Собрать фон главной из оригинала 4200×2790 (Paolo Costa Baldi, CC BY 3.0).

Скачать «Original file» с https://commons.wikimedia.org/wiki/File:Atrani_(Costiera_Amalfitana,_23-8-2011).jpg
и запустить: python3 scripts/build_web_hero.py /путь/к/Atrani.jpg. Нужны ffmpeg с libsvtav1 и cwebp.
"""
import argparse
import hashlib
import subprocess
from pathlib import Path

PHOTOS = Path(__file__).resolve().parents[1] / 'web/photos'
ORIGINAL_SHA256 = '9e86780e1cc6e18c5f6b1b67d1f56de845d4dfcfce1c41a72c76ffb2bbb8261b'

# x, y, ширина и высота кадра в оригинале. В узком кадре остаются город и арки,
# а в панораме — вся береговая линия. Размеры соответствуют srcset в index.html.
CROPS = (
    ('mobile', (0, 340, 2900, 2350), (480, 900, 1320, 2100), (900, 1320)),
    ('wide', (0, 730, 4200, 1440), (768, 1024, 1600, 2304, 3072, 4200), (1600, 3072)),
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('original', type=Path)
    source = parser.parse_args().original
    if hashlib.sha256(source.read_bytes()).hexdigest() != ORIGINAL_SHA256:
        parser.error('Нужен оригинал фотографии Атрани с Wikimedia Commons.')
    for name, crop, widths, fallback_widths in CROPS:
        x, y, crop_width, crop_height = crop
        for width in widths:
            video_filter = (f'crop={crop_width}:{crop_height}:{x}:{y},'
                            f'scale={width}:-2:flags=lanczos:out_color_matrix=bt709:out_range=tv')
            subprocess.run([
                'ffmpeg', '-nostdin', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(source),
                '-vf', video_filter, '-frames:v', '1', '-c:v', 'libsvtav1', '-preset', '5', '-crf', '32',
                '-pix_fmt', 'yuv420p10le', '-color_range', 'tv', '-colorspace', 'bt709',
                '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', str(PHOTOS / f'hero-{name}-{width}.avif'),
            ], check=True)
        for width in fallback_widths:
            target = PHOTOS / f'hero-{name}-{width}.webp'
            subprocess.run([
                'cwebp', '-quiet', '-mt', '-sharp_yuv', '-q', '82', '-m', '6',
                '-crop', *map(str, crop), '-resize', str(width), '0', str(source), '-o', str(target),
            ], check=True)


if __name__ == '__main__':
    main()

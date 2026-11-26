"""Собрать фон главной из панорамы Мадейры (Diego Delso, CC BY-SA 4.0).

Скачать «Original file» с https://commons.wikimedia.org/wiki/File:Ponta_de_S%C3%A3o_Louren%C3%A7o,_Madeira,_Portugal,_2019-05-28,_DD_01-09_PAN.jpg
и запустить: python3 scripts/build_web_hero.py /путь/к/Madeira.jpg. Нужны ffmpeg с libsvtav1 и cwebp.
"""
import argparse
import hashlib
import subprocess
from pathlib import Path

PHOTOS = Path(__file__).resolve().parents[1] / 'web/photos'
ORIGINAL_SHA256 = '4b1da8cded5b60a23fea3e527123a2c74005dbef3cbc3ef5a7973903d248bae1'

# x, y, ширина и высота кадра в оригинале. В узком кадре остаётся мыс,
# а широкий кадр показывает бухту. Размеры соответствуют srcset в index.html.
CROPS = (
    ('mobile-coast', (2450, 1050, 6050, 4400), (480, 900, 1320, 2100), (900, 1320)),
    ('wide', (0, 260, 15356, 5264), (768, 1024, 1600, 2304, 3072, 4200), (1600, 3072)),
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('original', type=Path)
    source = parser.parse_args().original
    if hashlib.sha256(source.read_bytes()).hexdigest() != ORIGINAL_SHA256:
        parser.error('Нужен оригинал панорамы Мадейры с Wikimedia Commons.')
    for name, crop, widths, fallback_widths in CROPS:
        x, y, crop_width, crop_height = crop
        for width in widths:
            video_filter = (f'crop={crop_width}:{crop_height}:{x}:{y},'
                            f'scale={width}:-2:flags=lanczos:out_color_matrix=bt709:out_range=tv')
            subprocess.run([
                'ffmpeg', '-nostdin', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(source),
                '-vf', video_filter, '-frames:v', '1', '-c:v', 'libsvtav1', '-preset', '5', '-crf', '32',
                '-pix_fmt', 'yuv420p10le', '-color_range', 'tv', '-colorspace', 'bt709',
                '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', str(PHOTOS / f'hero-madeira-{name}-{width}.avif'),
            ], check=True)
        for width in fallback_widths:
            target = PHOTOS / f'hero-madeira-{name}-{width}.webp'
            subprocess.run([
                'cwebp', '-quiet', '-mt', '-sharp_yuv', '-q', '82', '-m', '6',
                '-crop', *map(str, crop), '-resize', str(width), '0', str(source), '-o', str(target),
            ], check=True)

    _, (x, y, width, height), _, _ = CROPS[1]
    subprocess.run([
        'ffmpeg', '-nostdin', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(source),
        '-vf', f'crop={width}:{height}:{x}:{y},scale=1920:-2:flags=lanczos',
        '-frames:v', '1', '-q:v', '4', str(PHOTOS / 'hero-madeira-1920.jpg'),
    ], check=True)


if __name__ == '__main__':
    main()

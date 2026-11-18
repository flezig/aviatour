"""Макет выбора: значки подборок, рамка фото и плашка уровня цены — три варианта на живых данных.

Данные — снимок /api/v1/home из Москвы (home-mow.json). Пересобрать:
    python3 -I mockups/rows/build.py   →  mockups/rows/index.html (открывать через статический сервер из корня репозитория)
"""
import json
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
home = json.loads((HERE / 'home-mow.json').read_text())
offers = home['offers']
rows = {row['key']: row for row in home['rows']}
MONTH = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']
PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']


def rub(minor):
    return f'{minor // 100:,}'.replace(',', ' ') + ' ₽'


def span(o):
    a, b = datetime.fromisoformat(o['departure_at']), datetime.fromisoformat(o['return_at'])
    n = (b.date() - a.date()).days
    word = 'ночь' if n % 10 == 1 and n % 100 != 11 else 'ночи' if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14 else 'ночей'
    dates = f'{a.day}–{b.day} {MONTH[b.month - 1]}' if a.month == b.month else f'{a.day} {MONTH[a.month - 1]} – {b.day} {MONTH[b.month - 1]}'
    return dates, f'{n} {word}', n


def level(o):
    _, _, n = span(o)
    group = 0 if n <= 2 else 1 if n <= 4 else 2 if n <= 7 else 3
    found = home['usual'].get(f"{o['city_code']}|{o['departure_at'][:7]}|{group}")
    if not found:
        return None
    diff = int((o['price_minor'] / found[0] - 1) * 100 + .5 if o['price_minor'] >= found[0] else (o['price_minor'] / found[0] - 1) * 100 - .5)
    return diff


# --- Значки: одна форма — три подачи (наклейка, пиксель, линия) ---
VECTOR = {
    'hot': [('M12 2.5c1.2 3.6-1.6 5.2-1.6 7.8 0 1.4 1 2.6 2.5 2.6 1.7 0 2.7-1.4 2.4-3.6 2.4 1.6 3.9 4.2 3.9 6.8 0 3.8-3.2 6.4-7.2 6.4S4.8 19.9 4.8 16.1c0-5 4.6-7.2 7.2-13.6z', 'main'),
            ('M12 21.3c-1.9 0-3.2-1.3-3.2-3 0-2.1 1.9-3.1 3.1-5 .9 1.5 3.3 2.7 3.3 5 0 1.7-1.3 3-3.2 3z', 'light')],
    'weekend': [('M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v12.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5V7a1.5 1.5 0 0 1 1.5-1.5z', 'main'),
                ('M3 9.5h18v-2.5a1.5 1.5 0 0 0-1.5-1.5h-15A1.5 1.5 0 0 0 3 7z', 'dark'),
                ('M7.5 3v4M16.5 3v4', 'line'), ('M7 13h3v3H7zM14 13h3v3h-3z', 'light')],
    'holidays': [('M12 2 16.5 8h-2.3l4.6 6h-2.6l4.8 6.5H3l4.8-6.5H5.2l4.6-6H7.5z', 'main'), ('M10.6 20.5h2.8V23h-2.8z', 'dark'),
                 ('M9.5 12.5h.01M14 15.5h.01M11 17h.01', 'dots')],
    'budget': [('M3.5 7.5h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z', 'main'), ('M4 7.5 15.5 3.6a1.5 1.5 0 0 1 1.9 1l.8 2.9', 'line'),
               ('M15 12h5.5v4H15a2 2 0 0 1 0-4z', 'dark'), ('M15.8 14h.01', 'dots')],
    'sea': [('M18 2.8a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2z', 'accent'),
            ('M1.5 14.5c2.3 0 2.3-1.8 4.6-1.8s2.3 1.8 4.6 1.8 2.3-1.8 4.6-1.8 2.3 1.8 4.6 1.8 2.6-1 2.6-1V22H1.5z', 'main'),
            ('M3 18.5c1.8 0 1.8-1.3 3.6-1.3s1.8 1.3 3.6 1.3 1.8-1.3 3.6-1.3 1.8 1.3 3.6 1.3', 'line')],
}
COLORS = {'hot': ('#e8243c', '#ffd1d6', '#a3122a'), 'weekend': ('#2346d8', '#ffffff', '#0f1b3d'), 'holidays': ('#17703a', '#ffffff', '#0f1b3d'),
          'budget': ('#0f1b3d', '#ffffff', '#2346d8'), 'sea': ('#2f80ed', '#ffffff', '#1b4fa8')}
SUN = '#f5b301'


def sticker(key):
    main, light, dark = COLORS[key]
    parts = []
    for d, role in VECTOR[key]:
        if role in ('line', 'dots'):
            parts.append(f'<path d="{d}" fill="none" stroke="{light if role == "dots" else "#fff"}" stroke-width="{2.6 if role == "dots" else 1.6}" stroke-linecap="round"/>')
        else:
            fill = {'main': main, 'light': light, 'dark': dark, 'accent': SUN}[role]
            parts.append(f'<path d="{d}" fill="{fill}"/>')
    # Белая вырубка вокруг всей наклейки — тот же контур, толще, под рисунком.
    outline = ''.join(f'<path d="{d}" fill="#fff" stroke="#fff" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>' for d, role in VECTOR[key])
    return f'<svg class="st" viewBox="-3 -3 30 30" aria-hidden="true">{outline}{"".join(parts)}</svg>'


def line_icon(key):
    parts = ''.join(f'<path d="{d}" fill="none" stroke="currentColor" stroke-width="{2.6 if role == "dots" else 1.7}" stroke-linecap="round" stroke-linejoin="round"/>' for d, role in VECTOR[key])
    return f'<span class="sq sq--{key}"><svg viewBox="0 0 24 24" aria-hidden="true">{parts}</svg></span>'


PIXEL = {
    'hot': ['....X.......', '....XX......', '...XXX...X..', '...XXXX..X..', '..XXXXX.XX..', '..XXXXXXXX..', '.XXXXXXXXXX.', '.XXXX.XXXXX.', '.XXX...XXXX.', '.XXX....XXX.', '..XXX..XXX..', '...XXXXXX...'],
    'weekend': ['..X.....X...', '.XXXXXXXXXX.', '.XXXXXXXXXX.', '.X........X.', '.X.XX.XX..X.', '.X........X.', '.X.XX.XX..X.', '.X........X.', '.X.XX.....X.', '.X........X.', '.XXXXXXXXXX.', '............'],
    'holidays': ['.....XX.....', '....XXXX....', '...XXXXXX...', '....XXXX....', '...XXXXXX...', '..XXXXXXXX..', '....XXXX....', '..XXXXXXXX..', '.XXXXXXXXXX.', '.....XX.....', '.....XX.....', '....XXXX....'],
    'budget': ['............', '..XXXXXXX...', '.X.......X..', '.XXXXXXXXXX.', '.X........X.', '.X.....XXXX.', '.X.....X.XX.', '.X.....XXXX.', '.X........X.', '.XXXXXXXXXX.', '............', '............'],
    'sea': ['........XX..', '.......XXXX.', '.......XXXX.', '........XX..', '............', '............', '.XX...XX....', 'X..X.X..X.X.', '....X....X..', '.XX...XX....', 'X..X.X..X.X.', '....X....X..'],
}


def pixel(key):
    rects = ''.join(f'<rect x="{x}" y="{y}" width="1" height="1"/>' for y, line in enumerate(PIXEL[key]) for x, ch in enumerate(line) if ch == 'X')
    return f'<span class="px"><svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true"><g fill="currentColor">{rects}</g></svg></span>'


HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.9c0 5.6-7.5 10-7.5 10z" fill="currentColor"/></svg>'


def tag(diff, style):
    if diff is None:
        return ''
    word = 'к обычной'
    sign = '−' if diff < 0 else '+'
    kind = 'low' if diff <= -15 else 'high' if diff >= 15 else 'usual'
    if style == 'a':
        return f'<span class="tag-a tag-a--{kind}">{sign}{abs(diff)}%<small>{word}</small></span>'
    if style == 'b':
        return f'<span class="tag-b tag-b--{kind}">{sign}{abs(diff)}% {word}</span>'
    arrow = '↓' if diff < 0 else '↑'
    text = f'{arrow} на {abs(diff)}% {"ниже" if diff < 0 else "выше"} обычной' if kind != 'usual' else '≈ обычная цена'
    return f'<span class="tag-c tag-c--{kind}">{text}</span>'


def card(o, style, pressed=False):
    dates, nights, _ = span(o)
    heart = f'<span class="fav{" on" if pressed else ""}">{HEART}</span>'
    return f'''<article class="tile tile-{style}">
  <div class="ph ph-{style}"><img src="../../web/photos/s/{o['city_code']}.jpg" alt="">{heart}</div>
  <h3>{o['city']}</h3>
  <p class="price">{rub(o['price_minor'])} {tag(level(o), style)}</p>
  <p class="meta">{dates} · {nights}</p>
</article>'''


SECTIONS = [('hot', 'Горячие билеты', 'Вылет в ближайшие две недели, цена заметно ниже обычной'), ('weekend', 'На эти выходные', rows['weekend1']['hint']),
            ('holidays', 'Новогодние каникулы', rows['holidays']['hint']), ('budget', 'До 5 000 ₽', 'Туда и обратно на одного'), ('sea', 'К морю', 'Города на морском побережье')]
ROWKEY = {'hot': 'hot', 'weekend': 'weekend1', 'holidays': 'holidays', 'budget': 'budget5000', 'sea': 'sea'}
VARIANTS = [('a', 'A. Наклейки на чемодан', 'Цветные наклейки с белой вырубкой, чуть повёрнуты — как на чемодане. Фото — со скруглёнными углами и белым полем, тоже как наклейка. Уровень цены — штамп.'),
            ('b', 'B. Пиксельные значки', 'Однотонные пиксельные значки, как у стажировок Яндекса, но в наших цветах. Фото — в тонкой тёмной рамке с жёсткой тенью. Уровень цены — напечатанная тёмная бирка.'),
            ('c', 'C. Значки в скруглённых квадратах', 'Наши линейные значки в цветных квадратах — спокойно и понятно. Фото — просто скруглённое, с мягкой тенью. Уровень цены — текст со стрелкой, без плашки.')]


def head(key, title, hint, style):
    mark = sticker(key) if style == 'a' else pixel(key) if style == 'b' else line_icon(key)
    return f'<div class="row-head"><span class="mark mark-{style}">{mark}</span><div><h2>{title}</h2><p>{hint}</p></div></div>'


panels = []
for style, name, about in VARIANTS:
    blocks = []
    for i, (key, title, hint) in enumerate(SECTIONS):
        items = [offers[x] for x in rows[ROWKEY[key]]['items'][:2]] if i < 2 else []
        cards = ''.join(card(o, style, pressed=(i == 0 and j == 0)) for j, o in enumerate(items))
        blocks.append(f'<section class="row">{head(key, title, hint, style)}{f"<div class=strip>{cards}</div>" if cards else ""}</section>')
    panels.append(f'<div class="panel"><header class="panel-head"><h1>{name}</h1><p>{about}</p></header>{"".join(blocks)}</div>')

CSS = '''
@font-face { font-family: G; font-weight: 800; src: url('../../web/fonts/geologica-cyrillic-800-normal.woff2'); unicode-range: U+0400-045F; }
@font-face { font-family: G; font-weight: 800; src: url('../../web/fonts/geologica-latin-800-normal.woff2'); unicode-range: U+0000-00FF; }
@font-face { font-family: T; font-weight: 400; src: url('../../web/fonts/golos-text-cyrillic-400-normal.woff2'); unicode-range: U+0400-045F; }
@font-face { font-family: T; font-weight: 400; src: url('../../web/fonts/golos-text-latin-400-normal.woff2'); unicode-range: U+0000-00FF; }
@font-face { font-family: T; font-weight: 600; src: url('../../web/fonts/golos-text-cyrillic-600-normal.woff2'); unicode-range: U+0400-045F; }
@font-face { font-family: M; font-weight: 700; src: url('../../web/fonts/martian-mono-latin-700-normal.woff2'); unicode-range: U+0000-00FF; }
@font-face { font-family: M; font-weight: 700; src: url('../../web/fonts/martian-mono-cyrillic-700-normal.woff2'); unicode-range: U+0400-045F; }
@font-face { font-family: M; font-weight: 700; src: url('../../web/fonts/martian-mono-latin-ext-700-normal.woff2'); unicode-range: U+20BD, U+2212; }
* { box-sizing: border-box; }
body { margin: 0; font: 400 15px/1.45 T, system-ui; color: #0f1b3d; background: linear-gradient(180deg, #d6e6fa 0, #eef3f9 520px) fixed; }
.top { padding: 20px 24px 8px; } .top h1 { font: 800 26px/1.15 G; margin: 0 0 6px; } .top p { margin: 0; color: #565d70; max-width: 70em; }
.grid { display: grid; gap: 20px; padding: 16px 24px 40px; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); }
.panel { background: rgba(255,255,255,.35); border: 1px solid rgba(15,27,61,.1); border-radius: 18px; padding: 18px; display: grid; gap: 22px; align-content: start; }
.panel-head h1 { font: 800 20px/1.2 G; margin: 0 0 4px; } .panel-head p { margin: 0; font-size: 13px; color: #565d70; }
.row { display: grid; gap: 10px; }
.row-head { display: flex; gap: 12px; align-items: center; } .row-head h2 { font: 800 19px/1.2 G; margin: 0; } .row-head p { margin: 2px 0 0; font-size: 12.5px; color: #565d70; }
.mark { flex: none; display: grid; place-items: center; width: 46px; height: 46px; }
.st { width: 46px; height: 46px; filter: drop-shadow(0 1.5px 2px rgba(15,27,61,.28)); transform: rotate(-8deg); }
.row:nth-child(2n) .st { transform: rotate(6deg); }
.px { width: 40px; height: 40px; display: grid; place-items: center; background: #0f1b3d; color: #fff; border-radius: 4px; box-shadow: 3px 3px 0 #2346d8; }
.px svg { width: 26px; height: 26px; }
.sq { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 12px; }
.sq svg { width: 24px; height: 24px; }
.sq--hot { background: #ffe1e5; color: #c8102e; } .sq--weekend { background: #e6eafb; color: #2346d8; } .sq--holidays { background: #e3f1e7; color: #17703a; }
.sq--budget { background: #ece8fb00; background: #e9edf5; color: #0f1b3d; } .sq--sea { background: #dcecff; color: #1b5fc9; }
.strip { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.tile h3 { font: 800 15px/1.2 G; margin: 8px 0 2px; } .price { margin: 0; font: 700 14px/1.6 M, T, sans-serif; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.meta { margin: 0; font-size: 12.5px; color: #565d70; }
.ph { position: relative; aspect-ratio: 3/2; }
.ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ph-a { padding: 5px; background: #fff; border-radius: 14px; box-shadow: 0 1px 2px rgba(15,27,61,.2), 0 6px 14px -6px rgba(15,27,61,.3); transform: rotate(-1.2deg); }
.tile-a:nth-child(2n) .ph-a { transform: rotate(1deg); }
.ph-a img { border-radius: 10px; }
.ph-b { border: 2px solid #0f1b3d; box-shadow: 4px 4px 0 #0f1b3d; background: #fff; }
.ph-c img { border-radius: 14px; } .ph-c { border-radius: 14px; box-shadow: 0 8px 18px -10px rgba(15,27,61,.55); }
.fav { position: absolute; top: 9px; right: 9px; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 10px; background: rgba(255,255,255,.92); color: rgba(15,27,61,.35); }
.fav svg { width: 20px; height: 20px; } .fav.on { color: #e8243c; }
.ph-b .fav { border-radius: 0; border: 2px solid #0f1b3d; } .ph-b .fav.on { background: #e8243c; color: #fff; }
.tag-a { display: inline-flex; align-items: baseline; gap: 3px; padding: 1px 6px; border: 2px solid currentColor; border-radius: 6px; font: 700 12px M, T, sans-serif; transform: rotate(-4deg);
  box-shadow: inset 0 0 0 1px #fff, inset 0 0 0 2px currentColor; }
.tag-a small { font: 600 10px T; } .tag-a--low { color: #17703a; } .tag-a--high { color: #c8102e; } .tag-a--usual { color: #565d70; }
.tag-b { padding: 2px 7px; font: 700 11.5px M, T, sans-serif; color: #fff; background: #0f1b3d; } .tag-b--low { background: #17703a; } .tag-b--high { background: #c8102e; } .tag-b--usual { background: #565d70; }
.tag-c { font: 700 11.5px M, T, sans-serif; } .tag-c--low { color: #17703a; } .tag-c--high { color: #c8102e; } .tag-c--usual { color: #565d70; }
'''

received = datetime.fromisoformat(home['received_at'])
html = f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Значки подборок, рамка фото, уровень цены — варианты</title><style>{CSS}</style></head><body>
<header class="top"><h1>Три варианта: значки подборок, рамка фото, плашка уровня цены</h1>
<p>Живые данные главной из Москвы на {received.day} {MONTH[received.month - 1]} {received:%H:%M} UTC. Сердечко на первой карточке — нажатое, новым красным. Остальное на сайте не меняется: шрифты, цвета, раскладка.</p></header>
<main class="grid">{"".join(panels)}</main></body></html>'''
(HERE / 'index.html').write_text(html)
print('ok', len(html))


# --- Сравнение крупно: значки по строкам, варианты по столбцам; ниже рамка фото и плашка цены ---
def big(mark):
    return f'<div class="big">{mark}</div>'


sample = offers[rows['weekend1']['items'][1]]
low_diff = -19
cells = []
for key, title, _ in SECTIONS:
    cells.append(f'<div class="name">{title}</div>' + ''.join(big(f(key)) for f in (sticker, pixel, line_icon)))
frames = ''.join(f'<div class="frame"><div class="ph ph-{s}"><img src="../../web/photos/s/{sample["city_code"]}.jpg" alt=""><span class="fav on">{HEART}</span></div></div>' for s in 'abc')
tags = ''.join(f'<div class="tagcell">{tag(low_diff, s)}<br>{tag(18, s)}<br>{tag(3, s)}</div>' for s in 'abc')
COMPARE_CSS = CSS + '''
.cmp { display: grid; grid-template-columns: 210px repeat(3, 1fr); gap: 0; margin: 12px 24px 40px; background: rgba(255,255,255,.45); border: 1px solid rgba(15,27,61,.12); border-radius: 18px; overflow: hidden; }
.cmp > div { padding: 14px 16px; border-bottom: 1px solid rgba(15,27,61,.08); display: grid; place-items: center; }
.cmp .hd { font: 800 17px/1.2 G; background: rgba(255,255,255,.6); text-align: center; }
.cmp .hd small { display: block; font: 400 12.5px/1.35 T; color: #565d70; margin-top: 4px; }
.cmp .name { justify-items: start; place-items: center start; font: 800 16px/1.2 G; }
.big .st, .big .px, .big .sq { transform: scale(1.7); }
.big { height: 92px; }
.frame { width: 100%; } .frame .ph { width: 220px; margin: 6px auto; }
.tagcell { line-height: 2.4; text-align: center; }
'''
head_row = '<div class="hd">Что выбираем</div>' + ''.join(f'<div class="hd">{n}<small>{w}</small></div>' for n, w in (
    ('A. Наклейки', 'цветные, с белой вырубкой, чуть повёрнуты'), ('B. Пиксели', 'однотонные, как у стажировок Яндекса'), ('C. Значки в квадратах', 'тонкие линии в цветном квадрате')))
compare = f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Сравнение значков, рамок и плашек</title><style>{COMPARE_CSS}</style></head><body>
<header class="top"><h1>Между чем выбор: значки подборок, рамка фото, плашка уровня цены</h1>
<p>Значок стоит слева от названия подборки. Рамка — у фото городов в лентах. Плашка — рядом с ценой: «ниже обычной», «выше обычной», «обычная».</p></header>
<main class="cmp">{head_row}{"".join(cells)}<div class="name">Рамка фото</div>{frames}<div class="name">Плашка уровня цены</div>{tags}</main></body></html>'''
(HERE / 'compare.html').write_text(compare)
print('compare ok')

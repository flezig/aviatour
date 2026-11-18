"""City photos in the initial HTML returned to browsers and link preview crawlers."""
from html import escape
from urllib.parse import urlencode

from .city_pages import SITE

# Include the route and offer identity so messengers can open the same search.
PUBLIC_PARAMS = ('from', 'fc', 'to', 'tc', 'region', 'month', 'weekend', 'budget',
                 'dep', 'ret', 'direct', 'city', 'trip')


def city_metadata(template, path, params, city, has_photo):
    code, name = city['city_code'], city['city']
    image = SITE + (f'/photos/{code}.jpg' if has_photo else '/og.jpg')
    title = escape(f"{name} · {'План поездки' if path == '/trip.html' else 'Билеты'} · Aviator")
    alt = escape(name) if has_photo else 'Aviator'
    query = urlencode([(key, params[key]) for key in PUBLIC_PARAMS if key in params])
    url = escape(f'{SITE}{path}?{query}')
    meta = f'''<meta property="og:type" content="website">
  <meta property="og:site_name" content="Aviator">
  <meta property="og:locale" content="ru_RU">
  <meta property="og:title" content="{title}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{image}">
  <meta property="og:image:alt" content="{alt}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{title}">
  <meta name="twitter:image" content="{image}">
  <meta name="twitter:image:alt" content="{alt}">'''
    before, separator, block = template.partition('<!-- preview:start -->')
    _, end, after = block.partition('<!-- preview:end -->')
    if not separator or not end:
        raise ValueError('Пропущен блок метаданных превью')
    return before + meta + after

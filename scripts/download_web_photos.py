"""Фото городов только для сайта; приложение не трогает. Требует certifi, macOS sips. Проверьте снимки и лицензии после запуска.

Запуск из корня: .venv/bin/python scripts/download_web_photos.py [КОД ...]
Источник — изображение города в Wikidata (P18), к которому ведёт статья русской Википедии; если его нет или лицензия
не свободная, берётся первый подходящий снимок из поиска Commons. Файлы ложатся в web/photos/<код города>.jpg,
атрибуция — в web/photos/credits-web.md; scripts/build_web_assets.py их сохраняет и добавляет в manifest и credits.
"""
import html, json, re, ssl, subprocess, sys, tempfile, time, urllib.parse, urllib.request
from pathlib import Path
import certifi

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'web/photos'
CREDITS = OUT / 'credits-web.md'
# Направления из выдачи сайта: 10 популярных городов вылета, ноябрь 2026 — январь 2027 (снято 26.10.2026), по частоте.
CITIES = '''MOW SVX UFA TAS BKK AYT KUF NQZ BJS KJA OVB MCX KRR ALA DXB IKT SGC OMS BAX HKT CEK RGK MMK BEG BAK GOJ TOF NOZ TJM
BUS CSY PEE ULY SHA KEJ CMB IJK BSZ SSH ARH GOI RTW DEL REN HRG SUI SKD NJC ASB ABA VOG ASF OGZ DYU CTU NBC UUD SIA SYX GRV KGF
NUX SGN UGC HAN FEG CAN SCW NMA LCA CMN BOM HTA NHA KHV ZRH VVO HMA OSW LWN NAL STW UKK MNL LBD MQF KVK BHK RMO KYZ PKV PQC DPS
KVX OSS FRA BUD CIT CAI KUL IAR BQS MLE PEZ AUH AZN ZNZ TCI UTP BLR NCE SHJ ALC SEL TRV MCT GZP NNM NOJ CEE COV KBV GME BQT UCT
KRO MUC YKS RMZ LYS BTS SIN NSK HKG CGQ GDZ BJV SKX TBW IWA BTK TGD LJU UUS KUT HAJ STR PKC TYO DAD RAK DUB KQT HAK SYD RAI IGT
NYA NCU OVS HAM DUS SJJ PES SOF AGP MED ZAG FMM CPT HEL DOH GNJ KTM SEZ KWI BLQ CNX CCU MLA ESL AGA TIA KSQ SCO TMJ URJ DTM DIY
USK BIO WAW HER LEJ VCE HGH PUS FLR ANU TIV SAO OPO DLM SZX AMD ANK ECN ALG ALY NER IZM LUX SLY JED NNG NBO DAR DMU AKL'''.split()
# Статья русской Википедии, когда название города в каталоге не совпадает с ней или неоднозначно.
TITLES = {'NBC': 'Набережные Челны', 'DPS': 'Бали', 'KVK': 'Кировск (Мурманская область)', 'KQT': 'Бохтар', 'BJS': 'Пекин',
          'SEL': 'Сеул', 'TYO': 'Токио', 'GOI': 'Гоа', 'MLE': 'Мале', 'SEZ': 'Маэ', 'TRV': 'Тируванантапурам', 'RAI': 'Прая',
          'OVS': 'Советский (Ханты-Мансийский автономный округ)', 'BQT': 'Брест (Белоруссия)', 'SUI': 'Сухум', 'TCI': 'Тенерифе',
          'NOJ': 'Ноябрьск', 'RGK': 'Горно-Алтайск', 'ZNZ': 'Занзибар (остров)', 'COV': 'Мерсин', 'GZP': 'Аланья', 'SSH': 'Шарм-эш-Шейх',
          'HRG': 'Хургада', 'PQC': 'Фукуок', 'HKT': 'Пхукет', 'KBV': 'Краби (город)', 'UTP': 'Паттайя', 'KWI': 'Эль-Кувейт',
          'MED': 'Медина', 'STW': 'Ставрополь', 'IGT': 'Магас', 'FMM': 'Мемминген', 'GME': 'Гомель', 'NYA': 'Нягань', 'HKG': 'Гонконг',
          'SIN': 'Сингапур', 'LCA': 'Ларнака', 'CMB': 'Коломбо', 'LWN': 'Гюмри', 'UKK': 'Усть-Каменогорск', 'CIT': 'Шымкент'}
# Ручной выбор после просмотра: снимок P18 оказался картой, картиной, коллажем или другим городом. Поиск Commons или конкретный файл.
PICKS = {'SHA': 'Shanghai Pudong skyline from the Bund', 'DEL': 'India Gate New Delhi', 'VOG': 'Volgograd central embankment',
         'ASF': 'Astrakhan Kremlin', 'NUX': 'File:Leningradsky Avenue (Novy Urengoy).jpg', 'AYT': 'Antalya Kaleiçi harbour', 'NOZ': 'File:Novokuznetsk 2010-02 1265914858 aerial.jpg',
         'COV': 'File:MERSİN-9.jpg', 'LYS': 'Lyon Fourvière view from', 'DUS': 'Düsseldorf Medienhafen', 'CGQ': 'File:Changchun CBD viewed from the Cultural Square, 2024.jpg',
         'TRV': 'Thiruvananthapuram city', 'TCI': 'Tenerife Teide landscape', 'CEE': 'File:Дебаркадер в Череповце.jpg', 'HER': 'Heraklion Venetian harbour',
         'FLR': 'Florence Duomo panorama', 'ANU': 'Antigua English Harbour', 'ALG': 'Algiers bay panorama', 'LUX': 'Luxembourg City Grund',
         'DIY': 'Diyarbakır city walls', 'ECN': 'Kyrenia harbour', 'DLM': 'Dalyan rock tombs'}
FREE = ('cc by', 'cc0', 'public domain', 'pd', 'fal')  # FAL: Free Art License, attribution only


def get(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'AviatorWeb/1.0 (https://aviatour.vercel.app; image credits on the site)'})
    return urllib.request.urlopen(request, timeout=25, context=ssl.create_default_context(cafile=certifi.where())).read()


def api(host, **params):
    return json.loads(get(f'https://{host}/w/api.php?' + urllib.parse.urlencode({'action': 'query', 'format': 'json', **params})))


def wikidata_item(title, country):
    pages = api('ru.wikipedia.org', titles=title, redirects=1, prop='pageprops', ppprop='wikibase_item|disambiguation')['query']['pages']
    page = next(iter(pages.values()))
    if 'missing' in page or 'disambiguation' in page.get('pageprops', {}):
        found = api('ru.wikipedia.org', list='search', srsearch=f'{title} {country}', srlimit=1)['query']['search']
        if not found:
            return None
        return wikidata_item(found[0]['title'], country) if found[0]['title'] != title else None
    return page.get('pageprops', {}).get('wikibase_item')


def candidates(item):
    """Файлы Commons: сначала P18 из Wikidata, потом поиск по английскому названию."""
    entity = json.loads(get('https://www.wikidata.org/w/api.php?' + urllib.parse.urlencode(
        {'action': 'wbgetentities', 'format': 'json', 'ids': item, 'props': 'claims|labels', 'languages': 'en'})))['entities'][item]
    for claim in entity.get('claims', {}).get('P18', []):
        value = claim['mainsnak'].get('datavalue', {}).get('value')
        if value:
            yield 'File:' + value
    label = entity.get('labels', {}).get('en', {}).get('value')
    if label:
        found = api('commons.wikimedia.org', list='search', srsearch=f'{label} view filetype:bitmap', srnamespace=6, srlimit=20)
        yield from (row['title'] for row in found['query']['search'])


def picked(query):
    if query.startswith('File:'):
        return [query]
    found = api('commons.wikimedia.org', list='search', srsearch=f'{query} filetype:bitmap', srnamespace=6, srlimit=20)
    return [row['title'] for row in found['query']['search']]


def usable(title, *, reviewed=False):
    pages = api('commons.wikimedia.org', titles=title, prop='imageinfo', iiprop='url|extmetadata|size|mime', iiurlwidth=1000)['query']['pages']
    info = next(iter(pages.values())).get('imageinfo', [None])[0]
    if not info or info.get('mime') != 'image/jpeg' or (not reviewed and not 1 / 1.6 <= info['width'] / info['height'] <= 2.3):
        return None
    meta = info.get('extmetadata', {})
    license = meta.get('LicenseShortName', {}).get('value', '')
    if not license.lower().startswith(FREE) or re.search(r'\b(?:nc|nd)\b', license, re.I):
        return None
    return info, meta, license


def main():
    airports = json.loads((ROOT / 'backend/app/airports.json').read_text())
    cities = {a['city_code']: a for a in airports}
    lines = CREDITS.read_text().splitlines() if CREDITS.exists() else [
        '## Города на сайте', '', 'Добавлено 26.10.2026 для сайта. Изображение города из Wikidata или Wikimedia Commons; рейсы не подтверждает.', '']
    reviewed = dict(re.findall(r'^- \*\*([A-Z]{3})\*\*: \[(File:[^\]]+)\]', '\n'.join(lines), re.M))
    wanted = sys.argv[1:] or list(dict.fromkeys([*CITIES, *reviewed]))
    for code in wanted:
        if (OUT / f'{code}.jpg').exists() and len(sys.argv) == 1:
            continue
        city = cities[code]
        try:
            if code in reviewed:
                titles = [reviewed[code]]
            elif code in PICKS:
                titles = picked(PICKS[code])
            else:
                item = wikidata_item(TITLES.get(code) or re.sub(r'\s*\(.*\)', '', city['city']), city['country'])
                titles = candidates(item) if item else []
            choice = next(((title, found) for title in titles if (found := usable(title, reviewed=code in reviewed))), None)
            if not choice:
                print('NO PHOTO', code, city['city'], flush=True)
                continue
            title, (info, meta, license) = choice
            with tempfile.NamedTemporaryFile(suffix='.jpg') as source:
                source.write(get(info.get('thumburl', info['url'])))
                source.flush()
                subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '62', '-Z', '720', source.name, '--out', str(OUT / f'{code}.jpg')],
                               check=True, capture_output=True)
            if code in reviewed:
                print(code, city['city'], title, license, flush=True)
                continue  # Keep the approved photographer credit, including preferred attribution.
            artist = html.unescape(re.sub('<[^>]+>', '', meta.get('Artist', {}).get('value', 'Wikimedia Commons'))).strip()
            lines = [line for line in lines if not line.startswith(f'- **{code}**:')]
            lines.append(f"- **{code}**: [{title}]({info['descriptionurl']}) — {artist}; [{license}]({meta.get('LicenseUrl', {}).get('value', info['descriptionurl'])}). Фото масштабировано, отображается с кадрированием.")
            CREDITS.write_text('\n'.join(lines) + '\n')
            print(code, city['city'], title, license, flush=True)
        except Exception as error:
            print('ERROR', code, city['city'], error, flush=True)
        time.sleep(.3)


if __name__ == '__main__':
    main()

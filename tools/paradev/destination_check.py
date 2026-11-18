"""Fresh country coverage, browser acceptance and two separately metered reviews."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import fcntl
import itertools
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen
from zoneinfo import ZoneInfo

from meter import write_json
from worker_model import invoke

ROOT = Path(__file__).resolve().parent
SITE = 'https://aviatour.vercel.app'
ORIGINS = {'MOW': 'SVO', 'LED': 'LED', 'KZN': 'KZN', 'SVX': 'SVX'}
MONTHS = ('2026-12', '2027-01', '2027-02')
COUNTRIES = {'thailand': ('TH', {'BKK', 'HKT'}), 'uae': ('AE', {'DXB', 'AUH'})}


def collect(url):
    for attempt in range(4):
        try:
            with urlopen(url, timeout=75) as response:
                return json.load(response)
        except HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise
            delay = exc.headers.get('Retry-After', '')
            time.sleep(int(delay) if delay.isdigit() else (62 if exc.code == 429 else 5))
        except (URLError, TimeoutError):
            if attempt == 3:
                raise
            time.sleep(3)


def observations(response, region, origin, month):
    groups = {}
    for key, (country, cities) in COUNTRIES.items():
        if region not in ('asia', key):
            continue
        fares, dates, seen_cities = {}, set(), set()
        for offer in response['offers']:
            belongs = offer['country_code'] == country and offer['city_code'] in cities
            if region != 'asia' and not belongs:
                raise ValueError(f'Чужой город в выдаче {region}: {offer["city_code"]}')
            if not belongs:
                continue
            if offer['currency'] != 'RUB' or offer['origin_city_code'] != origin:
                raise ValueError('Валюта или город вылета в ответе не совпали с запросом')
            depart = local_date(offer, 'departure_at', 'origin_timezone')
            returning = local_date(offer, 'return_at', 'destination_timezone')
            if depart.isoformat()[:7] == month and 1 <= (returning - depart).days <= 14 and 0 < offer['price_minor'] <= 10_000_000:
                fares[offer['id']] = offer['price_minor']
                dates.add(depart.isoformat())
                seen_cities.add(offer['city_code'])
        groups[key] = {'offers': len(fares), 'dates': sorted(dates), 'cities': sorted(seen_cities),
                       'min_rub': min(fares.values()) / 100 if fares else None}
    return groups


def local_date(offer, field, zone):
    value = datetime.fromisoformat(offer[field].replace('Z', '+00:00'))
    return value.astimezone(ZoneInfo(offer[zone])).date()


def matrix(folder):
    checkpoint = folder / 'observations.json'
    rows = json.loads(checkpoint.read_text()) if checkpoint.exists() else {}
    now = datetime.now(timezone.utc)
    if any((now - datetime.fromisoformat(row['checked_at'])).total_seconds() > 3600 for row in rows.values()):
        raise ValueError('Наблюдения старше часа. Запустите новую проверку.')
    for month, origin, region in itertools.product(MONTHS, ORIGINS, ('asia', *COUNTRIES)):
        key = f'{origin}/{month}/{region}'
        if key in rows:
            continue
        params = {'from': ORIGINS[origin], 'fc': origin, 'month': month, 'weekend': 0,
                  'budget': 100000, 'region': region}
        url = SITE + '/api/v1/search/web?' + urlencode(params)
        data = collect(url)
        rows[key] = {'groups': observations(data, region, origin, month),
            'url': url, 'warnings': data['warnings'], 'received_at': data['received_at'],
            'checked_at': datetime.now(timezone.utc).isoformat(timespec='seconds')}
        write_json(checkpoint, rows)
        time.sleep(2)
    return rows


def evaluate(rows, source, country):
    ok = set()
    counts = {}
    for origin, month in itertools.product(ORIGINS, MONTHS):
        group = rows[f'{origin}/{month}/{source}']['groups'][country]
        dates = len(set(group['dates']))
        counts[f'{origin}/{month}'] = dates
        if dates >= 2:
            ok.add((origin, month))
    passed = (len(ok) >= 10 and all(sum((o, m) in ok for m in MONTHS) >= 2 for o in ORIGINS)
              and all(sum((o, m) in ok for o in ORIGINS) >= 3 for m in MONTHS))
    return {'accepted': passed, 'cells': len(ok), 'dates': counts}


def browser_checks(folder):
    for name in ('picker', 'cards'):
        with (folder / (name + '.log')).open('w') as log:
            subprocess.run(['node', str(ROOT / 'checks' / (name + '.cjs')), SITE],
                           stdout=log, stderr=subprocess.STDOUT, timeout=180, check=True)
    return {'picker': (folder / 'picker.log').read_text().strip(),
            'cards': (folder / 'cards.log').read_text().strip()}


def model_review(folder, role, model, prompt):
    usage_file = folder / (role + '.usage.json')
    previous = sorted(folder.glob(role + '.attempt-*.json'))
    if not (folder / (role + '.md')).is_file():
        if usage_file.is_file():
            if previous:
                raise RuntimeError('Обе попытки исчерпаны: ' + role)
            usage_file.rename(folder / (role + '.attempt-1.json'))
        invoke(folder, role, 'Сразу дай конечный ответ по готовой карточке. ' + prompt
               + '\nПоследняя строка SUPERSET_WORKER_DONE.', (model, 'xhigh', [], 3, 26000))
    attempts = [json.loads(path.read_text()) for path in sorted(folder.glob(role + '.attempt-*.json')) + [usage_file]]
    fields = ('requests', 'uncached', 'cached_input_tokens', 'input_tokens', 'output_tokens', 'total')
    return dict(model=model, effort='xhigh', attempts=len(attempts),
                **{key: sum(attempt[key] for attempt in attempts) for key in fields})


def run(folder):
    with ThreadPoolExecutor(max_workers=2) as work:
        evidence_file = folder / 'evidence.json'
        if evidence_file.exists():
            if time.time() - evidence_file.stat().st_mtime > 3600:
                raise ValueError('Матрица старше часа. Запустите новую проверку.')
            card = json.loads(evidence_file.read_text())
            ui, evidence, warnings = card['ui'], card['countries'], card['partial_country_queries']
        else:
            browser = work.submit(browser_checks, folder)
            rows = matrix(folder)
            evidence = {key: {phase: evaluate(rows, source, key) for phase, source in
                              [('screen', 'asia'), ('live', key)]} for key in COUNTRIES}
            ui = browser.result()
            warnings = sum(len(r['warnings']) > 1 for k, r in rows.items() if not k.endswith('/asia'))
            card = {'countries': evidence, 'partial_country_queries': warnings, 'ui': ui}
            write_json(evidence_file, card)
        criteria = ('Россия: Москва, Петербург, Казань, Екатеринбург; декабрь 2026, январь и февраль 2027. '
                    '100000 ₽ на одного туда-обратно, 1–14 ночей. Нужно минимум 2 разные даты вылета '
                    'в 10/12 сочетаниях, в 2/3 месяцев каждого города и для 3/4 городов каждого месяца.')
        ux = work.submit(model_review, folder, 'interface', 'sol',
            'Судья интерфейса. По результатам тестов дай итог до 65 слов: видимость стран при вводе и после очистки, '
            'порядок восьми начальных строк, проверка ссылок, ограничение эмуляции. Не обещай проверку на людях. '
            'Тест сопоставляет исходную геометрию и тексты. ' + json.dumps(ui, ensure_ascii=False))
        judge = work.submit(model_review, folder, 'datajudge', 'astra',
            'Независимо пересчитай порог по датам каждой ячейки. Укажи решения по странам и ограничения, '
            'до 85 слов. ' + criteria + ' Числа по ячейкам = разные местные даты. '
            + json.dumps({k: {phase: res['dates'] for phase, res in pair.items()} for k,pair in evidence.items()})
            + f' Дополнительные предупреждения в {warnings}/24 отдельных запросов. Снимок за один день.')
        usage = {'interface': ux.result(), 'datajudge': judge.result()}
    return {'state': 'complete', 'site': SITE, 'api_queries': len(ORIGINS) * len(MONTHS) * (1 + len(COUNTRIES)), 'cards': card,
            'coordinator_model_calls': 0, 'coordinator_tokens': 0, 'agents': usage,
            'directory': str(folder)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('folder', type=Path)
    parser.add_argument('--retry', action='store_true')
    opts = parser.parse_args()
    folder = opts.folder.resolve()
    with (folder / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        receipt = folder / 'result.json'
        if receipt.exists():
            if not opts.retry or json.loads(receipt.read_text())['state'] == 'complete':
                return
            receipt.replace(folder / 'failed-receipt.json')
        try:
            result = run(folder)
        except Exception as e:
            result = {'state': 'failed', 'error': str(e), 'directory': str(folder),
                      'agents': {p.stem.split('.')[0]: json.loads(p.read_text())
                                 for p in folder.glob('*.usage.json')}}
            write_json(folder / 'result.json', result)
            raise
        write_json(folder / 'result.json', result)

if __name__ == '__main__':
    main()

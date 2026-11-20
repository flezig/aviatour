"""Run a card-based design discussion and publish a single terminal receipt."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import fcntl
import json
from pathlib import Path
import re

from meter import write_json
from worker_model import invoke


ROLES = {
    'designer': 'Дизайнер. Сравни варианты и предложи конкретный основной вид.',
    'ux_judge': 'Судья по удобству. Оцени выбор на телефоне и компьютере и назови проверку для пользователя.',
    'data_judge': 'Судья по данным. Найди риск потери или искажения вариантов и предложи проверку по карточке.',
}
END = 'SUPERSET_WORKER_DONE'
SETTINGS = ('astra', 'xhigh', None, 2, 30000)


def read_card(path):
    if path.stat().st_size > 12000:
        raise ValueError('Слишком большой файл карточки')
    data = json.loads(path.read_text())
    question, options, facts = (data[k] for k in ('question', 'options', 'facts'))
    if not isinstance(question, str) or not question.strip():
        raise ValueError('Нужен вопрос для обсуждения')
    if not isinstance(options, dict) or not 2 <= len(options) <= 5 or 'OTHER' in options:
        raise ValueError('Нужны от 2 до 5 вариантов с собственными кодами')
    if not all(re.fullmatch('[A-Z][A-Z0-9_]{0,19}', k) and isinstance(v, str) and v.strip()
               for k, v in options.items()):
        raise ValueError('Проверьте коды и названия вариантов')
    if not isinstance(facts, list) or not facts or not all(isinstance(f, str) and f.strip() for f in facts):
        raise ValueError('Нужен список наблюдений')
    card = {'question': question, 'options': options, 'facts': facts}
    if len(render_card(card)) > 2400:
        raise ValueError('В карточке больше 2400 знаков')
    return card


def render_card(card):
    return '\n'.join([card['question'], 'Варианты:',
                      *(f'{k} — {v}' for k, v in card['options'].items()), 'Наблюдения:', *card['facts']])


def role_prompt(role, card):
    sections = ['Команда Aviator. Реши вопрос за один ответ по переданным наблюдениям. '
                'Первая строка: CHOICE и один код через пробел. Для своего варианта используй OTHER. '
                'Дальше напиши обоснование и условие, при котором выбор стоит изменить. '
                'В примерах интерфейса используй пробел, перенос или запятую вместо точки-разделителя. '
                'До 1200 знаков. В самом конце отдельная строка ' + END, render_card(card)]
    sections.append(ROLES[role])
    return '\n\n'.join(sections)


def decision(text, options):
    lines = text.strip().splitlines()
    if len(lines) < 3 or lines[-1] != END:
        raise ValueError('Неполная карточка решения')
    choice = lines[0].removeprefix('CHOICE ')
    if lines[0] != 'CHOICE ' + choice or choice not in {*options, 'OTHER'}:
        raise ValueError('Неизвестный код решения')
    brief = '\n'.join(lines[:-1]).strip()
    if len(brief) > 1400 or not any(s.strip() for s in lines[1:-1]):
        raise ValueError('Проверьте объём обоснования')
    return choice, brief


def run(folder, worker=invoke):
    with (folder / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        receipt = folder / 'result.json'
        if receipt.exists():
            return json.loads(receipt.read_text())
        return discuss(folder, worker)


def discuss(folder, worker):
    result = {'kind': 'discussion', 'state': 'failed', 'choices': {}, 'agents': {}, 'coordinator_tokens': 0}
    try:
        card = read_card(folder / 'card.json')

        def ask(role):
            prompt = role_prompt(role, card)
            worker(folder, role, prompt, SETTINGS, card_only=True)
            return decision((folder / (role + '.md')).read_text(), card['options'])[0]

        result['choices']['designer'] = ask('designer')
        errors = []
        with ThreadPoolExecutor(max_workers=2) as pool:
            jobs = {role: pool.submit(ask, role) for role in ('ux_judge', 'data_judge')}
            for role, job in jobs.items():
                try:
                    result['choices'][role] = job.result()
                except Exception as exc:
                    errors.append(f'{role}: {exc}')
        if errors:
            raise RuntimeError('\n'.join(errors))
        result['state'] = 'complete'
    except Exception as exc:
        result['error'] = str(exc)
    for role in ROLES:
        path = folder / (role + '.usage.json')
        if path.exists():
            result['agents'][role] = json.loads(path.read_text())
    if result['state'] == 'complete' and (len(result['agents']) != len(ROLES) or
            len({a.get('thread') for a in result['agents'].values() if a.get('thread')}) != len(ROLES)):
        result.update(state='failed', error='Не подтверждены отдельные чаты всех ролей')
    write_json(folder / 'result.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('folder', type=Path)
    args = parser.parse_args()
    raise SystemExit(0 if run(args.folder)['state'] == 'complete' else 1)

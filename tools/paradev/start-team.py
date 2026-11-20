"""Start one Paradev job and return one completion receipt to the caller."""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import time

from meter import caller_receipt, write_json
from discussion import read_card

ROOT = Path(__file__).resolve().parent
CLI = shutil.which('superset') or str(Path.home() / '.paradev/bin/superset')


def dispatch(workspace, cmd):
    out = subprocess.check_output([CLI, 'terminals', 'create', '--local', '--workspace', workspace,
                                   '--command', shlex.join(cmd), '--json'], text=True)
    return json.loads(out)['terminalId']


def wait_for_results(files, errors, timeout):
    deadline = time.monotonic() + timeout
    while True:
        for error in errors:
            if error.exists():
                raise SystemExit(error.read_text())
        if all(p.exists() for p in files):
            return
        if time.monotonic() >= deadline:
            raise SystemExit(f'Ожидание завершено по таймауту. Результаты останутся в {files[0].parent}')
        time.sleep(1)


def playwright_path():
    proc = subprocess.run(['node', '-p', "require.resolve('playwright/package.json')"],
                          text=True, capture_output=True)
    if proc.returncode == 0:
        return str(Path(proc.stdout.strip()).parent.parent)
    packages = list((Path.home() / '.npm/_npx').glob('*/node_modules/playwright/package.json'))
    if not packages:
        raise SystemExit('Для браузерной проверки нужен установленный Playwright. Укажите NODE_PATH.')
    return str(max(packages, key=lambda p: p.stat().st_mtime).parent.parent)


def main():
    parser = argparse.ArgumentParser()
    choice = parser.add_mutually_exclusive_group()
    choice.add_argument('--topic', type=Path)
    choice.add_argument('--discussion', type=Path, help='Обсудить короткую карточку с двумя независимыми судьями')
    choice.add_argument('--check', choices=['destinations'])
    choice.add_argument('--retry-check', type=Path, help='Повторить незавершённое ревью по свежим сохранённым проверкам')
    choice.add_argument('--receipt', type=Path, help='Дождаться существующего запуска без новых вызовов')
    parser.add_argument('--workspace', default=os.environ.get('SUPERSET_WORKSPACE_ID'))
    parser.add_argument('--detach', action='store_true', help='Вернуть управление сразу после запуска')
    args = parser.parse_args()
    if not args.receipt and not args.workspace:
        parser.error('Укажите --workspace или SUPERSET_WORKSPACE_ID')
    if args.check or args.discussion or args.receipt or args.retry_check:
        if args.retry_check:
            folder = args.retry_check.resolve()
            previous = folder / 'result.json'
            if folder.parent != ROOT / 'runs' or not (folder / 'launch.json').is_file() or not previous.exists():
                parser.error('Нужна папка завершённого запуска')
            if json.loads((folder / 'launch.json').read_text()).get('kind', 'destinations') != 'destinations':
                parser.error('--retry-check применяется только к проверкам направлений')
            if json.loads(previous.read_text())['state'] == 'failed':
                # Wait for a different receipt, including when the first retry fails quickly.
                prior_time = previous.stat().st_mtime_ns
                dispatch(args.workspace, ['env', 'NODE_PATH='+playwright_path(), sys.executable, '-B',
                         str(ROOT / 'destination_check.py'), str(folder), '--retry'])
                deadline = time.monotonic() + 60
                while True:
                    try:
                        if previous.stat().st_mtime_ns != prior_time:
                            break
                    except FileNotFoundError:
                        break
                    if time.monotonic() >= deadline:
                        raise SystemExit('Не получено подтверждение запуска')
                    time.sleep(0.2)
        elif args.receipt:
            folder = args.receipt.resolve()
            if not (folder / 'launch.json').is_file():
                parser.error('Нет сохранённого запуска в указанной папке')
        else:
            (ROOT / 'runs').mkdir(exist_ok=True)
            if args.discussion:
                card = read_card(args.discussion)
                kind = 'discussion'
                command = [sys.executable, '-B', str(ROOT / 'discussion.py')]
            else:
                kind = 'destinations'
                command = ['env', 'NODE_PATH='+playwright_path(), sys.executable, '-B', str(ROOT / 'destination_check.py')]
            folder = Path(tempfile.mkdtemp(prefix=kind+'-', dir=ROOT / 'runs'))
            if args.discussion:
                write_json(folder / 'card.json', card)
            launched_at = time.time()
            terminal = dispatch(args.workspace, command + [str(folder)])
            write_json(folder / 'launch.json', {'terminal': terminal, 'kind': kind, 'start': launched_at,
                       'caller': os.environ.get('CODEX_THREAD_ID')})
        print(folder, flush=True)
        if args.detach:
            return
        wait_for_results([folder / 'result.json'], [], 3600)
        result = json.loads((folder / 'result.json').read_text())
        launch = json.loads((folder / 'launch.json').read_text())
        if launch.get('caller') and not (folder / 'caller-overlap.json').exists():
            window = caller_receipt(launch['start'], (folder / 'result.json').stat().st_mtime, launch['caller'])
            if window is not None:
                write_json(folder / 'caller-overlap.json', window)
        if result['state'] != 'complete':
            raise SystemExit(result['error'])
        if result.get('kind') == 'discussion':
            print(json.dumps({'choices': result['choices'], 'agent_tokens': {
                k: a['total'] for k, a in result['agents'].items()}, 'coordinator_tokens': result['coordinator_tokens']}))
            return
        print(json.dumps({'api_queries': result['api_queries'], 'quality': {
            k: {p:{'cells':r['cells'], 'accepted':r['accepted']} for p,r in v.items()} for k,v in result['cards']['countries'].items()},
            'agent_tokens': {k:r['total'] for k,r in result['agents'].items()},
            'coordinator_tokens': result['coordinator_tokens']}, ensure_ascii=False))
        return
    runner = [sys.executable, '-B', str(ROOT / 'paradev-run.py')]
    topic = ['--topic', str((args.topic or ROOT / 'compare-pair.json').resolve())]
    folder = Path(subprocess.check_output(runner + ['prepare'] + topic, text=True).strip())
    roles = ('research','data','review','editor')
    errors = [folder / (r+'.error') for r in roles]
    for error in errors:
        if error.exists():
            raise SystemExit(error.read_text())
    for role in roles:
        if not (folder / (role+'.md')).exists():
            dispatch(args.workspace, runner + [role] + topic)
    print(folder, flush=True)
    if not args.detach:
        wait_for_results([folder / (r+'.md') for r in roles], errors, 1000)
        print(subprocess.check_output(runner + ['report'] + topic, text=True))

if __name__ == '__main__':
    main()

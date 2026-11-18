"""Read only the Codex rollout belonging to the specified Paradev worker."""
from pathlib import Path
from datetime import datetime, timedelta
import json
import os
import uuid

FIELDS = ("input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens")

class RolloutMeter:
    """Read completed records once; retry an unfinished JSONL line on the next update."""
    def __init__(self, thread):
        self.thread = thread
        self.offset = 0
        self.ids = set()
        self.counts = dict.fromkeys(FIELDS, 0)

    def update(self, path):
        with path.open('rb') as stream:
            stream.seek(self.offset)
            while line := stream.readline():
                if not line.endswith(b'\n'):
                    break
                self.offset = stream.tell()
                try:
                    entry = json.loads(line)
                except (UnicodeDecodeError, json.JSONDecodeError):
                    continue
                if entry.get('type') != 'token_usage_record':
                    continue
                payload = entry['payload']
                key = payload.get('response_id')
                if payload.get('thread_id') != self.thread or not key or key in self.ids:
                    continue
                self.ids.add(key)
                for field in FIELDS:
                    self.counts[field] += int(payload['usage'].get(field) or 0)
        return dict(self.counts, requests=len(self.ids),
                    uncached=self.counts['input_tokens'] - self.counts['cached_input_tokens'],
                    total=self.counts['input_tokens'] + self.counts['output_tokens'])


def snapshot(path, thread):
    return RolloutMeter(thread).update(path)

def rollout_for(thread, start):
    uuid.UUID(thread)
    root = Path(os.environ.get("CODEX_HOME", Path.home()/".codex")) / "sessions"
    for delta in (0, -1, 1):
        day = datetime.fromtimestamp(start) + timedelta(days=delta)
        found = next((root / day.strftime("%Y/%m/%d")).glob("rollout-*-" + thread + ".jsonl"), None)
        if found:
            return found

def write_json(path, value):
    tmp = path.with_name(path.name + "." + str(os.getpid()) + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(path)

def report(directory):
    cols = ["requests", "uncached", "cached_input_tokens", "output_tokens", "total"]
    lines = ["# Расход токенов команды Aviator", "",
             "| Роль | Ответы модели | Новый вход | Вход из кеша | Выход | Всего |",
             "|---|---:|---:|---:|---:|---:|"]
    sums = [0] * len(cols)
    measured = 0
    for role in ("research", "data", "review", "editor"):
        file = directory / (role + ".usage.json")
        row = json.loads(file.read_text()) if file.exists() else {}
        if not row.get("requests"):
            lines.append("| " + role + " | — | — | — | — | — |")
            continue
        measured += 1
        values = [row[k] for k in cols]
        sums = [a+b for a,b in zip(sums,values)]
        lines.append("| " + role + " | " + " | ".join(map(str,values)) + " |")
    lines += ["| **Итого** | " + " | ".join(map(str,sums)) + " |", "",
              f"Есть телеметрия для {measured} из 4 ролей. Кешированный вход входит в общий вход. Выход включает рассуждения. Числа отражают обработанные токены, денежная стоимость зависит от тарифа."]
    return "\n".join(lines) + "\n"


def caller_receipt(start, finish, thread=None):
    """Charge completed desktop responses in the observed interval separately from worker costs."""
    thread = thread or os.environ.get('CODEX_THREAD_ID')
    if not thread:
        return None
    try:
        uuid.UUID(thread)
    except ValueError:
        return None
    root = Path(os.environ.get('CODEX_HOME', Path.home()/'.codex')) / 'sessions'
    path = next(root.glob('*/*/*/rollout-*-'+thread+'.jsonl'), None)
    if not path:
        return None
    counts = dict.fromkeys(FIELDS, 0)
    ids = set()
    for line in path.open():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get('type') != 'token_usage_record':
            continue
        payload = event['payload']
        stamp = datetime.fromisoformat(event['timestamp'].replace('Z', '+00:00')).timestamp()
        key = payload.get('response_id')
        if payload.get('thread_id') != thread or not key or key in ids or not start <= stamp <= finish:
            continue
        ids.add(key)
        for field in FIELDS:
            counts[field] += payload['usage'].get(field, 0)
    return dict(start=start, finish=finish, thread=thread, overlapping_responses=len(ids),
                total=counts['input_tokens']+counts['output_tokens'],
                uncached_plus_output=counts['input_tokens']-counts['cached_input_tokens']+counts['output_tokens'],
                **counts)

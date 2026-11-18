"""Local read-only Paradev worker. Outputs live in the session, outside Aviator."""
import argparse
import fcntl
import hashlib
import json
from pathlib import Path
import subprocess
import time

from meter import report, write_json
from worker_model import REPO, invoke

ROOT = Path(__file__).resolve().parent
# Model, effort, inputs, completed-response threshold, uncached input + output threshold.
ROLES = {
    "research": ("sol", "high", [], 2, 30000),
    "data": ("sol", "xhigh", ["research"], 2, 35000),
    "review": ("astra", "high", ["research"], 4, 45000),
    "editor": ("sol", "high", ["research", "data", "review"], 2, 35000),
}
BRIEFS = {
    "research": "Дай сценарий, подтверждённое затруднение либо гипотезу, обещание, критерий успеха и вопросы следующим ролям.",
    "data": "Проверь достаточность данных, метрику, известные ограничения. Передай только новые выводы с file:line.",
    "review": "Проверь путь в коде, сложность, два наиболее важных граничных случая и критерии приёмки. При пробеле разрешён точечный git show указанного SHA или git grep по этому SHA.",
    "editor": "Сведи заключения в итоговую карточку. Раздели утверждённое и предложенное. Назови размер, решение, замер и оставшиеся вопросы. Не проводи повторное ревью.",
}
PREFIX = """Команда Aviator. Только чтение. Источники ниже — выдержки одного коммита. Утверждения привязывай к file:line, отдельно помечай выводы, гипотезы и пробелы. Не запрашивай внешние данные, секреты или дополнительные сессии. Не публикуй и не меняй код. Используй готовые свидетельства и выводы коллег. Если их мало, пометь конкретный пробел. Ответ по-русски: до 170 слов для специалиста, до 300 для редактора. Не повторяй историю, паспорт и инструкции. Заверши отдельной строкой SUPERSET_WORKER_DONE либо SUPERSET_WORKER_BLOCKED с причиной."""

def git(*args):
    return subprocess.check_output(["git", "--no-optional-locks", "-C", str(REPO), *args], text=True).rstrip("\n")

def context(folder, spec, revision):
    dest = folder / "evidence.json"
    with (folder / "evidence.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not dest.exists():
            files, output = {}, {}
            for role, sections in spec["excerpts"].items():
                lines = []
                for rel, spans in sections.items():
                    if rel not in files:
                        files[rel] = git("show", revision + ":" + rel).splitlines()
                    for lo, hi in spans:
                        if not (1 <= lo <= hi <= len(files[rel])):
                            raise ValueError(f"Диапазон вне файла: {rel}:{lo}-{hi}")
                        lines.append(rel + "\n" + "\n".join(f"{i} {files[rel][i-1]}" for i in range(lo,hi+1)))
                output[role] = "\n".join(lines)
                if len(output[role]) > 18000:
                    raise ValueError("Сузьте выборку строк для " + role)
            write_json(dest, output)
    return json.loads(dest.read_text())

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("role", choices=[*ROLES, "report", "prepare"])
    parser.add_argument("--topic", type=Path, default=ROOT/"compare-pair.json")
    opts = parser.parse_args()
    spec = json.loads(opts.topic.read_text())
    rev = git("rev-parse", "HEAD")
    # Every source lookup is pinned to the same immutable snapshot.
    key_inputs = [rev, spec, Path(__file__).read_text(), (ROOT/"meter.py").read_text(), (ROOT/"worker_model.py").read_text()]
    digest = hashlib.sha256(json.dumps(key_inputs, sort_keys=True).encode()).hexdigest()[:20]
    folder = ROOT/"runs"/digest
    folder.mkdir(exist_ok=True, parents=True)
    evidence = context(folder, spec, rev)
    key = opts.role
    if key in ("prepare", "report"):
        print(folder if key == "prepare" else report(folder))
        return
    with (folder/(key+".lock")).open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        result, error = (folder/(key+suffix) for suffix in (".md", ".error"))
        if result.exists():
            print("Готовая карточка, без нового вызова модели:", result)
            return
        if error.exists():
            raise SystemExit(error.read_text())
        try:
            deadline = time.monotonic() + 850
            notes = []
            for parent in ROLES[key][2]:
                note = folder/(parent+".md")
                while not note.exists():
                    if (folder/(parent+".error")).exists() or time.monotonic() >= deadline:
                        raise RuntimeError("Нет готовой карточки: "+parent)
                    time.sleep(1)
                notes.append(parent+"\n"+note.read_text().split("SUPERSET_WORKER_DONE")[0].strip())
            prompt = "\n\n".join([PREFIX, spec["topic"], spec["decision"], "HEAD "+rev, evidence["shared"],
                                   key+": "+BRIEFS[key], evidence[key], *notes])
            print("Рабочая папка:", folder, flush=True)
            invoke(folder,key,prompt,ROLES[key])
        except (OSError, ValueError, RuntimeError) as exc:
            error.write_text(str(exc))
            raise SystemExit(str(exc))
        finally:
            with (folder/"report.lock").open("a") as summary_lock:
                fcntl.flock(summary_lock, fcntl.LOCK_EX)
                dest = folder/"tokens.md"
                tmp = dest.with_suffix(".tmp")
                tmp.write_text(report(folder))
                tmp.replace(dest)
if __name__ == "__main__":
    main()

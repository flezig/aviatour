"""Metered, time-bounded Codex invocation shared by Paradev workflows."""
import contextlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time

from meter import RolloutMeter, rollout_for, write_json

REPO = Path(os.environ.get("AVIATOR_REPO", Path(__file__).resolve().parents[2]))
CLI = os.environ.get("AVIATOR_CODEX_CLI") or shutil.which("codex") or "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"
def read_events(events, thread):
    # Each line is newline-terminated JSON from codex exec --json.
    while True:
        pos = events.tell()
        line = events.readline()
        if not line.endswith(b"\n"):
            events.seek(pos)
            break
        event = json.loads(line)
        if event.get("type") == "thread.started":
            thread = event["thread_id"]
    return thread

def invoke(folder, key, prompt, settings):
    family, effort, _, steps, budget = settings
    draft = folder / (key + ".partial")
    model = "gpt-6.2-" + family
    args = [CLI, "exec", "--ignore-user-config", "-C", str(REPO), "-s", "read-only",
            "--disable", "apps", "--disable", "plugins", "-c", 'web_search="disabled"',
            "-c", f'model_reasoning_effort="{effort}"', "-m", model, "--json", "-o", str(draft)]
    if key != "review":
        args += ["--disable", "shell_tool", "--disable", "unified_exec"]
    start = time.time()
    thread = path = counter = None
    seen = 0
    usage_path = folder / (key + ".usage.json")
    def record():
        nonlocal path, seen, counter
        if thread and path is None:
            path = rollout_for(thread, start)
        if not path:
            return {}
        if counter is None:
            counter = RolloutMeter(thread)
        usage = counter.update(path)
        if usage["requests"] != seen:
            write_json(usage_path, dict(usage, model=model, effort=effort, thread=thread))
            seen = usage["requests"]
        return usage
    with tempfile.TemporaryDirectory(dir=folder) as temp:
        events_path = Path(temp) / "events"
        with events_path.open("wb") as out, events_path.open("rb") as events, (folder/(key+".log")).open("w") as log:
            proc = subprocess.Popen(args + ["-"], stdin=subprocess.PIPE, stdout=out, stderr=log, start_new_session=True)
            try:
                proc.stdin.write(prompt.encode())
                proc.stdin.close()
                while True:
                    thread = read_events(events, thread)
                    usage = record()
                    rc = proc.poll()
                    if rc is not None:
                        thread = read_events(events, thread)
                        for _ in range(5):
                            record()
                            if seen:
                                break
                            time.sleep(.2)
                        if rc or not seen:
                            raise RuntimeError(f"Код {rc}; подтверждённых ответов: {seen}. См. {key}.log")
                        break
                    if time.time()-start > 240:
                        raise RuntimeError("Истекли четыре минуты на роль")
                    if not seen and time.time()-start > 100:
                        raise RuntimeError("Нет телеметрии 100 секунд")
                    if usage and (seen >= steps or usage["uncached"] + usage["output_tokens"] >= budget):
                        # Let a final message flush before stopping further work.
                        try:
                            proc.wait(1.5)
                        except subprocess.TimeoutExpired:
                            raise RuntimeError(f"Достигнут порог роли: {steps} ответов или {budget} новых входных + выходных токенов")
                    time.sleep(.5)
            finally:
                if proc.poll() is None:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(proc.pid, signal.SIGTERM)
                    try:
                        proc.wait(3)
                    except subprocess.TimeoutExpired:
                        os.killpg(proc.pid, signal.SIGKILL)
                        proc.wait()
                thread = read_events(events, thread)
                record()
    text = draft.read_text().strip()
    if not text.endswith("SUPERSET_WORKER_DONE") or len(text) > 6000:
        raise RuntimeError("Карточка требует проверки: нет маркера готовности или превышен размер передачи")
    draft.replace(folder / (key + ".md"))
    print(text, flush=True)

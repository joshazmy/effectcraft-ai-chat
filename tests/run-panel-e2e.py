#!/usr/bin/env python3
"""Run tests/panel-e2e.jsx headlessly: starts the bridge, then EffectCraft's CLI.

A bare `effectcraft-cli script` session runs with default preferences, so the
scripting file/network gate is always off there (the CLI only reads the
auto-save page of prefs.json). `run` executes several engine commands in one
session, so this script sets the gate in-session and then runs the harness —
headless, without touching desktop settings or the running app.

Needs: effectcraft-cli on PATH (scripts/install-cli.sh), `ollama serve` with the
model named in tests/panel-e2e.jsx, and python3 for the bridge and test agent.
"""
import json
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parent.parent
code = (root / "tests" / "panel-e2e.jsx").read_text()

test_cfg = {
    "agents": [
        {"id": "ollama", "label": "Ollama (local)", "kind": "ollama",
         "url": "http://127.0.0.1:11434", "model": "llama3.2:3b"},
        {"id": "echo", "label": "Echo (test)", "kind": "command",
         "command": ["python3", "-c",
                     "import sys; print('ECHO: ' + sys.argv[1][-60:].replace(chr(10), ' '))",
                     "{prompt}"]},
    ]
}
cfg = Path(tempfile.mkdtemp(prefix="artcraft-e2e-")) / "agents.json"
cfg.write_text(json.dumps(test_cfg))

bridge = subprocess.Popen(
    [sys.executable, str(root / "bridge" / "agent-bridge.py"), "--config", str(cfg), "--port", "8765"],
    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
try:
    for _ in range(50):
        if bridge.poll() is not None:
            sys.exit("bridge exited early:\n" + bridge.stderr.read())
        try:
            with urllib.request.urlopen("http://127.0.0.1:8765/health", timeout=1) as r:
                if json.loads(r.read()).get("ok"):
                    break
        except OSError:
            time.sleep(0.2)
    else:
        sys.exit("bridge did not come up on 127.0.0.1:8765")

    cmd = [
        "effectcraft-cli", "run",
        "prefs.set", json.dumps({"key": "scripting.allowScriptsWriteFiles", "value": True}),
        "script.run", json.dumps({"code": code, "name": "panel-e2e.jsx"}),
        "--empty", "--json",
    ]
    p = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=600)
finally:
    bridge.terminate()
    try:
        bridge.wait(timeout=5)
    except subprocess.TimeoutExpired:
        bridge.kill()

if p.returncode != 0:
    print(p.stdout)
    print(p.stderr, file=sys.stderr)
    sys.exit(p.returncode)

try:
    results = json.loads(p.stdout)
except json.JSONDecodeError:
    print(p.stdout)
    sys.exit("unexpected CLI output")

script = next(r for r in results if r["command"] == "script.run")
print(script["result"].get("output", ""), end="")
if script["result"].get("ok") and not script["result"].get("error"):
    print("panel-e2e: PASS")
    sys.exit(0)
print("panel-e2e: FAIL:", json.dumps(script["result"].get("error")))
sys.exit(1)

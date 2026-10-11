#!/usr/bin/env python3
"""Run tests/panel-e2e.jsx headlessly via effectcraft-cli.

A bare `effectcraft-cli script` session runs with default preferences, so the
scripting file/network gate is always off there (the CLI only reads the
auto-save page of prefs.json). `run` executes several engine commands in one
session, so this script sets the gate in-session and then runs the harness —
headless, without touching desktop settings or the running app.

Needs: effectcraft-cli on PATH (scripts/install-cli.sh), `ollama serve`, and
the model named in tests/panel-e2e.jsx.
"""
import json
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
code = (root / "tests" / "panel-e2e.jsx").read_text()

cmd = [
    "effectcraft-cli", "run",
    "prefs.set", json.dumps({"key": "scripting.allowScriptsWriteFiles", "value": True}),
    "script.run", json.dumps({"code": code, "name": "panel-e2e.jsx"}),
    "--empty", "--json",
]
p = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=600)
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

#!/usr/bin/env python3
"""Local bridge between the EffectCraft AI Chat panel and your agents.

The panel's scripting Socket API is plain TCP with no TLS and cannot spawn
processes, so it talks to this bridge over plain HTTP on 127.0.0.1. The bridge
holds the connections: local models (Ollama), OpenAI-compatible APIs (keys from
`pass` or the environment), any CLI agent (Codex with a ChatGPT plan, Devin,
OpenCode, Claude, Grok...), and ACP agents (`devin acp`, `opencode acp`).

Run:    python3 bridge/agent-bridge.py --config bridge/agents.json
List:   python3 bridge/agent-bridge.py --config bridge/agents.json --list
API:    GET  /health            -> {"ok": true}
        GET  /agents            -> {"agents": [{"id","label","kind","ready","note"}]}
        POST /chat              -> {"agent": id, "messages": [...]} -> {"reply": "..."}
                                  errors come back as {"error": "..."}

Config (bridge/agents.json — copy agents.example.json and edit):
  {"agents": [
    {"id","label","kind", ...}
  ]}
  kinds:
    ollama  {url, model}                 local /api/chat
    openai  {base_url, model, key}       OpenAI-compatible; key: env:NAME | pass:NAME
    command {command: ["...", "{prompt}", ...], cwd?, timeout?, env?}
    acp     {command: ["devin", "acp"], cwd?, timeout?}

`{prompt}` is replaced by the conversation text in that one argument. `command`
and `acp` agents get the whole transcript every turn (they keep no session
state here). Everything binds 127.0.0.1 only; message contents are never logged.
"""
import argparse
import json
import os
import select
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY = 10 * 1024 * 1024


# --------------------------------------------------------------------- helpers

def resolve_key(spec):
    """`env:NAME`, `pass:NAME` (first line of `pass show NAME`), or a literal."""
    if not spec:
        return None
    if spec.startswith("env:"):
        return os.environ.get(spec[4:]) or None
    if spec.startswith("pass:"):
        try:
            out = subprocess.run(["pass", "show", spec[5:]], capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired):
            return None
        if out.returncode != 0 or not out.stdout.strip():
            return None
        return out.stdout.splitlines()[0].strip()
    return spec


def messages_to_text(messages):
    who = {"user": "User", "assistant": "Assistant", "system": "System"}
    return "\n\n".join(who.get(m.get("role", "user"), "User") + ": " + str(m.get("content", "")) for m in messages)


def http_json(url, payload=None, headers=None, timeout=300):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def scratch_dir(agent):
    return agent.get("cwd") or tempfile.mkdtemp(prefix="artcraft-bridge-")


# ---------------------------------------------------------------------- kinds

def run_ollama(agent, messages):
    body = {"model": agent.get("model", "llama3.2:3b"), "stream": False, "messages": messages}
    j = http_json(agent.get("url", "http://127.0.0.1:11434").rstrip("/") + "/api/chat", body)
    return (j.get("message") or {}).get("content", "") or "(empty reply)"


def run_openai(agent, messages):
    key = resolve_key(agent.get("key"))
    if not key:
        raise RuntimeError("no API key (key: env:NAME or pass:NAME)")
    url = agent.get("base_url", "https://api.openai.com/v1").rstrip("/") + "/chat/completions"
    j = http_json(url, {"model": agent.get("model", "gpt-4o-mini"), "messages": messages, "stream": False},
                  {"Authorization": "Bearer " + key})
    return j["choices"][0]["message"]["content"]


def run_command(agent, messages):
    argv = agent.get("command")
    if not argv:
        raise RuntimeError("no command configured")
    if shutil.which(argv[0]) is None:
        raise RuntimeError(argv[0] + " is not installed")
    prompt = messages_to_text(messages)
    argv = [str(part).replace("{prompt}", prompt) for part in argv]
    env = {**os.environ, **(agent.get("env") or {})}
    p = subprocess.run(argv, capture_output=True, text=True, timeout=agent.get("timeout", 300),
                       cwd=scratch_dir(agent), env=env, stdin=subprocess.DEVNULL)
    if p.returncode != 0:
        raise RuntimeError(((p.stderr or "") + (p.stdout or "")).strip()[-500:] or "exit %d" % p.returncode)
    return p.stdout.strip() or "(empty reply)"


class AcpAgent:
    """Minimal ACP (Agent Client Protocol) client: initialize, session/new, session/prompt."""

    def __init__(self, argv, cwd, timeout):
        self.proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, bufsize=0, cwd=cwd)
        self.timeout = timeout
        self.id = 0
        self.buf = b""

    def _write(self, obj):
        self.proc.stdin.write((json.dumps(obj) + "\n").encode())
        self.proc.stdin.flush()

    def _readline(self, deadline):
        while b"\n" not in self.buf:
            remaining = deadline - time.time()
            if remaining <= 0:
                raise RuntimeError("ACP agent timed out")
            ready, _, _ = select.select([self.proc.stdout], [], [], min(remaining, 0.5))
            if not ready:
                if self.proc.poll() is not None and not self.buf:
                    raise RuntimeError("ACP agent exited")
                continue
            chunk = os.read(self.proc.stdout.fileno(), 65536)
            if not chunk:
                raise RuntimeError("ACP agent exited")
            self.buf += chunk
        line, self.buf = self.buf.split(b"\n", 1)
        return line.decode("utf-8", "replace")

    def call(self, method, params, collect=None):
        self.id += 1
        self._write({"jsonrpc": "2.0", "id": self.id, "method": method, "params": params})
        deadline = time.time() + self.timeout
        while True:
            line = self._readline(deadline).strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if msg.get("id") == self.id and ("result" in msg or "error" in msg):
                if "error" in msg:
                    err = msg["error"]
                    raise RuntimeError(err.get("message") if isinstance(err, dict) else str(err))
                return msg.get("result") or {}
            if "method" in msg and "id" in msg:
                self._answer(msg)
            elif msg.get("method") == "session/update" and collect is not None:
                update = (msg.get("params") or {}).get("update") or {}
                if update.get("sessionUpdate") == "agent_message_chunk":
                    content = update.get("content") or {}
                    if content.get("type") == "text":
                        collect.append(content.get("text", ""))

    def _answer(self, msg):
        if msg.get("method") == "session/request_permission":
            options = (msg.get("params") or {}).get("options") or []
            allow = next((o for o in options if str(o.get("kind", "")).lower().startswith("allow")), None)
            result = ({"outcome": {"outcome": "selected", "optionId": allow.get("optionId")}}
                      if allow else {"outcome": {"outcome": "cancelled"}})
        else:
            result = {}
        self._write({"jsonrpc": "2.0", "id": msg["id"], "result": result})

    def close(self):
        try:
            self.proc.stdin.close()
        except OSError:
            pass
        if self.proc.poll() is None:
            self.proc.kill()


def run_acp(agent, messages):
    argv = agent.get("command") or ["devin", "acp"]
    if shutil.which(argv[0]) is None:
        raise RuntimeError(argv[0] + " is not installed")
    cwd = scratch_dir(agent)
    acp = AcpAgent(argv, cwd, agent.get("timeout", 300))
    try:
        acp.call("initialize", {"protocolVersion": 1,
                                "clientCapabilities": {"fs": {"readTextFile": False, "writeTextFile": False}}})
        session = acp.call("session/new", {"cwd": cwd, "mcpServers": []})
        session_id = session.get("sessionId")
        if not session_id:
            raise RuntimeError("the agent opened no session (not authenticated?)")
        chunks = []
        acp.call("session/prompt", {"sessionId": session_id,
                                    "prompt": [{"type": "text", "text": messages_to_text(messages)}]},
                 collect=chunks)
        return "".join(chunks).strip() or "(empty reply)"
    finally:
        acp.close()


RUNNERS = {"ollama": run_ollama, "openai": run_openai, "command": run_command, "acp": run_acp}


# -------------------------------------------------------------------- readiness

def ready(agent):
    kind = agent.get("kind", "command")
    if kind in ("command", "acp"):
        argv = agent.get("command") or []
        return bool(argv) and shutil.which(argv[0]) is not None
    if kind == "ollama":
        hostport = agent.get("url", "http://127.0.0.1:11434").split("://", 1)[-1]
        host, _, port = hostport.partition(":")
        try:
            with socket.create_connection((host, int(port or 80)), timeout=0.3):
                return True
        except OSError:
            return False
    if kind == "openai":
        return bool(agent.get("key"))
    return True


def note(agent):
    if not ready(agent):
        if agent.get("kind") in ("command", "acp"):
            return "%s not found" % (agent.get("command") or ["?"])[0]
        return "not reachable"
    return ""


# ----------------------------------------------------------------------- server

class Handler(BaseHTTPRequestHandler):
    agents = {}

    def log_message(self, fmt, *args):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True})
        if self.path == "/agents":
            return self._json(200, {"agents": [
                {"id": a["id"], "label": a.get("label", a["id"]), "kind": a.get("kind", "command"),
                 "ready": ready(a), "note": note(a)}
                for a in self.agents.values()
            ]})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/chat":
            return self._json(404, {"error": "not found"})
        try:
            n = min(int(self.headers.get("Content-Length") or 0), MAX_BODY)
            req = json.loads(self.rfile.read(n).decode() or "{}")
        except (ValueError, OSError) as e:
            return self._json(400, {"error": "bad request: %s" % e})
        agent = self.agents.get(req.get("agent"))
        if not agent:
            return self._json(200, {"error": "unknown agent %r" % req.get("agent")})
        t0 = time.time()
        try:
            reply = RUNNERS[agent.get("kind", "command")](agent, req.get("messages") or [])
            print("[bridge] %s ok %.1fs" % (agent["id"], time.time() - t0), file=sys.stderr, flush=True)
            return self._json(200, {"reply": reply})
        except Exception as e:  # surface every failure to the panel
            print("[bridge] %s error: %s" % (agent["id"], e), file=sys.stderr, flush=True)
            return self._json(200, {"error": str(e)})


def main():
    ap = argparse.ArgumentParser(description="EffectCraft AI Chat bridge")
    ap.add_argument("--config", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "agents.json"))
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--list", action="store_true", help="print the configured agents and exit")
    args = ap.parse_args()

    if not os.path.exists(args.config):
        raise SystemExit("no config at %s — copy agents.example.json to agents.json and edit it" % args.config)
    with open(args.config) as f:
        agents = json.load(f).get("agents")
    if not isinstance(agents, list) or not agents:
        raise SystemExit("config needs a non-empty \"agents\" list")

    if args.list:
        for a in agents:
            print("%-12s %-10s %s %s" % (a.get("id", "?"), a.get("kind", "command"),
                                         "ready" if ready(a) else "not ready", note(a)))
        return

    Handler.agents = {a["id"]: a for a in agents}
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    srv.daemon_threads = True
    print("[bridge] http://127.0.0.1:%d — %d agents" % (args.port, len(Handler.agents)), file=sys.stderr, flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()

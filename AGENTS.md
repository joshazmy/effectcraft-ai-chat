# EffectCraft AI Chat — agent notes

Extensions and agent wiring for [EffectCraft](https://github.com/storytold/effectcraft)
(open-source, pure-Rust After Effects-style compositor). Owner: Joshua (`joshazmy`).
**Public repo** — nothing machine-specific or secret goes in.

## What's here

| Path | What |
|---|---|
| `extensions/AI Chat.jsx` | ScriptUI panel — an "AI Chat" tab inside EffectCraft |
| `bridge/agent-bridge.py` | local bridge (127.0.0.1:8765): ollama / openai / command / acp |
| `bridge/agents.example.json` | committed template; real `agents.json` is gitignored |
| `tests/panel-e2e.jsx`, `tests/run-panel-e2e.py` | headless end-to-end test |
| `.devin/mcp_config.json` | EffectCraft MCP servers for Devin CLI (headless + bridged) |
| `scripts/install-cli.sh` | downloads `effectcraft-cli` into `~/.local/bin` |

## Machine facts (verify, don't assume)

- App: `/Applications/EffectCraft.app` (0.8.0). Settings folder:
  `~/Library/Application Support/EffectCraft` (`prefs.json`, `Scripts/`, `Plug-ins/`).
- CLI: `effectcraft-cli` on PATH (`~/.local/bin`, v0.8.0 macOS universal release asset).
- Ollama: `http://127.0.0.1:11434`, model `llama3.2:3b`.
- Bridge: `python3 bridge/agent-bridge.py --config bridge/agents.json` → 127.0.0.1:8765.
- Gate: `scripting.allowScriptsWriteFiles` is ON in `prefs.json` (scripts need it
  for File and Socket access). Don't change security settings without asking.

## Running scripts headlessly (the important trick)

`effectcraft-cli script` runs with **default** preferences — it does not load the
desktop's `prefs.json`, so the scripting gate is always off there. To run a
script that uses File/Socket headlessly, use `run` to set the gate in the same
session:

```sh
effectcraft-cli run prefs.set '{"key":"scripting.allowScriptsWriteFiles","value":true}' \
  script.run '{"code":"<js code>","name":"x.jsx"}' --empty --json
```

In-session only — nothing is written to desktop settings. (`--bridge` mode runs
scripts inside the running app, which does load the user's settings.)

## Testing

- Panel e2e (needs `ollama serve`): from the project root,
  `python3 tests/run-panel-e2e.py`. Starts the bridge with a test config, stubs
  ScriptUI, runs the real panel file, checks direct-Ollama and bridge round-trips.
- Bridge alone: `--list` prints agents and readiness; `curl 127.0.0.1:8765/agents`.
- Live agents verified once through the bridge: codex (`codex exec`), devin
  (`devin acp`), opencode (`opencode run`). ACP: `initialize` → `session/new` →
  `session/prompt`, collecting `agent_message_chunk` updates.
- MCP smoke: `effectcraft-cli mcp --demo` speaks JSON-RPC over stdio.

## Panel / bridge facts

- ScriptUI panels dock as tabs, listed at the bottom of the Window menu; the file
  lives in `Scripts/ScriptUI Panels/` in the settings folder.
- Scripting Socket API: plain TCP, no TLS → the panel only talks to local HTTP
  (Ollama direct, or the bridge). The bridge does HTTPS and subprocesses.
- Requests block while the agent generates (the app waits). Known limitation.
- Ollama shape: `POST /api/chat {"model","stream":false,"messages":[…]}` →
  `{"message":{"content":…}}`; `Content-Length`, `Connection: close`.
- Bridge API: `GET /agents`, `POST /chat {agent, messages}` → `{reply}` / `{error}`.

## Rules

- GitHub is code control: `joshazmy/effectcraft-ai-chat` (public). Commit author:
  Joshua James <jothantranston@pm.me>.
- Never commit `bridge/agents.json`, keys, the CLI binary, or model files.
- Local services stay on `127.0.0.1`.

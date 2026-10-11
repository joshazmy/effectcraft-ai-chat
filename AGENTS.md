# artcraft — agent notes

Extensions and agent wiring for [ArtCraft](https://getartcraft.com)'s EffectCraft
(open-source, pure-Rust After Effects-style compositor). Owner: Joshua (`joshazmy`).

## What's here

| Path | What |
|---|---|
| `extensions/AI Chat.jsx` | ScriptUI panel — an "AI Chat" tab inside EffectCraft, backed by a local Ollama model |
| `tests/panel-e2e.jsx`, `tests/run-panel-e2e.py` | headless end-to-end test for the panel |
| `.devin/mcp_config.json` | EffectCraft MCP servers for Devin CLI (headless + bridged) |
| `scripts/install-cli.sh` | downloads `effectcraft-cli` into `~/.local/bin` |

## Machine facts (verify, don't assume)

- App: `/Applications/EffectCraft.app` (0.8.0). Settings folder:
  `~/Library/Application Support/EffectCraft` (`prefs.json`, `Scripts/`, `Plug-ins/`).
- CLI: `effectcraft-cli` on PATH (`~/.local/bin`, v0.8.0 macOS universal release asset).
- Ollama: `http://127.0.0.1:11434`, model `llama3.2:3b`.
- Gate: `scripting.allowScriptsWriteFiles` is ON in `prefs.json` (Scripts need it
  for File and Socket access). Do not turn it off or change security settings
  without asking.

## Running scripts headlessly (the important trick)

`effectcraft-cli script` runs with **default** preferences — it does not load the
desktop's `prefs.json`, so the scripting gate is always off there. To run a
script that uses File/Socket headlessly, use `run` to set the gate in the same
session:

```sh
effectcraft-cli run prefs.set '{"key":"scripting.allowScriptsWriteFiles","value":true}' \
  script.run '{"code":"<js code>","name":"x.jsx"}' --empty --json
```

In-session only — nothing is written to desktop settings. `tests/run-panel-e2e.py`
does exactly this for the panel test. (In `--bridge` mode scripts run inside the
running app, which *does* load the user's settings.)

## Testing

- Panel e2e (needs `ollama serve`): from the project root,
  `python3 tests/run-panel-e2e.py`. It stubs ScriptUI, runs the real
  `extensions/AI Chat.jsx`, clicks Send, and checks the reply lands in the transcript.
- MCP smoke: `effectcraft-cli mcp --demo` speaks JSON-RPC over stdio
  (`initialize`, `tools/list`, `tools/call`).
- Live app: launch with `effectcraft --control 9877` (control channel) and route
  CLI calls to it with `--bridge 9877`.

## Panel facts

- ScriptUI panels dock as tabs, listed at the bottom of the Window menu; the file
  lives in `Scripts/ScriptUI Panels/` in the settings folder (installed).
- The scripting Socket API is plain TCP, no TLS → local HTTP servers only
  (Ollama). Cloud APIs would need a local bridge/proxy.
- Requests block while the model generates (the app waits).
- Ollama shape: `POST /api/chat {"model", "stream": false, "messages": [...]}` →
  `{"message": {"content": ...}, "eval_count": ...}`; `Content-Length`,
  `Connection: close`.

## Rules

- GitHub is code control: `joshazmy/artcraft` (private). Commit author:
  Joshua James <jothantranston@pm.me>.
- Never commit the 144 MB CLI binary or model files.
- Local services stay on `127.0.0.1`.
- Don't install things into the app or flip its security settings without asking.

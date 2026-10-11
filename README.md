# EffectCraft AI Chat

**An AI chat tab inside [EffectCraft](https://github.com/storytold/effectcraft)** —
the open-source, pure-Rust After Effects alternative. Chat with a local model, or
with whatever agents you already have: **Codex on a ChatGPT plan, Devin over ACP,
OpenCode, any OpenAI-compatible API, any CLI.**

No fork of EffectCraft, no recompiling, no changes to the app. It's a ScriptUI
panel — the app's own extension mechanism — plus a small local bridge that holds
the connections.

> Community project. Not affiliated with ArtCraft or Adobe. EffectCraft is
> MIT/Apache-2.0; this repo is independent.

## Quick start (panel + local model)

1. **Ollama** running with a model: `ollama serve`, `ollama pull llama3.2:3b`.
2. In EffectCraft: **Settings ▸ Scripting & Expressions ▸ Allow Scripts to Write
   Files and Access Network** — on. (Scripts can't use the network without it.)
3. Copy the panel in:

   ```sh
   # macOS settings folder; Windows: %APPDATA%\EffectCraft; Linux: ~/.config/effectcraft
   mkdir -p "$HOME/Library/Application Support/EffectCraft/Scripts/ScriptUI Panels"
   cp "extensions/AI Chat.jsx" "$HOME/Library/Application Support/EffectCraft/Scripts/ScriptUI Panels/"
   ```

   (Or use **File ▸ Scripts ▸ Install ScriptUI Panel…**.)
4. Restart EffectCraft → **Window ▸ AI Chat.jsx** → the tab docks anywhere.

## Connections (the bridge)

The panel's scripting Socket API is plain TCP with **no TLS** and it can't spawn
processes, so it talks to a local bridge over HTTP on `127.0.0.1:8765`. The
bridge is what reaches everything else — cloud APIs over HTTPS, and CLIs:

```sh
python3 bridge/agent-bridge.py --config bridge/agents.json   # copy agents.example.json first
```

| Kind | What it connects to | Example config |
|---|---|---|
| `ollama` | Local models (also the panel's direct mode) | `{"kind":"ollama","url":"http://127.0.0.1:11434","model":"llama3.2:3b"}` |
| `command` | Any CLI agent | `["codex","exec","--skip-git-repo-check","{prompt}"]`, `["opencode","run","{prompt}"]` |
| `acp` | ACP agents over stdio | `["devin","acp"]`, `["opencode","acp"]` |
| `openai` | OpenAI-compatible APIs | `{"kind":"openai","base_url":"https://api.openai.com/v1","model":"gpt-4o-mini","key":"pass:openai"}` |

Keys come from `pass` (`pass:name`) or the environment (`env:NAME`) — never
stored in the panel or the repo. Add or remove agents in `agents.json`, hit
**Refresh** in the panel, and the picker updates.

The four adapters above are verified working (see Testing): a local model, Codex
with a ChatGPT plan, Devin over ACP, and OpenCode — each answered through the
bridge on the maintainer's machine.

## How it works

```
EffectCraft ── ScriptUI panel ── plain HTTP ──▶ 127.0.0.1:8765  (agent-bridge.py)
                                                   ├── ollama      → local model
                                                   ├── command     → codex / opencode / ...
                                                   ├── acp         → devin acp (JSON-RPC over stdio)
                                                   └── openai      → HTTPS + key from pass/env
```

- The panel is one `.jsx` file using EffectCraft's documented ScriptUI + Socket
  APIs. It can't see the project yet — it's a chat, not an editor (see Roadmap).
- The bridge is one Python file, standard library only. It binds `127.0.0.1` and
  never logs message contents.

## Testing

```sh
python3 tests/run-panel-e2e.py
```

Starts the bridge with a test config, then runs the real panel file inside
EffectCraft's own script engine (headless, with the network gate set in-session):
it checks that the panel builds, discovers the bridge's agents, gets a reply from
Ollama directly, and gets a reply from the bridge. 7 checks, all green on macOS
with EffectCraft 0.8.0.

## Layout

| Path | What |
|---|---|
| `extensions/AI Chat.jsx` | the panel — install into `Scripts/ScriptUI Panels/` |
| `bridge/agent-bridge.py` | the connections: ollama / openai / command / acp |
| `bridge/agents.example.json` | copy to `agents.json` and edit |
| `tests/` | headless end-to-end test |
| `scripts/install-cli.sh` | installs `effectcraft-cli` (for the tests and MCP) |

## Roadmap

- Streaming replies (today a request blocks until the agent finishes).
- Let the agent *edit* the project: the scripting API can, the panel just doesn't
  ask it to yet.
- A one-click installer for the panel.

## License

MIT. See [LICENSE](LICENSE).

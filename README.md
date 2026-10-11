# artcraft

Working project for [ArtCraft](https://getartcraft.com)'s **EffectCraft** — a local
AI chat tab for the app, plus the agent wiring around it.

## What's in the box

- **`extensions/AI Chat.jsx`** — an "AI Chat" tab for EffectCraft, built as a
  ScriptUI panel (the app's extension mechanism — no app changes, no recompiling).
  It chats with a local Ollama model and docks like any other panel.
- **`tests/`** — a headless end-to-end test that runs the actual panel file and
  verifies the round-trip to Ollama.
- **`.devin/mcp_config.json`** — registers EffectCraft's MCP server for Devin CLI
  (headless, or bridged to the running app).
- **`scripts/install-cli.sh`** — installs `effectcraft-cli` into `~/.local/bin`.

## Use the panel

1. Ollama with a model pulled — already set up (`llama3.2:3b`; `ollama serve`).
2. Settings ▸ Scripting & Expressions ▸ **Allow Scripts to Write Files and Access
   Network** — enabled in `prefs.json`; the app picks it up when it restarts.
3. Restart EffectCraft, then **Window ▸ AI Chat.jsx** — the tab docks anywhere.
4. Type, Send. The model answers in the transcript; `Clear` resets the conversation.

Limitations (v0): the reply arrives in one blocking call, so the app waits while
the model thinks. Local models only — the scripting Socket API has no TLS, so
cloud APIs would need a local bridge. The model can't edit the project yet.

## Agents

See `AGENTS.md`. The MCP `effectcraft` server runs headless
(`effectcraft-cli mcp --autosave --demo`); `effectcraft-app` bridges to a running
app started with `effectcraft --control 9877`.

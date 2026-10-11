// AI Chat — an EffectCraft ScriptUI panel that chats with any agent:
// a local Ollama model directly, or whatever the local bridge exposes
// (Codex with a ChatGPT plan, Devin over ACP, OpenCode, OpenAI-compatible
// APIs, any CLI). The bridge lives in this repository: bridge/agent-bridge.py.
//
// Install: copy this file to `Scripts/ScriptUI Panels/` in the EffectCraft
// settings folder (~/Library/Application Support/EffectCraft on macOS), or use
// File ▸ Scripts ▸ Install ScriptUI Panel…. It then appears at the bottom of
// the Window menu and docks like any panel.
//
// Requirements:
//   - Settings ▸ Scripting & Expressions ▸ Allow Scripts to Write Files and
//     Access Network (the scripting Socket API is gated by it)
//   - Ollama for the direct connection; the bridge (127.0.0.1:8765) for the rest
//
// Notes: the scripting Socket API is plain TCP with no TLS, so this panel talks
// to local HTTP servers only — the bridge is what reaches cloud APIs and CLIs.
// A request blocks until the agent finishes, so EffectCraft waits while the
// reply is generated. Nothing leaves your machine except what an agent you
// configured sends.

(function aiChat(thisObj) {
  var ui = thisObj instanceof Panel ? thisObj : new Window("palette", "AI Chat", undefined, { resizeable: true });
  ui.orientation = "column";
  ui.alignChildren = ["fill", "top"];
  ui.spacing = 6;

  var OLLAMA = "127.0.0.1:11434";
  var BRIDGE = "127.0.0.1:8765";
  var DEFAULT_MODEL = "llama3.2:3b";
  var SYSTEM = "You are the AI Chat panel inside EffectCraft, an open-source After Effects-style motion graphics app. Keep replies short, concrete and friendly. You cannot see the project yet; if asked to change it, say what you would do.";

  var history = [];
  var transcript = "";
  var agentIds = ["ollama"];
  var agentLabels = ["Ollama (direct)"];

  // UTF-8 byte length, for Content-Length (JS strings are UTF-16).
  function utf8Len(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  // One HTTP/1.1 request over the scripting Socket API; returns the JSON body.
  function httpJson(host, method, path, bodyObj, timeoutSec) {
    var s = new Socket();
    s.timeout = timeoutSec;
    if (!s.open(host)) throw new Error("cannot reach " + host + " (" + (s.error || "is it running?") + ")");
    try {
      var body = bodyObj ? JSON.stringify(bodyObj) : "";
      var head = method + " " + path + " HTTP/1.1\r\n"
        + "Host: " + host + "\r\n"
        + "Content-Type: application/json\r\n"
        + (body ? "Content-Length: " + utf8Len(body) + "\r\n" : "")
        + "Connection: close\r\n\r\n";
      if (!s.write(head + body)) throw new Error("socket write failed (" + s.error + ")");
      var raw = s.read(-1);
      var i = raw.indexOf("\r\n\r\n");
      if (i < 0) throw new Error("no HTTP response from " + host + " (" + raw.length + " bytes)");
      var status = Number((raw.substring(0, i).match(/^HTTP\/1\.[01] (\d+)/) || [0, 0])[1]);
      var json = JSON.parse(raw.substring(i + 4));
      if (status !== 200) throw new Error(json.error || ("HTTP " + status));
      return json;
    } finally {
      s.close();
    }
  }

  function selectedAgentId() {
    var sel = agentPick.selection;
    if (!sel) return agentIds[0];
    var i = agentPick.items.indexOf(sel);
    return i >= 0 && i < agentIds.length ? agentIds[i] : agentIds[0];
  }

  function rebuildPicker() {
    var keep = selectedAgentId();
    agentPick.removeAll();
    for (var i = 0; i < agentLabels.length; i++) agentPick.add("item", agentLabels[i]);
    var idx = agentIds.indexOf(keep);
    agentPick.selection = idx >= 0 ? idx : 0;
  }

  function probeBridge() {
    var j = httpJson(BRIDGE, "GET", "/agents", null, 2);
    var list = j.agents || [];
    agentIds = ["ollama"];
    agentLabels = ["Ollama (direct)"];
    for (var i = 0; i < list.length; i++) {
      agentIds.push(list[i].id);
      agentLabels.push((list[i].label || list[i].id) + (list[i].ready === false ? " — not ready" : ""));
    }
    rebuildPicker();
    return list.length;
  }

  function render() {
    transcriptBox.text = transcript || "Ask a local model about your project. Nothing leaves this machine.";
  }

  function send() {
    var text = inputBox.text;
    if (!text || !text.replace(/\s+/g, "")) { status.text = "Type a message first."; return; }
    var agent = selectedAgentId();
    inputBox.text = "";
    transcript += (transcript ? "\n\n" : "") + "You: " + text;
    render();
    history.push({ role: "user", content: text });
    try {
      var reply;
      if (agent === "ollama") {
        status.text = "asking Ollama …";
        var j = httpJson(OLLAMA, "POST", "/api/chat",
          { model: modelBox.text, stream: false, messages: [{ role: "system", content: SYSTEM }].concat(history) }, 300);
        reply = (j.message && j.message.content) || "(empty reply)";
      } else {
        status.text = "asking " + agent + " via bridge …";
        var b = httpJson(BRIDGE, "POST", "/chat",
          { agent: agent, messages: [{ role: "system", content: SYSTEM }].concat(history) }, 600);
        if (b.error) throw new Error(b.error);
        reply = b.reply || "(empty reply)";
      }
      history.push({ role: "assistant", content: reply });
      transcript += "\n\nAI: " + reply;
      status.text = "ready";
    } catch (e) {
      history.pop();
      transcript += "\n\n[error] " + e.message;
      status.text = "error: " + e.message;
    }
    render();
  }

  function clearAll() {
    history = [];
    transcript = "";
    render();
    status.text = "cleared";
  }

  var agentRow = ui.add("group");
  agentRow.alignChildren = ["fill", "center"];
  agentRow.add("statictext", undefined, "Agent:");
  var agentPick = agentRow.add("dropdownlist", undefined, agentLabels);
  agentPick.preferredSize.width = 210;
  var refreshBtn = agentRow.add("button", undefined, "Refresh");

  var modelRow = ui.add("group");
  modelRow.add("statictext", undefined, "Model:");
  var modelBox = modelRow.add("edittext", undefined, DEFAULT_MODEL);
  modelBox.characters = 18;
  var clearBtn = modelRow.add("button", undefined, "Clear");

  var transcriptBox = ui.add("edittext", undefined, "", { multiline: true, readonly: true });
  transcriptBox.preferredSize.width = 320;
  transcriptBox.preferredSize.height = 240;

  var inputBox = ui.add("edittext", undefined, "", { multiline: true });
  inputBox.preferredSize.height = 56;

  var status = ui.add("statictext", undefined, "Ollama direct · bridge " + BRIDGE);

  var buttonRow = ui.add("group");
  buttonRow.alignChildren = ["right", "center"];
  var sendBtn = buttonRow.add("button", undefined, "Send");

  sendBtn.onClick = send;
  clearBtn.onClick = clearAll;
  refreshBtn.onClick = function () {
    try {
      var n = probeBridge();
      status.text = "bridge: " + n + " agent(s) at " + BRIDGE;
    } catch (e) {
      status.text = "bridge off (" + e.message + ") — run bridge/agent-bridge.py";
    }
  };
  render();

  if (ui instanceof Window) {
    ui.center();
    ui.show();
  } else {
    ui.layout.layout(true);
  }

  try {
    var n = probeBridge();
    status.text = "ready · " + (n + 1) + " agents (Ollama direct + bridge " + BRIDGE + ")";
  } catch (e) {
    status.text = "Ollama direct only — bridge off (run bridge/agent-bridge.py)";
  }
})(this);

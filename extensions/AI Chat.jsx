// AI Chat — an EffectCraft ScriptUI panel that chats with a local Ollama model.
//
// Install: copy this file to `Scripts/ScriptUI Panels/` in the EffectCraft
// settings folder (~/Library/Application Support/EffectCraft on macOS), or use
// File ▸ Scripts ▸ Install ScriptUI Panel…. It then appears at the bottom of
// the Window menu and docks like any panel.
//
// Requirements:
//   - Settings ▸ Scripting & Expressions ▸ Allow Scripts to Write Files and
//     Access Network (the scripting Socket API is gated by it)
//   - A local Ollama server (`ollama serve`), http://127.0.0.1:11434
//
// Notes: the scripting Socket API is plain TCP with no TLS, so this panel
// talks to a local HTTP server only — never to a cloud API directly. A request
// blocks until the model finishes, so EffectCraft waits while the reply is
// generated. The transcript is the conversation; nothing is sent anywhere but
// your own machine.

(function aiChat(thisObj) {
  var ui = thisObj instanceof Panel ? thisObj : new Window("palette", "AI Chat", undefined, { resizeable: true });
  ui.orientation = "column";
  ui.alignChildren = ["fill", "top"];
  ui.spacing = 6;

  var HOST = "127.0.0.1:11434";
  var DEFAULT_MODEL = "llama3.2:3b";
  var SYSTEM = "You are the AI Chat panel inside EffectCraft, an open-source After Effects-style motion graphics app. Keep replies short, concrete and friendly. You cannot see the project yet; if asked to change it, say what you would do.";

  var history = [];
  var transcript = "";

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
  function httpJson(method, path, bodyObj) {
    var s = new Socket();
    s.timeout = 300;
    if (!s.open(HOST)) throw new Error("cannot reach Ollama at " + HOST + " — is `ollama serve` running? (" + s.error + ")");
    try {
      var body = bodyObj ? JSON.stringify(bodyObj) : "";
      var head = method + " " + path + " HTTP/1.1\r\n"
        + "Host: " + HOST + "\r\n"
        + "Content-Type: application/json\r\n"
        + (body ? "Content-Length: " + utf8Len(body) + "\r\n" : "")
        + "Connection: close\r\n\r\n";
      if (!s.write(head + body)) throw new Error("socket write failed (" + s.error + ")");
      var raw = s.read(-1);
      var i = raw.indexOf("\r\n\r\n");
      if (i < 0) throw new Error("no HTTP response from " + HOST + " (" + raw.length + " bytes)");
      var status = Number((raw.substring(0, i).match(/^HTTP\/1\.[01] (\d+)/) || [0, 0])[1]);
      var json = JSON.parse(raw.substring(i + 4));
      if (status !== 200) throw new Error(json.error || ("HTTP " + status));
      return json;
    } finally {
      s.close();
    }
  }

  function render() {
    transcriptBox.text = transcript || "Ask a local model about your project. Nothing leaves this machine.";
  }

  function send() {
    var text = inputBox.text;
    if (!text || !text.replace(/\s+/g, "")) { status.text = "Type a message first."; return; }
    inputBox.text = "";
    transcript += (transcript ? "\n\n" : "") + "You: " + text;
    render();
    status.text = "asking " + modelBox.text + " …";
    history.push({ role: "user", content: text });
    try {
      var json = httpJson("POST", "/api/chat", {
        model: modelBox.text,
        stream: false,
        messages: [{ role: "system", content: SYSTEM }].concat(history)
      });
      var reply = (json.message && json.message.content) || "(empty reply)";
      history.push({ role: "assistant", content: reply });
      transcript += "\n\nAI: " + reply;
      status.text = "ready" + (json.eval_count ? " — " + json.eval_count + " tokens" : "");
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

  var status = ui.add("statictext", undefined, "Local model via Ollama at " + HOST);

  var buttonRow = ui.add("group");
  buttonRow.alignChildren = ["right", "center"];
  var sendBtn = buttonRow.add("button", undefined, "Send");

  sendBtn.onClick = send;
  clearBtn.onClick = clearAll;
  render();

  if (ui instanceof Window) {
    ui.center();
    ui.show();
  } else {
    ui.layout.layout(true);
  }
})(this);

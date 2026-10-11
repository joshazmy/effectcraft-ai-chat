// Headless end-to-end test for extensions/AI Chat.jsx.
//
// Run from the project root:
//
//   python3 tests/run-panel-e2e.py
//
// (The runner starts the bridge with a test config, then hands this file to
// `effectcraft-cli run` with the scripting network gate set in-session — a bare
// `effectcraft-cli script` session always runs with default preferences; see
// AGENTS.md.)
//
// It stubs the ScriptUI environment, loads the real panel source, and checks:
//   - the panel builds and finds its controls
//   - the bridge's agents appear in the picker
//   - a direct Ollama round-trip lands in the transcript
//   - a bridge round-trip (the test "echo" agent) lands in the transcript
// Needs `ollama serve` and the model below.

var MODEL = "llama3.2:3b";

// ---- stub ScriptUI --------------------------------------------------------

function makeStub(type, text, props) {
  var s = {
    type: type,
    text: text === undefined ? "" : String(text),
    properties: props || {},
    __kids: [],
    preferredSize: {},
    value: 0,
    items: [],
    __sel: [],
    onClick: null,
    onChange: null,
    onChanging: null
  };
  if (type === "dropdownlist" || type === "listbox") {
    Object.defineProperty(s, "selection", {
      get: function () { return s.__sel.length ? s.items[s.__sel[0]] : null; },
      set: function (v) {
        var i = typeof v === "number" ? v : s.items.indexOf(v);
        s.__sel = i >= 0 && i < s.items.length ? [i] : [];
      },
      configurable: true
    });
    s.removeAll = function () { s.items = []; s.__sel = []; };
  }
  s.add = function (t, bounds, txt, pr) {
    if (t === "item") {
      var it = { text: String(bounds === undefined ? "" : bounds) };
      s.items.push(it);
      return it;
    }
    var k = makeStub(t, typeof txt === "string" || txt === undefined ? txt : "", pr);
    if ((t === "dropdownlist" || t === "listbox") && txt instanceof Array) {
      for (var n = 0; n < txt.length; n++) k.items.push({ text: String(txt[n]) });
    }
    s.__kids.push(k);
    return k;
  };
  s.layout = { layout: function () {}, resize: function () {}, margins: {}, spacing: 0 };
  s.center = function () {};
  s.show = function () {};
  s.close = function () {};
  s.addEventListener = function () {};
  return s;
}

function findStub(root, pred) {
  if (pred(root)) return root;
  for (var i = 0; i < root.__kids.length; i++) {
    var hit = findStub(root.__kids[i], pred);
    if (hit) return hit;
  }
  return null;
}

var pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; writeLn("PASS  " + name); }
  else { fail++; writeLn("FAIL  " + name + (extra ? "  [" + extra + "]" : "")); }
}

// ---- load and run the real panel ------------------------------------------

var f = new File("extensions/AI Chat.jsx");
if (!f.open("r")) throw new Error("cannot open extensions/AI Chat.jsx (run from the project root)");
var src = f.read();
f.close();

var root = null;
(function () {
  function Window() { root = makeStub("window", "AI Chat", {}); return root; }
  function Panel() {}
  eval(src);
})();

check("panel builds", root !== null && root.__kids.length > 0);

var agentPick = findStub(root, function (n) { return n.type === "dropdownlist"; });
var transcriptBox = findStub(root, function (n) { return n.type === "edittext" && n.properties.readonly; });
var inputBox = findStub(root, function (n) { return n.type === "edittext" && n.properties.multiline && !n.properties.readonly; });
var modelBox = findStub(root, function (n) { return n.type === "edittext" && !n.properties.multiline; });
var sendBtn = findStub(root, function (n) { return n.type === "button" && n.text === "Send"; });
var refreshBtn = findStub(root, function (n) { return n.type === "button" && n.text === "Refresh"; });
check("controls found (agent picker, model, transcript, input, Send, Refresh)",
  !!agentPick && !!modelBox && !!transcriptBox && !!inputBox && !!sendBtn && !!refreshBtn);

var labels = [];
for (var i = 0; i < agentPick.items.length; i++) labels.push(agentPick.items[i].text);
check("picker starts with direct Ollama", labels.length >= 1 && labels[0] === "Ollama (direct)", labels.join(", "));
check("bridge agents discovered at panel open", labels.length >= 3, labels.join(", "));

// ---- direct Ollama --------------------------------------------------------

agentPick.selection = 0;
modelBox.text = MODEL;
inputBox.text = "Reply with exactly: hello from effectcraft";
sendBtn.onClick();
check("direct Ollama reply in transcript",
  transcriptBox.text.toLowerCase().indexOf("hello from effectcraft") > 0 && transcriptBox.text.indexOf("AI: ") > 0,
  transcriptBox.text.substring(Math.max(0, transcriptBox.text.length - 220)));

// ---- bridge round-trip (test echo agent) ----------------------------------

refreshBtn.onClick();
var echoIdx = -1;
for (var j = 0; j < agentPick.items.length; j++) {
  if (agentPick.items[j].text.indexOf("Echo") >= 0) echoIdx = j;
}
check("echo agent present after Refresh", echoIdx >= 0, labels.join(", "));

agentPick.selection = echoIdx;
inputBox.text = "ping from the harness";
sendBtn.onClick();
check("bridge reply in transcript",
  transcriptBox.text.indexOf("ECHO:") > 0 && transcriptBox.text.indexOf("ping from the harness") > 0,
  transcriptBox.text.substring(Math.max(0, transcriptBox.text.length - 220)));

writeLn(pass + " passed, " + fail + " failed");
if (fail > 0) throw new Error(fail + " check(s) failed");

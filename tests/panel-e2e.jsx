// Headless end-to-end test for extensions/AI Chat.jsx.
//
// Run from the project root (~/Documents/artcraft):
//
//   python3 tests/run-panel-e2e.py
//
// (That script sets the scripting network gate in-session and hands this file
// to `effectcraft-cli run`, because a bare `effectcraft-cli script` session
// always runs with default preferences — see AGENTS.md.)
//
// It stubs the ScriptUI environment, loads the real panel source, types a
// message, "clicks" Send, and checks that an Ollama reply lands in the
// transcript. Needs `ollama serve` and the model below.

var PANEL = "extensions/AI Chat.jsx";
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
    selection: null,
    onClick: null,
    onChange: null,
    onChanging: null
  };
  s.add = function (t, bounds, txt, pr) {
    var k = makeStub(t, typeof txt === "string" || txt === undefined ? txt : String(txt), pr);
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

var f = new File(PANEL);
if (!f.open("r")) throw new Error("cannot open " + PANEL + " (run from the project root)");
var src = f.read();
f.close();

var root = null;
(function () {
  function Window() { root = makeStub("window", "AI Chat", {}); return root; }
  function Panel() {}
  eval(src);
})();

check("panel builds", root !== null && root.__kids.length > 0);

var transcriptBox = findStub(root, function (n) { return n.type === "edittext" && n.properties.readonly; });
var inputBox = findStub(root, function (n) { return n.type === "edittext" && n.properties.multiline && !n.properties.readonly; });
var sendBtn = findStub(root, function (n) { return n.type === "button" && n.text === "Send"; });
var modelBox = findStub(root, function (n) { return n.type === "edittext" && !n.properties.multiline; });
check("controls found (model, transcript, input, Send)", !!modelBox && !!transcriptBox && !!inputBox && !!sendBtn);

modelBox.text = MODEL;
inputBox.text = "Reply with exactly: hello from effectcraft";
sendBtn.onClick();

check("user message in transcript", transcriptBox.text.indexOf("You: Reply with exactly") >= 0, transcriptBox.text.substring(0, 120));
check("ollama reply in transcript", transcriptBox.text.toLowerCase().indexOf("hello from effectcraft") > 0 && transcriptBox.text.indexOf("AI: ") > 0, transcriptBox.text.substring(Math.max(0, transcriptBox.text.length - 220)));

writeLn(pass + " passed, " + fail + " failed");
if (fail > 0) throw new Error(fail + " check(s) failed");

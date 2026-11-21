/* Saved progress still loads. Every file in tests/fixtures/saves is what a
   build of the game left in localStorage: a JSON object mapping each key to
   the exact string the game stored there. Released fixtures never change; a
   new save format adds new v<N>-*.json files (see docs/RELEASING.md). */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("../web/lessons.js");
let n = 0; const t = (name, f) => { f(); n++; console.log("ok -", name); };

const DIR = path.join(__dirname, "fixtures", "saves");
const SAVE_KEY = "coastline.v1", PREVIOUS_KEY = "coastline.v1.previous", MUTED_KEY = "coastline.muted";
/* Every fixture, by name, with what it must load as (previous: the save
   that ?new kept aside, or null). */
const FIXTURES = {
  "v1-scene1-start.json": {save: {reached: 1, done: false}, muted: false, previous: null},
  "v1-scene2-snowflake.json": {save: {reached: 2, done: false}, muted: false, previous: null},
  "v1-finished-sound-off.json": {save: {reached: 3, done: true}, muted: true, previous: null},
  "v1-started-over.json": {save: {reached: 1, done: false}, muted: true, previous: {reached: 3, done: true}},
};

/* The storage the game reads through (StrataKit.store), over a fixture. */
function fakeStore(values) {
  return {get: (k) => (Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null), set: (k, v) => { values[k] = String(v); }};
}

t("the fixture folder holds exactly the listed fixtures", () => {
  const files = fs.readdirSync(DIR).sort();
  assert.deepEqual(files, Object.keys(FIXTURES).sort(), "a fixture is missing, or a file in the folder is not listed in FIXTURES");
});

t("SAVE_VERSION is a positive integer and every format 1..SAVE_VERSION has a fixture", () => {
  assert(Number.isInteger(L.SAVE_VERSION) && L.SAVE_VERSION >= 1);
  for (const name of Object.keys(FIXTURES)) {
    const m = /^v(\d+)-[a-z0-9-]+\.json$/.exec(name);
    assert(m, `${name} is not named v<N>-<name>.json`);
    assert(+m[1] <= L.SAVE_VERSION, `${name} is newer than SAVE_VERSION ${L.SAVE_VERSION}`);
  }
  for (let v = 1; v <= L.SAVE_VERSION; v++) assert(Object.keys(FIXTURES).some((f) => f.startsWith(`v${v}-`)), `no fixture for save format ${v}`);
});

for (const [name, want] of Object.entries(FIXTURES)) {
  t(`${name} loads as scene ${want.save.reached}${want.save.done ? ", finished" : ""}${want.muted ? ", sound off" : ""}`, () => {
    const stored = JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
    for (const [k, v] of Object.entries(stored)) {
      assert([SAVE_KEY, PREVIOUS_KEY, MUTED_KEY].includes(k), `unknown key ${k}`);
      assert.equal(typeof v, "string", k);
    }
    const store = fakeStore(stored);
    // main.js: loadSave() = Lessons.parseSave(StrataKit.store.get("coastline.v1"))
    const save = L.parseSave(store.get(SAVE_KEY));
    assert.deepEqual(save, want.save);
    assert(L.SCENES[save.reached - 1], `scene ${save.reached} exists`);
    // sound.js: muted = Lessons.parseMuted(StrataKit.store.get("coastline.muted"))
    assert.equal(L.parseMuted(store.get(MUTED_KEY)), want.muted);
    // the progress ?new kept aside is a save in the same format
    if (want.previous) assert.deepEqual(L.parseSave(store.get(PREVIOUS_KEY)), want.previous);
    else assert.equal(store.get(PREVIOUS_KEY), null);
    // saving again (writeSave) stores the same string
    const before = stored[SAVE_KEY];
    store.set(SAVE_KEY, JSON.stringify({reached: save.reached, done: !!save.done}));
    assert.equal(store.get(SAVE_KEY), before);
  });
}

t("the sound setting reads as before: only \"1\" is off", () => {
  for (const [raw, off] of [["1", true], ["0", false], [null, false], ["", false], ["true", false]]) assert.equal(L.parseMuted(raw), off, String(raw));
});

console.log(`${n} tests passed`);

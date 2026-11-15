const assert = require("assert");
const L = require("../web/lessons.js");
const F = require("../web/fractal.js");
let n = 0; const t = (name, f) => { f(); n++; console.log("ok -", name); };
const s = F.survey();
t("three scenes", () => assert.deepEqual(L.SCENES.map((x) => x.name), ["The Ruler", "The Snowflake", "The Net"]));
t("the 1 m chain: only 'a lot longer' is right on this island", () => {
  assert.equal(L.settleVerdict("lot", s.chains).right, true);
  assert.equal(L.settleVerdict("settle", s.chains).right, false);
  assert.equal(L.settleVerdict("bit", s.chains).right, false);
  assert.match(L.settleVerdict("settle", s.chains).text, /didn't settle/);
});
t("Koch guesses: area settles, coast endless", () => {
  const v = L.kochVerdict("settles", "endless"); assert(v.areaRight && v.coastRight);
  const w = L.kochVerdict("endless", "settles"); assert(!w.areaRight && !w.coastRight);
  assert(Math.abs(L.kochCoastAfter(20) - (4 / 3) ** 20) < 1e-6);
});
t("halving the mesh: between twice and four times", () => {
  const v = L.halveVerdict("between", s.nets); assert(v.right); assert(v.ratio > 2.15 && v.ratio < 2.6);
  assert.equal(L.halveVerdict("two", s.nets).right, false);
  assert.equal(L.shapeVerdict("between", s.dimension).right, true);
  assert.equal(L.shapeVerdict("line", 1.02).right, true);
});
t("every guess offers its choices with ids", () => {
  for (const set of [L.SETTLE_CHOICES, L.KOCH_AREA, L.KOCH_COAST, L.HALVE_CHOICES, L.SHAPE_CHOICES]) {
    assert(set.length >= 2); assert.equal(new Set(set.map((c) => c.id)).size, set.length);
  }
});
t("saves: good, damaged and missing all load", () => {
  assert.deepEqual(L.parseSave('{"reached":3,"done":true}'), {reached: 3, done: true});
  assert.deepEqual(L.parseSave('{"reached":2}'), {reached: 2, done: false});
  for (const bad of ["", null, "{", "[]", "7", '{"reached":9}', '{"reached":"2"}']) assert.deepEqual(L.parseSave(bad), {reached: 1, done: false});
});
t("lengths read as whole metres", () => { assert.equal(L.fmtM(1130.3), "1,130 m"); assert.equal(L.fmtM(74.6), "75 m"); });
console.log(n, "passed");

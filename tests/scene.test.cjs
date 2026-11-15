const assert = require("assert");
const W = require("../web/vendor/hall-walk.js");
const S = require("../web/scene.js");
let n = 0; const t = (name, f) => { f(); n++; console.log("ok -", name); };
// Flood fill the dry, clear ground from the first spawn, 0.5 m steps.
const step = 0.5, reach = new Set(), key = (x, z) => Math.round(x / step) + "," + Math.round(z / step);
const ok = (x, z) => S.dry(x, z) && W.clear(x, z, S.world);
{ const q = [[S.SPAWN.x, S.SPAWN.z]]; reach.add(key(...q[0]));
  while (q.length) { const [x, z] = q.pop(); for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) { const a = x + dx, b = z + dz, k = key(a, b); if (reach.has(k) || !ok(a, b)) continue; reach.add(k); q.push([a, b]); } } }
const can = (x, z, r = 1) => { for (let dx = -r; dx <= r; dx += step) for (let dz = -r; dz <= r; dz += step) if (reach.has(key(x + dx, z + dz))) return true; return false; };
t("the spawns start on dry, clear ground", () => { for (const s of S.SPAWNS) assert(ok(s.x, s.z), JSON.stringify(s)); });
t("cairn, sand tray and net post can be walked to from the start", () => {
  for (const k of ["cairn", "tray", "netPost"]) { const p = S[k]; assert(can(p.x - S.inland[0] * 1.6, p.z - S.inland[1] * 1.6) || can(p.x, p.z, 2), k); }
  for (const s of S.SPAWNS) assert(can(s.x, s.z, 0.5));
  console.log("   reachable ground", (reach.size * step * step).toFixed(0), "m²");
});
t("the camp is close together (one walk, no long treks)", () => {
  for (const k of ["cairn", "tray", "netPost", "hut"]) assert(Math.hypot(S[k].x - S.cairn.x, S[k].z - S.cairn.z) < 22, k);
});
t("ground height matches the mesh and the sea line is the coast", () => {
  let worst = 0;
  for (const [x, z] of S.coast.filter((_, i) => i % 40 === 0)) worst = Math.max(worst, Math.abs(S.groundY(x, z)));
  console.log("   worst ground height on the coast", worst.toFixed(3), "m");
  // The ground mesh is a 1 m grid, so detail finer than that sits a little off the line.
  assert(worst < 0.4);
});
t("meshes are well formed", () => {
  const m = S.build(), extra = {chain1: S.chainMesh(S.survey.chains[2]), chain100: S.chainMesh(S.survey.chains[0]), net1: S.netMesh(1).mesh, islet5: S.isletMesh(5)};
  for (const [k, x] of Object.entries(Object.assign({}, m, extra))) {
    assert(x.indices.length % 3 === 0, k); assert.equal(x.normals.length, x.positions.length, k); assert.equal(x.colors.length, x.positions.length, k);
    assert(x.uvs.length === 0 || x.uvs.length === x.nv * 2, k);
    let mx = 0; for (const i of x.indices) if (i > mx) mx = i; assert(mx < x.nv, k);
    assert(x.positions.every(Number.isFinite), k);
  }
  console.log("   vertices: ground", m.ground.nv, "solid", m.solid.nv, "1 m chain", extra.chain1.nv, "1 m net", extra.net1.nv);
});
t("the net drawn is the net counted", () => {
  for (const s of [16, 4]) { const drawn = S.netMesh(s).cells.length, counted = S.survey.nets.find((x) => x.size === s).count; assert(drawn >= counted && drawn < counted * 1.25, `${s}: ${drawn} vs ${counted}`); }
});
console.log(n, "passed");

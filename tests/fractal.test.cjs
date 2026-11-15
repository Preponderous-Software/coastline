/* The measuring: the box counter on shapes whose dimension is known, then
   the island itself. Run: node tests/fractal.test.cjs */
const assert = require("assert");
const F = require("../web/fractal.js");
let n = 0; const t = (name, f) => { f(); n++; console.log("ok -", name); };
const near = (a, b, tol, what) => assert(Math.abs(a - b) <= tol, `${what}: ${a} not within ${tol} of ${b}`);

t("noise is deterministic and in range", () => {
  for (let i = 0; i < 2000; i++) {
    const x = i * 0.137, z = i * 0.071;
    const v = F.value(x, z, 3); assert(v >= -1 && v <= 1); assert.equal(v, F.value(x, z, 3));
  }
  assert.notEqual(F.value(0.5, 0.5, 1), F.value(0.5, 0.5, 2));
});
t("the island uses 9 octaves, gain 0.7, lacunarity 2", () => {
  assert.equal(F.ISLAND.octaves, 9); assert.equal(F.ISLAND.gain, 0.7); assert.equal(F.ISLAND.lacunarity, 2);
});
t("box counter: a circle is a line (D = 1)", () => {
  const d = F.dimension(F.circle(50, 20000), [16, 8, 4, 2, 1, 0.5]);
  console.log("   circle D", d.dimension.toFixed(3), d.counts.join(","));
  near(d.dimension, 1, 0.03, "circle");
});
t("box counter: a Koch curve is log 4 / log 3", () => {
  const d = F.dimension(F.koch(7, 300), [16, 8, 4, 2, 1, 0.5]);
  console.log("   Koch D", d.dimension.toFixed(4), "vs", (Math.log(4) / Math.log(3)).toFixed(4));
  near(d.dimension, Math.log(4) / Math.log(3), 0.02, "Koch");
});
t("box counter: a filled square's boundary-dense scribble climbs towards 2", () => {
  // A space-filling zigzag over a 64 m square, 0.25 m apart: area-like down to its spacing.
  const pts = []; for (let k = 0; k <= 256; k++) { const z = k * 0.25; pts.push(k % 2 ? [64, z] : [0, z]); if (k < 256) pts.push(k % 2 ? [64, z + 0.25] : [0, z + 0.25]); }
  const d = F.dimension(pts, [16, 8, 4, 2, 1], false);
  console.log("   zigzag D", d.dimension.toFixed(3));
  assert(d.dimension > 1.85);
});
t("divider: a circle's chains approach 2πr from below", () => {
  const c = F.circle(50, 4000), L = [10, 1].map((r) => F.divider(c, r).length);
  assert(L[0] < L[1] && L[1] < 2 * Math.PI * 50 + 0.01);
  near(L[1], 2 * Math.PI * 50, 0.2, "1 m chain round a circle");
});
t("divider: a square measured with its own side", () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const d = F.divider(sq, 10);
  near(d.length, 40, 1e-9, "square"); assert(d.rest < 1e-9);
});

const s = F.survey();
t("the island has one long closed coast", () => {
  console.log("   coast vertices", s.coast.length, "fine perimeter", s.fine.toFixed(1), "area", s.area.toFixed(0), "m²");
  assert(s.coast.length > 3000); assert(s.area > 8000 && s.area < 20000);
  for (const [x, z] of s.coast.filter((_, i) => i % 50 === 0)) near(F.field(x, z), 0, 0.05, "coast on the zero line (linear between 0.25 m samples)");
});
t("the island's box-counting dimension is 1.2-1.3 over the game's nets", () => {
  console.log("   nets", s.nets.map((n) => `${n.size} m: ${n.count}`).join(", "), "D", s.dimension.toFixed(4), "r²", s.r2.toFixed(4));
  assert(s.dimension > 1.2 && s.dimension < 1.3, "D " + s.dimension);
  assert(s.r2 > 0.99, "a straight line on the log-log plot");
});
t("the chains are measured on that same coast, and keep growing", () => {
  console.log("   chains", s.chains.map((c) => `${c.ruler} m: ${c.steps} + ${c.rest.toFixed(1)} = ${c.length.toFixed(1)} m`).join("; "));
  const [a, b, c] = s.chains.map((c) => c.length);
  assert(a < b && b < c, "each shorter chain is longer");
  assert(c / b > 1.3, "the 1 m chain is far from settling");
  assert(c < s.fine, "and still short of the finest tracing");
  for (const ch of s.chains) {
    // Every post is on the coast, and each is one chain from the one before.
    for (let i = 1; i < ch.posts.length; i++) near(Math.hypot(ch.posts[i][0] - ch.posts[i - 1][0], ch.posts[i][1] - ch.posts[i - 1][1]), ch.ruler, 1e-6, "link");
    assert(ch.rest <= ch.ruler + 1e-9);
  }
});
t("Richardson's law holds: log length against log ruler is a line of slope 1 - D", () => {
  const fit = F.fitLogLog(s.chains.map((c) => c.ruler), s.chains.map((c) => c.length));
  console.log("   chain slope", fit.slope.toFixed(3), "→ divider D", (1 - fit.slope).toFixed(3));
  assert(1 - fit.slope > 1.1 && 1 - fit.slope < 1.35);
});
t("Koch: numbers come from the polygons", () => {
  const k = F.kochTable(6);
  k.rows.forEach((r, i) => {
    assert.equal(r.edges, 3 * 4 ** i);
    near(r.coast, (4 / 3) ** i, 1e-9, "coast ratio");
  });
  near(k.areaLimit, 8 / 5, 1e-12, "area limit");
  assert(k.rows.every((r) => r.area < 8 / 5));
  near(k.rows[6].area, 8 / 5, 0.01, "step 6 close to 8/5");
  console.log("   areas", k.rows.map((r) => r.area.toFixed(4)).join(" "));
});
t("Koch: the islet's pieces tile the snowflake exactly", () => {
  for (let lv = 0; lv <= 5; lv++) {
    const pieces = F.kochPieces(lv, 1), poly = F.koch(lv, 1);
    assert.equal(pieces.length, 1 + (4 ** lv - 1));
    near(pieces.reduce((a, p) => a + F.area(p), 0), F.area(poly), 1e-12, "pieces add up to the polygon");
  }
});
console.log(n, "passed");

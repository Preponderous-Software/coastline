"use strict";
/* Coastline's measuring: the island's fractal coast, the chains that measure
   it, the Koch snowflake and the box-counting nets. No DOM and no engine, so
   the same code runs in the page and under node (tests/fractal.test.cjs).

   Everything shown in the game is computed here from the one coastline:
   nothing is typed in by hand. Coordinates are metres, x east, z south. */
(function (root) {
  /* ------------------------------------------------------- value noise */
  function hash(ix, iz, seed) {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295 * 2 - 1;          // -1..1
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  /* Smoothstep value noise: random heights on the integer grid, eased between. */
  function value(x, z, seed) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
    const u = smooth(fx), v = smooth(fz);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  /* Fractal noise: octaves of value noise, each twice as fine (lacunarity 2)
     and `gain` as strong. Normalised to about -1..1. */
  function fbm(x, z, o) {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let i = 0; i < o.octaves; i++) {
      // Each octave is turned a little, so the grids never line up.
      const c = Math.cos(i * 0.9), s = Math.sin(i * 0.9);
      sum += amp * value((x * c - z * s) * f + i * 17.3, (x * s + z * c) * f - i * 9.1, o.seed + i * 101);
      norm += amp; amp *= o.gain; f *= o.lacunarity;
    }
    return sum / norm;
  }

  /* --------------------------------------------------------- the island
     A radial base (high in the middle, below the sea past R) plus fractal
     noise. The coast is where the field crosses zero. */
  const ISLAND = {seed: 23, radius: 62, wave: 32, amp: 1.4, octaves: 9, gain: 0.7, lacunarity: 2, extent: 92,
    camp: [-6.6, 52]};   // where the chains start: a broad stretch of the south shore
  function field(x, z, o = ISLAND) {
    const r = Math.hypot(x, z) / o.radius;
    return (1 - r * r) * 0.75 + o.amp * fbm(x / o.wave, z / o.wave, o);
  }

  /* Marching squares on a grid of spacing h; returns the longest closed loop
     as [[x, z], ...] (counter-clockwise seen from above, with z south). */
  function contour(f, extent, h) {
    const n = Math.round(2 * extent / h) + 1, x0 = -extent;
    const v = new Float64Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[j * n + i] = f(x0 + i * h, x0 + j * h);
    // Edge ids: horizontal edge (i, j)-(i+1, j) is 2(jn+i), vertical (i, j)-(i, j+1) is 2(jn+i)+1.
    const pt = new Map();
    const at = (e) => {
      if (pt.has(e)) return pt.get(e);
      const k = e >> 1, i = k % n, j = (k - i) / n, vert = e & 1;
      const a = v[j * n + i], b = vert ? v[(j + 1) * n + i] : v[j * n + i + 1];
      const t = a / (a - b);
      const p = vert ? [x0 + i * h, x0 + (j + t) * h] : [x0 + (i + t) * h, x0 + j * h];
      pt.set(e, p);
      return p;
    };
    const next = new Map();   // edge -> edge, walking with land on the left
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = v[j * n + i] > 0, b = v[j * n + i + 1] > 0, c = v[(j + 1) * n + i + 1] > 0, d = v[(j + 1) * n + i] > 0;
      const top = 2 * (j * n + i), bottom = 2 * ((j + 1) * n + i), left = 2 * (j * n + i) + 1, right = 2 * (j * n + i + 1) + 1;
      const code = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
      // Corners a (i,j) b (i+1,j) c (i+1,j+1) d (i,j+1); the pair is [from, to].
      const segs = {
        1: [[top, left]], 2: [[right, top]], 3: [[right, left]], 4: [[bottom, right]],
        5: [[top, right], [bottom, left]], 6: [[bottom, top]], 7: [[bottom, left]],
        8: [[left, bottom]], 9: [[top, bottom]], 10: [[left, top], [right, bottom]], 11: [[right, bottom]],
        12: [[left, right]], 13: [[top, right]], 14: [[left, top]],
      }[code];
      if (segs) for (const [s, e] of segs) next.set(s, e);
    }
    const seen = new Set();
    let best = [];
    for (const start of next.keys()) {
      if (seen.has(start)) continue;
      const loop = [];
      let e = start;
      while (e !== undefined && !seen.has(e)) { seen.add(e); loop.push(at(e)); e = next.get(e); }
      if (e === start && loop.length > best.length) best = loop;
    }
    if (signedArea(best) < 0) best.reverse();
    return best;
  }

  function signedArea(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length];
      s += x1 * z2 - x2 * z1;
    }
    return s / 2;
  }
  const area = (poly) => Math.abs(signedArea(poly));
  function perimeter(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      s += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return s;
  }

  /* ----------------------------------------------------- the divider
     Walk a pair of dividers opened to `ruler` round a closed loop: each step
     goes to the first point further along the coast that is exactly `ruler`
     away. The last, short gap back to the start is measured as it is.
     Returns {steps, length, posts}. */
  function divider(poly, ruler, startIndex = 0) {
    const n = poly.length;
    const P = (k) => poly[((k % n) + n) % n];
    let cur = P(startIndex).slice(), seg = startIndex, steps = 0;
    const posts = [cur.slice()];
    // Arc position so the walk can't lap the start.
    for (;;) {
      let found = null;
      for (let k = seg; k < startIndex + n; k++) {
        const a = k === seg ? cur : P(k), b = P(k + 1);
        // Points beyond `ruler`: solve |a + t(b - a) - cur| = ruler for the largest t in [0, 1].
        const dx = b[0] - a[0], dz = b[1] - a[1], ex = a[0] - cur[0], ez = a[1] - cur[1];
        const A = dx * dx + dz * dz, B = 2 * (dx * ex + dz * ez), C = ex * ex + ez * ez - ruler * ruler;
        if (A < 1e-18) continue;
        const disc = B * B - 4 * A * C;
        if (disc < 0) continue;
        const t = (-B + Math.sqrt(disc)) / (2 * A);
        if (t >= 0 && t <= 1 && (k > seg || t > 1e-12)) { found = {k, p: [a[0] + t * dx, a[1] + t * dz]}; break; }
      }
      if (!found) break;
      cur = found.p; seg = found.k; steps++;
      posts.push(cur.slice());
    }
    const s = P(startIndex), rest = Math.hypot(cur[0] - s[0], cur[1] - s[1]);
    return {steps, length: steps * ruler + rest, rest, posts};
  }

  /* ----------------------------------------------------- box counting
     How many cells of a square net of mesh `size` the curve touches. The
     curve is sampled finely enough that no cell it crosses is missed, and the
     count is the least over a few shifts of the net (the usual way to keep
     the net's placement from inflating it). */
  function boxCount(poly, size, shifts = 4, closed = true) {
    const step = size / 6;
    let best = Infinity;
    for (let s = 0; s < shifts; s++) {
      const ox = s / shifts * size * 0.73, oz = s / shifts * size * 0.37;
      const cells = new Set();
      const m = closed ? poly.length : poly.length - 1;
      for (let i = 0; i < m; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(d / step));
        for (let q = 0; q < k; q++) {
          const x = a[0] + (b[0] - a[0]) * q / k, z = a[1] + (b[1] - a[1]) * q / k;
          cells.add(Math.floor((x + ox) / size) * 1000003 + Math.floor((z + oz) / size));
        }
      }
      if (!closed) { const e = poly[poly.length - 1]; cells.add(Math.floor((e[0] + ox) / size) * 1000003 + Math.floor((e[1] + oz) / size)); }
      best = Math.min(best, cells.size);
    }
    return best;
  }
  /* The cells themselves (for drawing), net placed at the origin. */
  function boxCells(poly, size) {
    const step = size / 6, cells = new Map();
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(d / step));
      for (let q = 0; q < k; q++) {
        const x = a[0] + (b[0] - a[0]) * q / k, z = a[1] + (b[1] - a[1]) * q / k;
        const cx = Math.floor(x / size), cz = Math.floor(z / size);
        cells.set(cx + "," + cz, [cx * size, cz * size]);
      }
    }
    return [...cells.values()];
  }
  /* Least-squares line through (log x, log y): {slope, intercept, r2}. */
  function fitLogLog(xs, ys) {
    const X = xs.map(Math.log), Y = ys.map(Math.log), n = X.length;
    const mx = X.reduce((a, b) => a + b) / n, my = Y.reduce((a, b) => a + b) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (X[i] - mx) * (Y[i] - my); sxx += (X[i] - mx) ** 2; syy += (Y[i] - my) ** 2; }
    const slope = sxy / sxx;
    return {slope, intercept: my - slope * mx, r2: syy ? sxy * sxy / (sxx * syy) : 1};
  }
  /* Box-counting dimension: minus the slope of log N against log size. */
  function dimension(poly, sizes, closed = true) {
    const counts = sizes.map((s) => boxCount(poly, s, 4, closed));
    const fit = fitLogLog(sizes, counts);
    return {sizes, counts, dimension: -fit.slope, r2: fit.r2};
  }

  /* ------------------------------------------------------------- Koch
     The snowflake: every edge's middle third is replaced by two sides of a
     small outward triangle. */
  function kochStep(poly) {
    const out = [], sgn = signedArea(poly) > 0 ? 1 : -1;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = (b[0] - a[0]) / 3, dz = (b[1] - a[1]) / 3;
      const p = [a[0] + dx, a[1] + dz], q = [a[0] + 2 * dx, a[1] + 2 * dz];
      // Outward: to the right of the walk for a counter-clockwise loop (x east, z south).
      const h = Math.sqrt(3) / 2;
      const tip = [p[0] + dx / 2 + sgn * dz * h, p[1] + dz / 2 - sgn * dx * h];
      out.push(a, p, tip, q);
    }
    return out;
  }
  /* The same islet as solid pieces: the first triangle and every bump ever
     added, which tile it with no overlaps (so it can be drawn exactly). */
  function kochPieces(level, side = 1, cx = 0, cz = 0) {
    let poly = kochTriangle(side, cx, cz);
    const pieces = [poly.slice()];
    for (let i = 0; i < level; i++) {
      const next = kochStep(poly);
      for (let k = 0; k < next.length; k += 4) pieces.push([next[k + 1], next[k + 2], next[k + 3]]);
      poly = next;
    }
    return pieces;
  }
  function kochTriangle(side = 1, cx = 0, cz = 0) {
    const r = side / Math.sqrt(3), pts = [];
    for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + k * 2 * Math.PI / 3; pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); }
    return signedArea(pts) < 0 ? pts.reverse() : pts;
  }
  function koch(level, side = 1, cx = 0, cz = 0) {
    let p = kochTriangle(side, cx, cz);
    for (let i = 0; i < level; i++) p = kochStep(p);
    return p;
  }
  /* The numbers at each step, measured off the polygon itself, and the limit
     of the area worked out from its series: each step n adds 3·4^(n-1)
     triangles each 1/9^n of the first, so the total is 1 + (1/3)/(1 - 4/9). */
  function kochTable(levels) {
    const base = koch(0);
    const a0 = area(base), p0 = perimeter(base);
    const rows = [];
    for (let n = 0; n <= levels; n++) {
      const poly = koch(n);
      rows.push({step: n, edges: poly.length, coast: perimeter(poly) / p0, area: area(poly) / a0});
    }
    let limit = 1, add = 1 / 3;               // step 1 adds 3 triangles of 1/9: 1/3
    for (let n = 1; n < 200; n++) { limit += add; add *= 4 / 9; }
    return {rows, areaLimit: limit, coastRatio: rows[1].coast / rows[0].coast};
  }

  function circle(radius, n) {
    return Array.from({length: n}, (_, i) => [radius * Math.cos(i / n * 2 * Math.PI), radius * Math.sin(i / n * 2 * Math.PI)]);
  }

  /* ----------------------------------------------------- the lessons */
  const CHAINS = [100, 10, 1];
  const NETS = [16, 8, 4, 2, 1];
  /* Real coasts, from Richardson's measurements as Mandelbrot (1967) read them. */
  const REAL_COASTS = [
    {name: "South Africa", d: 1.02},
    {name: "Australia", d: 1.13},
    {name: "West coast of Britain", d: 1.25},
  ];

  /* Everything the game shows, measured once. */
  function survey(o = ISLAND, h = 0.25) {
    const coast = contour((x, z) => field(x, z, o), o.extent, h);
    // The chains start at the cairn: the coast point nearest the camp.
    let start = 0;
    const d2 = (p) => (p[0] - o.camp[0]) ** 2 + (p[1] - o.camp[1]) ** 2;
    coast.forEach((p, i) => { if (d2(p) < d2(coast[start])) start = i; });
    const chains = CHAINS.map((r) => Object.assign({ruler: r}, divider(coast, r, start)));
    const nets = NETS.map((s) => ({size: s, count: boxCount(coast, s)}));
    const fit = fitLogLog(nets.map((n) => n.size), nets.map((n) => n.count));
    return {coast, start, chains, nets, dimension: -fit.slope, r2: fit.r2, fine: perimeter(coast), area: area(coast)};
  }

  const Fractal = {hash, value, fbm, field, ISLAND, contour, signedArea, area, perimeter, divider, boxCount, boxCells,
    fitLogLog, dimension, kochStep, koch, kochPieces, kochTable, circle, CHAINS, NETS, REAL_COASTS, survey};
  if (typeof module !== "undefined" && module.exports) module.exports = Fractal;
  else root.Fractal = Fractal;
})(typeof window !== "undefined" ? window : globalThis);

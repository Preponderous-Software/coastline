"use strict";
/* The island: its ground, the camp, the chains and nets drawn over the
   coast, and the sand tray's islet. No DOM and no engine
   (tests/scene.test.cjs walks it under node).

   Coordinates are metres, x east, z south, y up; the sea is y = 0.
   Frames follow HallWalk.frame: r = (cos a, 0, -sin a), f = (sin a, 0, cos a). */
(function (root) {
  const node = typeof module !== "undefined" && module.exports;
  const Walk = node ? require("./vendor/hall-walk.js") : root.HallWalk;
  const F = node ? require("./fractal.js") : root.Fractal;

  const C = {
    sand: [0.86, 0.78, 0.58], wetSand: [0.66, 0.6, 0.46], grass: [0.42, 0.58, 0.3], grassDark: [0.3, 0.46, 0.24],
    heath: [0.52, 0.5, 0.32], rock: [0.55, 0.53, 0.5], sea: [0.2, 0.47, 0.6], seaFar: [0.32, 0.56, 0.68],
    wood: [0.5, 0.35, 0.22], woodDark: [0.33, 0.23, 0.15], plaster: [0.92, 0.88, 0.78], thatch: [0.66, 0.52, 0.3],
    brass: [0.86, 0.66, 0.26], chain: [0.85, 0.32, 0.18], chainB: [0.98, 0.86, 0.4], net: [0.98, 0.9, 0.5], netB: [0.95, 0.55, 0.25],
    tray: [0.36, 0.62, 0.72], islet: [0.9, 0.82, 0.6], leaf: [0.2, 0.38, 0.22], leafB: [0.28, 0.46, 0.24], stone: [0.62, 0.6, 0.56],
    ink: [0.11, 0.14, 0.2], coat: [0.2, 0.3, 0.5], skin: [0.86, 0.68, 0.54],
  };

  /* ------------------------------------------------------------ ground */
  const GRID = 1, EXT = 84, N = Math.round(2 * EXT / GRID) + 1;
  const LAND_K = 3.2, SEA_K = 2.4;
  const FIELD = new Float32Array(N * N), HEIGHT = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const f = F.field(-EXT + i * GRID, -EXT + j * GRID);
    FIELD[j * N + i] = f;
    HEIGHT[j * N + i] = f > 0 ? f * LAND_K : f * SEA_K;
  }
  /* The ground's height under (x, z), on the same triangles the mesh draws. */
  function groundY(x, z) {
    const gx = (x + EXT) / GRID, gz = (z + EXT) / GRID;
    const i = Math.max(0, Math.min(N - 2, Math.floor(gx))), j = Math.max(0, Math.min(N - 2, Math.floor(gz)));
    const u = Math.max(0, Math.min(1, gx - i)), v = Math.max(0, Math.min(1, gz - j));
    const a = HEIGHT[j * N + i], b = HEIGHT[j * N + i + 1], c = HEIGHT[(j + 1) * N + i + 1], d = HEIGHT[(j + 1) * N + i];
    return u >= v ? a + (b - a) * u + (c - b) * v : a + (c - d) * u + (d - a) * v;
  }
  /* Dry enough to stand on: the walker keeps out of the sea and the ponds. */
  const SHORE = 0.12;
  const dry = (x, z) => groundY(x, z) > SHORE;

  /* ------------------------------------------------------- the survey */
  const survey = F.survey();
  const coast = survey.coast;

  /* The camp sits behind the cairn where the chains start, on the south shore. */
  const start = coast[survey.start];
  const inland = (() => { const l = Math.hypot(start[0], start[1]); return [-start[0] / l, -start[1] / l]; })();
  const side = [-inland[1], inland[0]];
  const at = (d, s) => ({x: start[0] + inland[0] * d + side[0] * s, z: start[1] + inland[1] * d + side[1] * s});
  /* Walk inland from a spot until it's comfortably dry. */
  function settleDry(p) {
    let {x, z} = p;
    for (let k = 0; k < 80 && !(groundY(x, z) > 0.45); k++) { x += inland[0] * 0.5; z += inland[1] * 0.5; }
    return {x, z};
  }
  const facing = Math.atan2(inland[0], inland[1]);   // frame angle whose f points inland
  const cairn = settleDry(at(3, 0));
  const hut = settleDry(at(17, -5));
  const tray = settleDry(at(10, 5.5));
  const netPost = settleDry(at(9, -7.5));
  const master = settleDry(at(13.5, -2.5));
  // The yaw that looks along (dx, dz): the walker looks along (-cos yaw, -sin yaw).
  const look = (from, to) => Math.atan2(-(to.z - from.z), -(to.x - from.x));
  const spawnAt = settleDry(at(7, 0));
  const SPAWN = {x: spawnAt.x, z: spawnAt.z, yaw: look(spawnAt, {x: start[0], z: start[1]}), pitch: 0.12};
  // Stand 2.4 m back and look at the middle of the tray's surface (eye 1.62 m; the
  // tray top is 0.82 m above its own ground), so the whole islet is in view.
  const SPAWN_TRAY = (() => {
    const p = settleDry({x: tray.x - inland[0] * 2.4, z: tray.z - inland[1] * 2.4});
    const d = Math.hypot(tray.x - p.x, tray.z - p.z), drop = (groundY(p.x, p.z) + 1.62) - (groundY(tray.x, tray.z) + 0.82);
    return {x: p.x, z: p.z, yaw: look(p, tray), pitch: Math.atan2(drop, Math.max(d, 0.5))};
  })();
  const SPAWN_NET = (() => { const p = settleDry({x: netPost.x - inland[0] * 2.2, z: netPost.z - inland[1] * 2.2}); return {x: p.x, z: p.z, yaw: look(p, {x: start[0], z: start[1]}), pitch: 0.18}; })();
  const SPAWNS = [SPAWN, SPAWN_TRAY, SPAWN_NET];

  /* --------------------------------------------------------- obstacles */
  function placed(x, z, angle, hw, hd) { return {fr: Walk.frame({x, z, angle}), x0: -hw, z0: -hd, x1: hw, z1: hd, c: null}; }
  const HUT = {w: 5, d: 4};
  const TRAY = {w: 2.0, d: 2.0, h: 0.92};
  let seed = 5;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const trees = [];
  {
    seed = 5;
    for (let k = 0; k < 900 && trees.length < 70; k++) {
      const x = (rnd() * 2 - 1) * 70, z = (rnd() * 2 - 1) * 70;
      if (groundY(x, z) < 1.2) continue;
      if ([cairn, hut, tray, netPost, master, spawnAt].some((p) => Math.hypot(p.x - x, p.z - z) < 9)) continue;
      if (Math.hypot(x - start[0], z - start[1]) < 14) continue;
      trees.push({x, z, s: 0.8 + rnd() * 0.7, c: rnd() < 0.5 ? C.leaf : C.leafB});
    }
  }
  const obstacles = [
    placed(hut.x, hut.z, facing, HUT.w / 2, HUT.d / 2),
    placed(tray.x, tray.z, facing, TRAY.w / 2, TRAY.d / 2),
    placed(cairn.x, cairn.z, 0, 0.55, 0.55),
    placed(netPost.x, netPost.z, 0, 0.2, 0.2),
    ...trees.map((t) => placed(t.x, t.z, 0, 0.3 * t.s, 0.3 * t.s)),
  ];
  const world = {obstacles, bounds: [-EXT, -EXT, EXT, EXT]};

  /* ---------------------------------------------------------- meshes */
  class Mesh {
    constructor() { this.positions = []; this.normals = []; this.colors = []; this.uvs = []; this.indices = []; }
    get nv() { return this.positions.length / 3; }
    poly(pts, n, color = [1, 1, 1], uvs = null) {
      const b = this.nv, [p0, p1, p2] = pts;
      const e1 = [0, 1, 2].map((i) => p1[i] - p0[i]), e2 = [0, 1, 2].map((i) => p2[i] - p0[i]);
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const flip = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0;
      pts.forEach((p, i) => {
        this.positions.push(...p); this.normals.push(...n);
        this.colors.push(...(Array.isArray(color[0]) ? color[i] : color));
        if (uvs) this.uvs.push(...uvs[i]);
      });
      for (let i = 1; i < pts.length - 1; i++) {
        if (flip) this.indices.push(b, b + i + 1, b + i); else this.indices.push(b, b + i, b + i + 1);
      }
    }
    box(x, y, z, sx, sy, sz, color, a = 0, top = null) {
      const r = [Math.cos(a), 0, -Math.sin(a)], f = [Math.sin(a), 0, Math.cos(a)];
      const P = (u, v, w) => [x + u * sx / 2 * r[0] + w * sz / 2 * f[0], y + v * sy, z + u * sx / 2 * r[2] + w * sz / 2 * f[2]];
      this.poly([P(-1, 0, 1), P(1, 0, 1), P(1, 1, 1), P(-1, 1, 1)], f, color);
      this.poly([P(1, 0, -1), P(-1, 0, -1), P(-1, 1, -1), P(1, 1, -1)], f.map((v) => -v), color);
      this.poly([P(1, 0, 1), P(1, 0, -1), P(1, 1, -1), P(1, 1, 1)], r, color);
      this.poly([P(-1, 0, -1), P(-1, 0, 1), P(-1, 1, 1), P(-1, 1, -1)], r.map((v) => -v), color);
      this.poly([P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1)], [0, 1, 0], top || color);
    }
    gable(x, y, z, sx, sz, h, color, end, a = 0) {
      const r = [Math.cos(a), 0, -Math.sin(a)], f = [Math.sin(a), 0, Math.cos(a)];
      const P = (u, v, w) => [x + u * r[0] + w * f[0], y + v, z + u * r[2] + w * f[2]];
      const hx = sx / 2, hz = sz / 2, l = Math.hypot(hz, h), ny = hz / l, nf = h / l;
      this.poly([P(-hx, 0, hz), P(hx, 0, hz), P(hx, h, 0), P(-hx, h, 0)], [f[0] * nf, ny, f[2] * nf], color);
      this.poly([P(hx, 0, -hz), P(-hx, 0, -hz), P(-hx, h, 0), P(hx, h, 0)], [-f[0] * nf, ny, -f[2] * nf], color);
      this.poly([P(hx, 0, hz), P(hx, 0, -hz), P(hx, h, 0)], r, end);
      this.poly([P(-hx, 0, -hz), P(-hx, 0, hz), P(-hx, h, 0)], r.map((v) => -v), end);
    }
    cylinder(x, y, z, rad, h, color, n = 10, top = rad) {
      for (let i = 0; i < n; i++) {
        const a = i / n * 2 * Math.PI, b = (i + 1) / n * 2 * Math.PI, m = (a + b) / 2;
        const A = (t, k) => [x + k * Math.cos(t), y, z + k * Math.sin(t)], B = (t, k) => [x + k * Math.cos(t), y + h, z + k * Math.sin(t)];
        const l = Math.hypot(h, rad - top) || 1, ny = (rad - top) / l, nr = h / l;
        const pts = top > 1e-3 ? [A(a, rad), A(b, rad), B(b, top), B(a, top)] : [A(a, rad), A(b, rad), B(a, 0)];
        this.poly(pts, [Math.cos(m) * nr, ny, Math.sin(m) * nr], color);
        if (top > 1e-3) this.poly([B(a, top), B(b, top), [x, y + h, z]], [0, 1, 0], color);
      }
    }
    /* A flat strip from a to b ([x, y, z]) of width w, lying face up. */
    strip(a, b, w, color) {
      const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1;
      const ox = -dz / l * w / 2, oz = dx / l * w / 2;
      this.poly([[a[0] - ox, a[1], a[2] - oz], [a[0] + ox, a[1], a[2] + oz], [b[0] + ox, b[1], b[2] + oz], [b[0] - ox, b[1], b[2] - oz]], [0, 1, 0], color);
    }
    sign(o, nx, nz, w, h, uv) {
      const rx = nz, rz = -nx, hw = w / 2;
      const [u0, v0, u1, v1] = uv;
      this.poly([
        [o[0] - rx * hw, o[1], o[2] - rz * hw], [o[0] + rx * hw, o[1], o[2] + rz * hw],
        [o[0] + rx * hw, o[1] + h, o[2] + rz * hw], [o[0] - rx * hw, o[1] + h, o[2] - rz * hw],
      ], [nx, 0, nz], [1, 1, 1], [[u0, v1], [u1, v1], [u1, v0], [u0, v0]]);
    }
  }

  const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * Math.max(0, Math.min(1, t)));
  function groundColor(y, i, j) {
    const n = F.hash(i, j, 3) * 0.04;
    let c;
    if (y < 0) c = mix(C.wetSand, [0.42, 0.44, 0.38], -y / 1.2);
    else if (y < 0.32) c = mix(C.wetSand, C.sand, y / 0.32);
    else if (y < 0.6) c = mix(C.sand, C.grass, (y - 0.32) / 0.28);
    else if (y < 2.2) c = mix(C.grass, C.grassDark, (y - 0.6) / 1.6);
    else c = mix(C.grassDark, C.heath, (y - 2.2) / 1.4);
    return c.map((v) => v + n);
  }
  function buildGround() {
    const m = new Mesh(), idx = new Int32Array(N * N).fill(-1);
    const vert = (i, j) => {
      const k = j * N + i;
      if (idx[k] >= 0) return idx[k];
      const y = HEIGHT[k];
      const hl = HEIGHT[j * N + Math.max(0, i - 1)], hr = HEIGHT[j * N + Math.min(N - 1, i + 1)];
      const hu = HEIGHT[Math.max(0, j - 1) * N + i], hd = HEIGHT[Math.min(N - 1, j + 1) * N + i];
      const nx = -(hr - hl) / (2 * GRID), nz = -(hd - hu) / (2 * GRID), l = Math.hypot(nx, 1, nz);
      m.positions.push(-EXT + i * GRID, y, -EXT + j * GRID);
      m.normals.push(nx / l, 1 / l, nz / l);
      m.colors.push(...groundColor(y, i, j));
      idx[k] = m.nv - 1;
      return idx[k];
    };
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const hs = [HEIGHT[j * N + i], HEIGHT[j * N + i + 1], HEIGHT[(j + 1) * N + i + 1], HEIGHT[(j + 1) * N + i]];
      if (Math.max(...hs) < -0.5) continue;
      const a = vert(i, j), b = vert(i + 1, j), c = vert(i + 1, j + 1), d = vert(i, j + 1);
      // Wound to face up (+y) with z south: a, c, b and a, d, c.
      m.indices.push(a, c, b, a, d, c);
    }
    return m;
  }

  function buildCamp(m) {
    const a = facing, fr = Walk.frame({x: hut.x, z: hut.z, angle: a});
    // On a slope, the walls go down to the lowest corner.
    const low = Math.min(...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, w]) => { const p = fr.p(u * HUT.w / 2, 0, w * HUT.d / 2); return groundY(p[0], p[2]); }));
    const y0 = groundY(hut.x, hut.z) - 0.3, base = Math.min(y0, low - 0.1);
    m.box(hut.x, base, hut.z, HUT.w, 2.8 + y0 - base, HUT.d, C.plaster, a);
    m.gable(hut.x, y0 + 2.8, hut.z, HUT.w + 0.6, HUT.d + 0.8, 1.8, C.thatch, C.plaster, a);
    // Door and window on the side that faces the sea (-f).
    const door = fr.p(0.8, 0, -HUT.d / 2 - 0.04);
    m.box(door[0], y0, door[2], 1.0, 2.25, 0.06, C.woodDark, a);
    const win = fr.p(-1.3, 0, -HUT.d / 2 - 0.04);
    m.box(win[0], y0 + 1.25, win[2], 0.9, 0.75, 0.06, [0.97, 0.84, 0.5], a);
    const chim = fr.p(1.6, 0, 0.6);
    m.box(chim[0], y0 + 3.2, chim[2], 0.5, 1.6, 0.5, [0.55, 0.36, 0.28], a);
    // The sand tray on its trestle.
    const t = tray, ty = groundY(t.x, t.z) - 0.1, tf = Walk.frame({x: t.x, z: t.z, angle: a});
    for (const [u, w] of [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]]) {
      const p = tf.p(u, 0, w);
      m.box(p[0], ty, p[2], 0.12, TRAY.h + 0.1, 0.12, C.woodDark, a);
    }
    m.box(t.x, ty + TRAY.h, t.z, TRAY.w, 0.08, TRAY.d, C.wood, a, C.tray);
    for (const [u, w, sx, sz] of [[0, -1, TRAY.w, 0.08], [0, 1, TRAY.w, 0.08], [-1, 0, 0.08, TRAY.d], [1, 0, 0.08, TRAY.d]]) {
      const p = tf.p(u * TRAY.w / 2, 0, w * TRAY.d / 2);
      m.box(p[0], ty + TRAY.h, p[2], sx, 0.14, sz, C.wood, a);
    }
    // The cairn: a stack of stones with the chains' brass flag.
    const cy = groundY(cairn.x, cairn.z) - 0.1;
    m.cylinder(cairn.x, cy, cairn.z, 0.55, 0.35, C.stone, 9, 0.45);
    m.cylinder(cairn.x, cy + 0.35, cairn.z, 0.45, 0.3, [0.56, 0.55, 0.52], 8, 0.32);
    m.cylinder(cairn.x, cy + 0.65, cairn.z, 0.32, 0.25, C.stone, 7, 0.18);
    m.cylinder(cairn.x, cy + 0.9, cairn.z, 0.03, 1.4, C.woodDark, 5);
    m.box(cairn.x + 0.22, cy + 2.0, cairn.z, 0.42, 0.26, 0.02, C.chain);
    // The net post with its rolled net.
    const ny = groundY(netPost.x, netPost.z) - 0.1;
    m.cylinder(netPost.x, ny, netPost.z, 0.09, 2.2, C.woodDark, 7);
    m.box(netPost.x, ny + 1.1, netPost.z, 0.7, 0.35, 0.35, C.net, a);
    // The chain start: a white stake at the water's edge.
    m.cylinder(start[0], -0.3, start[1], 0.06, 1.3, [0.95, 0.95, 0.92], 6);
    for (const tr of trees) {
      const y = groundY(tr.x, tr.z) - 0.1, s = tr.s;
      m.cylinder(tr.x, y, tr.z, 0.18 * s, 1.4 * s, C.woodDark, 6);
      m.cylinder(tr.x, y + 1.0 * s, tr.z, 1.3 * s, 2.4 * s, tr.c, 8, 0);
      m.cylinder(tr.x, y + 2.3 * s, tr.z, 0.95 * s, 2.0 * s, tr.c, 8, 0);
    }
  }

  /* The master's slate, on the hut's sea-facing wall. */
  const SLATE = (() => {
    const fr = Walk.frame({x: hut.x, z: hut.z, angle: facing});
    const o = fr.p(-1.0, 0, -HUT.d / 2 - 0.09);
    return {o: [o[0], groundY(hut.x, hut.z) - 0.3 + 0.75, o[2]], nx: -fr.f[0], nz: -fr.f[2], w: 2.6, h: 1.3};
  })();

  function buildSky() {
    const m = new Mesh(), R = 75;
    const stops = [[-0.1, C.seaFar], [0.02, [0.86, 0.9, 0.9]], [0.2, [0.7, 0.83, 0.92]], [0.5, [0.48, 0.68, 0.88]], [1, [0.3, 0.52, 0.8]]];
    const shade = (y) => {
      for (let i = 1; i < stops.length; i++) {
        if (y <= stops[i][0]) {
          const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = Math.max(0, (y - a) / (b - a));
          return ca.map((v, k) => v + (cb[k] - v) * t);
        }
      }
      return stops[stops.length - 1][1];
    };
    const lat = 12, lon = 32;
    for (let j = 0; j < lat; j++) {
      const p0 = -0.1 + j / lat * 1.67, p1 = -0.1 + (j + 1) / lat * 1.67;
      for (let i = 0; i < lon; i++) {
        const a = i / lon * 2 * Math.PI, b = (i + 1) / lon * 2 * Math.PI;
        const P = (t, p) => [R * Math.cos(p) * Math.cos(t), R * Math.sin(p), R * Math.cos(p) * Math.sin(t)];
        const pts = [P(a, p0), P(b, p0), P(b, p1), P(a, p1)];
        const mid = pts.reduce((s, q) => s.map((v, k) => v + q[k] / 4), [0, 0, 0]);
        m.poly(pts, mid.map((v) => -v / R), pts.map((q) => shade(q[1] / R)));
      }
    }
    // The sea: a disc at y = 0 that travels with the walker, darker near, paler far.
    const rings = [0, 10, 30, 74], n = 40;
    for (let k = 0; k < rings.length - 1; k++) {
      for (let i = 0; i < n; i++) {
        const a = i / n * 2 * Math.PI, b = (i + 1) / n * 2 * Math.PI;
        const P = (t, r) => [r * Math.cos(t), 0, r * Math.sin(t)];
        const ca = mix(C.sea, C.seaFar, rings[k] / 74), cb = mix(C.sea, C.seaFar, rings[k + 1] / 74);
        m.poly([P(a, rings[k]), P(b, rings[k]), P(b, rings[k + 1]), P(a, rings[k + 1])], [0, 1, 0], [ca, ca, cb, cb]);
      }
    }
    return m;
  }

  function build() {
    const ground = buildGround(), solid = new Mesh(), slate = new Mesh();
    buildCamp(solid);
    slate.poly([
      [SLATE.o[0] - SLATE.nz * SLATE.w / 2, SLATE.o[1], SLATE.o[2] + SLATE.nx * SLATE.w / 2],
      [SLATE.o[0] + SLATE.nz * SLATE.w / 2, SLATE.o[1], SLATE.o[2] - SLATE.nx * SLATE.w / 2],
      [SLATE.o[0] + SLATE.nz * SLATE.w / 2, SLATE.o[1] + SLATE.h, SLATE.o[2] - SLATE.nx * SLATE.w / 2],
      [SLATE.o[0] - SLATE.nz * SLATE.w / 2, SLATE.o[1] + SLATE.h, SLATE.o[2] + SLATE.nx * SLATE.w / 2],
    ], [SLATE.nx, 0, SLATE.nz], [1, 1, 1], [[0, 1], [1, 1], [1, 0], [0, 0]]);
    return {ground, solid, slate, sky: buildSky()};
  }

  /* --------------------------------------------- what's laid over the coast */
  const drape = (x, z, lift) => [x, Math.max(groundY(x, z), 0) + lift, z];
  /* A chain: posts at each divider step, links draped over land and water.
     upto: how many links to draw (for laying it out link by link). */
  function chainMesh(chain, upto = Infinity) {
    const m = new Mesh(), posts = chain.posts.concat([coast[survey.start]]);
    const big = chain.ruler >= 10, w = big ? 0.16 : 0.09, lift = big ? 0.22 : 0.12;
    const links = Math.min(upto, posts.length - 1);
    for (let i = 0; i < links; i++) {
      const a = posts[i], b = posts[i + 1], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const k = Math.max(1, Math.ceil(d / 0.8)), col = i % 2 ? C.chain : C.chainB;
      for (let q = 0; q < k; q++) {
        const t0 = q / k, t1 = (q + 1) / k;
        m.strip(drape(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, lift), drape(a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, lift), w, col);
      }
    }
    const postH = chain.ruler >= 100 ? 1.5 : big ? 0.7 : 0.18, postW = big ? 0.1 : 0.04;
    for (let i = 0; i <= links && i < posts.length; i++) {
      const p = posts[i], y = Math.max(groundY(p[0], p[1]), 0) - 0.05;
      m.box(p[0], y, p[1], postW, postH, postW, [0.96, 0.95, 0.9], 0, C.chain);
    }
    return m;
  }
  /* A net: the outline of every cell the coast touches. */
  function netMesh(size) {
    const m = new Mesh(), cells = F.boxCells(coast, size), lift = 0.18, w = Math.max(0.06, Math.min(0.2, size * 0.03));
    const edge = (x0, z0, x1, z1, col) => {
      const d = Math.hypot(x1 - x0, z1 - z0), k = Math.max(1, Math.ceil(d / 1.5));
      for (let q = 0; q < k; q++) {
        const t0 = q / k, t1 = (q + 1) / k;
        m.strip(drape(x0 + (x1 - x0) * t0, z0 + (z1 - z0) * t0, lift), drape(x0 + (x1 - x0) * t1, z0 + (z1 - z0) * t1, lift), w, col);
      }
    };
    cells.forEach(([x, z], i) => {
      const col = i % 2 ? C.net : C.netB;
      edge(x, z, x + size, z, col); edge(x + size, z, x + size, z + size, col);
      edge(x + size, z + size, x, z + size, col); edge(x, z + size, x, z, col);
    });
    return {mesh: m, cells};
  }
  /* The islet in the sand tray at Koch step `level`, 1.3 m a side (the story calls it a tiny islet). */
  const ISLET = {side: 1.3};
  function isletMesh(level) {
    const m = new Mesh();
    const fr = Walk.frame({x: tray.x, z: tray.z, angle: facing});
    const top = groundY(tray.x, tray.z) - 0.1 + TRAY.h + 0.08, h = 0.035;
    // Point the triangle out to sea, so the first bump faces the player.
    const toWorld = ([u, w]) => fr.p(u, 0, -w);
    const local = F.koch(level, ISLET.side).map(toWorld);
    const cx = tray.x, cz = tray.z, n = local.length;
    // The top: the first triangle and every bump, which tile the islet exactly.
    for (const piece of F.kochPieces(level, ISLET.side)) m.poly(piece.map(toWorld).map((p) => [p[0], top + h, p[2]]), [0, 1, 0], C.islet);
    for (let i = 0; i < n; i++) {
      const a = local[i], b = local[(i + 1) % n];
      const ex = b[0] - a[0], ez = b[2] - a[2], l = Math.hypot(ex, ez) || 1;
      const nrm = [ez / l, 0, -ex / l];
      const out = (a[0] - cx) * nrm[0] + (a[2] - cz) * nrm[2] < 0 ? nrm.map((v) => -v) : nrm;
      m.poly([[a[0], top, a[2]], [b[0], top, b[2]], [b[0], top + h, b[2]], [a[0], top + h, a[2]]], out, C.wetSand);
    }
    return m;
  }

  const Scene = {C, GRID, EXT, groundY, dry, SHORE, survey, coast, start, inland, facing, cairn, hut, tray, netPost, master,
    SPAWN, SPAWN_TRAY, SPAWN_NET, SPAWNS, world, trees, SLATE, TRAY, look, build, chainMesh, netMesh, isletMesh, Mesh};
  if (node) module.exports = Scene;
  else root.Scene = Scene;
})(typeof window !== "undefined" ? window : globalThis);

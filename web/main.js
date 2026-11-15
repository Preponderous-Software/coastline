"use strict";
/* Coastline in the browser: the engine, the walking, the HUD and the three
   scenes. The measuring lives in fractal.js, the guesses in lessons.js and
   the island in scene.js. */
(function () {
  const F = window.Fractal, L = window.Lessons, S = window.Scene, W = window.HallWalk, K = window.HallControls;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const canvas = $("island");
  const touchFirst = matchMedia("(hover: none), (pointer: coarse)").matches;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SAVE_KEY = "coastline.v1";
  // ?new (the desktop launcher's --new): start over, keeping the old progress as the previous save.
  if (params.has("new")) {
    const old = StrataKit.store.get(SAVE_KEY);
    if (old) StrataKit.store.set(SAVE_KEY + ".previous", old);
    StrataKit.store.set(SAVE_KEY, JSON.stringify({reached: 1, done: false}));
    history.replaceState(null, "", location.pathname + location.search.replace(/([?&])new(=[^&]*)?(&|$)/, "$1").replace(/[?&]$/, ""));
  }
  const FOV = 62;
  /* Portrait phones: widen the vertical view so the horizontal view never
     drops below 52 degrees (the sand tray and the island otherwise get cut
     off at the sides). Landscape keeps 62. */
  const HFOV_MIN = 52, FOV_MAX = 90;
  function viewFov() {
    const r = canvas.getBoundingClientRect(), aspect = r.width / Math.max(r.height, 1);
    if (aspect >= 1) return FOV;
    const need = 2 * Math.atan(Math.tan(HFOV_MIN * Math.PI / 360) / aspect) * 180 / Math.PI;
    return Math.min(FOV_MAX, Math.max(FOV, need));
  }
  const TEX_MIPS = 1, TEX_CLAMP = 2 | 4, UNLIT = 1, LATE = 0x10000;
  const SOFTWARE = /llvmpipe|softpipe|lavapipe|swiftshader|software|basic render/i;
  const REACH = 2.0;
  const SLOT = {sky: 1, ground: 2, solid: 3, slate: 5, chain: 6, net: 7, islet: 8};
  const TEX = {slate: 2};
  const MAREN = "Maren, the cartographer";
  const survey = S.survey;
  const fmtM = L.fmtM;

  let mod = null, kit = null, economy = false;
  let me = Object.assign({}, S.SPAWN);
  let eyeY = S.groundY(me.x, me.z) + W.EYE;
  const keys = new Set();
  let stickInput = {forward: 0, right: 0, run: false};
  let activeUse = null, clock = 0;

  /* ---------------------------------------------------------- the story */
  const G = {
    mode: "title",          // title | play | free
    scene: 1, reached: 1, step: "",
    laid: [],               // chains laid so far (Fractal.survey chains)
    settle: null,           // the scene 1 guess
    level: 0,               // Koch step on the sand tray
    kochArea: null, kochCoast: null,
    cast: [],               // nets cast so far
    halve: null, shape: null,
    busy: false,            // a chain or net is being laid out
  };

  const loadSave = () => L.parseSave(StrataKit.store.get(SAVE_KEY));
  function writeSave(done) {
    const prev = loadSave();
    StrataKit.store.set(SAVE_KEY, JSON.stringify({reached: G.reached, done: !!(done || prev.done)}));
  }
  const sceneLabel = () => `Scene ${G.scene} · ${L.SCENES[G.scene - 1].name}`;
  function goal(text) { $("scene").textContent = G.mode === "free" ? "The island" : sceneLabel(); $("objective").textContent = text; }

  function enter(scene, spawn) {
    Object.assign(G, {mode: "play", scene, reached: Math.max(G.reached, scene), step: "", busy: false});
    if (spawn) { me = Object.assign({}, spawn, {vx: 0, vz: 0}); placeView(); }
    $("title").hidden = true; $("hud").hidden = false; $("skip").hidden = false;
    $("stick").hidden = !touchFirst;
    writeSave();
    canvas.focus({preventScroll: true});
  }
  /* Starting a scene from the title (or skipping to it) fills in what the
     earlier scenes would have left behind. */
  function prepare(scene) {
    G.laid = scene > 1 ? survey.chains.slice() : [];
    G.level = scene > 2 ? L.KOCH_STEPS : 0;
    G.cast = [];
    if (G.laid.length) showChain(G.laid[G.laid.length - 1]); else clearSlot(SLOT.chain);
    showIslet(G.level);
    clearSlot(SLOT.net);
  }
  function startScene(n, fromTitle) {
    if (fromTitle) prepare(n);
    [startRuler, startSnowflake, startNet][n - 1](fromTitle);
  }
  function skipPanel() {
    if (fading || G.mode !== "play") return;
    if (!$("panel").hidden) { toast("Close this panel first."); return; }
    if (G.busy) { toast("Wait for the chain to settle."); return; }
    const last = G.scene === L.SCENES.length, next = L.SCENES[G.scene];
    panel(`Skip scene ${G.scene}?`, last
      ? "<p>Last scene. Goes to the end.</p>"
      : `<p>Goes to scene ${G.scene + 1}, ${next.name}. Replay any scene from the title.</p>`, [
      {label: last ? "Skip to the end" : `Skip to scene ${G.scene + 1}`, primary: true, run: () => {
        closePanel();
        if (last) { G.cast = survey.nets.slice(); finish(); } else { const n = G.scene + 1; fadeTo(() => { prepare(n); startScene(n, false); placeAt(S.SPAWNS[n - 1]); }); }
      }},
      {label: "Keep going", run: closePanel},
    ], closePanel);
  }
  function placeAt(spawn) { me = Object.assign({}, spawn, {vx: 0, vz: 0}); placeView(); }

  /* ----------------------------------------------------------- the heap */
  function put(typed) {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const ptr = mod._malloc(Math.max(bytes.length, 4));
    new Uint8Array(mod.HEAPF32.buffer).set(bytes, ptr);
    return ptr;
  }
  function texture(slot, w, h, rgba, flags) {
    const ptr = put(rgba);
    try { return mod._hall_texture(slot, w, h, ptr, flags); } finally { mod._free(ptr); }
  }
  function mesh(slot, mb, tex = -1, flags = 0) {
    if (!mb.nv) return clearSlot(slot);
    const p = put(new Float32Array(mb.positions)), n = put(new Float32Array(mb.normals));
    const c = put(new Float32Array(mb.colors)), u = mb.uvs.length ? put(new Float32Array(mb.uvs)) : 0;
    const i = put(new Uint32Array(mb.indices));
    try {
      return mod._hall_mesh(slot, p, n, c, u, mb.nv, i, mb.indices.length, tex, flags);
    } finally { [p, n, c, u, i].forEach((x) => x && mod._free(x)); }
  }
  /* An empty slot: one triangle with no area, far below the sea. */
  function clearSlot(slot) {
    if (!mod) return;
    const m = new S.Mesh();
    m.poly([[0, -50, 0], [0.001, -50, 0], [0, -50, 0.001]], [0, 1, 0], [0, 0, 0]);
    mesh(slot, m);
  }
  const rowBlocks = new Map();
  function rows(fn, flat, width) {
    let block = rowBlocks.get(fn);
    if (!block || block.cap < flat.length) {
      if (block) mod._free(block.ptr);
      block = {cap: flat.length * 2 + 64, ptr: mod._malloc((flat.length * 2 + 64) * 4)};
      rowBlocks.set(fn, block);
    }
    new Float32Array(mod.HEAPF32.buffer, block.ptr, flat.length).set(flat);
    fn(block.ptr, flat.length / width);
  }

  /* ------------------------------------------------------ the slate */
  function canvasOf(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", {willReadFrequently: true});
    draw(ctx, w, h);
    return {rgba: new Uint8Array(ctx.getImageData(0, 0, w, h).data.buffer), w, h};
  }
  const FONT = '"Atkinson Hyperlegible",system-ui,sans-serif';
  const SERIF = '"Libre Baskerville",Georgia,serif';
  function drawSlate() {
    if (!mod) return;
    let title = "Coast of the island", lines = [];
    if (G.scene === 1 || G.mode === "free") {
      lines = survey.chains.map((c) => [`${c.ruler} m chain`, G.laid.includes(c) ? fmtM(c.length) : "?"]);
    } else if (G.scene === 2) {
      title = "The islet";
      const t = F.kochTable(L.KOCH_STEPS).rows;
      lines = [["Step", "Coast · Area"]].concat(t.slice(0, G.level + 1).slice(-4).map((r) => [`${r.step}: ${r.edges} edges`, `${L.fmt(r.coast)}× · ${L.fmt(r.area, 3)}×`]));
    } else {
      title = "Nets over the coast";
      lines = survey.nets.map((n) => [`${n.size} m mesh`, G.cast.includes(n) ? `${n.count} squares` : "?"]);
    }
    const img = canvasOf(1024, 512, (x, w, h) => {
      x.fillStyle = "#26323a"; x.fillRect(0, 0, w, h);
      x.strokeStyle = "#8a6a3a"; x.lineWidth = 18; x.strokeRect(9, 9, w - 18, h - 18);
      x.fillStyle = "#f6edd2"; x.font = `60px ${SERIF}`; x.textBaseline = "top"; x.textAlign = "left";
      x.fillText(title, 48, 34);
      x.font = `700 44px ${FONT}`;
      lines.forEach(([a, b], i) => {
        const y = 136 + i * 70;
        x.fillStyle = "#d9d2bd"; x.textAlign = "left"; x.fillText(a, 48, y);
        x.fillStyle = b === "?" ? "#7f8a90" : "#f2c14e"; x.textAlign = "right"; x.fillText(b, w - 48, y);
      });
    });
    texture(TEX.slate, img.w, img.h, img.rgba, TEX_CLAMP);
  }

  /* ----------------------------------------------- chains, nets, islet */
  function showChain(chain, upto) { if (mod) mesh(SLOT.chain, S.chainMesh(chain, upto)); }
  function showIslet(level) { if (mod) mesh(SLOT.islet, S.isletMesh(level)); }
  function showNet(size) { if (mod) mesh(SLOT.net, S.netMesh(size).mesh); }
  /* Lay a chain out link by link, then done(). */
  function layChain(chain, done) {
    G.busy = true;
    const links = chain.posts.length, frames = reducedMotion ? 1 : Math.min(16, links);
    let k = 0;
    toast(`Laying the ${chain.ruler} m chain…`, 2600);
    const tickLay = () => {
      k++;
      showChain(chain, Math.ceil(links * k / frames));
      if (window.Sound) Sound.clink();
      if (k < frames) setTimeout(tickLay, 2600 / frames);
      else { G.busy = false; done(); }
    };
    tickLay();
  }

  /* ---------------------------------------------------------------- HUD */
  let toastTimer = 0;
  function toast(text, ms = 3800) {
    $("toast").textContent = text; $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, ms);
  }
  let panelDismiss = null;
  /* One thing per screen: a panel holds a title, a little text, maybe one
     figure, and the buttons that move on. */
  function panel(title, html, buttons, dismiss, opts = {}) {
    $("panel-who").textContent = opts.who || ""; $("panel-who").hidden = !opts.who;
    $("panel-title").textContent = title;
    $("panel-body").innerHTML = html;
    const box = $("panel-buttons");
    box.innerHTML = "";
    buttons.forEach((b) => {
      const el = document.createElement("button");
      el.type = "button"; el.className = "btn" + (b.primary ? " primary" : ""); el.textContent = b.label;
      el.addEventListener("click", b.run);
      box.appendChild(el);
    });
    panelDismiss = dismiss || null;
    $("panel").hidden = false;
    $("panel").scrollTop = 0;
    if (window.Sound) Sound.page();
    if (opts.after) opts.after();
    const focus = box.querySelector(".primary") || $("panel").querySelector("button");
    if (focus) focus.focus({preventScroll: true});
    keys.clear();
  }
  /* A guess: the choices are the buttons, and picking one commits to it. */
  function ask(title, html, choices, pick, opts) {
    panel(title, `${html}<div class="choices" id="choices">${choices.map((c) => `<button class="btn" type="button" data-id="${c.id}">${c.label}</button>`).join("")}</div>`, [], null,
      Object.assign({}, opts, {after: () => {
        $("choices").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { if (window.Sound) Sound.commit(); pick(b.dataset.id); } });
      }}));
    // Nothing is picked for the player: focus rests on the panel, not a choice.
    $("panel").focus({preventScroll: true});
  }
  function closePanel() {
    $("panel").hidden = true; panelDismiss = null;
    canvas.focus({preventScroll: true});
  }
  const busy = () => !$("panel").hidden || G.mode === "title";
  let fading = false;
  function fadeTo(fn) {
    const f = $("fade");
    f.hidden = false; fading = true;
    requestAnimationFrame(() => f.classList.add("on"));
    setTimeout(() => {
      fn(); fading = false;
      f.classList.remove("on");
      setTimeout(() => { f.hidden = true; }, reducedMotion ? 0 : 520);
    }, reducedMotion ? 0 : 520);
  }

  /* -------------------------------------------------------- the figures
     Drawn on a canvas in the panel, sized to it, so they read on a phone. */
  function figure(id, cls = "") { return `<canvas class="fig ${cls}" id="${id}" role="img"></canvas>`; }
  function sized(id) {
    const c = $(id), r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const x = c.getContext("2d");
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    return {x, w: r.width, h: r.height, c};
  }
  /* The island seen from above, with something laid over it. */
  function drawMap(id, over) {
    const {x, w, h, c} = sized(id);
    const xs = survey.coast.map((p) => p[0]), zs = survey.coast.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const pad = 10, k = Math.min((w - 2 * pad) / (x1 - x0), (h - 2 * pad) / (z1 - z0));
    const ox = (w - k * (x1 - x0)) / 2, oz = (h - k * (z1 - z0)) / 2;
    const P = (p) => [ox + (p[0] - x0) * k, oz + (p[1] - z0) * k];
    x.fillStyle = "#cfe3ea"; x.fillRect(0, 0, w, h);
    x.beginPath();
    survey.coast.forEach((p, i) => { const q = P(p); if (i) x.lineTo(q[0], q[1]); else x.moveTo(q[0], q[1]); });
    x.closePath(); x.fillStyle = "#e8d9ae"; x.fill();
    x.lineWidth = 1; x.strokeStyle = "#5d6a5a"; x.stroke();
    if (over && over.net) {
      x.lineWidth = Math.max(0.6, Math.min(1.5, over.net * k * 0.08)); x.strokeStyle = "#b4471f";
      for (const [cx, cz] of F.boxCells(survey.coast, over.net)) {
        const q = P([cx, cz]);
        x.strokeRect(q[0], q[1], over.net * k, over.net * k);
      }
    }
    if (over && over.chain) {
      const pts = over.chain.posts.concat([survey.coast[survey.start]]);
      x.beginPath();
      pts.forEach((p, i) => { const q = P(p); if (i) x.lineTo(q[0], q[1]); else x.moveTo(q[0], q[1]); });
      x.lineWidth = over.chain.ruler >= 10 ? 2.5 : 1.6; x.strokeStyle = "#b4471f"; x.stroke();
      if (over.chain.ruler >= 10) for (const p of over.chain.posts) { const q = P(p); x.fillStyle = "#1b2433"; x.fillRect(q[0] - 2, q[1] - 2, 4, 4); }
    }
    const s = P(survey.coast[survey.start]);
    x.fillStyle = "#1b2433"; x.beginPath(); x.arc(s[0], s[1], 4, 0, 2 * Math.PI); x.fill();
    const y = P([me.x, me.z]);
    x.strokeStyle = "#1e4e6b"; x.lineWidth = 2; x.beginPath(); x.arc(y[0], y[1], 5, 0, 2 * Math.PI); x.stroke();
    c.setAttribute("aria-label", over && over.label ? over.label : "A map of the island from above.");
  }
  function drawKoch(id, level) {
    const {x, w, h, c} = sized(id);
    x.fillStyle = "#cfe3ea"; x.fillRect(0, 0, w, h);
    const side = Math.min(w, h * 1.1) * 0.62;
    // The figure's own centre is the triangle's centroid; nudge it to the middle of the box.
    const poly = F.koch(level, side, w / 2, h / 2 + side * 0.05);
    x.beginPath();
    poly.forEach((p, i) => { if (i) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]); });
    x.closePath(); x.fillStyle = "#e8d9ae"; x.fill(); x.strokeStyle = "#5d6a5a"; x.lineWidth = 1.2; x.stroke();
    const tri = F.koch(0, side, w / 2, h / 2 + side * 0.05);
    x.beginPath(); tri.forEach((p, i) => { if (i) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]); }); x.closePath();
    x.setLineDash([5, 4]); x.strokeStyle = "#b4471f"; x.stroke(); x.setLineDash([]);
    c.setAttribute("aria-label", `The islet after ${level} steps, over the dashed first triangle.`);
  }
  /* The diagram that comes last: log count against log mesh. */
  function drawLogLog(id) {
    const {x, w, h, c} = sized(id);
    const nets = survey.nets;
    x.fillStyle = "#fff"; x.fillRect(0, 0, w, h);
    const lx = nets.map((n) => Math.log2(1 / n.size)), ly = nets.map((n) => Math.log2(n.count));
    const gx0 = Math.min(...lx) - 0.4, gx1 = Math.max(...lx) + 0.4;
    const gy0 = Math.min(...ly) - 0.8, gy1 = gy0 + (gx1 - gx0) * 2 + 0.4;   // room for the slope-2 line
    const L0 = 46, R0 = 14, T0 = 12, B0 = 38;
    const X = (v) => L0 + (v - gx0) / (gx1 - gx0) * (w - L0 - R0), Y = (v) => h - B0 - (v - gy0) / (gy1 - gy0) * (h - T0 - B0);
    x.strokeStyle = "#dcd3b8"; x.lineWidth = 1; x.font = `12px ${FONT}`; x.fillStyle = "#5a6272";
    nets.forEach((n, i) => { x.beginPath(); x.moveTo(X(lx[i]), T0); x.lineTo(X(lx[i]), h - B0); x.stroke(); x.textAlign = "center"; x.fillText(`${n.size} m`, X(lx[i]), h - B0 + 16); });
    for (let v = Math.ceil(gy0); v <= gy1; v++) {
      x.beginPath(); x.moveTo(L0, Y(v)); x.lineTo(w - R0, Y(v)); x.stroke();
      if (v % 2 === 0) { x.textAlign = "right"; x.fillText(String(2 ** v), L0 - 6, Y(v) + 4); }
    }
    x.textAlign = "center"; x.fillText("mesh (halving each step) →", (L0 + w - R0) / 2, h - 6);
    x.save(); x.translate(12, (T0 + h - B0) / 2); x.rotate(-Math.PI / 2); x.fillText("squares touched", 0, 0); x.restore();
    const ref = (slope, col, label) => {
      x.setLineDash([5, 4]); x.strokeStyle = col; x.lineWidth = 1.5;
      const a = [lx[0], ly[0]], b = [lx[lx.length - 1], ly[0] + slope * (lx[lx.length - 1] - lx[0])];
      x.beginPath(); x.moveTo(X(a[0]), Y(a[1])); x.lineTo(X(b[0]), Y(b[1])); x.stroke(); x.setLineDash([]);
      x.fillStyle = col; x.textAlign = "right"; x.fillText(label, X(b[0]) - 4, Y(b[1]) - 6);
    };
    ref(1, "#7f8a90", "a line: slope 1");
    ref(2, "#7f8a90", "an area: slope 2");
    const fit = F.fitLogLog(nets.map((n) => n.size), nets.map((n) => n.count));
    const yAt = (v) => (fit.intercept + fit.slope * Math.log(Math.pow(2, -v))) / Math.LN2;
    x.strokeStyle = "#b4471f"; x.lineWidth = 2.5;
    x.beginPath(); x.moveTo(X(gx0 + 0.2), Y(yAt(gx0 + 0.2))); x.lineTo(X(gx1 - 0.2), Y(yAt(gx1 - 0.2))); x.stroke();
    x.fillStyle = "#1b2433";
    lx.forEach((v, i) => { x.beginPath(); x.arc(X(v), Y(ly[i]), 4.5, 0, 2 * Math.PI); x.fill(); });
    x.fillStyle = "#b4471f"; x.font = `700 14px ${FONT}`; x.textAlign = "left";
    x.fillText(`the coast: slope ${survey.dimension.toFixed(2)}`, X(lx[1]) + 6, Y(yAt(lx[1])) + 20);
    c.setAttribute("aria-label", `Squares touched against mesh size on doubling scales. The coast's points rise at slope ${survey.dimension.toFixed(2)}, between the line's 1 and the area's 2.`);
  }

  /* ------------------------------------------------------- 1: The Ruler */
  function startRuler(fromTitle) {
    enter(1, fromTitle ? S.SPAWN : null);
    G.laid = []; clearSlot(SLOT.chain); drawSlate();
    G.step = "open";
    goal("Listen to Maren.");
    panel("How long is the coast?", `<p>Welcome, apprentice. The harbour wants one number for the new chart: the length of this island's coast.</p>
      <p>My chains are at the cairn by the water. Start with the longest.</p>`,
    [{label: "I'll measure it", primary: true, run: () => { closePanel(); G.step = "cairn"; goal("Go down to the cairn and lay the 100 m chain."); }}], null, {who: MAREN});
  }
  function nextChain() { return survey.chains[G.laid.length]; }
  function useCairn() {
    const c = nextChain();
    if (!c) return;
    if (c.ruler === 1 && !G.settle) { predictSettle(); return; }
    layChain(c, () => { G.laid.push(c); drawSlate(); chainPanel(c); });
  }
  function chainPanel(c) {
    const prev = G.laid[G.laid.length - 2];
    const body = [`<p class="big">${fmtM(c.length)}</p>`];
    body.push(`<p>${c.steps.toLocaleString("en-US")} full chains, then ${fmtM(c.rest)} back to the stake.${prev ? ` That's ${fmtM(c.length - prev.length)} more than the ${prev.ruler} m chain.` : ""}</p>`);
    body.push(figure("map"));
    if (c.ruler === 1) body.push(`<p>${L.settleVerdict(G.settle, G.laid).text}</p>`);
    panel(`The ${c.ruler} m chain`, body.join(""), [{label: "Write it down", primary: true, run: () => { closePanel(); afterChain(c); }}], null,
      {after: () => drawMap("map", {chain: c, label: `The ${c.ruler} m chain laid round the island, from the stake by the cairn.`})});
  }
  function afterChain(c) {
    if (c.ruler === 100) {
      G.step = "cairn";
      goal("Lay the 10 m chain to check it.");
      toast("Maren: \"Good. Now check it with the 10 m chain.\"", 4200);
    } else if (c.ruler === 10) {
      G.step = "cairn";
      goal("Lay the 1 m chain.");
      panel("Two answers", `<p>The short chain went into the little bays the long one cut straight across.</p><p>One more chain to settle it.</p>`,
        [{label: "Fetch the 1 m chain", primary: true, run: closePanel}], closePanel, {who: MAREN});
    } else {
      dependsPanel();
    }
  }
  function predictSettle() {
    const [a, b] = survey.chains;
    ask("Before you lay it", `<p>The 100 m chain said ${fmtM(a.length)}. The 10 m chain said ${fmtM(b.length)}.</p><p>What will the 1 m chain say?</p>`,
      L.SETTLE_CHOICES, (id) => { G.settle = id; closePanel(); useCairn(); }, {who: "Your guess"});
  }
  function dependsPanel() {
    G.step = "depends";
    panel("So how long is it?", `<p>Every shorter chain finds more coast: bays inside the bays, rocks along those. A hand span would find more again.</p>
      <p>The coast has no single length. <strong>It depends on your ruler.</strong></p>`,
    [{label: "Has anyone else seen this?", primary: true, run: richardsonPanel}], null, {who: MAREN});
  }
  function richardsonPanel() {
    const rowsHtml = survey.chains.map((c) => `<tr><td>${c.ruler} m</td><td>${fmtM(c.length)}</td></tr>`).join("");
    panel("Richardson's rulers", `<p>Lewis Fry Richardson measured real coasts and borders with shorter and shorter rulers. Every time, the length grew, and each coast grew at its own steady rate.</p>
      <table class="table"><thead><tr><th>Your chain</th><th>Coast</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      <p>In 1967 Benoit Mandelbrot used his numbers in a paper with a famous title: <em>How long is the coast of Britain?</em></p>`,
    [{label: "On to the snowflake", primary: true, run: () => { closePanel(); G.reached = Math.max(G.reached, 2); writeSave(); startSnowflake(false); }}], null);
  }

  /* --------------------------------------------------- 2: The Snowflake */
  function startSnowflake(fromTitle) {
    enter(2, fromTitle ? S.SPAWN_TRAY : null);
    G.level = 0; G.kochArea = null; G.kochCoast = null;
    showIslet(0); drawSlate();
    G.step = "tray";
    goal("Maren is at the sand tray.");
  }
  function trayIntro() {
    G.step = "bumps";
    panel("A smaller island", `<p>Real coasts are messy. Here's a tidy one: a triangle islet, 1 m a side.</p>
      <p>Each step, every straight edge gets a bump: its middle third is pushed out into a little triangle.</p>`,
    [{label: "Add the first bumps", primary: true, run: () => { closePanel(); addBumps(); }}], null, {who: MAREN, after: () => {}});
    goal("Add bumps to every edge.");
  }
  function addBumps() {
    if (G.level >= L.KOCH_STEPS) return;
    G.level++;
    showIslet(G.level); drawSlate();
    const r = F.kochTable(G.level).rows[G.level];
    toast(`Step ${G.level}: ${r.edges.toLocaleString("en-US")} edges. Coast ${L.fmt(r.coast)}×, area ${L.fmt(r.area, 3)}× the triangle.`, 4200);
    // A moment to look at the new bumps, with nothing to press, then the panel.
    if (G.level === L.KOCH_PREDICT_AT) { G.step = "look"; setTimeout(predictKochArea, reducedMotion ? 300 : 1400); }
    else if (G.level === L.KOCH_STEPS) { G.step = "look"; setTimeout(kochReveal, reducedMotion ? 300 : 1400); }
    goal(G.step === "look" ? "Look at the islet." : `Add bumps: step ${G.level + 1} of ${L.KOCH_STEPS}.`);
  }
  function predictKochArea() {
    G.step = "guess";
    const r = F.kochTable(G.level).rows[G.level];
    ask("Keep going forever", `${figure("koch")}<p>After ${G.level} steps the area is ${L.fmt(r.area, 3)}× the triangle. Imagine adding bumps forever. The <strong>area</strong>…</p>`,
      L.KOCH_AREA, (id) => { G.kochArea = id; predictKochCoast(); }, {who: "Your guess", after: () => drawKoch("koch", G.level)});
  }
  function predictKochCoast() {
    const r = F.kochTable(G.level).rows[G.level];
    ask("And the coast?", `<p>After ${G.level} steps the coastline is ${L.fmt(r.coast)}× the triangle's. Bumps forever. The <strong>coastline</strong>…</p>`,
      L.KOCH_COAST, (id) => { G.kochCoast = id; closePanel(); G.step = "bumps"; goal(`Add bumps: step ${G.level + 1} of ${L.KOCH_STEPS}.`); }, {who: "Your guess"});
  }
  function kochReveal() {
    G.step = "reveal";
    const v = L.kochVerdict(G.kochArea, G.kochCoast);
    const rowsHtml = v.rows.map((r) => `<tr class="${r.step === L.KOCH_STEPS + 1 ? "new" : ""}"><td>${r.step}${r.step > L.KOCH_STEPS ? " (next)" : ""}</td><td>${r.edges.toLocaleString("en-US")}</td><td>${L.fmt(r.coast)}×</td><td>${L.fmt(r.area, 3)}×</td></tr>`).join("");
    const area = v.areaRight ? "You were right: the area levels off." : "The area levels off.";
    const coast = v.coastRight ? "and you were right about the coast too: it never stops." : "but the coast never stops.";
    panel("A small island with an endless coast", `<table class="table"><thead><tr><th>Step</th><th>Edges</th><th>Coast</th><th>Area</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      <p>${area} It closes in on <strong>8/5 of the triangle</strong> (${L.fmt(v.limit, 3)}×) and never passes it, ${coast} Each step makes it <strong>4/3 as long</strong>: ${Math.round(L.kochCoastAfter(20))}× after 20 steps, ${Math.round(L.kochCoastAfter(40)).toLocaleString("en-US")}× after 40.</p>`,
    [{label: "What has this to do with my island?", primary: true, run: snowflakeLink}], null);
  }
  function snowflakeLink() {
    panel("Bays inside bays", `<p>Your island isn't tidy like this, but it's built the same way. Look closely at a bay and it has smaller bays, and those have smaller ones.</p>
      <p>That's why each shorter chain found more. Mathematicians call shapes like this <strong>fractals</strong>.</p>`,
    [{label: "On to the net", primary: true, run: () => { closePanel(); G.reached = Math.max(G.reached, 3); writeSave(); startNet(false); }}], null, {who: MAREN});
  }

  /* ---------------------------------------------------------- 3: The Net */
  function startNet(fromTitle) {
    enter(3, fromTitle ? S.SPAWN_NET : null);
    G.cast = []; G.halve = null; G.shape = null;
    clearSlot(SLOT.net); clearSlot(SLOT.chain); drawSlate();
    G.step = "post";
    goal("Maren is at the net post.");
  }
  function netIntro() {
    G.step = "nets";
    goal("Cast the nets, each mesh half the last.");
    panel("Count instead", `<p>The length won't hold still, so let's count. Lay a net over the coast and count the squares the coastline passes through.</p>
      <p>Then halve the mesh and count again.</p>`,
    [{label: "Cast the 16 m net", primary: true, run: () => { closePanel(); castNet(); }}], null, {who: MAREN});
  }
  function nextNet() { return survey.nets[G.cast.length]; }
  function castNet() {
    const n = nextNet();
    if (!n) return;
    if (G.cast.length === 2 && !G.halve) { predictHalve(); return; }
    G.busy = true;
    showNet(n.size);
    if (window.Sound) Sound.whoosh();
    toast(`Casting the ${n.size} m net…`, 1600);
    setTimeout(() => { G.busy = false; G.cast.push(n); drawSlate(); netPanel(n); }, reducedMotion ? 50 : 1100);
  }
  function netPanel(n) {
    const prev = G.cast[G.cast.length - 2];
    const body = [`<p class="big">${n.count.toLocaleString("en-US")} squares</p>`];
    if (prev) body.push(`<p>Half the mesh, ${L.fmt(n.count / prev.count)}× the squares.</p>`);
    else body.push(`<p>Each square is ${n.size} m across. The coast passes through ${n.count} of them.</p>`);
    body.push(figure("map"));
    if (G.cast.length === 3) {
      const v = L.halveVerdict(G.halve, G.cast);
      body.push(`<p>${v.right ? "You called it." : "Not quite."} Each halving gives about ${L.fmt(v.ratio)}× the squares: more than a line, less than a field.</p>`);
    }
    const more = nextNet();
    panel(`The ${n.size} m net`, body.join(""), [{label: more ? `Cast the ${more.size} m net` : "Count them up", primary: true, run: () => { closePanel(); if (more) castNet(); else askShape(); }}], null,
      {after: () => drawMap("map", {net: n.size, label: `The ${n.size} m net over the island: ${n.count} squares touch the coast.`})});
  }
  function predictHalve() {
    const [a, b] = G.cast;
    ask("Halve it again", `<p>The ${a.size} m net touched ${a.count}. The ${b.size} m net touched ${b.count}.</p>
      <p>Halve the mesh, and a straight line passes through about twice as many squares. A field covers four times as many. The coast will touch…</p>`,
    L.HALVE_CHOICES, (id) => { G.halve = id; closePanel(); castNet(); }, {who: "Your guess"});
  }
  function askShape() {
    ask("Line or area?", `<p>A line doubles its squares when the mesh halves. An area quadruples. Your coast multiplied by about ${L.fmt(L.halveVerdict("between", survey.nets).ratio)} each time.</p><p>So is the coast a line or an area?</p>`,
      L.SHAPE_CHOICES, (id) => { G.shape = id; diagramPanel(); }, {who: "Your guess"});
  }
  function diagramPanel() {
    const v = L.shapeVerdict(G.shape, survey.dimension), d = survey.dimension.toFixed(2);
    panel("The slope is the dimension", `${figure("loglog", "tall")}
      <p>${v.right ? "Yes: in between." : "In between."} Each dot is one net, on scales that double. A line's dots climb at slope 1; an area's at slope 2. Your coast climbs at <strong>${d}</strong>.</p>
      <p>That slope is the coast's <strong>fractal dimension</strong>: more than a line, less than an area.</p>`,
    [{label: "And real coasts?", primary: true, run: realPanel}], null, {after: () => drawLogLog("loglog")});
  }
  function realPanel() {
    const all = F.REAL_COASTS;
    const list = all.concat([{name: "This island", d: survey.dimension, here: true}]).sort((a, b) => a.d - b.d);
    const rowsHtml = list.map((r) => `<tr class="${r.here ? "new" : ""}"><td>${r.name}</td><td>${r.here ? "" : "≈ "}${r.d.toFixed(2)}</td></tr>`).join("");
    panel("Real coasts", `<p>Richardson's measurements give real coasts a dimension too. A smooth coast sits near 1; a ragged one climbs higher.</p>
      <table class="table"><thead><tr><th>Coast</th><th>Dimension</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      <p class="cite">Approximate values from Richardson's data, as read by Mandelbrot, "How long is the coast of Britain?", <em>Science</em>, 1967.</p>`,
    [{label: "Finish the chart", primary: true, run: finish}], null);
  }
  function finish() {
    G.mode = "free"; G.step = "free"; G.reached = 3; writeSave(true);
    if (window.Sound) Sound.finale();
    $("skip").hidden = true;
    drawSlate();
    panel("What goes on the chart", `<ul class="learned">
      <li>Coast length: <strong>it depends on your ruler</strong>. ${fmtM(survey.chains[0].length)} with 100 m, ${fmtM(survey.chains[1].length)} with 10 m, ${fmtM(survey.chains[2].length)} with 1 m.</li>
      <li>A shape can hold a fixed area inside an endless coast.</li>
      <li>Coast dimension: <strong>${survey.dimension.toFixed(2)}</strong>, between a line and an area.</li></ul>
      <p>Thank you, apprentice. The island is yours to walk.</p>`,
    [{label: "Walk the island", primary: true, run: () => { closePanel(); goal("Walk the island."); }}, {label: "Back to the title", run: () => { closePanel(); showTitle(); }}], null, {who: MAREN});
  }

  /* ------------------------------------------------------- the notebook */
  function notebookPanel() {
    const items = [];
    if (G.laid.length) items.push(`<li>Chains: ${G.laid.map((c) => `${c.ruler} m → ${fmtM(c.length)}`).join(", ")}.</li>`);
    if (G.level) { const r = F.kochTable(G.level).rows[G.level]; items.push(`<li>Islet after ${G.level} steps: coast ${L.fmt(r.coast)}×, area ${L.fmt(r.area, 3)}×.</li>`); }
    if (G.cast.length) items.push(`<li>Nets: ${G.cast.map((n) => `${n.size} m → ${n.count}`).join(", ")}.</li>`);
    if (G.mode === "free") items.push(`<li>Dimension of the coast: ${survey.dimension.toFixed(2)}.</li>`);
    panel("Notebook", items.length ? `<ul class="learned">${items.join("")}</ul>` : "<p>Nothing measured yet.</p>", [{label: "Close", primary: true, run: closePanel}], closePanel);
  }

  /* --------------------------------------------------------- the world */
  function stationFor(p, d) {
    // A point d metres seaward of a station: where the walker stands to use it.
    return {x: p.x - S.inland[0] * d, z: p.z - S.inland[1] * d};
  }
  function uses() {
    const list = [];
    if (G.mode !== "play" || G.busy) return list;
    if (G.scene === 1 && G.step === "cairn") {
      const c = nextChain();
      if (c) list.push({id: "cairn", x: S.cairn.x, z: S.cairn.z, reach: 2.4, label: c.ruler === 1 && !G.settle ? "Fetch the 1 m chain" : `Lay the ${c.ruler} m chain`, run: useCairn});
    }
    if (G.scene === 2) {
      if (G.step === "tray") list.push({id: "tray", x: S.tray.x, z: S.tray.z, reach: 2.6, label: "Look at the sand tray", run: trayIntro});
      if (G.step === "bumps" && G.level < L.KOCH_STEPS) list.push({id: "tray", x: S.tray.x, z: S.tray.z, reach: 2.6, label: `Add bumps: step ${G.level + 1}`, run: addBumps});
    }
    if (G.scene === 3) {
      if (G.step === "post") list.push({id: "net", x: S.netPost.x, z: S.netPost.z, reach: 2.4, label: "Unroll the nets", run: netIntro});
      if (G.step === "nets" && nextNet()) list.push({id: "net", x: S.netPost.x, z: S.netPost.z, reach: 2.4, label: `Cast the ${nextNet().size} m net`, run: castNet});
    }
    return list;
  }
  function nearestUse() {
    let best = null, score = Infinity;
    const fx = -Math.cos(me.yaw), fz = -Math.sin(me.yaw);
    for (const u of uses()) {
      const dx = u.x - me.x, dz = u.z - me.z, d = Math.hypot(dx, dz);
      if (d > (u.reach || REACH)) continue;
      const v = d - 0.4 * (d > 1e-6 ? (dx * fx + dz * fz) / d : 1);
      if (v < score) { score = v; best = u; }
    }
    return best;
  }
  function objectivePoint() {
    if (G.mode !== "play" || G.busy) return null;
    const above = (p, h) => [p.x, S.groundY(p.x, p.z) + h, p.z];
    if (G.scene === 1 && G.step === "cairn") return above(S.cairn, 2.6);
    if (G.scene === 2 && (G.step === "tray" || G.step === "bumps")) return above(S.tray, 1.7);
    if (G.scene === 3 && (G.step === "post" || G.step === "nets")) return above(S.netPost, 2.8);
    return null;
  }
  /* Where Maren stands in each scene. */
  function marenAt() {
    if (G.mode === "free" || G.mode === "title") return S.master;
    const s = [S.cairn, S.tray, S.netPost][G.scene - 1], away = [2.0, 1.9, 1.6][G.scene - 1];
    const side = [-S.inland[1], S.inland[0]];
    return {x: s.x + side[0] * away + S.inland[0] * 0.6, z: s.z + side[1] * away + S.inland[1] * 0.6};
  }

  function items() {
    const out = [];
    const m = marenAt(), gy = S.groundY(m.x, m.z);
    out.push(1, m.x, gy + 0.74, m.z, 0.5, 0.62, 0.5, ...S.C.coat);
    out.push(3, m.x, gy + 1.62, m.z, 0.3, 0.3, 0.3, ...S.C.skin);
    out.push(0, m.x, gy + 1.8, m.z, 0.42, 0.05, 0.42, ...S.C.woodDark);
    out.push(0, m.x, gy + 1.88, m.z, 0.24, 0.14, 0.24, ...S.C.woodDark);
    const aim = objectivePoint();
    const t = aim && Math.hypot(aim[0] - me.x, aim[2] - me.z) > 2.2 ? aim : null;
    markerPoint = t;
    if (t) out.push(3, t[0], t[1] + Math.sin(clock * 3) * 0.1, t[2], 0.22, 0.22, 0.22, 0.95, 0.76, 0.3);
    return out;
  }
  let markerPoint = null;
  function points() {
    const out = [];
    if (markerPoint) out.push(markerPoint[0], markerPoint[1], markerPoint[2], 0, 0.7, 0.95, 0.76, 0.3, 0.5);
    return out;
  }

  /* -------------------------------------------------------------- view */
  function placeView() {
    eyeY = S.groundY(me.x, me.z) + W.EYE;
    if (!kit) return;
    Object.assign(kit.cam, {yaw: me.yaw, pitch: me.pitch, tx: me.x, ty: eyeY, tz: me.z});
  }
  function input() {
    const down = (...k) => k.some((x) => keys.has(x));
    let forward = (down("w", "arrowup") ? 1 : 0) - (down("s", "arrowdown") ? 1 : 0);
    let right = (down("d") ? 1 : 0) - (down("a") ? 1 : 0);
    const turn = (down("arrowleft") ? -1.9 : 0) + (down("arrowright") ? 1.9 : 0);
    if (Math.abs(stickInput.forward) + Math.abs(stickInput.right) > 0) { forward = stickInput.forward; right = stickInput.right; }
    return {forward, right, turn, run: down("shift") || stickInput.run};
  }
  /* One step of walking that keeps to dry land: sliding along the shore
     instead of stopping dead at it. */
  function walk(dt) {
    const next = W.step(me, input(), dt, S.world);
    if (S.dry(next.x, next.z)) { me = next; return; }
    if (S.dry(next.x, me.z)) { me = Object.assign(next, {z: me.z, vz: 0}); return; }
    if (S.dry(me.x, next.z)) { me = Object.assign(next, {x: me.x, vx: 0}); return; }
    me = Object.assign(next, {x: me.x, z: me.z, vx: 0, vz: 0});
  }
  function tick(t, now, dt) {
    clock += dt;
    me.yaw = kit.cam.yaw; me.pitch = kit.cam.pitch;
    if (!busy()) { walk(dt); kit.cam.yaw = me.yaw; }
    const want = S.groundY(me.x, me.z) + W.EYE;
    eyeY += (want - eyeY) * Math.min(1, dt * 10);
    kit.cam.tx = me.x; kit.cam.ty = eyeY; kit.cam.tz = me.z;
    placeSky(false);
    rows(mod._hall_set_items, new Float32Array(items()), 10);
    rows(mod._hall_set_points, new Float32Array(points()), 9);
    activeUse = busy() ? null : nearestUse();
    const pr = $("prompt");
    pr.hidden = !activeUse;
    if (activeUse && pr.dataset.id !== activeUse.id + activeUse.label) {
      pr.dataset.id = activeUse.id + activeUse.label;
      pr.innerHTML = `<kbd>E</kbd>${activeUse.label}`;
    }
    pointArrow();
  }
  function pointArrow() {
    const a = $("arrow");
    if (!markerPoint || busy()) { a.hidden = true; return; }
    const rect = canvas.getBoundingClientRect();
    const v = {x: me.x, y: eyeY, z: me.z, yaw: me.yaw, pitch: me.pitch, aspect: rect.width / Math.max(rect.height, 1), fov: viewFov()};
    const p = K.project(v, markerPoint);
    a.hidden = p.on;
    if (!p.on) {
      const x = (p.nx + 1) / 2 * rect.width, y = (1 - p.ny) / 2 * rect.height;
      a.style.transform = `translate(${x}px,${y}px) rotate(${-p.angle}rad) translate(-11px,-11px)`;
    }
  }
  function useNow() { if (activeUse && !busy()) { const u = activeUse; activeUse = null; u.run(); } }

  /* ------------------------------------------------------------- input */
  addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "escape" && panelDismiss) { panelDismiss(); return; }
    if (k === "m" && !e.repeat) { toggleSound(); return; }
    if (busy()) return;
    if (k === "e" && !e.repeat) { useNow(); return; }
    if (k === "n" && !e.repeat) { notebookPanel(); return; }
    if (["w", "a", "s", "d", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) { keys.add(k); e.preventDefault(); }
  });
  addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  addEventListener("blur", () => keys.clear());
  $("prompt").addEventListener("click", useNow);
  $("notebook").addEventListener("click", () => { if (!busy()) notebookPanel(); });
  $("skip").addEventListener("click", skipPanel);
  function toggleSound() {
    if (!window.Sound) return;
    Sound.start();
    const off = Sound.toggle();
    syncMute();
    toast(off ? "Sound off. M turns it back on." : "Sound on.", 1800);
  }
  function syncMute() {
    if (!window.Sound) return;
    const off = Sound.muted;
    $("mute").setAttribute("aria-pressed", off ? "true" : "false");
    $("mute").setAttribute("aria-label", off ? "Sound off (M to turn on)" : "Sound on (M to mute)");
    $("mute").classList.toggle("off", off);
  }
  $("mute").addEventListener("click", toggleSound);
  syncMute();
  document.addEventListener("click", (e) => { if (window.Sound && e.target.closest(".btn")) Sound.click(); });
  $("help").addEventListener("click", () => {
    if (!$("panel").hidden) return;
    const desk = "<p>W A S D or arrows: walk. Shift: run. Drag: look. E: use. N: notebook. M: sound. Esc: close.</p>";
    const pad = "<p>Left stick: walk (push it all the way to run). Drag anywhere else: look. Yellow button: use.</p>";
    panel("Controls", touchFirst ? pad : desk, [{label: "Close", primary: true, run: closePanel}], closePanel);
  });
  const stick = $("stick"), knob = $("knob");
  let stickId = null;
  function stickMove(e) {
    const r = stick.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    stickInput = W.stick(dx, dy, r.width / 2);
    const m = Math.hypot(dx, dy), lim = r.width / 2 - 24, k = m > lim ? lim / m : 1;
    knob.style.transform = `translate(${dx * k}px,${dy * k}px)`;
  }
  stick.addEventListener("pointerdown", (e) => { stickId = e.pointerId; stick.setPointerCapture(stickId); stickMove(e); });
  stick.addEventListener("pointermove", (e) => { if (e.pointerId === stickId) stickMove(e); });
  const stickEnd = (e) => { if (e.pointerId !== stickId) return; stickId = null; stickInput = {forward: 0, right: 0, run: false}; knob.style.transform = ""; };
  stick.addEventListener("pointerup", stickEnd);
  stick.addEventListener("pointercancel", stickEnd);

  /* --------------------------------------------------------------- boot */
  function rendererName() {
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return "";
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      return name;
    } catch (e) { return ""; }
  }
  function setLights() {
    if (economy) { rows(mod._hall_set_lights, new Float32Array(0), 8); return; }
    rows(mod._hall_set_lights, new Float32Array([
      60, 70, 40, 220, 1, 0.95, 0.85, 1.4,       // the morning sun
      -50, 50, -40, 200, 0.62, 0.76, 1, 0.55,    // the sky's fill
    ]), 8);
  }
  function setEconomy(on) {
    economy = !!on;
    if (economy && kit) kit.dprCap = Math.min(kit.dprCap, 0.75);
    mod._hall_set_view(economy ? 0.92 : 0.6, viewFov());
    setLights();
  }
  addEventListener("resize", () => { if (mod) mod._hall_set_view(economy ? 0.92 : 0.6, viewFov()); });
  function buildWorld() {
    const m = S.build();
    skyMesh = m.sky; placeSky(true);
    mesh(SLOT.solid, m.solid);
    drawSlate();
    mesh(SLOT.slate, m.slate, TEX.slate, UNLIT);
    clearSlot(SLOT.chain); clearSlot(SLOT.net);
    showIslet(0);
    mesh(SLOT.ground, m.ground, -1, LATE);
  }
  /* The engine's far plane is 80 m, so the sky and the sea travel with the
     walker and the dome is never out of range. */
  let skyMesh = null, skyAt = [Infinity, 0];
  function placeSky(force) {
    if (!force && Math.hypot(me.x - skyAt[0], me.z - skyAt[1]) < 3) return;
    skyAt = [me.x, me.z];
    const moved = Object.assign(Object.create(Object.getPrototypeOf(skyMesh)), skyMesh, {positions: skyMesh.positions.slice()});
    for (let i = 0; i < moved.positions.length; i += 3) { moved.positions[i] += me.x; moved.positions[i + 2] += me.z; }
    mesh(SLOT.sky, moved, -1, UNLIT | LATE);
  }
  function showTitle() {
    const save = loadSave(), box = $("title-buttons");
    G.mode = "title"; G.reached = save.reached;
    $("hud").hidden = true; $("prompt").hidden = true;
    placeAt(Object.assign({}, S.SPAWN, {pitch: 0.06}));
    box.innerHTML = "";
    const add = (label, primary, run) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn" + (primary ? " primary" : ""); b.textContent = label;
      b.addEventListener("click", run); box.appendChild(b);
    };
    const name = (n) => `Scene ${n}, ${L.SCENES[n - 1].name}`;
    const resume = save.reached > 1 && !save.done ? save.reached : 1;
    add(resume > 1 ? `Continue: ${name(resume)}` : "Begin", true, () => startScene(resume, true));
    L.SCENES.forEach((s) => { if (s.n !== resume) add(name(s.n), false, () => startScene(s.n, true)); });
    $("title").hidden = false;
    $("stick").hidden = true;   // the stick is for walking, not the title
    box.querySelector("button").focus({preventScroll: true});
  }
  async function boot() {
    document.body.classList.toggle("touch", touchFirst);
    $("stick").hidden = !touchFirst;
    try { await document.fonts.load(`66px "Libre Baskerville"`); await document.fonts.load(`700 40px "Atkinson Hyperlegible"`); } catch (e) { /* fallback faces still read */ }
    mod = await StrataLoader.load({script: "vendor/hall-engine.js", factory: "createHallEngine", wasm: "vendor/hall-engine.wasm",
      title: "the island", fallback: {href: "./", text: "Your browser can't draw the island"}});
    const software = SOFTWARE.test(rendererName());
    mod._hall_configure(software ? 0 : 1, params.get("drive") === "1" ? 1 : 0);
    const wantEconomy = params.has("economy") ? params.get("economy") === "1" : software;
    me = Object.assign({}, S.SPAWN);
    eyeY = S.groundY(me.x, me.z) + W.EYE;
    kit = StrataKit.create({
      module: mod, canvas,
      camera: {yaw: me.yaw, pitch: me.pitch, dist: 1, tx: me.x, ty: eyeY, tz: me.z},
      limits: {minPitch: -1.1, maxPitch: 1.2, minDist: 1, maxDist: 1},
      idleOrbit: false, dprCap: 1.5, quality: wantEconomy ? 0 : undefined,
      frame: tick,
      onKey: (e) => e.key !== "Tab",
      onSlow: () => { if (!economy) setEconomy(true); },
      onFatal: (code, msg) => StrataLoader.fallback(code, msg),
    });
    buildWorld();
    setEconomy(wantEconomy);
    kit.start();
    StrataLoader.done();
    showTitle();
    window.__coast = {
      G, S, F, L, get me() { return me; },
      tp(x, z, yaw, pitch = 0.1) { me = Object.assign({}, me, {x, z, yaw, pitch, vx: 0, vz: 0}); placeView(); },
      use: () => activeUse && activeUse.label,
      act: useNow,
    };
  }
  boot().catch((e) => { console.error(e); StrataLoader.fallback("boot", String(e)); });
})();

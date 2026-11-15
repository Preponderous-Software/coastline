"use strict";
/* Coastline's lessons: the three scenes, the guesses the player commits to
   and what the island says back. No DOM and no engine
   (tests/lessons.test.cjs). Every number comes from Fractal. */
(function (root) {
  const F = typeof module !== "undefined" && module.exports ? require("./fractal.js") : root.Fractal;

  const SCENES = [
    {n: 1, name: "The Ruler"},
    {n: 2, name: "The Snowflake"},
    {n: 3, name: "The Net"},
  ];
  const KOCH_STEPS = 5;          // bumps the player adds by hand
  const KOCH_PREDICT_AT = 2;     // the guess comes after this step

  const fmtM = (m) => `${Math.round(m).toLocaleString("en-US")} m`;
  const fmt = (v, d = 2) => v.toFixed(d);

  /* Scene 1: before the 1 m chain, will the length settle? */
  const SETTLE_CHOICES = [
    {id: "settle", label: "About the same. It's settling down."},
    {id: "bit", label: "A little longer."},
    {id: "lot", label: "A lot longer."},
  ];
  function settleVerdict(choice, chains) {
    const [c100, c10, c1] = chains;
    const grew = c1.length / c10.length - 1;
    const lot = grew > 0.3;
    const right = lot ? choice === "lot" : choice === (grew > 0.05 ? "bit" : "settle");
    const was = `${fmtM(c10.length)} became ${fmtM(c1.length)}, ${Math.round(grew * 100)}% more`;
    const miss = choice === "bit" ? "More than a little" : "It didn't settle";
    return {right, grew, text: right ? `You called it: ${was}.` : `${miss}: ${was}.`,
      first: c100.length};
  }

  /* Scene 2: after a couple of steps, guess where the islet ends up. */
  const KOCH_AREA = [
    {id: "endless", label: "It grows forever."},
    {id: "settles", label: "It levels off at some size."},
  ];
  const KOCH_COAST = [
    {id: "endless", label: "It grows forever."},
    {id: "settles", label: "It levels off at some length."},
  ];
  function kochVerdict(area, coast) {
    const t = F.kochTable(KOCH_STEPS + 1);
    return {
      areaRight: area === "settles", coastRight: coast === "endless",
      limit: t.areaLimit, ratio: t.coastRatio, rows: t.rows,
    };
  }
  /* How long the coast is after n steps, as a multiple of the triangle's. */
  const kochCoastAfter = (n) => Math.pow(F.kochTable(1).coastRatio, n);

  /* Scene 3: halving the mesh. */
  const HALVE_CHOICES = [
    {id: "two", label: "About twice as many, like a line."},
    {id: "between", label: "Somewhere between twice and four times."},
    {id: "four", label: "About four times as many, like a field."},
  ];
  function ratios(nets) {
    const out = [];
    for (let i = 1; i < nets.length; i++) out.push(nets[i].count / nets[i - 1].count);
    return out;
  }
  function halveVerdict(choice, nets) {
    const r = ratios(nets), mean = Math.exp(r.reduce((a, b) => a + Math.log(b), 0) / r.length);
    const id = mean < 2.15 ? "two" : mean > 3.6 ? "four" : "between";
    return {right: choice === id, ratio: mean, id};
  }
  /* Scene 3's last guess: estimate the dimension from the halving ratio.
     The right pick is whichever choice is nearest the measured dimension. */
  const SHAPE_CHOICES = [
    {id: "1.1", label: "About 1.1"},
    {id: "1.3", label: "About 1.3"},
    {id: "1.5", label: "About 1.5"},
    {id: "1.8", label: "About 1.8"},
  ];
  function shapeVerdict(choice, d) {
    const near = SHAPE_CHOICES.map((c) => +c.id).reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a));
    return {right: +choice === near, d, near};
  }

  /* Saves keep only how far the player has got. */
  function parseSave(raw) {
    const out = {reached: 1, done: false};
    if (!raw) return out;
    try {
      const s = JSON.parse(raw);
      if (!s || typeof s !== "object" || Array.isArray(s)) return out;
      if (Number.isInteger(s.reached) && s.reached >= 1 && s.reached <= SCENES.length) out.reached = s.reached;
      out.done = s.done === true;
    } catch (e) { /* damaged: start over */ }
    return out;
  }

  const Lessons = {SCENES, KOCH_STEPS, KOCH_PREDICT_AT, fmtM, fmt, SETTLE_CHOICES, settleVerdict, KOCH_AREA, KOCH_COAST,
    kochVerdict, kochCoastAfter, HALVE_CHOICES, ratios, halveVerdict, SHAPE_CHOICES, shapeVerdict, parseSave};
  if (typeof module !== "undefined" && module.exports) module.exports = Lessons;
  else root.Lessons = Lessons;
})(typeof window !== "undefined" ? window : globalThis);

/* Plays scenes 1-3 in a real browser on Strata (software GL), on a desktop
   and two phones, and screenshots each scene. Needs the server running:
     cd web && python3 -m http.server 8783 --bind 127.0.0.1
     NODE_PATH=/root/arcade-watch/node_modules node tests/play.cjs <screenshot-dir> */
const {chromium, devices} = require("playwright");
const assert = require("assert");
const fs = require("fs");
const OUT = process.argv[2] || "shots";
const BASE = process.env.BASE || "http://127.0.0.1:8783/";
fs.mkdirSync(OUT, {recursive: true});

async function run(name, ctxOpts) {
  const b = await chromium.launch({args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]});
  const c = await b.newContext(ctxOpts);
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  const wait = (fn, arg, ms = 40000) => p.waitForFunction(fn, arg, {timeout: ms, polling: 100});
  const shot = (n) => p.screenshot({path: `${OUT}/${name}-${n}.png`});
  const open = () => wait(() => !document.getElementById("panel").hidden);
  const closed = () => wait(() => document.getElementById("panel").hidden);
  const ok = async () => { await open(); await p.click("#panel-buttons .primary"); };
  const title = () => p.textContent("#panel-title");
  const overflow = async (where) => {
    const o = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(o <= 0, `${name}: horizontal overflow ${o}px at ${where}`);
    const panelFits = await p.evaluate(() => { const e = document.getElementById("panel"); if (e.hidden) return true; const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5; });
    assert(panelFits, `${name}: panel wider than the screen at ${where}`);
  };
  const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  /* Stand just seaward of a station, facing it. */
  const standAt = async (key, d, pitch = 0.25) => {
    await p.evaluate(([key, d, pitch]) => {
      const S = __coast.S, s = S[key];
      const at = {x: s.x - S.inland[0] * d, z: s.z - S.inland[1] * d};
      __coast.tp(at.x, at.z, S.look(at, s), pitch);
    }, [key, d, pitch]);
    await frames();
  };
  const useAt = async (key, d, pitch) => { await standAt(key, d, pitch); await wait(() => __coast.use()); await p.evaluate(() => __coast.act()); };

  await p.goto(BASE + "?economy=1");
  await wait(() => window.__coast && !document.getElementById("title").hidden, null, 60000);
  await p.waitForTimeout(600); await shot("01-title"); await overflow("title");

  /* ---------------------------------------------- Scene 1: The Ruler */
  await p.click("#title-buttons .primary");
  await open(); assert.match(await title(), /How long is the coast/); await p.waitForTimeout(300); await shot("02-cold-open"); await overflow("cold open");
  await ok(); await closed();
  // Real input, no teleporting: walking moves the walker and never turns the view.
  const pose = () => p.evaluate(() => ({x: __coast.me.x, z: __coast.me.z, yaw: __coast.me.yaw}));
  const a0 = await pose();
  if (!ctxOpts.hasTouch) {
    await p.focus("#island"); await p.keyboard.down("w"); await p.waitForTimeout(1000); await p.keyboard.up("w");
    const a1 = await pose();
    assert(Math.hypot(a1.x - a0.x, a1.z - a0.z) > 0.5, "W walks " + JSON.stringify([a0, a1]));
    assert.equal(a1.yaw, a0.yaw, "walking never turns the view");
    await p.mouse.move(640, 300); await p.mouse.down(); await p.mouse.move(760, 300, {steps: 6}); await p.mouse.up(); await p.waitForTimeout(200);
    const a2 = await pose(); assert(Math.abs(a2.yaw - a1.yaw) > 0.05, "drag looks");
  } else {
    const y = await p.evaluate(() => {
      const s = document.getElementById("stick"), r = s.getBoundingClientRect(); s.setPointerCapture = () => {};
      s.dispatchEvent(new PointerEvent("pointerdown", {pointerId: 7, bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + 8}));
      return r.top + 8;
    });
    await p.waitForTimeout(1000);
    await p.evaluate((y) => document.getElementById("stick").dispatchEvent(new PointerEvent("pointerup", {pointerId: 7, bubbles: true, clientY: y})), y);
    const a1 = await pose();
    assert(Math.hypot(a1.x - a0.x, a1.z - a0.z) > 0.5, "the stick walks " + JSON.stringify([a0, a1]));
    assert.equal(a1.yaw, a0.yaw, "the stick never turns the view");
  }
  // The sea stops the walker: push straight out from the chain stake and stay dry.
  await p.evaluate(() => { const S = __coast.S; const s = S.start; __coast.tp(s[0] + S.inland[0] * 4, s[1] + S.inland[1] * 4, S.look({x: 0, z: 0}, {x: -S.inland[0], z: -S.inland[1]}), 0.1); });
  if (!ctxOpts.hasTouch) {
    await p.focus("#island"); await p.keyboard.down("w"); await p.waitForTimeout(3500); await p.keyboard.up("w");
    assert(await p.evaluate(() => __coast.S.dry(__coast.me.x, __coast.me.z)), "the walker stays on dry land");
  }

  await standAt("cairn", -1.6, 0.35);
  await wait(() => /100 m chain/.test(__coast.use() || "")); await shot("03-cairn"); await overflow("cairn");
  await p.evaluate(() => __coast.act());
  await open(); assert.match(await title(), /100 m chain/); await p.waitForTimeout(300); await shot("04-chain-100"); await overflow("100 m panel");
  const lengths = [];
  lengths.push(await p.textContent("#panel-body .big"));
  await ok(); await closed();
  await useAt("cairn", -1.6, 0.35);
  await open(); assert.match(await title(), /10 m chain/); lengths.push(await p.textContent("#panel-body .big")); await shot("05-chain-10");
  await ok(); await open(); assert.match(await title(), /Two answers/); await ok(); await closed();
  // The chain in the world: look along the shore from the stake.
  await p.evaluate(() => { const S = __coast.S, s = S.start; const at = {x: s[0] + S.inland[0] * 2.5, z: s[1] + S.inland[1] * 2.5}; __coast.tp(at.x, at.z, S.look(at, {x: s[0] - S.inland[1] * 20, z: s[1] + S.inland[0] * 20}), 0.32); });
  await p.waitForTimeout(500); await shot("06-chain-in-world");
  await useAt("cairn", -1.6, 0.35);
  await open(); assert.match(await title(), /Before you lay it/); assert.equal(await p.isVisible("#panel-buttons .primary"), false, "a guess has no way round it"); await shot("07-predict-settle"); await overflow("prediction");
  await p.click("#choices [data-id=lot]");
  await wait(() => __coast.G.laid.length === 3, null, 20000);
  await open(); assert.match(await title(), /1 m chain/); lengths.push(await p.textContent("#panel-body .big"));
  assert.match(await p.textContent("#panel-body"), /You called it/); await p.waitForTimeout(200); await shot("08-chain-1");
  console.log(name, "chains", lengths.join(" / "));
  const nums = lengths.map((t) => +t.replace(/[^0-9]/g, ""));
  assert(nums[0] < nums[1] && nums[1] < nums[2], "each shorter chain finds more coast");
  await ok(); await open(); assert.match(await title(), /So how long/); await ok();
  await open(); assert.match(await title(), /Richardson/); await shot("09-richardson"); await overflow("richardson");
  await ok(); await closed();

  /* ------------------------------------------ Scene 2: The Snowflake */
  assert.equal(await p.evaluate(() => __coast.G.scene), 2);
  await useAt("tray", 1.7, 0.6);
  await open(); assert.match(await title(), /A smaller island/); await shot("10-tray-intro"); await ok(); await closed();
  await wait(() => __coast.G.level === 1);
  await useAt("tray", 1.7, 0.6); // step 2, then the guesses
  await open(); assert.match(await title(), /Keep going forever/); await p.waitForTimeout(200); await shot("11-predict-area"); await overflow("koch area guess");
  await p.click("#choices [data-id=settles]");
  await wait(() => /And the coast/.test(document.getElementById("panel-title").textContent)); await shot("12-predict-coast");
  await p.click("#choices [data-id=endless]"); await closed();
  for (let k = 3; k <= 4; k++) { await useAt("tray", 1.7, 0.6); await wait((k) => __coast.G.level === k, k); }
  await p.waitForTimeout(300); await shot("13-tray-step4");
  await useAt("tray", 1.7, 0.6);
  await open(); assert.match(await title(), /endless coast/); await shot("14-koch-reveal"); await overflow("koch reveal");
  const kochText = await p.textContent("#panel-body");
  assert.match(kochText, /8\/5/); assert.match(kochText, /1\.600×/); assert.match(kochText, /You were right/);
  await ok(); await open(); assert.match(await title(), /Bays inside bays/); await ok(); await closed();

  /* ------------------------------------------------ Scene 3: The Net */
  assert.equal(await p.evaluate(() => __coast.G.scene), 3);
  await useAt("netPost", 1.8, 0.3);
  await open(); assert.match(await title(), /Count instead/); await ok(); await closed();
  await open(); assert.match(await title(), /16 m net/); await p.waitForTimeout(200); await shot("15-net-16");
  const counts = [await p.textContent("#panel-body .big")];
  await ok(); await open(); counts.push(await p.textContent("#panel-body .big")); assert.match(await title(), /8 m net/);
  await ok(); await open(); assert.match(await title(), /Halve it again/); await shot("16-predict-halve");
  await p.click("#choices [data-id=between]");
  await open(); await wait(() => /4 m net/.test(document.getElementById("panel-title").textContent)); counts.push(await p.textContent("#panel-body .big")); assert.match(await p.textContent("#panel-body"), /You called it/);
  await ok(); await open(); await wait(() => /2 m net/.test(document.getElementById("panel-title").textContent)); counts.push(await p.textContent("#panel-body .big"));
  await ok(); await open(); await wait(() => /1 m net/.test(document.getElementById("panel-title").textContent)); counts.push(await p.textContent("#panel-body .big")); await shot("17-net-1");
  console.log(name, "nets", counts.join(" / "));
  await ok(); await open(); assert.match(await title(), /Line or area/); await p.click("#choices [data-id=between]");
  await open(); assert.match(await title(), /slope is the dimension/); await p.waitForTimeout(200); await shot("18-loglog"); await overflow("diagram");
  const dimText = await p.textContent("#panel-body"); console.log(name, "diagram:", dimText.replace(/\s+/g, " ").slice(0, 160));
  await ok(); await open(); assert.match(await title(), /Real coasts/); await shot("19-real-coasts"); await overflow("real coasts");
  const real = await p.textContent("#panel-body"); assert.match(real, /South Africa/); assert.match(real, /Australia/); assert.match(real, /Britain/);
  await ok(); await open(); assert.match(await title(), /chart/); await shot("20-end"); await overflow("end");
  await ok(); await closed();
  await p.evaluate(() => { const S = __coast.S, s = S.start; const at = {x: s[0] + S.inland[0] * 3, z: s[1] + S.inland[1] * 3}; __coast.tp(at.x, at.z, S.look(at, {x: s[0] + S.inland[1] * 20, z: s[1] - S.inland[0] * 20}), 0.4); });
  await p.waitForTimeout(500); await shot("21-net-in-world");

  /* ------------------------------------------- saves and skipping */
  await p.reload(); await wait(() => window.__coast && !document.getElementById("title").hidden, null, 60000);
  const t = await p.textContent("#title-buttons");
  assert(/Begin/.test(t) && /Scene 2/.test(t) && /Scene 3/.test(t), "a finished game offers every scene: " + t);
  await p.evaluate(() => localStorage.setItem("coastline.v1", JSON.stringify({reached: 2})));
  await p.reload(); await wait(() => window.__coast && !document.getElementById("title").hidden, null, 60000);
  assert.match(await p.textContent("#title-buttons .primary"), /Continue: Scene 2/);
  await p.click("#title-buttons .primary"); await wait(() => __coast.G.scene === 2 && __coast.G.laid.length === 3);
  await p.click("#skip"); await open(); await shot("22-skip"); await p.click("#panel-buttons .btn:last-child"); await closed();
  assert.equal(await p.evaluate(() => __coast.G.scene), 2, "keep going stays put");
  await p.click("#skip"); await open(); await p.click("#panel-buttons .primary");
  await wait(() => __coast.G.scene === 3 && __coast.G.level === 5);
  await p.click("#skip"); await open(); await p.click("#panel-buttons .primary");
  await open(); assert.match(await title(), /chart/);

  await overflow("final");
  console.log(name, "errors", errs);
  await b.close();
  if (errs.length) process.exit(1);
}

(async () => {
  await run("desktop", {viewport: {width: 1280, height: 720}});
  const pixel = devices["Pixel 7"], iphone = devices["iPhone 14"];
  await run("pixel7", {viewport: pixel.viewport, userAgent: pixel.userAgent, deviceScaleFactor: pixel.deviceScaleFactor, isMobile: true, hasTouch: true});
  await run("iphone", {viewport: iphone.viewport, userAgent: iphone.userAgent, deviceScaleFactor: iphone.deviceScaleFactor, isMobile: true, hasTouch: true});
  console.log("all played");
})().catch((e) => { console.error(e); process.exit(1); });

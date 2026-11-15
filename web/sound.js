/* Coastline's sound: everything is synthesised with WebAudio, so there are no
   audio files to license or load. Quiet waves under everything, soft cues for
   the story beats. Starts on the player's first gesture (browsers require it);
   M or the HUD button mutes, and the choice is remembered. */
(function () {
  "use strict";
  const KEY = "coastline.muted";
  let ctx = null, master = null, sea = null;
  let muted = (window.StrataKit && StrataKit.store.get(KEY)) === "1";

  function start() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (e) { return; }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);
    waves();
  }

  // The sea: brown-ish noise through a low-pass filter whose level swells
  // slowly, like waves arriving every 6-9 seconds.
  function waves() {
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.2; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520;
    sea = ctx.createGain(); sea.gain.value = 0.0;
    src.connect(lp); lp.connect(sea); sea.connect(master);
    src.start();
    const swell = () => {
      if (!ctx) return;
      const t = ctx.currentTime, period = 6 + Math.random() * 3;
      sea.gain.cancelScheduledValues(t);
      sea.gain.setValueAtTime(sea.gain.value, t);
      sea.gain.linearRampToValueAtTime(0.16 + Math.random() * 0.08, t + period * 0.45);
      sea.gain.linearRampToValueAtTime(0.05, t + period);
      lp.frequency.setTargetAtTime(380 + Math.random() * 320, t, period / 3);
      setTimeout(swell, period * 1000);
    };
    swell();
  }

  function tone(freq, dur, type, vol, when, glide) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noiseBurst(dur, freq, vol) {
    if (!ctx || muted) return;
    const t = ctx.currentTime, n = Math.floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = ctx.createBufferSource(); s.buffer = b;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(master); s.start(t);
  }

  const Sound = {
    start,
    click() { tone(880, 0.06, "triangle", 0.05); },
    page() { noiseBurst(0.12, 2400, 0.05); },
    clink() { tone(1800 + Math.random() * 600, 0.09, "square", 0.025); tone(2600 + Math.random() * 400, 0.07, "sine", 0.03, 0.01); },
    whoosh() { noiseBurst(0.6, 700, 0.14); },
    // A committed guess: two notes rising.
    commit() { tone(523, 0.18, "sine", 0.08); tone(784, 0.3, "sine", 0.07, 0.09); },
    // The end of the chart: a small open chord.
    finale() { [392, 523, 659, 784].forEach((f, i) => tone(f, 1.4, "sine", 0.06, i * 0.12)); },
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      if (window.StrataKit) StrataKit.store.set(KEY, muted ? "1" : "0");
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.05);
      return muted;
    },
  };
  window.Sound = Sound;
  const first = () => { start(); removeEventListener("pointerdown", first, true); removeEventListener("keydown", first, true); };
  addEventListener("pointerdown", first, true);
  addEventListener("keydown", first, true);
})();

// Every sound is generated in the browser, and reacts to the weather, time of day and where the camera is.

// The mix. Adjust these to rebalance the sounds.
const BALANCE = {
  master: .8, rain: .34, rainDeep: .3, stormBoost: 1.5, thunder: 1.1, wind: .13,
  lakeBirds: .2, pirith: .26, town: .24, lake: .2, crickets: .035, children: .05, engine: .17,
 horn: .045, bell: .1, footsteps: .22, paddle: .2,
};
const RADIUS = { town: 650, lake: 1050, statue: 240, park: 130 };

// Real recordings. Any entry listed here replaces the generated sound of that name; anything left out stays generated.
// loops: rain, rainDeep, wind, town, lake, crickets, children, engine. shots: thunder, horn, bell, step, paddle.
const RECORDINGS = {
  loops: {
    pirith: { url: 'audio/pirith.ogg' }, lakeBirds: { url: 'audio/magpie-robin.ogg' }, lakeBirds2: { url: 'audio/bulbul.ogg', boost: .7 },
    rain: { url: 'audio/storm-rain.ogg' }, rainDeep: { url: 'audio/rain.ogg' }, townWet: { url: 'audio/town.m4a', boost: 2 },
    lake: { url: 'audio/lake.ogg', boost: 2.2, lowpass: 950 }, crickets: { url: 'audio/lake.ogg', boost: 1.8 }, // The low-pass keeps the water and drops the insects.
   
  },
  shots: { thunder: ['audio/thunder-2.ogg', 'audio/thunder-3.ogg'] },
};
const CLAP_SECONDS = 6; // How much of a thunder clap to play.
const LOUDNESS = .3; // Every recording is levelled to this, so the mix doesn't depend on how loud the file was.

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const between = (a, b) => a + Math.random() * (b - a);

export function buildAudio(world, { low = false, mono = false } = {}) {
  const { clock, lake, statue, park } = world.landmarks;
  let ctx = null, master = null, output = null, analyser = null, enabled = false, volume = 1;
  let white = null, brown = null, stormBus = null;
  const shots = {}, voices = {}, oneShots = { thunder: 0, horn: 0, bell: 0, step: 0, paddle: 0 }, samples = new Map();
  const timers = { horn: between(4, 10), bell: between(6, 14), step: 0, paddle: 0 };

  function noiseBuffer(kind) {
    const seconds = 5, data = new Float32Array(ctx.sampleRate * seconds);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') data[i] = w;
      else { last = (last + .02 * w) / 1.02; data[i] = last * 3.5; }
    }
    const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buffer.copyToChannel(data, 0);
    return buffer;
  }
  const filter = (type, frequency, Q = .7) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = frequency; f.Q.value = Q; return f; };
  const gainNode = (value = 0) => { const g = ctx.createGain(); g.gain.value = value; return g; };
  const chain = (...nodes) => { nodes.reduce((a, b) => (a.connect(b), b)); return nodes[nodes.length - 1]; };
  const noise = (buffer, loop = true) => { const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = loop; if (loop) s.loopStart = Math.random() * 4; return s; };

  /** A continuously running layer, faded in and out by update(). */
  function voice(name, source, ...nodes) {
    const gain = gainNode();
    chain(source, ...nodes, gain, output);
    source.start(0, source.buffer ? Math.random() * 4 : undefined);
    voices[name] = { gain, target: 0, feed: nodes[nodes.length - 1] ?? source };
    return gain;
  }
  /** Slowly swells a parameter around its value. */
  function swell(param, rate, depth) {
    const lfo = ctx.createOscillator(), amount = gainNode(depth);
    lfo.frequency.value = rate;
    chain(lfo, amount, param);
    lfo.start();
  }
  /** A gain stage that gently rises and falls, relative to the layer's own level. */
  const wobble = (rate, depth) => { const g = gainNode(1); swell(g.gain, rate, depth); return g; };
  const set = (name, level) => {
    const v = voices[name];
    v.target = level;
    if (level > .001 && RECORDINGS.loops[name]) loadLoop(name);
    v.gain.gain.setTargetAtTime(level, ctx.currentTime, .35);
  };

  function setup() {
    // Without this, an iPhone's silent switch mutes the page.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* Older browsers. */ }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = gainNode(0);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12; limiter.ratio.value = 12; limiter.attack.value = .004; limiter.release.value = .25;
    analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
    output = gainNode(1);
    chain(output, limiter, master, analyser, ctx.destination);
    white = noiseBuffer('white'); brown = noiseBuffer('brown');

    voice('rain', noise(white), filter('highpass', 900), filter('lowpass', 7500));
    voice('rainDeep', noise(brown), filter('lowpass', 700));
    voice('wind', noise(brown), filter('bandpass', 380, .6), wobble(.11, .45));
    voice('town', noise(brown), filter('lowpass', 340), wobble(.23, .15));
    voice('lake', noise(brown), filter('bandpass', 520, .8), wobble(.31, .55));
    // Crickets: a high tone chopped into quick pulses, gathered into slow chirps.
    const cricket = ctx.createOscillator(); cricket.type = 'sine'; cricket.frequency.value = 4300;
    const pulses = gainNode(.5), chirps = gainNode(.5);
    voice('crickets', cricket, pulses, chirps);
    swell(pulses.gain, 31, .5); swell(chirps.gain, 1.7, .5);
    voice('children', noise(white), filter('bandpass', 1500, 2.4), filter('lowpass', 2600), wobble(1.3, .4));
    // Tuk-tuk: a buzzy two-stroke note, pulsed.
    const engine = ctx.createOscillator(); engine.type = 'sawtooth'; engine.frequency.value = 70;
    voices.engineTone = engine;
    const putter = gainNode(.65);
    voice('engine', engine, filter('lowpass', 620), putter);
    const pulse = ctx.createOscillator(); pulse.frequency.value = 24;
    chain(pulse, gainNode(.35), putter.gain); pulse.start();
    // The street recording has wet tyres on it, so it only plays while it's raining.
    // These layers stay silent unless a recording is listed for them above.
    for (const name of ['lakeBirds', 'lakeBirds2', 'pirith']) { const g = gainNode(); g.connect(output); voices[name] = { gain: g, target: 0, feed: null }; }
    const wetStreet = gainNode();
    wetStreet.connect(output);
    voices.townWet = { gain: wetStreet, target: 0, feed: null };
    // Thunder runs through this, so a long recording fades away when the storm ends.
    stormBus = gainNode(1);
    stormBus.connect(output);
    voices.stormBus = { gain: stormBus, target: 1, feed: null };
  }

  /** Blends a recording's end into its start, so a loop has no audible seam. */
  function seamless(buffer) {
    const fade = Math.min(Math.floor(buffer.sampleRate * 1.5), Math.floor(buffer.length / 3)), length = buffer.length - fade;
    const channels = mono ? 1 : buffer.numberOfChannels; // One channel halves the memory on phones.
    const out = ctx.createBuffer(channels, length, buffer.sampleRate);
    for (let c = 0; c < channels; c++) {
      const from = buffer.getChannelData(c), to = out.getChannelData(c);
      to.set(from.subarray(0, length));
      for (let i = 0; i < fade; i++) { const t = i / fade; to[i] = from[i] * Math.sqrt(t) + from[length + i] * Math.sqrt(1 - t); }
    }
    return out;
  }
  /** Finds a recording's single loudest clap: where it strikes, and how loud that part is. */
  function findClap(data, rate) {
    const size = Math.floor(rate * .03), power = [];
    for (let at = 0; at + size < data.length; at += size) {
      let sum = 0, n = 0;
      for (let i = at; i < at + size; i += 4) { sum += data[i] * data[i]; n++; }
      power.push(sum / n);
    }
    let peak = 0;
    power.forEach((v, i) => { if (v > power[peak]) peak = i; });
    let start = peak;
    while (start > 0 && peak - start < 20 && power[start - 1] >= power[peak] * .06) start--; // Back to where it rises, at most .6 s.
    const span = power.slice(start, start + 100), loud = Math.sqrt(span.reduce((t, v) => t + v, 0) / span.length);
    return { onset: start * size / rate, clapTrim: LOUDNESS / Math.max(.005, loud) };
  }
  const recordings = new Map();
  const fetchRecording = (url) => {
    if (!recordings.has(url)) recordings.set(url, (async () => {
      const buffer = await fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.arrayBuffer(); }).then(b => ctx.decodeAudioData(b));
      const data = buffer.getChannelData(0);
      let sum = 0, n = 0;
      for (let i = 0; i < data.length; i += 37) { sum += data[i] * data[i]; n++; }
      return { buffer, trim: LOUDNESS / Math.max(.005, Math.sqrt(sum / n)), ...findClap(data, buffer.sampleRate) };
    })());
    return recordings.get(url);
  };
  // Recordings download only when something first needs them, so starting sound stays quick.
  const requested = new Set();
  async function loadLoop(name) {
    if (requested.has(name)) return;
    requested.add(name);
    const { url, boost = 1, lowpass } = RECORDINGS.loops[name];
    try {
      const { buffer, trim } = await fetchRecording(url), v = voices[name], s = ctx.createBufferSource(), g = gainNode(trim * boost);
      s.buffer = seamless(buffer); s.loop = true;
      v.feed?.disconnect();
      if (lowpass) chain(s, g, filter('lowpass', lowpass), v.gain); else chain(s, g, v.gain);
      s.start(0, Math.random() * s.buffer.duration);
      v.recording = s;
    } catch (e) { console.warn('Keeping the generated sound for', name, e); }
  }
  async function loadShots(name) {
    if (requested.has(`shot:${name}`)) return;
    requested.add(`shot:${name}`);
    for (const url of RECORDINGS.shots[name] || []) {
      try { (shots[name] ||= []).push(await fetchRecording(url)); } catch (e) { console.warn('Could not load', url, e); }
    }
  }
  /** Plays a recording of this sound if there is one. */
  function playRecording(name, level, delay = 0, destination = output) {
    const set = shots[name];
    if (!set?.length) return false;
    const { buffer, clapTrim, onset } = set[Math.floor(Math.random() * set.length)], s = ctx.createBufferSource(), peakLevel = clapTrim * level, g = gainNode(peakLevel);
    s.buffer = buffer; s.playbackRate.value = between(.94, 1.06);
    chain(s, g, destination);
    const when = ctx.currentTime + delay, seconds = Math.min(CLAP_SECONDS, buffer.duration - onset);
    g.gain.setValueAtTime(peakLevel, when + seconds * .6);
    g.gain.linearRampToValueAtTime(0, when + seconds); // Ends before any later boom in the recording.
    s.start(when, onset, seconds);
    return true;
  }

  /** A short shaped burst of filtered noise. */
  function burst(buffer, level, attack, decay, type, frequency, Q = .7, delay = 0) {
    const at = ctx.currentTime + delay, s = noise(buffer, false), g = gainNode(0);
    chain(s, filter(type, frequency, Q), g, output);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + attack);
    g.gain.exponentialRampToValueAtTime(.0001, at + attack + decay);
    s.start(at, Math.random() * 3, attack + decay + .05);
  }
  function tone(frequency, level, attack, decay, type = 'sine', delay = 0, slideTo = null) {
    const at = ctx.currentTime + delay, o = ctx.createOscillator(), g = gainNode(0);
    o.type = type; o.frequency.setValueAtTime(frequency, at);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, at + attack + decay);
    chain(o, g, output);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + attack);
    g.gain.exponentialRampToValueAtTime(.0001, at + attack + decay);
    o.start(at); o.stop(at + attack + decay + .05);
  }
  function thunder(distance, flashIn = 0) { // The boom lands on the brightest flash.
    if (!ctx || !enabled) return;
    oneShots.thunder++;
    const near = clamp(1 - (distance - 1600) / 1800), delay = flashIn, level = BALANCE.thunder * (.55 + .45 * near);
    if (playRecording('thunder', level * 1.6, delay, stormBus)) return;
    burst(brown, level * 2.4, .08, 5 + near * 2, 'lowpass', 150, .7, delay);
    burst(brown, level * 1.3, .35, 3.4, 'lowpass', 340, .7, delay + .25);
    burst(brown, level * .9, .1, 1.8, 'bandpass', 90, 1, delay + 1.2 + Math.random());
    if (near > .45) burst(white, level * .3 * near, .006, .28, 'highpass', 1400, .7, delay);
  }
  function horn(level) {
    oneShots.horn++;
    if (playRecording('horn', level * 4)) return;
    const big = Math.random() < .3, pitch = big ? 310 : 520;
    for (let n = 0, count = big ? 1 : 2; n < count; n++) for (const f of [pitch, pitch * 1.26]) tone(f, level, .02, big ? .55 : .17, 'square', n * .24);
  }
  function bell(level) {
    oneShots.bell++;
    if (playRecording('bell', level * 3)) return;
    [[196, 1], [392, .5], [523, .32], [784, .16]].forEach(([f, share], i) => tone(f, level * share, .008, 6.5 - i, 'sine'));
  }

  /** Lets a recording replace a generated sound later: drop a file in the project and play it by path. */
  async function playSample(url, level = 1) {
    if (!ctx || !enabled) return;
    if (!samples.has(url)) samples.set(url, await fetch(url).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)));
    const s = ctx.createBufferSource(), g = gainNode(level);
    s.buffer = samples.get(url);
    chain(s, g, output);
    s.start();
  }

  function applyVolume() { if (ctx) master.gain.setTargetAtTime(enabled ? BALANCE.master * volume : 0, ctx.currentTime, .12); }
  // Phones only allow audio to start from a finished tap, and can pause it after a call, so keep trying.
  const unlock = () => { if (ctx && enabled && ctx.state !== 'running') ctx.resume(); };
  for (const type of ['touchend', 'click', 'keydown']) addEventListener(type, unlock, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !enabled) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });

  const close = (t, p, radius) => { const d = clamp(1 - Math.hypot(t.x - p.x, t.z - p.z) / radius); return d * d * (3 - 2 * d); };
  const timer = (name, dt, min, max, play) => { if ((timers[name] -= dt) <= 0) { timers[name] = between(min, max); play(); } };

  return {
    get enabled() { return enabled; },
    get state() { return ctx ? ctx.state : 'not started'; },
    get volume() { return volume; },
    setEnabled(on) {
      if (on && !ctx) setup();
      enabled = on;
      if (!ctx) return;
      applyVolume();
      if (on) ctx.resume();
      else setTimeout(() => { if (!enabled) ctx.suspend(); }, 400);
    },
    setVolume(v) { volume = v; applyVolume(); },
    thunder,
    playSample,
    update({ dt, target, focusDistance, night, cover, storm, followKind, followSpeed }) {
      if (!ctx || !enabled || ctx.state !== 'running') return;
      const near = 1 - clamp((focusDistance - 220) / 1100), wide = 1 - clamp((focusDistance - 700) / 2200), day = 1 - clamp(night), dry = 1 - clamp(cover);
      const inTown = close(target, clock, RADIUS.town) * Math.max(near, .42), atLake = close(target, lake, RADIUS.lake) * wide, atStatue = close(target, statue, RADIUS.statue), atPark = close(target, park, RADIUS.park) * near;
      const nature = clamp(1 - inTown * 1.3);

      if (storm > .2) loadShots('thunder');
      const fall = cover * (1 + storm * (BALANCE.stormBoost - 1));
      set('rain', BALANCE.rain * fall * (.75 + .25 * near));
      set('rainDeep', BALANCE.rainDeep * cover * storm);
      set('wind', BALANCE.wind * (.6 + (1 - near) * 1.2 + storm * 2.2));
      const traffic = BALANCE.town * inTown * (.45 + .55 * day);
      set('town', traffic * (1 - cover));
      set('townWet', traffic * cover * .75);
      stormBus.gain.setTargetAtTime(cover > .5 ? 1 : 0, ctx.currentTime, .8);
      set('lake', BALANCE.lake * atLake * (1 - .4 * cover));
      for (const name of ['lakeBirds', 'lakeBirds2']) set(name, BALANCE.lakeBirds * atLake * day * dry);
      set('pirith', BALANCE.pirith * atStatue * clamp(near + .4));
      set('crickets', BALANCE.crickets * clamp(night) * dry * wide * nature);
      set('children', BALANCE.children * atPark * day * dry);
      const riding = followKind === 'tuk' ? 1 : 0, pace = clamp((followSpeed || 0) / 9);
      set('engine', BALANCE.engine * riding * (.6 + .4 * pace));
      voices.engineTone.frequency.setTargetAtTime(62 + pace * 58, ctx.currentTime, .2);
      if (voices.engine.recording) voices.engine.recording.playbackRate.setTargetAtTime(.85 + pace * .4, ctx.currentTime, .2);
      if (low) return;

      if (inTown > .25) timer('horn', dt, 3.5, 13, () => horn(BALANCE.horn * inTown));
      if (atStatue > .15 && storm < .5) timer('bell', dt, 12, 26, () => bell(BALANCE.bell * atStatue));
      if (followKind === 'jog' || followKind === 'climb') {
        timer('step', dt, followKind === 'jog' ? .34 : .56, followKind === 'jog' ? .34 : .6, () => {
          oneShots.step++;
          if (playRecording('step', BALANCE.footsteps * 1.5)) return;
          burst(brown, BALANCE.footsteps * 2.6, .004, .09, 'lowpass', 520);
          if (cover > .5) burst(white, BALANCE.footsteps * .16, .004, .1, 'bandpass', 2300, 1.2);
        });
      }
      if (followKind === 'boat') {
        timer('paddle', dt, 1.1, 1.6, () => {
          oneShots.paddle++;
          if (playRecording('paddle', BALANCE.paddle * 1.5)) return;
          burst(white, BALANCE.paddle * .5, .08, .5, 'bandpass', 900, .9);
          burst(brown, BALANCE.paddle * 1.4, .05, .35, 'lowpass', 420);
        });
      }
    },
    /** Current levels, for checking the mix. */
    levels() {
      const out = { outputRms: 0, oneShots: { ...oneShots } };
      for (const [k, v] of Object.entries(voices)) if (v.gain) out[k] = +v.gain.gain.value.toFixed(4);
      if (analyser) {
        const d = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(d);
        out.outputRms = +Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length).toFixed(4);
      }
      return out;
    },
  };
}

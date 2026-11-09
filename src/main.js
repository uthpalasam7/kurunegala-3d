// Entry point: assembles the scene, then runs the camera, interface and render loop.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { loadWorld, shared } from './world.js';
import { buildGround, buildWater } from './terrain.js';
import { buildSky } from './sky.js';
import { buildRain } from './rain.js';
import { buildAudio } from './audio.js';
import { buildTown, buildStreetLights, buildTrees } from './town.js';
import { buildLandmarks } from './landmarks.js';
import { buildStreets, flattenRoads } from './streets.js';
import { buildTraffic } from './traffic.js';
import { buildPeople } from './people.js';
import { prepareLakeside, buildLakeside } from './lakeside.js';
import { buildWildlife } from './wildlife.js';
import { prepareSteps, buildSteps } from './steps.js';
import { prepareTempleRoad, buildTempleRoad } from './temple.js';
import { preparePlaces, buildPlaces } from './places.js';

const $ = (s) => document.querySelector(s);
const status = $('#status'), bar = $('.bar i'), percent = $('#percent');
async function step(text, pct) {
  status.textContent = text;
  bar.style.width = `${pct}%`;
  percent.textContent = `${pct}%`;
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 16)));
}

const CAPTIONS = {
  clock: ['Clock Tower', 'Built in 1922 as a memorial to soldiers of the region lost in the First World War, it stands at the heart of town. These clock hands show the current time in Sri Lanka.'],
  lake: ['Kurunegala Lake', 'The lake lies at the northern edge of town, beneath the granite outcrops. Its shoreline here follows the mapped outline.'],
  town: ['Town Centre', 'The busy junction around the Clock Tower. Vehicles drive on the left and stop at traffic lights, and people use sidewalks and crossings. All of it is simulated on the real road map.'],
  boat: ['Ride a boat', 'Riding along on one of the boats out on Kurunegala Lake. Drag the view, or pick another button, to step off.'],
  jog: ['Jog around the lake', 'Running with a jogger on the path that circles Kurunegala Lake. Drag the view, or pick another button, to stop.'],
  climb: ['Climb to the Buddha', 'Climbing the stone stairway up Elephant Rock with a pilgrim, all the way to the statue. Drag the view, or pick another button, to stop.'],
  tuk: ['Ride a tuk-tuk', 'Riding along with a tuk-tuk through Kurunegala\u2019s streets and junctions. Drag the view, or pick another button, to get off.'],
  stadium: ['Welagedara Cricket Stadium', 'D. B. Welagedara Stadium on its mapped site, with a match under way. The stands and pavilion are illustrative.'],
  mosque: ['Malay Jumma Mosque', 'The mosque stands on its mapped footprint north of the Clock Tower. Its dome and minarets are illustrative.'],
  kovil: ['Kathiresan Kovil', 'The Hindu temple on its mapped site, with a colourful gateway tower. Its detailed design is illustrative.'],
  temple: ['Temple Road & Car Park', 'Athugala Road climbs the rock to a car park behind the statue, open to cars, tuk-tuks, vans and motorbikes but not buses. A wide stairway leads down behind the statue, and a walkway curves round it to the terrace.'],
  steps: ['Steps to the Buddha', 'The stone stairway up Elephant Rock follows its mapped route, then joins the statue\u2019s platform. People in white are making the climb.'],
  lakeside: ['Exercise Park', 'An open exercise area on the far shore from town, beside the jogging path that circles the lake. Its position and equipment are illustrative.'],
  boats: ['Boat Ride', 'A jetty with pedal boats and rowing boats out on Kurunegala Lake. The jetty is placed beside the Children\u2019s Park and is illustrative.'],
  park: ['Children\u2019s Park', 'The Children\u2019s Park at Lake Round, placed at its mapped location on the western shore. The playground equipment is illustrative.'],
  rock: ['Buddha Statue', 'The white seated Buddha on Athugala, reported to be about 27 metres tall. The terrace in front, with its flower stage and oil lamps, is illustrative.'],
};

async function main() {
  await step('Loading map data', 8);
  const world = await loadWorld();
  const canvas = $('#scene');
  const params = new URLSearchParams(location.search);
  // Phones and tablets get their own lighter mode. Add ?quality=high to override it.
  const handheld = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !handheld, stencil: true, powerPreference: 'high-performance' });
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  const quality = params.get('quality') ?? (handheld || /swiftshader|llvmpipe|software/i.test(gpu) ? 'low' : 'high');
  const low = quality === 'low';

  // If the graphics driver gives up, come back once in the lighter mode.
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    console.warn(`WebGL context lost during: ${status.textContent}, after ${renderer.info.render.frame} frames`);
    if (!low) {
      params.set('quality', 'low');
      location.replace(`${location.pathname}?${params}${location.hash}`);
    } else {
      status.textContent = 'Your graphics hardware ran out of memory. Close other tabs and reload.';
      $('#loader').classList.remove('done');
    }
  });

  const sharpness = handheld ? Math.min(devicePixelRatio, 1.25) : low ? 1 : Math.min(devicePixelRatio, 1.5);
  renderer.setPixelRatio(sharpness);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 3, 120000);

  await step('Mapping the streets', 14);
  const placeSites = preparePlaces(world);
  const templeData = prepareTempleRoad(world);
  flattenRoads(world);
  const streets = buildStreets(world);
  const lakeData = prepareLakeside(world);
  const stepData = prepareSteps(world);
  await step('Shaping the land', 20);
  const sky = buildSky(scene, renderer);
  sky.light.shadow.mapSize.setScalar(low ? 1536 : 4096);
  const ground = buildGround(world, scene, renderer, low ? 2048 : 4096, !low, streets);
  buildWater(world, scene);
  await step('Raising the town', 42);
  buildTown(world, scene);
  const setStreetLights = buildStreetLights(world, scene);
  await step('Planting trees', 66);
  const trees = buildTrees(world, scene);
  if (low) trees.setDensity(handheld ? .25 : .35);
  await step('Placing the landmarks', 84);
  const landmarks = buildLandmarks(world, scene);
  await step('Filling the streets', 92);
  const traffic = buildTraffic(world, scene, streets, { total: handheld ? 110 : low ? 200 : 500 });
  const people = buildPeople(world, scene, streets, traffic, { total: handheld ? 220 : low ? 500 : 1500 });

  await step('Opening the lakeside', 94);
  const lakeside = buildLakeside(world, scene, lakeData, { low });
  const wildlife = buildWildlife(world, scene, lakeData, { low });
  const steps = buildSteps(world, scene, stepData, { low });
  const templeRoad = buildTempleRoad(world, scene, templeData);
  const places = buildPlaces(world, scene, placeSites, { low });

  const { clock, statue, lake } = world.landmarks;
  const { summit } = world;
  const views = {
    overview: { pos: [-2650, 1320, 2450], target: [240, 150, -70] },
    clock: { pos: [clock.x - 44, clock.y + 13, clock.z + 56], target: [clock.x, clock.y + 6.5, clock.z] },
    town: { pos: [clock.x - 31, clock.y + 3.6, clock.z + 29], target: [clock.x + 6, clock.y + 5, clock.z - 6] },
    lake: { pos: [lake.x - 700, lake.y + 120, lake.z - 560], target: [lake.x + 180, lake.y + 16, lake.z + 170] },
    rock: { pos: [statue.x - 118, statue.y + 22, statue.z - 72], target: [statue.x, statue.y + 7, statue.z] },
    ...lakeside.views(),
    steps: steps.view(),
    rock: steps.statueView(),
    temple: templeRoad.view(),
    ...places.views,
  };

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = .07;
  controls.minDistance = 8;
  controls.maxDistance = 9500;
  controls.maxPolarAngle = 1.53;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  // Map-style: drag moves, right-drag or Shift-drag rotates, two fingers zoom and turn.
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.panSpeed = 1;

  // --- Camera flights ---------------------------------------------------------
  let followKind = null, flight = null, follow = null, followIn = 1, followHeading = 0;
  const followFromPos = new THREE.Vector3(), followFromTarget = new THREE.Vector3();
  const buttons = document.querySelectorAll('[data-view]');
  // The Explore menu folds away. Phones start folded, so the view isn't covered.
  const exploreToggle = $('.explore-toggle'), exploreList = $('#explore-list'), here = $('#here');
  const phone = matchMedia('(max-width: 720px)');
  function foldExplore(open) {
    exploreList.hidden = !open;
    exploreToggle.setAttribute('aria-expanded', open);
  }
  let startOpen = !phone.matches;
  try { if (!phone.matches && localStorage.getItem('kurunegala-explore') === 'closed') startOpen = false; } catch { /* Opens by default. */ }
  foldExplore(startOpen);
  exploreToggle.addEventListener('click', () => {
    const open = exploreList.hidden;
    foldExplore(open);
    try { localStorage.setItem('kurunegala-explore', open ? 'open' : 'closed'); } catch { /* Not remembered. */ }
  });
  const caption = $('#caption');
  let captionTimer = 0;
  function select(name) {
    buttons.forEach(b => {
      const on = b.dataset.view === name;
      b.classList.toggle('on', on);
      if (on) { here.textContent = b.dataset.label || b.textContent; b.scrollIntoView({ block: 'nearest' }); }
    });
    const text = CAPTIONS[name];
    caption.hidden = !text;
    clearTimeout(captionTimer);
    if (text && phone.matches) captionTimer = setTimeout(() => { caption.hidden = true; }, 7000); // Phones get their map back.
    if (text) {
      caption.querySelector('h2').textContent = text[0];
      caption.querySelector('p').textContent = text[1];
      caption.style.animation = 'none'; void caption.offsetWidth; caption.style.animation = '';
    }
  }
  function placeCamera(name) {
    const v = views[name];
    camera.position.set(...v.pos); controls.target.set(...v.target); controls.update();
  }
  // Camera placement: distance behind, height, how far ahead it looks, and aim height.
  const RIGS = {
    tuk: { back: 8, up: 3.9, ahead: 9, look: .1 },
    boat: { back: 9.5, up: 5, ahead: 9, look: -1.2 },
    jog: { back: 6, up: 3, ahead: 5, look: .5 },
    climb: { back: 6, up: 2.4, ahead: 5, look: .85 },
  };
  let rig = RIGS.bus;
  const FOLLOWABLE = {
    tuk: (c) => traffic.nearest('tuk', c.x, c.z),
    boat: (c) => lakeside.nearestBoat(c.x, c.z),
    jog: (c) => lakeside.nearestJogger(c.x, c.z),
    climb: () => steps.climber(),
  };
  function startFollow(kind = 'tuk', snap = false) {
    const subject = FOLLOWABLE[kind](controls.target);
    if (!subject) return;
    if (follow) follow.pinned = false;
    subject.pinned = true;
    follow = subject;
    followKind = kind;
    rig = RIGS[kind];
    followIn = snap ? 1 : 0;
    followHeading = subject.heading;
    followFromPos.copy(camera.position);
    followFromTarget.copy(controls.target);
    flight = null;
    controls.enabled = true;
    select(kind);
  }
  function stopFollow() {
    if (follow) follow.pinned = false;
    follow = null;
    followKind = null;
  }
  function flyTo(name) {
    if (FOLLOWABLE[name]) { startFollow(name); return; }
    stopFollow();
    const v = views[name];
    select(name);
    const endPos = new THREE.Vector3(...v.pos), endTarget = new THREE.Vector3(...v.target);
    const startPos = camera.position.clone(), startTarget = controls.target.clone();
    const distance = startPos.distanceTo(endPos);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    flight = { startPos, startTarget, endPos, endTarget, t: 0, duration: reduce ? .01 : Math.min(4.2, 1.7 + distance / 1800), lift: Math.min(420, distance * .18) };
    controls.enabled = false;
  }
  controls.addEventListener('start', () => {
    stopFollow();
    buttons.forEach(b => b.classList.remove('on'));
  });
  buttons.forEach(b => b.addEventListener('click', () => { flyTo(b.dataset.view); if (phone.matches) foldExplore(false); }));

  // --- Free movement -------------------------------------------------------------
  function takeManualControl() {
    stopFollow();
    if (flight) { flight = null; controls.enabled = true; }
    buttons.forEach(b => b.classList.remove('on'));
  }
  const canvasEl = renderer.domElement;
  canvasEl.addEventListener('pointerdown', takeManualControl, { capture: true });
  canvasEl.addEventListener('wheel', takeManualControl, { capture: true, passive: true });

  const pressed = new Set();
  const MOVES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  addEventListener('keydown', (e) => {
    if ($('#about').open || !MOVES.has(e.code) || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    if (!pressed.size) takeManualControl();
    pressed.add(e.code);
  });
  addEventListener('keyup', (e) => pressed.delete(e.code));
  addEventListener('blur', () => pressed.clear());
  const keyForward = new THREE.Vector3(), keyRight = new THREE.Vector3(), keyOffset = new THREE.Vector3(), orbit = new THREE.Spherical();

  document.querySelectorAll('.turn button').forEach((button) => {
    const code = button.dataset.key;
    const release = () => pressed.delete(code);
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!pressed.size) takeManualControl();
      pressed.add(code);
      try { button.setPointerCapture(e.pointerId); } catch { /* The release listeners below still apply. */ }
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
    button.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  function moveWithKeys(dt, shift) {
    if (!pressed.size) return;
    camera.getWorldDirection(keyForward);
    keyForward.y = 0;
    if (keyForward.lengthSq() < 1e-4) keyForward.set(0, 0, -1);
    keyForward.normalize();
    keyRight.set(-keyForward.z, 0, keyForward.x);
    const distance = camera.position.distanceTo(controls.target);
    const speed = Math.max(9, Math.min(900, distance * .75)) * (shift ? 3 : 1);
    const along = (pressed.has('KeyW') ? 1 : 0) - (pressed.has('KeyS') ? 1 : 0);
    const across = (pressed.has('KeyD') ? 1 : 0) - (pressed.has('KeyA') ? 1 : 0);
    const dx = (keyForward.x * along + keyRight.x * across) * speed * dt, dz = (keyForward.z * along + keyRight.z * across) * speed * dt;
    camera.position.x += dx; camera.position.z += dz;
    controls.target.x += dx; controls.target.z += dz;
    const lift = (pressed.has('KeyE') ? 1 : 0) - (pressed.has('KeyQ') ? 1 : 0);
    camera.position.y += lift * Math.max(7, distance * .55) * (shift ? 3 : 1) * dt;

    // Arrow keys and the on-screen buttons turn and tilt the view around its centre.
    const turn = (pressed.has('ArrowLeft') ? 1 : 0) - (pressed.has('ArrowRight') ? 1 : 0);
    const tilt = (pressed.has('ArrowDown') ? 1 : 0) - (pressed.has('ArrowUp') ? 1 : 0);
    if (turn || tilt) {
      orbit.setFromVector3(keyOffset.copy(camera.position).sub(controls.target));
      orbit.theta += turn * 1.25 * dt;
      orbit.phi = THREE.MathUtils.clamp(orbit.phi + tilt * .8 * dt, .08, controls.maxPolarAngle);
      camera.position.copy(controls.target).add(keyOffset.setFromSpherical(orbit));
    }
  }
  let shiftHeld = false;
  addEventListener('keydown', (e) => { if (e.key === 'Shift') shiftHeld = true; });
  addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftHeld = false; });

  // Double-click: march a ray over the land to find the spot, then glide to it.
  const pointer = new THREE.Vector2(), picker = new THREE.Raycaster();
  function groundPoint(clientX, clientY) {
    pointer.set(clientX / innerWidth * 2 - 1, 1 - clientY / innerHeight * 2);
    picker.setFromCamera(pointer, camera);
    const { origin, direction } = picker.ray;
    let previous = 0;
    for (let d = 2; d < 16000; d += Math.max(2, d * .012)) {
      const y = origin.y + direction.y * d, x = origin.x + direction.x * d, z = origin.z + direction.z * d;
      if (y <= world.heightAt(x, z)) {
        let lo = previous, hi = d;
        for (let i = 0; i < 14; i++) {
          const mid = (lo + hi) / 2;
          if (origin.y + direction.y * mid <= world.heightAt(origin.x + direction.x * mid, origin.z + direction.z * mid)) hi = mid; else lo = mid;
        }
        const point = origin.clone().addScaledVector(direction, hi);
        return Math.abs(point.x) < world.half && Math.abs(point.z) < world.half ? point : null;
      }
      previous = d;
    }
    return null;
  }
  canvasEl.addEventListener('dblclick', (e) => {
    const point = groundPoint(e.clientX, e.clientY);
    if (!point) return;
    takeManualControl();
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(Math.min(offset.length() * .55, Math.max(55, offset.length() * .3)));
    const endPos = point.clone().add(offset), endTarget = point.clone();
    endPos.y = Math.max(endPos.y, world.heightAt(endPos.x, endPos.z) + 5);
    flight = { startPos: camera.position.clone(), startTarget: controls.target.clone(), endPos, endTarget, t: 0, duration: 1.5, lift: 0 };
    controls.enabled = false;
  });

  const hint = $('#hint');
  try { hint.hidden = localStorage.getItem('kurunegala-hint') === 'off'; } catch { hint.hidden = false; }
  hint.querySelector('button').addEventListener('click', () => {
    hint.hidden = true;
    try { localStorage.setItem('kurunegala-hint', 'off'); } catch { /* The hint simply returns next visit. */ }
  });

  // --- Time of day -------------------------------------------------------------
  // Sound starts off. It needs a click before browsers allow it, and someone who turned it on last time gets it back on their first click.
  const audio = buildAudio(world, { low: low && !handheld, mono: handheld });
  sky.onStrike = (distance, flashIn) => audio.thunder(distance, flashIn);
  const soundButton = $('#sound'), volumeSlider = $('#volume');
  const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Not remembered. */ } };
  const recall = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const setSound = (on) => {
    audio.setEnabled(on);
    soundButton.classList.toggle('on', on);
    soundButton.setAttribute('aria-pressed', on);
    volumeSlider.hidden = !on;
    remember('kurunegala-sound', on ? 'on' : 'off');
  };
  const savedVolume = Number(recall('kurunegala-volume'));
  if (recall('kurunegala-volume') !== null && Number.isFinite(savedVolume)) { volumeSlider.value = savedVolume; audio.setVolume(savedVolume / 100); }
  soundButton.addEventListener('click', () => setSound(!audio.enabled));
  volumeSlider.addEventListener('input', () => { audio.setVolume(volumeSlider.value / 100); remember('kurunegala-volume', volumeSlider.value); });
  addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat) setSound(!audio.enabled); });
  if (recall('kurunegala-sound') === 'on') {
    const types = ['click', 'touchend', 'keydown'];
    const resume = (e) => {
      if (!e.target.closest?.('#sound') && !audio.enabled) setSound(true);
      types.forEach(t => removeEventListener(t, resume));
    };
    types.forEach(t => addEventListener(t, resume));
  }
  // On phones, time, weather and sound fold behind one button.
  const quick = $('.quick-toggle'), conditions = $('.conditions');
  const foldQuick = (open) => { conditions.classList.toggle('open', open); quick.setAttribute('aria-expanded', open); };
  quick.addEventListener('click', () => foldQuick(!conditions.classList.contains('open')));
  renderer.domElement.addEventListener('pointerdown', () => foldQuick(false));
  caption.addEventListener('click', () => { if (phone.matches) caption.hidden = true; });
  const rain = buildRain(scene, { low });
  const weatherButtons = document.querySelectorAll('.weather button');
  const setWeather = (kind, instant = false) => {
    sky.setRain({ clear: 0, rain: 1, storm: 2 }[kind], instant);
    weatherButtons.forEach(o => o.classList.toggle('on', o.dataset.weather === kind));
  };
  weatherButtons.forEach(b => b.addEventListener('click', () => setWeather(b.dataset.weather)));
  const requestedWeather = new URLSearchParams(location.search).get('weather');
  if (requestedWeather === 'rain' || requestedWeather === 'storm') setWeather(requestedWeather, true);
  const timeButtons = document.querySelectorAll('.time button');
  let shadowDirty = true;
  timeButtons.forEach(b => b.addEventListener('click', () => {
    sky.set(b.dataset.time);
    timeButtons.forEach(o => o.classList.toggle('on', o === b));
  }));

  // --- Floating labels ---------------------------------------------------------
  const pins = [
    { view: 'clock', label: 'Clock Tower', at: new THREE.Vector3(clock.x, clock.y + 30, clock.z) },
    { view: 'lake', label: 'Kurunegala Lake', at: new THREE.Vector3(lake.x, lake.y + 12, lake.z) },
    { view: 'rock', label: 'Athugala', at: new THREE.Vector3(statue.x, Math.max(summit.y, statue.y) + 52, statue.z) },
    ...lakeside.pins().map(p => ({ ...p, at: new THREE.Vector3(...p.at) })),
  ].map(p => {
    const el = document.createElement('button');
    el.className = 'marker'; el.textContent = p.label;
    el.addEventListener('click', () => flyTo(p.view));
    $('#markers').append(el);
    return { ...p, el };
  });
  const projected = new THREE.Vector3();
  function updatePins() {
    for (const p of pins) {
      projected.copy(p.at).project(camera);
      const near = camera.position.distanceTo(p.at) < 420;
      const hidden = near || projected.z > 1;
      p.el.style.opacity = hidden ? 0 : 1;
      p.el.style.pointerEvents = hidden ? 'none' : 'auto';
      p.el.style.visibility = hidden ? 'hidden' : 'visible';
      if (hidden) continue;
      const x = (projected.x + 1) / 2 * innerWidth, y = (1 - projected.y) / 2 * innerHeight;
      p.el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  // --- Shadows follow the area being looked at ---------------------------------
  const lastCam = new THREE.Vector3(1e9, 0, 0), lastTarget = new THREE.Vector3();
  function updateShadowFrustum() {
    const d = camera.position.distanceTo(controls.target);
    const half = THREE.MathUtils.clamp(d * 1.25, 130, 3400);
    const shadow = sky.light.shadow, cam = shadow.camera;
    const texel = (half * 2) / shadow.mapSize.x;
    const c = controls.target;
    const snap = (v) => Math.round(v / texel) * texel;
    sky.light.target.position.set(snap(c.x), c.y, snap(c.z));
    sky.light.position.copy(sky.light.target.position).addScaledVector(sky.sunDir, 7000);
    sky.light.target.updateMatrixWorld();
    sky.light.updateMatrixWorld();
    cam.left = cam.bottom = -half; cam.right = cam.top = half;
    cam.near = 200; cam.far = 14000;
    cam.updateProjectionMatrix();
    shadow.normalBias = Math.max(.25, half / 900);
    renderer.shadowMap.needsUpdate = true;
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // --- Start -------------------------------------------------------------------
  const start = location.hash.slice(1);
  const requestedTime = new URLSearchParams(location.search).get('time');
  if (['day', 'sunset', 'night'].includes(requestedTime)) {
    sky.set(requestedTime, true);
    timeButtons.forEach(b => b.classList.toggle('on', b.dataset.time === requestedTime));
  }
  if (views[start]) { placeCamera(start); select(start); } else placeCamera('overview');
  traffic.update(.016, sky.night, camera);
  if (start === 'tuk') { placeCamera('town'); startFollow('tuk', true); }
  if (start === 'boat') { placeCamera('boats'); lakeside.update(.016, sky.night, camera, 100); startFollow('boat', true); }
  if (start === 'jog') { placeCamera('lakeside'); startFollow('jog', true); }
  if (start === 'climb') { placeCamera('steps'); startFollow('climb', true); }

  await step('Rendering the first view', 100);
  const timer = new THREE.Clock();
  let smoothDt = 1 / 60;
  let frames = 0, sampleTime = 0, dropped = 0, clockTick = 0;
  const followPos = new THREE.Vector3(), followTarget = new THREE.Vector3();

  renderer.setAnimationLoop(() => {
    // Averaging the frame time removes tiny speed changes between frames.
    smoothDt += (Math.min(timer.getDelta(), .1) - smoothDt) * .25;
    const dt = smoothDt;
    shared.uTime.value += dt;

    if (flight) {
      flight.t = Math.min(1, flight.t + dt / flight.duration);
      const e = flight.t < .5 ? 4 * flight.t ** 3 : 1 - (-2 * flight.t + 2) ** 3 / 2;
      camera.position.lerpVectors(flight.startPos, flight.endPos, e);
      camera.position.y += Math.sin(e * Math.PI) * flight.lift;
      controls.target.lerpVectors(flight.startTarget, flight.endTarget, e);
      if (flight.t >= 1) { flight = null; controls.enabled = true; }
    }
    shared.uSun.value = sky.sunDir;
    shared.uShadow.value = (.42 - .3 * sky.night) * (1 - .8 * sky.cover);
    rain.update(sky.cover * (.55 + .45 * sky.storm), sky.storm, sky.night, camera);
    shared.uRain.value = sky.cover;
    shared.crowd.value = 1 - sky.cover * (.6 + .28 * sky.storm); // Most people head indoors, more so in a storm.
    traffic.update(dt, sky.night, camera);
    const focusDistance = camera.position.distanceTo(controls.target);
    people.update(dt, sky.night, camera, focusDistance);
    lakeside.update(dt, sky.night, camera, focusDistance);
    wildlife.update(dt, sky.night);
    steps.update(dt, sky.night, focusDistance);
    places.update(dt, sky.night, focusDistance);
    soundButton.classList.toggle('waiting', audio.enabled && audio.state !== 'running'); // Tap to start, if the phone has held it back.
    audio.update({ dt, target: controls.target, focusDistance, night: sky.night, cover: sky.cover, storm: sky.storm, followKind, followSpeed: follow?.speed });
    moveWithKeys(dt, shiftHeld);
    if (follow) {
      // The camera is fixed to the vehicle and only its direction is softened, so nothing lags or jitters.
      followHeading += Math.atan2(Math.sin(follow.heading - followHeading), Math.cos(follow.heading - followHeading)) * Math.min(1, dt * 1.6);
      const sin = Math.sin(followHeading), cos = Math.cos(followHeading);
      followIn = Math.min(1, followIn + dt / 2);
      const blend = followIn * followIn * (3 - 2 * followIn);
      followPos.set(follow.x - sin * rig.back, follow.y + rig.up, follow.z - cos * rig.back);
      followTarget.set(follow.x + sin * rig.ahead, follow.y + rig.look, follow.z + cos * rig.ahead);
      camera.position.lerpVectors(followFromPos, followPos, blend);
      controls.target.lerpVectors(followFromTarget, followTarget, blend);
    }
    controls.update();
    const t = controls.target, limit = world.half - 10;
    t.x = THREE.MathUtils.clamp(t.x, -limit, limit);
    t.z = THREE.MathUtils.clamp(t.z, -limit, limit);
    // Free movement keeps the pivot on the land, so panning follows hills.
    if (!flight && !follow) t.y += (world.heightAt(t.x, t.z) + 1 - t.y) * Math.min(1, dt * 5);
    const bound = world.half + 2400;
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -bound, bound);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -bound, bound);
    const floor = world.heightAt(camera.position.x, camera.position.z) + 2;
    if (camera.position.y < floor) camera.position.y = floor;

    if (sky.update(dt, camera)) {
      shadowDirty = true;
      ground.material.emissiveIntensity = sky.night * .9;
      setStreetLights(sky.night);
      landmarks.setNight(sky.night);
    }
    if ((clockTick += dt) > 1) { landmarks.updateHands(); clockTick = 0; }

    // While riding, static shadows stay valid, so they are redrawn only every 25 m of travel.
    const moved = follow ? lastTarget.distanceToSquared(t) > 625 : lastCam.distanceToSquared(camera.position) > 1e-2 || lastTarget.distanceToSquared(t) > 1e-2;
    if (moved || shadowDirty) {
      updateShadowFrustum();
      lastCam.copy(camera.position); lastTarget.copy(t);
      shadowDirty = false;
    }
    updatePins();
    renderer.render(scene, camera);

    // Keep checking, and step the detail down whenever this device can't keep up.
    if (dropped < 3 && ++frames > 12) {
      sampleTime += dt;
      if (frames === 102) {
        const fps = 90 / sampleTime;
        frames = 12; sampleTime = 0;
        if (fps < 32) {
          dropped++;
          renderer.setPixelRatio(sharpness * [.85, .7, .6][dropped - 1]);
          trees.setDensity((low ? (handheld ? .25 : .35) : .75) * [.7, .5, .35][dropped - 1]);
          if (dropped === 3 && handheld) sky.light.castShadow = false; // The last resort: no shadows from the sun.
          shadowDirty = true;
        }
      }
    }
  });

  landmarks.updateHands();
  ground.material.emissiveIntensity = sky.night * .9;
  await new Promise(r => setTimeout(r, 120));
  // A preset requested in the URL settles on the first frames; these follow it.
  setTimeout(() => { setStreetLights(sky.night); landmarks.setNight(sky.night); ground.material.emissiveIntensity = sky.night * .9; }, 80);
  bar.style.width = '100%';
  $('#loader').classList.add('done');
  // About page: opens over the map, so nobody loses their place.
  const about = $('#about');
  document.querySelectorAll('[data-about]').forEach(b => b.addEventListener('click', (e) => { e.preventDefault(); about.showModal(); }));
  about.querySelector('.about-close').addEventListener('click', () => about.close());
  about.addEventListener('click', (e) => { if (e.target === about) about.close(); }); // A click on the backdrop.
  if (location.hash === '#about') about.showModal();

  window.kurunegala = { handheld, audio, renderer, camera, controls, flyTo, sky, trees, scene, traffic, people, lakeside, wildlife, steps, templeRoad, places, groundPoint };
}

main().catch((error) => {
  console.error(error);
  status.textContent = /WebGL/i.test(error.message) ? 'This view needs a browser with WebGL enabled.' : 'The scene could not load. Reload the page, or check that the local server is running.';
  bar.style.background = '#d9694f';
});

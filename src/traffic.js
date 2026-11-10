// Simulated traffic that drives on the left along the real road network.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { mulberry, shared } from './world.js';
import { sampleLink } from './streets.js';

/** Prepares a geometry for merging: baked colour, plus how much the per-instance colour applies. */
export function part(geometry, hex, paint = 0) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
  const n = g.attributes.position.count, c = new THREE.Color(hex);
  const colors = new Float32Array(n * 3), paints = new Float32Array(n).fill(paint);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aPaint', new THREE.BufferAttribute(paints, 1));
  return g;
}

/** Applies the instance colour only where aPaint says so, leaving tyres and windows dark. */
export function paintVertexShader(source) {
  return source
    .replace('#include <common>', '#include <common>\nattribute float aPaint;')
    .replace('#include <color_vertex>', '#include <color_vertex>\nvColor = mix(color, color * instanceColor, aPaint);');
}

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
function taperedBox(w, h, d, x, y, z, topW, topD) {
  const g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * topW); p.setZ(i, p.getZ(i) * topD); }
  g.computeVertexNormals();
  return g.translate(x, y + h / 2, z);
}
const wheel = (r, width, x, z) => new THREE.CylinderGeometry(r, r, width, 10).rotateZ(Math.PI / 2).translate(x, r, z);

const TYRE = '#191919', GLASS = '#1d2a33', TRIM = '#262626', LAMP = '#f4edd2', BRAKE = '#a31919', SKIN = '#7a5136';

// People seen through dark glass, drawn as thin shapes on the window. 'side' faces sideways, 'front' faces forwards.
const SHIRTS = ['#d8ccb8', '#7f93a8', '#b98a6a', '#e4e0d6', '#8c9a7c'];
function seated(view, x, y, z, tilt = 0, shirt = 0) {
  const thin = .012, cloth = SHIRTS[shirt % SHIRTS.length];
  const flat = (w, h, cy) => (view === 'side' ? new THREE.BoxGeometry(thin, h, w) : new THREE.BoxGeometry(w, h, thin)).translate(0, cy, 0);
  const round = (r, cy) => (view === 'side' ? new THREE.CylinderGeometry(r, r, thin, 14).rotateZ(Math.PI / 2) : new THREE.CylinderGeometry(r, r, thin, 14).rotateX(Math.PI / 2)).translate(0, cy, 0);
  return [[flat(.4, .2, -.08), cloth], [flat(.09, .06, .05), '#6d4a33'], [round(.105, .17), '#6d4a33'], [round(.112, .225).scale(1, .8, 1).translate(0, .05, 0), '#17130f']]
    .map(([g, hex]) => part((view === 'side' ? g.rotateZ(tilt) : g.rotateX(tilt)).translate(x, y, z), hex));
}

function buildModels() {
  const tuk = mergeGeometries([
    part(box(1.3, .62, 1.75, 0, .32, -.4), '#ffffff', 1),
    part(taperedBox(1.05, .75, .7, 0, .3, 1, .7, .75), '#ffffff', 1),
    part(box(.86, .55, .05, 0, .98, .95), GLASS),
    part(box(.06, .72, .06, -.56, .94, .74), TRIM), part(box(.06, .72, .06, .56, .94, .74), TRIM),
    part(box(.06, .85, .06, -.61, .94, -1.15), TRIM), part(box(.06, .85, .06, .61, .94, -1.15), TRIM),
    part(box(1.42, .1, 2.15, 0, 1.68, -.2), '#ffffff', 1),
    part(box(1.05, .35, .5, 0, .94, -.75), '#31281f'),
    part(wheel(.24, .16, 0, 1.15), TYRE), part(wheel(.24, .16, -.68, -.8), TYRE), part(wheel(.24, .16, .68, -.8), TYRE),
    // The driver, sitting in the open cab with both hands on the handlebar.
    part(box(.4, .52, .24, 0, .94, .28), '#d8ccb8'),
    part(box(.1, .42, .1, -.23, 1, .46).rotateX(-.5).translate(0, -.06, .42), SKIN), part(box(.1, .42, .1, .23, 1, .46).rotateX(-.5).translate(0, -.06, .42), SKIN),
    part(box(.1, .1, .1, 0, 1.45, .28), SKIN),
    part(new THREE.IcosahedronGeometry(.125, 1).translate(0, 1.54, .3), SKIN),
    part(new THREE.IcosahedronGeometry(.13, 1).scale(1, .72, 1).translate(0, 1.6, .28), '#17130f'),
  ]);
  const bike = mergeGeometries([
    part(box(.28, .32, 1.05, 0, .42, .02), '#ffffff', 1),
    part(box(.22, .14, .55, 0, .76, -.25), '#191919'),
    part(box(.7, .05, .05, 0, 1, .55), TRIM),
    part(wheel(.31, .1, 0, .68), TYRE), part(wheel(.31, .1, 0, -.68), TYRE),
    part(taperedBox(.44, .66, .25, 0, .86, -.12, .85, .9), '#d8ccb8'),
    part(box(.11, .46, .11, -.22, .98, .16).rotateX(-.3), SKIN), part(box(.11, .46, .11, .22, .98, .16).rotateX(-.3), SKIN),
    part(box(.16, .5, .16, -.17, .42, -.03), '#39414d'), part(box(.16, .5, .16, .17, .42, -.03), '#39414d'),
    part(new THREE.IcosahedronGeometry(.17, 1).translate(0, 1.67, -.12), '#ffffff', 1),
  ]);
  const carBody = [
    part(box(1.76, .55, 4.2, 0, .3, 0), '#ffffff', 1),
    part(taperedBox(1.6, .58, 2.25, 0, .85, -.25, .84, .72), '#ffffff', 1),
    part(taperedBox(1.63, .42, 2.05, 0, .91, -.25, .86, .8), GLASS),
    part(box(1.5, .07, .03, 0, .55, 2.1), TRIM),
    part(wheel(.31, .2, -.84, 1.3), TYRE), part(wheel(.31, .2, .84, 1.3), TYRE), part(wheel(.31, .2, -.84, -1.3), TYRE), part(wheel(.31, .2, .84, -1.3), TYRE),
  ];
  const car = mergeGeometries([...carBody,
    ...seated('side', -.748, 1.08, .05, -.267), ...seated('side', .748, 1.08, .05, .267, 1),
    ...seated('front', -.38, 1.08, .672, -.454), ...seated('front', .38, 1.08, .672, -.454, 1),
  ]);
  const parkedCar = mergeGeometries(carBody);
  const van = mergeGeometries([
    part(box(1.9, 1.75, 4.9, 0, .34, 0), '#ffffff', 1),
    part(box(1.94, .62, 3.75, 0, 1.2, -.45), GLASS),
    part(taperedBox(1.75, .5, .05, 0, 1.25, 2.46, .9, 1), GLASS),
    part(wheel(.34, .22, -.92, 1.55), TYRE), part(wheel(.34, .22, .92, 1.55), TYRE), part(wheel(.34, .22, -.92, -1.55), TYRE), part(wheel(.34, .22, .92, -1.55), TYRE),
    ...seated('side', -.977, 1.48, 1, 0, 2), ...seated('side', .977, 1.48, 1, 0, 3),
    ...seated('front', -.42, 1.48, 2.5, 0, 2), ...seated('front', .42, 1.48, 2.5, 0, 3),
  ]);
  const bus = mergeGeometries([
    part(box(2.48, 2.75, 11, 0, .45, 0), '#ffffff', 1),
    part(box(2.5, .28, 11.02, 0, 1.4, 0), '#f1eadb'),
    part(box(2.52, .86, 10, 0, 1.92, -.2), GLASS),
    part(box(2.15, 1.05, .06, 0, 1.7, 5.5), GLASS),
    part(box(2.3, .12, 10.6, 0, 3.2, 0), '#d8d5ca'),
    part(wheel(.5, .3, -1.15, 3.6), TYRE), part(wheel(.5, .3, 1.15, 3.6), TYRE), part(wheel(.5, .3, -1.15, -3.4), TYRE), part(wheel(.5, .3, 1.15, -3.4), TYRE),
    ...seated('front', -.62, 2.25, 5.54, 0, 1),
    ...seated('side', -1.267, 2.25, 4.1, 0, 1),
    // Passengers along both rows of windows, with a few empty seats.
    ...[-4.2, -3, -1.8, -.6, .6, 1.8, 3].flatMap((z, i) => [
      ...(i % 3 === 2 ? [] : seated('side', -1.267, 2.25, z, 0, i)),
      ...(i % 4 === 1 ? [] : seated('side', 1.267, 2.25, z + .25, 0, i + 2)),
    ]),
  ]);
  return { tuk, bike, car, van, bus, parkedCar };
}

// Lamps are placed per type: [half-width, height, half-length].
const TYPES = [
  { name: 'tuk', share: .45, length: 2.8, speed: .85, lane: .28, lamp: [0, .95, 1.35], colors: ['#b5281e', '#1d4f9c', '#176b45', '#7c1f33', '#c79322', '#20242b'] },
  { name: 'bike', share: .25, length: 2, speed: 1.08, lane: .36, lamp: [0, .95, .95], colors: ['#d9d7d0', '#20242b', '#b5281e', '#1d4f9c', '#c79322'] },
  { name: 'car', share: .17, length: 4.4, speed: 1, lane: .25, lamp: [.65, .68, 2.12], colors: ['#ece9e1', '#b8bbbe', '#20242b', '#7a1d22', '#27477e', '#5c6166'] },
  { name: 'van', share: .07, length: 5.1, speed: .92, lane: .25, lamp: [.7, .78, 2.47], colors: ['#f0ede4', '#d7d8d4', '#a8adb0'] },
  { name: 'bus', share: .06, length: 11.2, speed: .82, lane: .24, lamp: [.95, .9, 5.55], colors: ['#a92623', '#b8302a', '#c2482c', '#25558c', '#c98b23'] },
];

/** Flattened copy of a mesh along the sun's direction. It shares the mesh's instance matrices, so it never lags. */
export function attachGroundShadow(mesh, scene, swingShader = '') {
  const material = new THREE.ShaderMaterial({
    uniforms: { uSun: shared.uSun, uShadow: shared.uShadow, uTime: shared.uTime, uRain: shared.uRain },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    stencilWrite: true, stencilFunc: THREE.NotEqualStencilFunc, stencilRef: 1, stencilZPass: THREE.ReplaceStencilOp,
    vertexShader: `
      uniform vec3 uSun; uniform float uTime, uRain;
      ${swingShader ? 'attribute float aPivot, aRate, aAmp; attribute vec2 aSwing; attribute vec4 aBody;' : ''}
      void main() {
        vec3 p = position;
        ${swingShader}
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.);
        float base = instanceMatrix[3].y, h = max(0., w.y - base);
        w.xz -= uSun.xz / max(uSun.y, .16) * h;
        w.y = base + .04;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: 'uniform float uShadow; void main() { gl_FragColor = vec4(.02, .03, .05, uShadow); }',
  });
  const shadow = new THREE.InstancedMesh(mesh.geometry, material, mesh.count);
  shadow.instanceMatrix = mesh.instanceMatrix;
  shadow.frustumCulled = false;
  shadow.renderOrder = 2;
  scene.add(shadow);
  return shadow;
}

// Overall traffic pace: scales every vehicle's cruising speed and the town speed limit.
const PACE = 1.15;
const FEEL = {
  tuk: { width: 1.4, accel: 2, radius: 3.8, stopEvery: [350, 1300], dwell: [3, 7] },
  bike: { width: .75, accel: 3.6, radius: 3, stopEvery: null },
  car: { width: 1.76, accel: 2.8, radius: 5.2, stopEvery: null },
  van: { width: 1.9, accel: 2.1, radius: 6, stopEvery: null },
  bus: { width: 2.5, accel: 1.15, radius: 9, stopEvery: [450, 900], dwell: [6, 12] },
};

export function buildTraffic(world, scene, streets, { total = 500 } = {}) {
  const rand = mulberry(4242);
  const clock = world.landmarks.clock;
  const links = streets.links;
  const between = ([a, b]) => a + rand() * (b - a);

  function chooseNext(link, v) {
    let options = link.nexts;
    if (v.type.name === 'bus') options = options.filter(l => !l.edge.temple); // Buses stay off the temple road.
    if (!options.length) options = link.nexts;
    if (v.type.length > 5) {
      const wide = options.filter(l => l.edge.w >= 6);
      if (wide.length) options = wide;
    }
    const a = sampleLink(link, link.len, {}), b = {};
    let sum = 0;
    const weights = options.map(l => {
      sampleLink(l, 0, b);
      const straight = a.tx * b.tx + a.tz * b.tz;
      const d = Math.hypot(l.to.x - clock.x, l.to.z - clock.z);
      const w = l.edge.w * l.edge.w * (straight > .8 ? 2.2 : straight > .2 ? 1 : .35) * (d > 1900 ? .04 : d > 1400 ? .3 : 1) * (l.edge.temple && !link.edge.temple ? 3.5 : 1);
      sum += w;
      return w;
    });
    let pick = rand() * sum;
    for (let i = 0; i < options.length; i++) if ((pick -= weights[i]) <= 0) return options[i];
    return options[0];
  }

  function spawnTable(list) {
    let sum = 0;
    const table = list.map(l => {
      const d = Math.hypot((l.from.x + l.to.x) / 2 - clock.x, (l.from.z + l.to.z) / 2 - clock.z);
      sum += l.len * l.edge.w * l.edge.w * Math.exp(-d / 800);
      return sum;
    });
    return () => {
      const r = rand() * sum;
      let lo = 0, hi = table.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (table[mid] < r) lo = mid + 1; else hi = mid; }
      return list[lo];
    };
  }
  const pickAny = spawnTable(links), pickWide = spawnTable(links.filter(l => l.edge.w >= 6));

  const models = buildModels();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: .08, envMapIntensity: 1 });
  material.onBeforeCompile = (s) => { s.vertexShader = paintVertexShader(s.vertexShader); };

  const vehicles = [], color = new THREE.Color();
  const p = { x: 0, z: 0, tx: 0, tz: 0 }, q = { x: 0, z: 0, tx: 0, tz: 0 };

  function laneOffset(v, link) {
    const { w, oneway } = link.edge;
    if (oneway) return w >= 9 ? v.side * w * .2 : 0;
    return Math.max(1.35, w * v.type.lane);
  }
  function laneAt(v, s, out) {
    let link = v.link, d = s;
    if (d > link.len) { d = Math.min(d - link.len, v.next.len); link = v.next; }
    sampleLink(link, d, out);
    const off = laneOffset(v, link);
    out.x += out.tz * off; out.z -= out.tx * off;
    return out;
  }
  const isClear = (v, list) => list.every(o => o === v || Math.hypot(o.x - v.x, o.z - v.z) > (o.type.length + v.type.length) / 2 + 7);
  function placeOnRoad(v, list) {
    for (let tries = 0; tries < 80; tries++) {
      v.link = v.type.length > 5 ? pickWide() : pickAny();
      v.s = rand() * v.link.len;
      v.next = chooseNext(v.link, v);
      laneAt(v, v.s, p);
      v.x = p.x; v.z = p.z;
      if (isClear(v, list)) break;
    }
    sampleLink(v.link, v.s, q);
    v.heading = Math.atan2(q.tx, q.tz);
    v.speed = 0; v.wait = 0;
  }

  let id = 0;
  for (const type of TYPES) {
    const count = Math.max(1, Math.round(total * type.share));
    const mesh = new THREE.InstancedMesh(models[type.name], material, count);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
    type.mesh = mesh;
    type.feel = FEEL[type.name];
    for (let i = 0; i < count; i++) {
      mesh.setColorAt(i, color.set(type.colors[(rand() * type.colors.length) | 0]));
      const v = {
        id: id++, type, slot: i, s: 0, speed: 0, wait: 0, pace: .78 + rand() * .42, rank: rand(), side: rand() < .5 ? 1 : -1,
        f1: .25 + rand() * .5, f2: .7 + rand() * .9, p1: rand() * 6.28, p2: rand() * 6.28, holds: [], dwell: 0,
        stopIn: type.feel.stopEvery ? between(type.feel.stopEvery) : Infinity, x: 0, y: 0, z: 0, heading: 0, pinned: false, active: true,
      };
      placeOnRoad(v, vehicles);
      vehicles.push(v);
    }
    mesh.instanceColor.needsUpdate = true;
    attachGroundShadow(mesh, scene);
  }

  // Cars parked behind the temple.
  if (world.templeParking?.length) {
    const spots = world.templeParking, parked = new THREE.InstancedMesh(models.parkedCar, material, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), c = new THREE.Vector3();
    spots.forEach((spot, i) => {
      parked.setMatrixAt(i, m.compose(c.set(spot.x, world.heightAt(spot.x, spot.z) + .1, spot.z), q.setFromAxisAngle(up, spot.heading), s));
      parked.setColorAt(i, color.set(TYPES[2].colors[i % TYPES[2].colors.length]));
    });
    parked.receiveShadow = true;
    parked.computeBoundingSphere();
    parked.frustumCulled = false;
    scene.add(parked);
    attachGroundShadow(parked, scene);
  }

  // --- Traffic lights ---------------------------------------------------------
  const poleParts = [], heads = streets.signals.flatMap(s => s.approaches);
  const lampGeometry = new THREE.SphereGeometry(.14, 10, 8);
  const lampMesh = new THREE.InstancedMesh(lampGeometry, new THREE.MeshBasicMaterial({ toneMapped: false }), Math.max(1, heads.length * 3));
  const lampMatrix = new THREE.Matrix4();
  const LIGHT = { red: new THREE.Color(3, .18, .12), amber: new THREE.Color(3, 1.6, .1), green: new THREE.Color(.15, 2.6, .8), off: new THREE.Color(.05, .05, .05) };
  heads.forEach((h, i) => {
    const roadside = h.oneway ? h.w / 2 + .9 : h.w / 2 + .9;
    const x = h.x + h.tz * roadside, z = h.z - h.tx * roadside, y = world.heightAt(x, z);
    h.lampBase = i * 3;
    const angle = Math.atan2(-h.tx, -h.tz);
    poleParts.push(part(new THREE.CylinderGeometry(.07, .09, 4.3, 8).translate(x, y + 2.15, z), '#2b2d2e'));
    poleParts.push(part(new THREE.BoxGeometry(.42, 1.15, .3).rotateY(angle).translate(x, y + 4.5, z), '#1b1c1d'));
    [.36, 0, -.36].forEach((rise, n) => {
      lampMatrix.makeTranslation(x - h.tx * .17, y + 4.5 + rise, z - h.tz * .17);
      lampMesh.setMatrixAt(i * 3 + n, lampMatrix);
      lampMesh.setColorAt(i * 3 + n, LIGHT.off);
    });
  });
  if (poleParts.length) {
    const poles = new THREE.Mesh(mergeGeometries(poleParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .6 }));
    poles.castShadow = poles.receiveShadow = true;
    scene.add(poles);
  }
  lampMesh.frustumCulled = false;
  lampMesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
  scene.add(lampMesh);

  let clockTime = 0;
  function signalState(signal, phase) {
    const { green, amber, clear, offset } = signal, half = green + amber + clear;
    let t = (clockTime + offset) % (half * 2);
    if (phase === 1) t = (t + half) % (half * 2);
    return t < green ? 'green' : t < green + amber ? 'amber' : 'red';
  }
  function updateSignals() {
    let changed = false;
    for (const signal of streets.signals) for (const a of signal.approaches) {
      const state = signalState(signal, a.phase);
      if (state === a.state) continue;
      a.state = state; changed = true;
      ['red', 'amber', 'green'].forEach((name, n) => lampMesh.setColorAt(a.lampBase + n, name === state ? LIGHT[name] : LIGHT.off));
    }
    if (changed && lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true;
  }

  // Head and tail lamps share one additive sprite and appear only after dark.
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 48;
  const ctx = sprite.getContext('2d', { willReadFrequently: true });
  const gradient = ctx.createRadialGradient(24, 24, 0, 24, 24, 24);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(.28, 'rgba(255,255,255,.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 48, 48);
  const glow = new THREE.CanvasTexture(sprite);
  const lamps = (hex, size) => {
    const position = new THREE.BufferAttribute(new Float32Array(vehicles.length * 6), 3).setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry().setAttribute('position', position);
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ map: glow, color: hex, size, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false }));
    points.frustumCulled = false; points.visible = false;
    scene.add(points);
    return { points, position };
  };
  const headLamps = lamps('#fff0c4', 1.5), tailLamps = lamps('#ff2a18', .9);
  function writeLamps(v, i) {
    const [w, h, l] = v.type.lamp, sin = Math.sin(v.heading), cos = Math.cos(v.heading);
    const set = (attr, index, side, along) => attr.setXYZ(index, v.x + sin * along + cos * side, v.active ? v.y + h : -9999, v.z + cos * along - sin * side);
    set(headLamps.position, i * 2, -w, l); set(headLamps.position, i * 2 + 1, w, l);
    set(tailLamps.position, i * 2, -w, -l); set(tailLamps.position, i * 2 + 1, w, -l);
  }

  // --- Driving ------------------------------------------------------------------
  const crossers = []; // People on the road right now; vehicles stop for them.
  const CELL = 18;
  let grid = new Map();
  const cellKey = (i, j) => (i + 4000) * 8000 + j + 4000;
  function rebuildGrid() {
    grid = new Map();
    for (const v of vehicles) {
      if (!v.active) continue;
      const k = cellKey(Math.floor(v.x / CELL), Math.floor(v.z / CELL));
      if (grid.has(k)) grid.get(k).push(v); else grid.set(k, [v]);
    }
  }
  function forEachNear(x, z, fn) {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const list = grid.get(cellKey(ci + i, cj + j));
      if (list) for (const o of list) fn(o);
    }
  }
  /** Is o in v's path? Returns the clear distance to it, or Infinity. */
  function gapTo(v, o, sin, cos) {
    const dx = o.x - v.x, dz = o.z - v.z;
    const along = dx * sin + dz * cos, lateral = Math.abs(dx * cos - dz * sin);
    if (along <= 0) return Infinity;
    const diff = o.heading - v.heading, c = Math.abs(Math.cos(diff)), s2 = Math.abs(Math.sin(diff));
    const oLong = o.type.length / 2 * c + o.type.feel.width / 2 * s2, oWide = o.type.length / 2 * s2 + o.type.feel.width / 2 * c;
    if (lateral > v.type.feel.width / 2 + oWide + .3) return Infinity;
    if (Math.cos(diff) < -.45 && lateral > .9) return Infinity; // Oncoming traffic in its own lane.
    return along - v.type.length / 2 - oLong;
  }
  const stopProfile = (distance, brake = 3.2) => Math.sqrt(2 * brake * Math.max(0, distance));

  function releaseHolds(v) {
    for (const h of v.holds) if (h.node.holder === v) h.node.holder = null;
    v.holds.length = 0;
  }

  function drive(v, dt, camera) {
    const feel = v.type.feel, length = v.type.length;
    const sin = Math.sin(v.heading), cos = Math.cos(v.heading);
    if (v.dwell > 0) {
      v.dwell -= dt;
      v.speed = Math.max(0, v.speed - 5 * dt);
      if (v.dwell <= 0) v.stopIn = feel.stopEvery ? between(feel.stopEvery) : Infinity;
      return;
    }

    const w = v.link.edge.w;
    const road = (w >= 10 ? 13.5 : w >= 8 ? 11 : w >= 6 ? 8.5 : 6) * v.type.speed * v.pace * PACE;
    // Drivers ease off and speed up all the time rather than holding one speed.
    let target = road * (1 + .17 * Math.sin(clockTime * v.f1 + v.p1) + .09 * Math.sin(clockTime * v.f2 + v.p2));

    target = Math.min(target, (v.link.edge.temple ? 6.6 : 13.2) * PACE); // About 55 km/h in town, much slower on the temple road.

    // Slow for bends and turns ahead, more for long vehicles.
    laneAt(v, v.s + 17, q);
    const toward = Math.atan2(q.x - v.x, q.z - v.z);
    const bend = Math.abs(Math.atan2(Math.sin(toward - v.heading), Math.cos(toward - v.heading)));
    target = Math.min(target, Math.max(length > 8 ? 2.6 : 3.4, road * (1 - bend / .95)));

    // Traffic lights on this link and the next.
    let held = false;
    for (const [link, before] of [[v.link, 0], [v.next, v.link.len]]) {
      if (!link.signal) continue;
      const a = link.signal.approach;
      const stop = before + a.stopS - v.s - length / 2 - .5;
      if (stop < -1.5 || a.state === 'green') continue;
      if (a.state === 'red' || stop > v.speed * v.speed / 7) {
        target = Math.min(target, stop < .15 ? 0 : stopProfile(stop));
        if (stop < 25) held = true;
      }
    }

    // One vehicle at a time through unsignalled junctions.
    const toEnd = v.link.len - v.s, node = v.link.to;
    if (!node.signal && node.out.filter(l => l.alive).length + node.in.filter(l => l.alive).length > 3 && toEnd < 11 + v.speed * .6) {
      if (!node.holder || node.holder === v) {
        if (!node.holder) { node.holder = v; v.holds.push({ node, from: v.link, to: v.next }); }
      } else {
        target = Math.min(target, stopProfile(toEnd - length / 2 - 4));
        held = held || toEnd < 18;
      }
    }

    // Anything physically ahead, on any road.
    let gap = Infinity;
    forEachNear(v.x, v.z, (o) => {
      if (o === v) return;
      const d = gapTo(v, o, sin, cos);
      if (d === Infinity) return;
      // When two vehicles each have the other ahead, one of them gives way.
      const os = Math.sin(o.heading), oc = Math.cos(o.heading);
      if (gapTo(o, v, os, oc) !== Infinity && v.id < o.id && d > .8) return;
      gap = Math.min(gap, d);
    });
    for (const c of crossers) {
      const dx = c.x - v.x, dz = c.z - v.z, along = dx * sin + dz * cos;
      if (along > 0 && along < 34 && Math.abs(dx * cos - dz * sin) < feel.width / 2 + 1.1) gap = Math.min(gap, along - length / 2 - .9);
    }
    if (gap < Infinity) target = Math.min(target, Math.max(0, (gap - 2) / 1.05));

    // Stops for passengers.
    if (feel.stopEvery) {
      if (v.stopIn < 28 && (w < (length > 8 ? 7 : 5) || toEnd < 42)) v.stopIn = 60;
      if (v.stopIn < 28) target = Math.min(target, stopProfile(v.stopIn, 1.8));
      if (v.stopIn < .4 && v.speed < .4) { v.dwell = between(feel.dwell); return; }
    }

    const brake = gap < 3 ? 14 : 6;
    v.speed += THREE.MathUtils.clamp(target - v.speed, -brake * dt, feel.accel * dt);
    if (gap < 1.2) v.speed = 0;
    v.speed = Math.max(0, v.speed);

    // Pure-pursuit steering: the vehicle follows an arc towards a point on its lane.
    const look = Math.max(length * .75 + 2, 3.8 + v.speed * .55);
    laneAt(v, v.s + look, q);
    const error = Math.atan2(Math.sin(Math.atan2(q.x - v.x, q.z - v.z) - v.heading), Math.cos(Math.atan2(q.x - v.x, q.z - v.z) - v.heading));
    const curvature = THREE.MathUtils.clamp(2 * Math.sin(error) / look, -1 / feel.radius, 1 / feel.radius);
    v.heading += curvature * v.speed * dt;
    v.x += Math.sin(v.heading) * v.speed * dt;
    v.z += Math.cos(v.heading) * v.speed * dt;

    sampleLink(v.link, Math.min(v.s, v.link.len), p);
    const follow = Math.max(.35, Math.sin(v.heading) * p.tx + Math.cos(v.heading) * p.tz);
    v.s += v.speed * dt * follow;
    if (v.stopIn !== Infinity) v.stopIn -= v.speed * dt;

    while (v.s >= v.link.len) {
      v.s -= v.link.len;
      v.link = v.next;
      v.next = chooseNext(v.link, v);
    }
    for (let i = v.holds.length - 1; i >= 0; i--) {
      const h = v.holds[i];
      if (v.link !== h.from && (v.link !== h.to || v.s > Math.min(h.to.len - .5, length + 5))) {
        if (h.node.holder === v) h.node.holder = null;
        v.holds.splice(i, 1);
      }
    }

    // A rare gridlock clears away from view, never by driving through anything.
    v.wait = v.speed < .25 && !held ? v.wait + dt : 0;
    if (v.wait > 22 && !v.pinned && camera.position.distanceTo(pos.set(v.x, v.y, v.z)) > 180) {
      releaseHolds(v);
      placeOnRoad(v, vehicles.filter(o => o !== v && o.active));
      v.respawns = (v.respawns || 0) + 1;
    }
  }

  const matrix = new THREE.Matrix4(), quat = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ'), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  function writeMatrix(v) {
    const half = v.type.length * .45, sin = Math.sin(v.heading), cos = Math.cos(v.heading);
    const front = world.heightAt(v.x + sin * half, v.z + cos * half), back = world.heightAt(v.x - sin * half, v.z - cos * half);
    v.y = (front + back) / 2 + .1;
    euler.set(-Math.atan2(front - back, half * 2), v.heading, 0);
    v.type.mesh.setMatrixAt(v.slot, matrix.compose(pos.set(v.x, v.y, v.z), quat.setFromEuler(euler), one));
  }

  let lastNight = -1;
  updateSignals();
  rebuildGrid();
  for (const v of vehicles) writeMatrix(v);

  return {
    vehicles, crossers, links,
    update(dt, night, camera) {
      clockTime += dt;
      updateSignals();
      const share = 1 - .62 * night;
      for (const v of vehicles) {
        const was = v.active;
        v.active = v.pinned || v.rank < share;
        if (was && !v.active) releaseHolds(v);
      }
      rebuildGrid();
      vehicles.forEach((v, i) => {
        if (v.active) { drive(v, dt, camera); writeMatrix(v); }
        else v.type.mesh.setMatrixAt(v.slot, hidden);
        if (night > .02) writeLamps(v, i);
      });
      for (const type of TYPES) type.mesh.instanceMatrix.needsUpdate = true;
      if (night !== lastNight) {
        lastNight = night;
        for (const l of [headLamps, tailLamps]) { l.points.visible = night > .02; l.points.material.opacity = Math.min(1, night * 1.1); }
      }
      if (night > .02) headLamps.position.needsUpdate = tailLamps.position.needsUpdate = true;
    },
    /** True when nobody is close enough to make stepping onto the road unsafe. */
    roadClear(x0, z0, x1, z1) {
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      let clear = true;
      forEachNear(mx, mz, (o) => {
        if (!clear) return;
        const d = Math.hypot(o.x - mx, o.z - mz);
        if ((d < 26 && o.speed > 1) || d < (o.type.length / 2) + 5) clear = false;
      });
      return clear;
    },
    nearest(kind, x, z) {
      let best = null, bestD = Infinity;
      for (const v of vehicles) {
        if (v.type.name !== kind || !v.active) continue;
        const d = Math.hypot(v.x - x, v.z - z);
        if (d < bestD) { bestD = d; best = v; }
      }
      return best;
    },
    stats() {
      rebuildGrid();
      const active = vehicles.filter(v => v.active);
      let overlaps = 0;
      for (const v of active) {
        const sin = Math.sin(v.heading), cos = Math.cos(v.heading);
        forEachNear(v.x, v.z, (o) => {
          if (o.id <= v.id) return;
          const dx = o.x - v.x, dz = o.z - v.z, along = Math.abs(dx * sin + dz * cos), lateral = Math.abs(dx * cos - dz * sin);
          const c = Math.abs(Math.cos(o.heading - v.heading)), s = Math.abs(Math.sin(o.heading - v.heading));
          if (along < v.type.length / 2 + o.type.length / 2 * c + o.type.feel.width / 2 * s - .25 && lateral < v.type.feel.width / 2 + o.type.length / 2 * s + o.type.feel.width / 2 * c - .25) overlaps++;
        });
      }
      const speeds = active.map(v => v.speed);
      return {
        links: links.length, signals: streets.signals.length, approaches: heads.length, crossings: streets.crossings.length, sidewalks: streets.sidewalks.length,
        active: active.length, moving: speeds.filter(s => s > .5).length, minSpeed: +Math.min(...speeds).toFixed(1), maxSpeed: +Math.max(...speeds).toFixed(1), meanSpeed: +(speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1),
        overlaps, longestWait: +Math.max(...active.map(v => v.wait)).toFixed(1), respawns: vehicles.reduce((a, v) => a + (v.respawns || 0), 0),
        onRock: active.filter(v => { const i = Math.round((v.x + world.half) / world.cell), j = Math.round((v.z + world.half) / world.cell); return world.rock[j * world.N + i] > 90 && !v.link.edge.temple; }).length,
        templeVehicles: active.filter(v => v.link.edge.temple).length, busesOnTemple: active.filter(v => v.link.edge.temple && v.type.name === 'bus').length,
        invalid: vehicles.filter(v => !Number.isFinite(v.x + v.y + v.z + v.heading)).length,
      };
    },
  };
}

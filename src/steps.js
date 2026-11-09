// The stairway up Elephant Rock, following the mapped steps and joining them to the statue.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { mulberry, shared } from './world.js';
import { part } from './traffic.js';
import { createCrowd, personGeometry, turnToward } from './people.js';

const RISE = .17, WIDTH = 2.4, BACK_WIDTH = 6.4, PATH_WIDTH = 4, STEP_DEPTH = 2;

function smooth(values, radius, passes) {
  let a = values;
  for (let p = 0; p < passes; p++) a = a.map((_, i) => {
    let sum = 0, count = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(a.length - 1, i + radius); k++) { sum += a[k]; count++; }
    return sum / count;
  });
  return a;
}

/** One point per metre along a polyline. */
function perMetre(route) {
  const raw = [];
  for (let i = 1; i < route.length; i++) {
    const [ax, az] = route[i - 1], [bx, bz] = route[i], len = Math.hypot(bx - ax, bz - az);
    for (let d = 0; d < len; d += 1) raw.push([ax + (bx - ax) * d / len, az + (bz - az) * d / len]);
  }
  raw.push(route[route.length - 1]);
  return raw;
}

/** Each tread is placed exactly where the climb reaches its height. */
function placeTreads(ys) {
  const treads = [];
  let level = ys[0];
  for (let i = 1; i < ys.length; i++) {
    while (ys[i] >= level + RISE) {
      level += RISE;
      const span = ys[i] - ys[i - 1] || 1, t = Math.max(0, Math.min(1, (level - ys[i - 1]) / span));
      treads.push({ s: i - 1 + t, y: level });
    }
  }
  return treads;
}

/** Runs before the ground is built, so the rock can be shaped to the stairway. */
export function prepareSteps(world) {
  const { statue, clock } = world.landmarks;
  const near = (r) => Math.min(...r.p.map(([x, z]) => Math.hypot(x - statue.x, z - statue.z)));
  const stairs = world.roads.filter(r => r.c === 'steps').sort((a, b) => near(a) - near(b))[0];
  let route = [...stairs.p];
  const startsHigh = world.heightAt(...route[0]) > world.heightAt(...route[route.length - 1]);
  if (startsHigh) route.reverse();

  // The mapped footpath that reaches the bottom of the stairs.
  const bottom = route[0];
  const approach = world.roads.find(r => r !== stairs && r.w < 3 && r.p.some(([x, z]) => x === bottom[0] && z === bottom[1]));
  if (approach) {
    const pts = [...approach.p];
    if (pts[0][0] === bottom[0] && pts[0][1] === bottom[1]) pts.reverse();
    route = [...pts.slice(0, -1), ...route];
  }

  // The stairs end at the edge of a flat terrace in front of the statue, not at the statue itself.
  const away = Math.hypot(statue.x - clock.x, statue.z - clock.z);
  const Fx = (clock.x - statue.x) / away, Fz = (clock.z - statue.z) / away;
  const T = { f0: 17, f1: 56, half: 25, y: statue.y - 9, Fx, Fz }; // The rock falls away here, so the terrace sits below the statue's base.
  const fOf = ([x, z]) => (x - statue.x) * Fx + (z - statue.z) * Fz, sOf = ([x, z]) => (x - statue.x) * Fz - (z - statue.z) * Fx;
  const onTerrace = (p, m = 0) => { const f = fOf(p), si = sOf(p); return f >= T.f0 - m && f <= T.f1 + m && Math.abs(si) <= T.half + m; };
  const firstInside = route.findIndex(p => onTerrace(p, 1));
  if (firstInside > 0) route = route.slice(0, firstInside);
  const onPlan = (f, si) => [statue.x + Fx * f + Fz * si, statue.z + Fz * f - Fx * si];
  // The mapped stairs arrive at the terrace's left side (facing the statue). They end square-on at a gateway.
  T.gateF = Math.max(T.f0 + 10, Math.min(T.f1 - 6, fOf(route[route.length - 1])));
  T.backS = -21; // The walkway from the rear stairs reaches the terrace on the right as you look at the statue from behind.
  const backSide = Math.sign(T.backS);
  route[route.length - 1] = onPlan(T.gateF, -T.half - 8);
  route.push(onPlan(T.gateF, -T.half), onPlan(T.gateF, -T.half + 3), onPlan(36, -11));

  // One point per metre, gently smoothed.
  const raw = perMetre(route);
  const xs = smooth(raw.map(p => p[0]), 2, 2), zs = smooth(raw.map(p => p[1]), 2, 2);

  // A climb that never dips, and arrives at the top of the statue's platform.
  const n = xs.length, arrive = T.y;
  const landing = xs.findIndex((x, i) => sOf([x, zs[i]]) > -T.half - 4.5); // Where the steps reach the landing outside the gateway.
  let ys = smooth(xs.map((x, i) => world.heightAt(x, zs[i])), 9, 2);
  ys = ys.map((y, i) => { const t = Math.min(1, Math.max(0, (i - (landing - 60)) / 59)); return y + (arrive - y) * t; });
  for (let i = 1; i < n; i++) ys[i] = Math.max(ys[i], ys[i - 1]);

  const { N, half, cell, heights } = world;

  // Level ground under the terrace.
  const CORE = 12, SOFT = 16;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const p = [-half + i * cell, -half + j * cell], f = fOf(p), si = sOf(p);
    const d = Math.hypot(Math.max(T.f0 - f, 0, f - T.f1), Math.max(Math.abs(si) - T.half, 0));
    if (d < CORE + SOFT && heights[j * N + i] > T.y - .4) heights[j * N + i] += (T.y - .4 - heights[j * N + i]) * (1 - Math.max(0, (d - CORE) / SOFT)); // Cut only: the land is never raised.
  }

  // From the car park: a wide straight stairway down behind the statue, a small plaza, then a walkway round to the terrace.
  const parkY = statue.y + 5, PLAZA_F = -19, PLAZA_HALF_F = 2.4, PLAZA_HALF_S = 6.5;
  const STAIR_FOOT = PLAZA_F - PLAZA_HALF_F, STAIR_HEAD = -27.4, plazaY = parkY - (STAIR_FOOT - STAIR_HEAD) * .62;
  // The stairs start at the plaza's edge and finish before the car park's; only the landing slides under its rim.
  const stairRaw = perMetre([onPlan(STAIR_FOOT, 0), onPlan(-29.2, 0)]);
  const sx = stairRaw.map(p => p[0]), sz = stairRaw.map(p => p[1]), sn = sx.length;
  const sy = stairRaw.map(p => plazaY + (parkY - plazaY) * Math.max(0, Math.min(1, (STAIR_FOOT - fOf(p)) / (STAIR_FOOT - STAIR_HEAD))));
  const stairRailEnd = stairRaw.findIndex(p => fOf(p) < -28.1);
  // The walkway runs from the terrace's landing to the plaza's side, tucked 3 cm under each so no two surfaces coincide.
  const walkRoute = [onPlan(T.f0 - 4.25, T.backS)];
  for (let a = 65; a <= 150; a += 3) {
    const r = 23 - 2 * (a - 65) / 85, t = a * Math.PI / 180;
    walkRoute.push(onPlan(r * Math.cos(t), backSide * r * Math.sin(t)));
  }
  walkRoute.push(onPlan(PLAZA_F, backSide * (PLAZA_HALF_S + 1.9)), onPlan(PLAZA_F, backSide * (PLAZA_HALF_S - .3)));
  const walkRaw = perMetre(walkRoute);
  const rx = smooth(walkRaw.map(p => p[0]), 2, 2), rz = smooth(walkRaw.map(p => p[1]), 2, 2), rn = rx.length;
  for (const i of [0, rn - 1]) { rx[i] = walkRaw[i][0]; rz[i] = walkRaw[i][1]; }
  const ry = rx.map((_, i) => T.y - .03 + (plazaY - T.y) * (i / (rn - 1)));

  // The land grid is about 10 m apart, so the cut must span a full cell either side or rock pokes between the points.
  const CUT = cell + 1.2, FADE = 9, REACH = CUT + FADE, DEPTH = .9;
  const nearest = new Map();
  const mark = (fx, fz, fy, to) => fx.slice(0, to).forEach((x, p) => {
    const z = fz[p];
    for (let j = Math.max(0, Math.floor((z - REACH + half) / cell)); j <= Math.min(N - 1, Math.ceil((z + REACH + half) / cell)); j++) {
      for (let i = Math.max(0, Math.floor((x - REACH + half) / cell)); i <= Math.min(N - 1, Math.ceil((x + REACH + half) / cell)); i++) {
        const d = Math.hypot(-half + i * cell - x, -half + j * cell - z), k = j * N + i, best = nearest.get(k);
        if (d <= REACH && (!best || d < best.d)) nearest.set(k, { d, y: fy[p] });
      }
    }
  });
  mark(xs, zs, ys, landing);
  mark(sx, sz, sy, sn);
  mark(rx, rz, ry, rn);
  for (const [k, { d, y }] of nearest) heights[k] += (y - DEPTH - heights[k]) * (1 - Math.max(0, (d - CUT) / FADE));

  const groundBelow = world.heightAt;
  world.heightAt = (x, z) => (onTerrace([x, z]) ? T.y : groundBelow(x, z));

  const rearStair = sx.map((x, i) => [x, sz[i]]), walkLine = rx.map((x, i) => [x, rz[i]]);
  (world.keepClear ||= []).push({ line: xs.map((x, i) => [x, zs[i]]), width: 7 }, { line: rearStair, width: 12 }, { line: walkLine, width: 8 }, { circle: [statue.x + Fx * 36, statue.z + Fz * 36], radius: 46 });
  const terraceDots = [];
  for (let f = T.f0; f <= T.f1; f += 9) for (let si = -T.half; si <= T.half; si += 9) terraceDots.push([statue.x + Fx * f + Fz * si, statue.z + Fz * f - Fx * si]);
  world.stairLine = [...(world.stairLine || []), ...xs.map((x, i) => [x, zs[i]]).filter((_, i) => i % 3 === 0), ...terraceDots, ...rearStair.filter((_, i) => i % 3 === 0), ...walkLine.filter((_, i) => i % 3 === 0)];
  world.buildings = world.buildings.filter((b) => !onTerrace([b.p[0], b.p[1]], 4));

  return {
    xs, zs, ys, treads: placeTreads(ys), n, firstStepIndex: approach ? approach.p.length : 0, railEnd: landing, terrace: T,
    back: { xs: sx, zs: sz, ys: sy, treads: placeTreads(sy), n: sn, firstStepIndex: 0, railEnd: stairRailEnd, width: BACK_WIDTH, walled: true },
    walkway: { xs: rx, zs: rz, ys: ry, n: rn, width: PATH_WIDTH },
    plaza: { at: onPlan(PLAZA_F, 0), y: plazaY, Fx, Fz, halfF: PLAZA_HALF_F, halfS: PLAZA_HALF_S, walkSide: backSide },
  };
}

function buildTerrace(world, scene, T, rand, low) {
  const { statue } = world.landmarks, { Fx, Fz, y, f0, f1, half, gateF, backS } = T;
  const parts = [];
  const add = (geo, hex) => parts.push(part(geo, hex));
  const block = (w, h, d, s, base, f, hex) => add(new THREE.BoxGeometry(w, h, d).translate(s, base + h / 2, f), hex);
  const mid = (f0 + f1) / 2, depth = f1 - f0, STONE = '#d9d2c0', PALE = '#efe9da';
  block(half * 2, 1, depth, 0, -1, mid, STONE);
  block(half * 2 + 1, 28, depth + 1, 0, -28.2, mid, '#a79f8d');
  for (let s = -half; s <= half; s += 5) block(.08, .02, depth, s, 0, mid, '#bdb5a2');
  for (let f = f0; f <= f1; f += 5) block(half * 2, .02, .08, 0, 0, f, '#bdb5a2');
  // Low kerb round the edge, open at the two stairways.
  const GAP = 3.25, BACK_GAP = PATH_WIDTH / 2 + .45;
  const kerbF = (s, a, b) => block(.4, .45, b - a, s, 0, (a + b) / 2, PALE);
  const kerbS = (f, a, b) => block(b - a, .45, .4, (a + b) / 2, 0, f, PALE);
  kerbS(f1, -half - .2, half + .2);
  kerbS(f0, -half - .2, backS - BACK_GAP); kerbS(f0, backS + BACK_GAP, half + .2);
  kerbF(half, f0, f1);
  kerbF(-half, f0, gateF - GAP); kerbF(-half, gateF + GAP, f1);

  // Landing and gateway where the main stairway arrives.
  block(4.7, 28, 6.9, -half - 2.35, -28.02, gateF, '#a79f8d');
  block(4.5, .3, 6.5, -half - 2.25, -.3, gateF, STONE);
  for (const f of [gateF - GAP, gateF + GAP]) block(4.5, .45, .4, -half - 2.25, 0, f, PALE);
  for (const f of [gateF - 2.2, gateF + 2.2]) {
    block(1, .3, 1, -half, 0, f, '#c8bea8');
    block(.72, 3.3, .72, -half, .3, f, PALE);
    block(.95, .16, .95, -half, 3.6, f, '#c9a35a');
  }
  block(.7, .34, 6.2, -half, 3.76, gateF, PALE);
  block(.5, .4, 3.4, -half, 4.1, gateF, '#c9a35a');

  // Landing at the head of the car-park stairway, behind the statue.
  block(BACK_GAP * 2 + 1.2, 28, 4.4, backS, -28.02, f0 - 2.2, '#a79f8d');
  block(BACK_GAP * 2 + 1, .3, 4.2, backS, -.3, f0 - 2.2, STONE);
  for (const s of [backS - BACK_GAP, backS + BACK_GAP]) block(.72, 1.5, .72, s, 0, f0, PALE), block(.92, .14, .92, s, 1.5, f0, '#c9a35a');

  // Flower-offering stage directly before the statue.
  block(28, .22, 11, 0, 0, f0 + 6, PALE);
  block(25, .22, 9, 0, .22, f0 + 6, '#f6f1e4');
  block(15, .85, 1.7, 0, .44, f0 + 4.6, '#b8ab90');
  block(15.4, .08, 2, 0, 1.29, f0 + 4.6, '#b83a30');
  const FLOWERS = ['#f7f0dc', '#f1a7bd', '#f7d04a', '#ef8fa8', '#ffffff'];
  for (let i = 0; i < 70; i++) {
    add(new THREE.IcosahedronGeometry(.09 + rand() * .07, 0).translate((rand() - .5) * 14, 1.46, f0 + 4.6 + (rand() - .5) * 1.4), FLOWERS[Math.floor(rand() * FLOWERS.length)]);
  }

  // A small oil-lamp rack on the left, between the stage and the main gateway.
  const flames = [], L0 = 26, L1 = 32.4, LS = -20;
  block(3.4, .08, L1 - L0 + 1.2, LS, 0, (L0 + L1) / 2, '#b8ab90');
  for (const [offset, height] of [[-.65, .55], [.65, .85]]) {
    block(.9, height, L1 - L0, LS + offset, .08, (L0 + L1) / 2, '#8b8474');
    for (let f = L0 + .4; f < L1; f += .62) {
      add(new THREE.CylinderGeometry(.1, .06, .08, 8).translate(LS + offset, height + .12, f), '#c9a058');
      const wx = statue.x + Fx * f + Fz * (LS + offset), wz = statue.z + Fz * f - Fx * (LS + offset);
      flames.push(wx, y + height + .28, wz);
    }
  }

  // A small incense stand on the right, across from the oil lamps on the left: a stone pedestal with a brass tray of sand.
  const embers = [], IF = (L0 + L1) / 2, IS = -LS;
  block(1.9, .08, 3.1, IS, 0, IF, '#b8ab90');
  block(1.1, .72, 2.3, IS, .08, IF, '#8b8474');
  block(1.4, .1, 2.6, IS, .8, IF, '#c9a058');
  block(1.14, .03, 2.34, IS, .9, IF, '#d9cfb6');
  for (let i = 0; i < 26; i++) {
    const s = IS + (rand() - .5) * .9, f = IF + (rand() - .5) * 2, tall = .42 + rand() * .2;
    add(new THREE.CylinderGeometry(.012, .016, tall, 5).translate(0, tall / 2, 0).rotateZ((rand() - .5) * .22).rotateX((rand() - .5) * .22).translate(s, .92, f), '#5c3423');
    embers.push(statue.x + Fx * f + Fz * s, y + .92 + tall, statue.z + Fz * f - Fx * s);
  }

  // Lamp posts around the terrace.
  const posts = [];
  const post = (s, f) => { add(new THREE.CylinderGeometry(.07, .11, 4.4, 8).translate(s, 2.2, f), '#39424a'); add(new THREE.SphereGeometry(.26, 10, 8).translate(s, 4.55, f), '#fbf2d8'); posts.push(statue.x + Fx * f + Fz * s, y + 4.6, statue.z + Fz * f - Fx * s); };
  for (const f of [f0 + 2, 28, 38, 48, f1 - .9]) { if (Math.abs(f - gateF) > 4 && (f > f0 + 3 || backS > 0)) post(-half + .9, f); post(half - .9, f); }
  for (const s of [-12, 0, 12]) post(s, f1 - .9);
  for (const s of [-8, 8]) { add(new THREE.BoxGeometry(.5, .35, .5).translate(s, .3, f0 + 1), '#3a3f44'); posts.push(statue.x + Fx * (f0 + 1) + Fz * s, y + 1, statue.z + Fz * (f0 + 1) - Fx * s); }

  const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .72 }));
  mesh.position.set(statue.x, y, statue.z);
  mesh.rotation.y = Math.atan2(Fx, Fz);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);

  const sprite = document.createElement('canvas'); sprite.width = sprite.height = 48;
  const c = sprite.getContext('2d', { willReadFrequently: true });
  const g = c.createRadialGradient(24, 24, 0, 24, 24, 24);
  g.addColorStop(0, 'rgba(255,245,210,1)'); g.addColorStop(.3, 'rgba(255,190,90,.7)'); g.addColorStop(1, 'rgba(255,140,40,0)');
  c.fillStyle = g; c.fillRect(0, 0, 48, 48);
  const glow = new THREE.CanvasTexture(sprite);
  const dots = (list, size) => {
    const material = new THREE.PointsMaterial({ map: glow, size, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 });
    const points = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(list, 3)), material);
    scene.add(points);
    return { points, material };
  };
  const flameDots = dots(flames, .55), postDots = dots(posts, 7);
  dots(embers, .13).material.opacity = 1;

  // Visitors wander the terrace, stopping to pray at the offering table, the oil lamps and the incense.
  const COUNT = low ? 10 : 16;
  const crowd = createCrowd(scene, personGeometry(), COUNT, rand, { colors: ['#f7f4ec', '#f0ece2', '#f7f4ec', '#e8dfca'] });
  const heading = Math.atan2(Fx, Fz) + Math.PI, m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), yAxis = new THREE.Vector3(0, 1, 0), gone = new THREE.Vector3(0, 0, 0);
  const faceS = (dir) => Math.atan2(Fz * dir, -Fx * dir);
  const stageLift = (s, f) => (Math.abs(s) <= 12.5 && f >= f0 + 1.5 && f <= f0 + 10.5 ? .44 : Math.abs(s) <= 14 && f >= f0 + .5 && f <= f0 + 11.5 ? .22 : 0);
  const between = (a, b) => a + rand() * (b - a);
  const nextSpot = () => {
    const r = rand();
    if (r < .3) return { s: between(-6.5, 6.5), f: f0 + 6.4, face: heading, stay: between(6, 15) };
    if (r < .45) return { s: -17.4, f: between(L0 + .6, L1 - .6), face: faceS(-1), stay: between(5, 12) };
    if (r < .6) return { s: IS - 1.8, f: IF + between(-.9, .9), face: faceS(1), stay: between(5, 12) };
    const f = between(30, 54), wide = f < 35 ? 16 : 22;
    return { s: between(-wide, wide), f, face: null, stay: between(1.5, 7) };
  };
  const visitors = Array.from({ length: COUNT }, (_, i) => {
    const at = nextSpot(), goal = nextSpot();
    crowd.setMotion(i, 0, 0);
    return { s: at.s, f: at.f, lift: stageLift(at.s, at.f), goal, pause: between(0, 9), heading: at.face ?? heading, face: at.face, speed: between(.95, 1.35), walking: false };
  });
  let motionChanged = false;
  const stepVisitors = (dt) => visitors.forEach((v, i) => {
    if (v.pause > 0) {
      v.pause -= dt;
      if (v.pause <= 0) { v.walking = true; v.face = null; crowd.setMotion(i, 5.8, .38); motionChanged = true; }
    } else {
      const ds = v.goal.s - v.s, df = v.goal.f - v.f, d = Math.hypot(ds, df), move = v.speed * dt;
      if (d <= move) {
        v.s = v.goal.s; v.f = v.goal.f; v.face = v.goal.face; v.pause = v.goal.stay; v.goal = nextSpot();
        v.walking = false; crowd.setMotion(i, 0, 0); motionChanged = true;
      } else {
        v.s += ds / d * move; v.f += df / d * move;
        const want = Math.atan2(Fx * df + Fz * ds, Fz * df - Fx * ds);
        v.heading = turnToward(v.heading, want, dt);
      }
    }
    if (v.face !== null) v.heading = turnToward(v.heading, v.face, dt);
    v.lift += (stageLift(v.s, v.f) - v.lift) * Math.min(1, dt * 9);
    crowd.mesh.setMatrixAt(i, m.compose(p.set(statue.x + Fx * v.f + Fz * v.s, y + v.lift, statue.z + Fz * v.f - Fx * v.s), q.setFromAxisAngle(yAxis, v.heading), i < COUNT * shared.crowd.value + .5 ? one : gone));
  });
  stepVisitors(0);
  crowd.commit();
  crowd.mesh.instanceMatrix.needsUpdate = true;

  let tick = 0;
  return {
    visitors,
    update(night, focus, dt) {
      crowd.setVisible(focus < 1700);
      if (focus < 1700) {
        stepVisitors(dt);
        if (motionChanged) { crowd.commit(); motionChanged = false; }
        crowd.mesh.instanceMatrix.needsUpdate = true;
      }
      tick += .1;
      flameDots.material.opacity = .55 + .45 * night;
      flameDots.material.size = .55 + .06 * Math.sin(tick * 1.7) + .04 * Math.sin(tick * 3.1);
      postDots.material.opacity = night;
      postDots.points.visible = night > .02;
    },
    view: () => ({ pos: [statue.x + Fx * 122 + Fz * 30, y + 46, statue.z + Fz * 122 - Fx * 30], target: [statue.x + Fx * 16, y + 22, statue.z + Fz * 16] }),
  };
}

export function buildSteps(world, scene, data, { low = false } = {}) {
  const { xs, zs, n } = data;
  const rand = mulberry(7373);
  const matrix = new THREE.Matrix4(), quat = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), size = new THREE.Vector3(), color = new THREE.Color();
  const lampSpots = [];

  /** Sweeps a cross-section ([sideways offset, height] pairs) along a line of {x, y, z} points as one seamless surface. */
  function sweep(parts, pts, profile, hex) {
    const position = [], at = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return profile.map(([o, h]) => [p.x + (b.z - a.z) / l * o, p.y + h, p.z - (b.x - a.x) / l * o]);
    });
    for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < profile.length - 1; j++) position.push(...at[i][j], ...at[i + 1][j], ...at[i][j + 1], ...at[i][j + 1], ...at[i + 1][j], ...at[i + 1][j + 1]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    g.computeVertexNormals();
    parts.push(part(g, hex));
  }
  const WALL = '#9b9587', COPING = '#cfc8b6', PIER = '#d9d2c0';
  /** Low stone walls either side of a line, with a pale coping. */
  function walls(parts, pts, width, high, deep) {
    for (const side of [-1, 1]) {
      const a = side * width / 2, b = side * (width / 2 + .44), lip = side * .06;
      sweep(parts, pts, [[a, -.5], [a, high], [b, high], [b, -deep]], WALL);
      sweep(parts, pts, [[a - lip, high], [a - lip, high + .07], [b + lip, high + .07], [b + lip, high]], COPING);
    }
  }
  /** A square post closing the end of a wall on both sides. */
  function piers(parts, p, nx, nz, width, top) {
    for (const side of [-1, 1]) {
      const o = side * (width / 2 + .22);
      parts.push(part(new THREE.BoxGeometry(.72, 1.9, .72).translate(p.x + nx * o, p.y + top - .95, p.z + nz * o), PIER));
    }
  }

  /** Draws one stairway: solid stone steps and handrails. */
  function flight({ xs, zs, ys, treads, n, firstStepIndex, railEnd, width = WIDTH, walled = false }) {
    const at = (s) => {
      const i = Math.max(0, Math.min(n - 2, Math.floor(s))), t = Math.min(1, s - i);
      const dx = xs[i + 1] - xs[i], dz = zs[i + 1] - zs[i], l = Math.hypot(dx, dz) || 1;
      return { x: xs[i] + dx * t, z: zs[i] + dz * t, y: ys[i] + (ys[i + 1] - ys[i]) * t, tx: dx / l, tz: dz / l };
    };
    // Each step is a deep block that reaches below the rock cut, so the stairway reads as built, never buried.
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(width, STEP_DEPTH, 1), new THREE.MeshStandardMaterial({ color: '#b3aea2', roughness: .92 }), treads.length);
    treads.forEach((tread, i) => {
      const next = treads[i + 1]?.s ?? tread.s + .45;
      const depth = Math.min(10, next - tread.s + .04), mid = at(tread.s + depth / 2);
      pos.set(mid.x, tread.y - STEP_DEPTH / 2, mid.z);
      quat.setFromAxisAngle(up, Math.atan2(mid.tx, mid.tz));
      mesh.setMatrixAt(i, matrix.compose(pos, quat, size.set(1, 1, depth)));
      mesh.setColorAt(i, color.setScalar(.86 + rand() * .2));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);

    const treadY = (s) => {
      if (s >= railEnd) return at(s).y;
      let lo = 0, hi = treads.length - 1;
      if (s < treads[0].s) return ys[0];
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (treads[mid].s <= s) lo = mid; else hi = mid - 1; }
      return treads[lo].y;
    };
    const parts = [];
    const bar = (a, b, r, hex) => {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
      parts.push(part(new THREE.CylinderGeometry(r, r, len, 5).translate(0, len / 2, 0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())).translate(...a), hex));
    };
    if (walled) { // A level stone landing from the top step to the car park.
      const a = at(treads[treads.length - 1].s), b = at(n - 1), len = Math.hypot(b.x - a.x, b.z - a.z);
      parts.push(part(new THREE.BoxGeometry(width + .8, STEP_DEPTH, len).rotateY(Math.atan2(b.x - a.x, b.z - a.z)).translate((a.x + b.x) / 2, ys[n - 1] - .02 - STEP_DEPTH / 2, (a.z + b.z) / 2), '#b3aea2'));
    }
    if (walled) {
      const pts = [];
      for (let s = treads[0].s - .7; s < railEnd; s += .5) pts.push(at(s));
      pts.push(at(railEnd));
      walls(parts, pts, width, .62, 2.4);
      for (const p of [pts[0], pts[pts.length - 1]]) piers(parts, p, p.tz, -p.tx, width, .86);
    } else for (const side of [-1, 1]) {
      let prev = null;
      for (let s = Math.max(treads[0].s, firstStepIndex); s < railEnd; s += 3) {
        const p = at(s), x = p.x + p.tz * side * (width / 2 + .05), z = p.z - p.tx * side * (width / 2 + .05), y = treadY(s);
        bar([x, y - .15, z], [x, y + 1, z], .03, '#efece3');
        if (prev) bar(prev, [x, y + 1, z], .022, '#efece3');
        prev = [x, y + 1, z];
        if (side === 1 && Math.round(s) % 27 === 0) lampSpots.push(x, y + 1.25, z);
      }
    }
    const rails = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .6 }));
    rails.castShadow = true;
    scene.add(rails);
    return { at, treadY };
  }
  const { at, treadY } = flight(data);
  flight(data.back);

  // The paved walkway and the small plaza at the foot of the rear stairs.
  {
    const { xs: wx, zs: wz, ys: wy, n: wn, width } = data.walkway, parts = [];
    const pts = wx.map((x, i) => ({ x, y: wy[i], z: wz[i] }));
    sweep(parts, pts, [[-width / 2, 0], [width / 2, 0]], '#c9c2b0');
    walls(parts, pts, width, .46, 2);
    const end = (i, j) => { const l = Math.hypot(wx[j] - wx[i], wz[j] - wz[i]) || 1; piers(parts, pts[i], (wz[j] - wz[i]) / l, -(wx[j] - wx[i]) / l, width, .78); };
    end(0, 1); end(wn - 1, wn - 2);

    const { at: [px, pz], y: py, Fx, Fz, halfF, halfS, walkSide } = data.plaza, angle = Math.atan2(Fx, Fz);
    const piece = (w, h, d, ds, df, top, hex) => parts.push(part(new THREE.BoxGeometry(w, h, d).rotateY(angle).translate(px + Fz * ds + Fx * df, py + top - h / 2, pz - Fx * ds + Fz * df), hex));
    piece(halfS * 2, 3, halfF * 2, 0, 0, 0, '#c9c2b0');
    const kerb = (w, d, ds, df) => piece(w, .9, d, ds, df, .46, COPING);
    const T = .4, stairGap = BACK_WIDTH / 2 + .44, walkGap = PATH_WIDTH / 2 + .44;
    kerb(halfS * 2 + T, T, 0, halfF);                                  // Along the statue side.
    for (const side of [-1, 1]) kerb(halfS - stairGap, T, side * (stairGap + halfS) / 2, -halfF); // Either side of the stairs.
    kerb(T, halfF * 2 + T, -walkSide * halfS, 0);                      // The far end.
    for (const side of [-1, 1]) kerb(T, halfF - walkGap, walkSide * halfS, side * (walkGap + halfF) / 2); // Either side of the walkway.

    const walk = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, side: THREE.DoubleSide }));
    walk.castShadow = walk.receiveShadow = true;
    scene.add(walk);
  }
  const start = data.firstStepIndex;

  const sprite = document.createElement('canvas'); sprite.width = sprite.height = 48;
  const ctx = sprite.getContext('2d', { willReadFrequently: true });
  const gradient = ctx.createRadialGradient(24, 24, 0, 24, 24, 24);
  gradient.addColorStop(0, 'rgba(255,240,205,1)'); gradient.addColorStop(.25, 'rgba(255,205,135,.6)'); gradient.addColorStop(1, 'rgba(255,170,80,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 48, 48);
  const lampMaterial = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(sprite), size: 5, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false });
  const lamps = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lampSpots, 3)), lampMaterial);
  lamps.visible = false;
  scene.add(lamps);

  const terrace = buildTerrace(world, scene, data.terrace, rand, low);

  // Pilgrims dressed in white, climbing slowly and coming back down.
  const COUNT = low ? 12 : 30;
  const crowd = createCrowd(scene, personGeometry(), COUNT, rand, { colors: ['#f7f4ec', '#f0ece2', '#f7f4ec', '#e4ddcc'] });
  const pilgrims = Array.from({ length: COUNT }, (_, i) => {
    const goingUp = rand() < .6, speed = goingUp ? .42 + rand() * .2 : .6 + rand() * .25;
    crowd.setMotion(i, 4.6 + speed * 2, .36);
    return { s: rand() * (n - 4), dir: goingUp ? 1 : -1, speed, side: (rand() - .5) * 1.5, heading: 0, rank: rand(), pause: 0 };
  });
  crowd.commit();
  const zero = new THREE.Vector3(), scale = new THREE.Vector3(1, 1, 1);
  const CLIMB_SPEED = 1.3;

  return {
    update(dt, night, focus) {
      lamps.visible = night > .02;
      lampMaterial.opacity = night;
      terrace.update(night, focus, dt);
      const away = focus > 1700;
      crowd.setVisible(!away);
      if (away) return;
      const share = (1 - .8 * night) * shared.crowd.value;
      pilgrims.forEach((p, i) => {
        const led = !!p.pinned;
        if (led !== !!p.led) { p.led = led; crowd.setMotion(i, led ? 7.5 : 4.6 + p.speed * 2, .36); crowd.commit(); }
        if (led) p.s = Math.min(n - 3, p.s + CLIMB_SPEED * dt); // The person being followed waits at the top.
        else if (p.pause > 0) p.pause -= dt;
        else {
          p.s += p.speed * p.dir * dt;
          if (p.s < 1 || p.s > n - 3) { p.dir = -p.dir; p.s = Math.max(1, Math.min(n - 3, p.s)); p.pause = 3 + rand() * 9; }
        }
        const a = at(p.s), tx = a.tx * p.dir, tz = a.tz * p.dir;
        if (led) { p.x = a.x + a.tz * p.side; p.z = a.z - a.tx * p.side; p.y = a.y; } // The smooth slope, so the camera doesn't bounce on each step.
        const x = a.x + a.tz * p.side, z = a.z - a.tx * p.side;
        const want = Math.atan2(tx, tz);
        p.heading = turnToward(p.heading, want, dt);
        crowd.mesh.setMatrixAt(i, matrix.compose(pos.set(x, treadY(p.s) + .02, z), quat.setFromAxisAngle(up, p.heading), p.rank < share || p.led ? scale : zero));
      });
      crowd.mesh.instanceMatrix.needsUpdate = true;
    },
    /** Brings one pilgrim to the foot of the stairs, ready to climb. */
    climber() {
      const p = pilgrims[0], a = at(Math.max(1, start - 8));
      Object.assign(p, { s: Math.max(1, start - 8), dir: 1, side: 0, pause: 0, x: a.x, y: a.y, z: a.z, heading: Math.atan2(a.tx, a.tz) });
      return p;
    },
    terrace,
    statueView: terrace.view,
    view() {
      const a = at(n * .72), side = 34, e = at(n - 3);
      return {
        pos: [a.x + a.tz * side - a.tx * 34, a.y + 12, a.z - a.tx * side - a.tz * 34],
        target: [(a.x + e.x) / 2, (a.y + e.y) / 2 - 8, (a.z + e.z) / 2],
      };
    },
    stats() {
      // How far the land rises above the steps, measured across their full width, on both stairways.
      const check = (d) => {
        let worst = 0, over = 0;
        for (const tread of d.treads) {
          const i = Math.floor(tread.s); if (i + 1 >= d.n) continue;
          const l = Math.hypot(d.xs[i + 1] - d.xs[i], d.zs[i + 1] - d.zs[i]) || 1, nx = (d.zs[i + 1] - d.zs[i]) / l, nz = -(d.xs[i + 1] - d.xs[i]) / l;
          for (const o of [-(d.width ?? WIDTH) / 2, 0, (d.width ?? WIDTH) / 2]) {
            const rise = world.heightAt(d.xs[i] + nx * o, d.zs[i] + nz * o) - tread.y;
            worst = Math.max(worst, rise); if (rise > -.05) over++;
          }
        }
        return { steps: d.treads.length, rockAboveStep: +worst.toFixed(2), pointsTouching: over };
      };
      const w = data.walkway;
      let walkwayWorst = -Infinity;
      for (let i = 0; i < w.n; i++) walkwayWorst = Math.max(walkwayWorst, world.heightAt(w.xs[i], w.zs[i]) - w.ys[i]);
      return { main: check(data), back: check(data.back), walkwayRockAbove: +walkwayWorst.toFixed(2) };
    },
  };
}

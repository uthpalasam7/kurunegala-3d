// Kurunegala Lake's surroundings: jogging path, exercise area, boat jetty and Children's Park.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { mulberry, shared } from './world.js';
import { part, attachGroundShadow } from './traffic.js';
import { createCrowd, personGeometry, CLOTHES, turnToward } from './people.js';

function inside(poly, x, z) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) hit = !hit;
  }
  return hit;
}
function chaikin(poly) {
  const out = [];
  poly.forEach(([ax, az], i) => {
    const [bx, bz] = poly[(i + 1) % poly.length];
    out.push([ax * .75 + bx * .25, az * .75 + bz * .25], [ax * .25 + bx * .75, az * .25 + bz * .75]);
  });
  return out;
}
function resample(poly, step) {
  let total = 0;
  const lens = poly.map(([ax, az], i) => { const [bx, bz] = poly[(i + 1) % poly.length], l = Math.hypot(bx - ax, bz - az); total += l; return l; });
  const n = Math.round(total / step), out = [];
  let seg = 0, travelled = 0;
  for (let k = 0; k < n; k++) {
    const d = k / n * total;
    while (travelled + lens[seg] < d) travelled += lens[seg++];
    const [ax, az] = poly[seg], [bx, bz] = poly[(seg + 1) % poly.length], t = (d - travelled) / (lens[seg] || 1);
    out.push([ax + (bx - ax) * t, az + (bz - az) * t]);
  }
  return out;
}
function smoothLoop(values, radius, passes = 1) {
  let a = values, n = a.length;
  for (let p = 0; p < passes; p++) a = a.map((_, i) => {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += a[(i + k + n) % n];
    return sum / (2 * radius + 1);
  });
  return a;
}

/** Runs before the ground is built, because it levels the land under the new surfaces. */
export function prepareLakeside(world) {
  const lake = world.lakes.find(l => l.name === 'Kurunegala Lake');
  const park = world.landmarks.park;
  const clock = world.landmarks.clock;
  const shore = resample(chaikin(chaikin(lake.p)), 4);

  // A 1 m raster of everything the path must avoid.
  const xs = lake.p.map(p => p[0]), zs = lake.p.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2, HALF = 1000, SIZE = HALF * 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const X = (x) => x - cx + HALF, Z = (z) => z - cz + HALF;
  ctx.fillStyle = ctx.strokeStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const r of world.roads) {
    if (r.w < 3.5) continue;
    ctx.beginPath(); r.p.forEach(([x, z], i) => ctx[i ? 'lineTo' : 'moveTo'](X(x), Z(z)));
    ctx.lineWidth = r.w + 1.4; ctx.stroke();
  }
  for (const b of world.buildings) {
    ctx.beginPath();
    for (let i = 0; i < b.p.length; i += 2) ctx[i ? 'lineTo' : 'moveTo'](X(b.p[i]), Z(b.p[i + 1]));
    ctx.closePath(); ctx.fill();
  }
  const builtPixels = ctx.getImageData(0, 0, SIZE, SIZE).data;
  for (const l of world.lakes) { ctx.beginPath(); l.p.forEach(([x, z], i) => ctx[i ? 'lineTo' : 'moveTo'](X(x), Z(z))); ctx.closePath(); ctx.fill(); }
  const pixels = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const blocked = (x, z) => {
    const i = X(x) | 0, j = Z(z) | 0;
    return i < 0 || j < 0 || i >= SIZE || j >= SIZE || pixels[(j * SIZE + i) * 4 + 3] > 60;
  };
  const built = (x, z) => {
    const i = X(x) | 0, j = Z(z) | 0;
    return i >= 0 && j >= 0 && i < SIZE && j < SIZE && builtPixels[(j * SIZE + i) * 4 + 3] > 60;
  };

  const n = shore.length;
  const frames = shore.map((p, i) => {
    const [ax, az] = shore[(i - 3 + n) % n], [bx, bz] = shore[(i + 3) % n], l = Math.hypot(bx - ax, bz - az) || 1;
    let nx = (bz - az) / l, nz = -(bx - ax) / l;
    if (inside(lake.p, p[0] + nx * 6, p[1] + nz * 6)) { nx = -nx; nz = -nz; }
    return { x: p[0], z: p[1], nx, nz, tx: (bx - ax) / l, tz: (bz - az) / l };
  });

  // Walking out from the water, the first road or building sets the landward limit.
  // The path may never go past it, so the order is always road, grass bank, path, lake.
  const minLoop = (values, radius) => values.map((_, i) => {
    let least = Infinity;
    for (let k = -radius; k <= radius; k++) least = Math.min(least, values[(i + k + n) % n]);
    return least;
  });
  const limits = frames.map((f) => {
    const hit = (d) => [-3, 0, 3].some(side => built(f.x + f.nx * d + f.tx * side, f.z + f.nz * d + f.tz * side));
    if (hit(0)) { // A road right on the mapped shoreline: find its lake-side edge.
      let d = 0;
      while (d > -24 && hit(d - 1)) d -= 1;
      return d;
    }
    for (let d = 1; d <= 40; d += 1) if (hit(d)) return d;
    return 41;
  });
  const BANK_AND_HALF_PATH = 5.4, PREFERRED = 9;
  // The path may only drift from the shore gradually, so a road at the water's edge makes it swing out in a long curve, not a zig-zag.
  const MAX_DRIFT = .42; // Metres sideways per 4 m along the shore.
  const limitDrift = (values) => {
    const a = [...values];
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) a[i] = Math.min(a[i], a[(i - 1 + n) % n] + MAX_DRIFT);
      for (let i = n - 1; i >= 0; i--) a[i] = Math.min(a[i], a[(i + 1) % n] + MAX_DRIFT);
    }
    return a;
  };
  const CLEARANCE = 3.8; // From the path's centre to the nearest tarmac or building.
  const wanted = minLoop(limits.map(l => Math.max(-30, Math.min(PREFERRED, l - BANK_AND_HALF_PATH))), 12);
  let offsets, px, pz;
  for (let attempt = 0; attempt < 24; attempt++) {
    offsets = limitDrift(smoothLoop(limitDrift(wanted), 6, 2));
    px = smoothLoop(frames.map((f, i) => f.x + f.nx * offsets[i]), 4, 2);
    pz = smoothLoop(frames.map((f, i) => f.z + f.nz * offsets[i]), 4, 2);
    // Check the finished line, and push any stretch that touches something further out, then rebuild it.
    const touching = new Set();
    for (let i = 0; i < n; i++) {
      const dx = px[(i + 1) % n] - px[(i - 1 + n) % n], dz = pz[(i + 1) % n] - pz[(i - 1 + n) % n], l = Math.hypot(dx, dz) || 1;
      if ([-CLEARANCE, -CLEARANCE / 2, 0, CLEARANCE / 2, CLEARANCE].some(o => built(px[i] + dz / l * o, pz[i] - dx / l * o))) for (let k = -3; k <= 3; k++) touching.add((i + k + n) % n);
    }
    if (!touching.size) break;
    for (const i of touching) wanted[i] = Math.max(-48, wanted[i] - 1.2);
  }
  const newShore = smoothLoop(offsets.map(o => Math.min(0, o - 4)), 2, 1);
  const nearLimits = minLoop(limits, 3);
  const bank = smoothLoop(nearLimits.map((l, i) => Math.max(2, Math.min(8, l - offsets[i] - .2))), 2, 1);

  const heights = smoothLoop(px.map((x, i) => Math.max(lake.level + .7, world.heightAt(x, pz[i]))), 6, 2);
  const path = px.map((x, i) => ({ x, z: pz[i], y: heights[i] }));
  const cum = [0];
  path.forEach((p, i) => { if (i) cum.push(cum[i - 1] + Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z)); });
  const pathLength = cum[n - 1] + Math.hypot(path[0].x - path[n - 1].x, path[0].z - path[n - 1].z);

  // Level the land under the track.
  const { N, half, cell, heights: land } = world;
  function level(x, z, y, radius, soft, reclaim = false) {
    const i0 = Math.max(0, Math.floor((x - radius - soft + half) / cell)), i1 = Math.min(N - 1, Math.ceil((x + radius + soft + half) / cell));
    const j0 = Math.max(0, Math.floor((z - radius - soft + half) / cell)), j1 = Math.min(N - 1, Math.ceil((z + radius + soft + half) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(-half + i * cell - x, -half + j * cell - z);
      const k = j * N + i;
      if (land[k] < lake.level - .05 && !reclaim) continue; // Only filled where the path needs room.
      const blend = 1 - Math.min(1, Math.max(0, (d - radius) / soft));
      if (blend > 0) land[k] += (y - land[k]) * blend;
    }
  }
  path.forEach((p, i) => { if (i % 2 === 0) level(p.x, p.z, p.y, 7, 7); });
  // Where the road runs close to the lake, the water edge moves back to make room.
  frames.forEach((f, i) => {
    if (i % 2 || newShore[i] > -.5) return;
    for (let d = newShore[i] + 7; d <= 6; d += 3) level(f.x + f.nx * d, f.z + f.nz * d, lake.level + .75, 8.5, 3, true);
  });

  // Exercise area: the open ground on the north shore, across the lake from town.
  const WANT = [-290, -800];
  const towardsPath = (i) => frames[i];
  let best = null;
  for (const [length, depth] of [[30, 16], [24, 13], [18, 11]]) {
    for (let i = 0; i < n; i += 2) {
      const f = towardsPath(i);
      const d = Math.hypot(path[i].x - WANT[0], path[i].z - WANT[1]);
      if (d > 420 || path[i].z > cz) continue;
      const out = depth / 2 + 3.4;
      const c = { x: path[i].x + f.nx * out, z: path[i].z + f.nz * out };
      let free = true;
      for (let u = -length / 2; free && u <= length / 2; u += 2) for (let v = -depth / 2; v <= depth / 2; v += 2) {
        if (blocked(c.x + f.tx * u + f.nx * v, c.z + f.tz * u + f.nz * v)) { free = false; break; }
      }
      if (free && (!best || d < best.d)) best = { ...c, d, i, length, depth, tx: f.tx, tz: f.tz, nx: f.nx, nz: f.nz, y: path[i].y };
    }
    if (best) break;
  }
  if (!best) {
    const i = path.reduce((b, p, k) => Math.hypot(p.x - WANT[0], p.z - WANT[1]) < Math.hypot(path[b].x - WANT[0], path[b].z - WANT[1]) ? k : b, 0), f = frames[i];
    best = { x: path[i].x + f.nx * 11, z: path[i].z + f.nz * 11, i, length: 18, depth: 11, tx: f.tx, tz: f.tz, nx: f.nx, nz: f.nz, y: path[i].y };
  }
  { // A true rectangle of level ground, a full grid cell wider than the slab so its edges stay flat too.
    const pad = cell + 1, soft = 7, reach = Math.hypot(best.length, best.depth) / 2 + pad + soft;
    const i0 = Math.max(0, Math.floor((best.x - reach + half) / cell)), i1 = Math.min(N - 1, Math.ceil((best.x + reach + half) / cell));
    const j0 = Math.max(0, Math.floor((best.z - reach + half) / cell)), j1 = Math.min(N - 1, Math.ceil((best.z + reach + half) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * N + i;
      if (land[k] < lake.level - .05) continue;
      const dx = -half + i * cell - best.x, dz = -half + j * cell - best.z;
      const u = Math.max(0, Math.abs(dx * best.tx + dz * best.tz) - best.length / 2 - pad);
      const v = Math.max(0, Math.abs(dx * best.nx + dz * best.nz) - best.depth / 2 - pad);
      const blend = 1 - Math.min(1, Math.hypot(u, v) / soft);
      if (blend > 0) land[k] += (best.y - land[k]) * blend;
    }
  }

  // Boat jetty: the shore closest to the Children's Park.
  let pier = 0;
  frames.forEach((f, i) => { if (Math.hypot(f.x - park.x, f.z - park.z) < Math.hypot(frames[pier].x - park.x, frames[pier].z - park.z)) pier = i; });

  // Children's Park: the mapped point, with an outline fitted to what's around it.
  const ANGLES = 48;
  const radii = smoothLoop(Array.from({ length: ANGLES }, (_, a) => {
    const t = a / ANGLES * Math.PI * 2, dx = Math.sin(t), dz = Math.cos(t);
    let r = 1;
    while (r < 26 && !blocked(park.x + dx * r, park.z + dz * r)) r += 1;
    return Math.max(5, r - 2);
  }), 1, 1);
  level(park.x, park.z, world.heightAt(park.x, park.z), 12, 12);

  (world.keepClear ||= []).push(
    { line: path.map(p => [p.x, p.z]), width: 7, closed: true },
    { circle: [best.x, best.z], radius: Math.max(best.length, best.depth) / 2 + 3 },
    { circle: [frames[pier].x, frames[pier].z], radius: 14 },
    { circle: [park.x, park.z], radius: 27 },
    { line: [[park.x, park.z], [park.x - frames[pier].nx * 62 - frames[pier].tx * 20, park.z - frames[pier].nz * 62 - frames[pier].tz * 20]], width: 40 }, // Open outlook from the park to the lake.
  );

  // Solid ground under the full width of the track, whatever the grid spacing.
  const minimum = lake.level + .62;
  path.forEach((p, i) => {
    for (const o of [-2.4, 0, 2.4]) {
      const fx = (p.x + frames[i].nx * o + half) / cell, fz = (p.z + frames[i].nz * o + half) / cell;
      const i0 = Math.floor(fx), j0 = Math.floor(fz);
      for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) land[(j0 + b) * N + i0 + a] = Math.max(land[(j0 + b) * N + i0 + a], minimum);
    }
  });

  frames.forEach((f, i) => { f.x += f.nx * newShore[i]; f.z += f.nz * newShore[i]; });

  const distanceToShore = (x, z) => {
    let d = Infinity;
    for (let i = 0; i < n; i += 3) d = Math.min(d, Math.hypot(frames[i].x - x, frames[i].z - z));
    return d;
  };
  const deep = [];
  for (let x = Math.min(...xs); x < Math.max(...xs); x += 18) for (let z = Math.min(...zs); z < Math.max(...zs); z += 18) {
    if (inside(lake.p, x, z) && distanceToShore(x, z) > 42) deep.push([x, z]);
  }

  const halfWidth = 1.9;
  const blockedCount = path.filter((p, i) => [0, halfWidth, -halfWidth].some(o => built(p.x + frames[i].nx * o, p.z + frames[i].nz * o))).length;
  return { lake, path, cum, pathLength, frames, offsets, bank, newShore, exercise: best, pier, radii, park, deep, inside, distanceToShore, blocked, blockedCount, clock };
}

const bar = (a, b, r = .05, sides = 6) => {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
  return new THREE.CylinderGeometry(r, r, len, sides).translate(0, len / 2, 0)
    .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())).translate(...a);
};
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const STEEL = '#3f7fa8', YELLOW = '#d9a92b', RED = '#c2453a', GREY = '#54585c', WOOD = '#7c5634', DARKWOOD = '#57402a';

const UNITS = {
  pullup: (a) => { a(bar([-.8, 0, 0], [-.8, 2.5, 0], .06), STEEL); a(bar([.8, 0, 0], [.8, 2.5, 0], .06), STEEL); a(bar([-.8, 2.45, 0], [.8, 2.45, 0], .04), YELLOW); },
  parallel: (a) => { for (const x of [-.32, .32]) { a(bar([x, 1.15, -1.1], [x, 1.15, 1.1], .04), YELLOW); for (const z of [-1, 1]) a(bar([x, 0, z], [x, 1.15, z], .05), STEEL); } },
  situp: (a) => { a(box(.5, .08, 1.6, 0, .55, 0).rotateX(-.35), RED); a(bar([0, 0, -.55], [0, .75, -.55], .06), STEEL); a(bar([0, 0, .55], [0, .33, .55], .06), STEEL); },
  press: (a) => { a(box(.5, .1, .55, 0, .5, -.3), RED); a(box(.5, .6, .08, 0, .55, -.6), RED); a(bar([0, 0, -.3], [0, .5, -.3], .07), STEEL); a(bar([0, .4, -.2], [0, .62, .7], .05), STEEL); a(box(.5, .5, .06, 0, .4, .78), YELLOW); a(bar([0, 0, .9], [0, .55, .85], .06), STEEL); },
  trainer: (a) => { a(bar([0, 0, .35], [0, 1.45, .25], .06), STEEL); a(bar([-.3, 1.42, .25], [.3, 1.42, .25], .035), YELLOW); a(box(.5, .05, 1.05, 0, 0, 0), GREY); a(box(.16, .05, .36, -.17, .3, -.15), YELLOW); a(box(.16, .05, .36, .17, .4, -.15), YELLOW); a(bar([-.17, .05, .3], [-.17, .32, -.15], .03), STEEL); a(bar([.17, .05, .3], [.17, .42, -.15], .03), STEEL); },
  monkey: (a) => { for (const x of [-2.6, 2.6]) for (const z of [-.4, .4]) a(bar([x, 0, z], [x, 2.5, z], .05), STEEL); for (const z of [-.4, .4]) a(bar([-2.6, 2.5, z], [2.6, 2.5, z], .04), STEEL); for (let x = -2.2; x <= 2.21; x += .55) a(bar([x, 2.5, -.4], [x, 2.5, .4], .025), YELLOW); },
  twist: (a) => { a(new THREE.CylinderGeometry(.35, .4, .1, 14).translate(0, .15, 0), YELLOW); a(bar([0, 0, .55], [0, 1.25, .55], .06), STEEL); a(bar([-.32, 1.25, .55], [.32, 1.25, .55], .03), RED); },
  bench: (a) => { a(box(1.7, .07, .42, 0, .45, 0), WOOD); a(box(1.7, .4, .06, 0, .55, -.2), WOOD); for (const x of [-.72, .72]) a(box(.08, .45, .4, x, 0, 0), GREY); },
  swings: (a) => { for (const x of [-1.9, 1.9]) { a(bar([x, 0, -.9], [x, 2.6, 0], .06), RED); a(bar([x, 0, .9], [x, 2.6, 0], .06), RED); } a(bar([-1.9, 2.6, 0], [1.9, 2.6, 0], .05), STEEL); },
  slide: (a) => { a(bar([-.45, 0, -1.6], [-.45, 2.05, -1.6], .05), STEEL); a(bar([.45, 0, -1.6], [.45, 2.05, -1.6], .05), STEEL); a(box(1, .08, .9, 0, 1.9, -1.8), YELLOW); for (let i = 0; i < 6; i++) a(box(.9, .05, .18, 0, .3 * i + .25, -2.3 - (5 - i) * .14), GREY); a(box(.72, .05, 3.3, 0, 1.0, .05).rotateX(.52).translate(0, 0, -.1), RED); a(box(.05, .18, 3.3, -.36, 1.03, .05).rotateX(.52), YELLOW); a(box(.05, .18, 3.3, .36, 1.03, .05).rotateX(.52), YELLOW); },
  seesaw: (a) => { a(box(.2, .5, .32, 0, 0, 0), STEEL); },
  climber: (a) => { const c = [-1.3, 0, 1.3]; for (const x of c) for (const z of c) a(bar([x, 0, z], [x, 2.2, z], .045), x === z ? YELLOW : RED); for (const y of [.75, 1.45, 2.2]) for (const z of c) a(bar([-1.3, y, z], [1.3, y, z], .03), STEEL); for (const y of [.75, 1.45, 2.2]) for (const x of c) a(bar([x, y, -1.3], [x, y, 1.3], .03), STEEL); },
  round: (a) => { a(new THREE.CylinderGeometry(.22, .3, .28, 10).translate(0, .14, 0), STEEL); },
};

/** Lays a flat-coloured sheet over the terrain from a grid of [x, z] points. */
export function drapedGrid(world, points, rows, cols, hex, lift, heightOf = null) {
  const pos = [];
  const v = (r, c) => { const [x, z] = points[r * (cols + 1) + c]; return [x, (heightOf ? heightOf(r, c, x, z) : world.heightAt(x, z)) + lift, z]; };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) pos.push(...v(r, c), ...v(r + 1, c), ...v(r, c + 1), ...v(r, c + 1), ...v(r + 1, c), ...v(r + 1, c + 1));
  const g = new THREE.BufferGeometry();
  for (let i = 0; i < pos.length; i += 9) { // Faces up, so it is lit by the sky rather than from below.
    const ux = pos[i + 3] - pos[i], uz = pos[i + 5] - pos[i + 2], vx = pos[i + 6] - pos[i], vz = pos[i + 8] - pos[i + 2];
    if (uz * vx - ux * vz < 0) for (let k = 0; k < 3; k++) [pos[i + 3 + k], pos[i + 6 + k]] = [pos[i + 6 + k], pos[i + 3 + k]];
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: hex, roughness: .92, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  mesh.receiveShadow = true;
  return mesh;
}

function boatModels() {
  const hull = (length, width, hex, paint) => {
    const g = new THREE.BoxGeometry(width, .55, length, 1, 1, 4), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getZ(i) / (length / 2), narrow = t > 0 ? 1 - t * t * .92 : 1 - t * t * .3;
      p.setX(i, p.getX(i) * narrow * (p.getY(i) < 0 ? .72 : 1));
      if (t > 0 && p.getY(i) > 0) p.setY(i, p.getY(i) + t * t * .28);
    }
    g.computeVertexNormals();
    return part(g.translate(0, .22, 0), hex, paint);
  };
  const SKIN = '#7b5238', HAIR = '#17130f';
  // A seated person, with arms reaching to wherever their hands rest.
  const sitter = (x, z, shirt, hands, longHair = false) => [
    part(box(.38, .52, .22, x, .5, z), shirt, 1),
    part(box(.09, .12, .09, x, 1.01, z), SKIN),
    part(new THREE.IcosahedronGeometry(.125, 1).translate(x, 1.2, z), SKIN),
    part(new THREE.IcosahedronGeometry(.13, 1).scale(1, .75, 1).translate(x, 1.26, z - .02), HAIR),
    ...(longHair ? [part(box(.26, .46, .07, x, .84, z - .14), HAIR), part(new THREE.IcosahedronGeometry(.085, 1).translate(x, 1.25, z - .16), HAIR)] : []),
    ...(hands ? [-1, 1].map((side, i) => part(bar([x + side * .24, .96, z], hands[i], .05), SKIN)) : []),
  ];
  const lap = (x, z) => [[x - .12, .62, z + .3], [x + .12, .62, z + .3]];
  const pedalBody = [
    hull(3.7, 1.7, '#ffffff', 1), part(box(1.3, .08, 1.5, 0, .5, -.2), '#efe9da'),
    ...[[-.72, -.85], [.72, -.85], [-.72, .5], [.72, .5]].map(([x, z]) => part(bar([x, .5, z], [x, 1.75, z], .03), '#d6d6d0')),
    part(box(1.7, .07, 1.75, 0, 1.75, -.2), '#ffffff', 1),
  ];
  const pedal = mergeGeometries([...pedalBody, ...sitter(-.3, -.35, '#e8e0cd', null), ...sitter(.3, -.35, '#d7763f', null, true)]);
  const pedalEmpty = mergeGeometries(pedalBody);
  const row = mergeGeometries([
    hull(4.3, 1.25, '#6f4a2c', 0), part(box(1, .07, .3, 0, .42, -.5), '#d9c49b'), part(box(1, .07, .3, 0, .42, .8), '#d9c49b'),
  ]);
  // The rower's upper body, separate so it can lean through each stroke. Its origin is the hips.
  const rowerTop = mergeGeometries(sitter(0, 0, '#ffffff', null).map(g => g.translate(0, -.5, 0)));
  return { pedal, row, pedalEmpty, rowerTop };
}

export function buildLakeside(world, scene, data, { low = false } = {}) {
  const rand = mulberry(8181);
  const { path, cum, pathLength, frames, exercise: ex, pier, radii, park, lake, deep, distanceToShore } = data;
  const n = path.length;
  const staticParts = [];
  const addAt = (geo, hex, x, y, z, angle = 0) => staticParts.push(part(geo.rotateY(angle).translate(x, y, z), hex));
  const unit = (name, x, z, angle, y = world.heightAt(x, z) + .08) => UNITS[name]((g, hex) => addAt(g, hex, x, y, z, angle));

  // The track is level from edge to edge, set just above the highest ground under it, so land cannot show through.
  const trackTop = path.map((p, i) => Math.max(...[-2.2, 0, 2.2].map(o => world.heightAt(p.x + frames[i].nx * o, p.z + frames[i].nz * o))));
  const trackY = smoothLoop(trackTop, 3, 1).map((y, i) => Math.max(y, trackTop[i]));
  const ribbon = (halfWidth, hex, lift, drop = 0) => {
    const points = [];
    for (let i = 0; i <= n; i++) {
      const a = path[(i - 1 + n) % n], b = path[(i + 1) % n], p = path[i % n], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = (b.z - a.z) / l, nz = -(b.x - a.x) / l;
      points.push([p.x + nx * halfWidth, p.z + nz * halfWidth], [p.x - nx * halfWidth, p.z - nz * halfWidth]);
    }
    return scene.add(drapedGrid(world, points, n, 1, hex, lift, (r) => trackY[r % n] - drop));
  };
  // The grass bank between the path and the road.
  const verge = [];
  for (let i = 0; i <= n; i++) {
    const k = i % n, p = path[k], f2 = frames[k];
    let outer = data.bank[k];
    for (let d = 1.5; d < outer; d += .25) { // The grass stops at the edge of the exercise slab.
      const dx = p.x + f2.nx * d - ex.x, dz = p.z + f2.nz * d - ex.z;
      if (Math.abs(dx * ex.tx + dz * ex.tz) < ex.length / 2 + .4 && Math.abs(dx * ex.nx + dz * ex.nz) < ex.depth / 2 + .4) { outer = d; break; }
    }
    outer = Math.max(outer, 2.2);
    verge.push([p.x + f2.nx * 2.2, p.z + f2.nz * 2.2], [p.x + f2.nx * outer, p.z + f2.nz * outer]);
  }
  scene.add(drapedGrid(world, verge, n, 1, '#5f8a3f', .09, (r, c, x, z) => (c ? world.heightAt(x, z) : trackY[r % n] - .25))); // The grass starts just outside and below the track's edge.
  ribbon(2.05, '#d8cdb8', .12);
  ribbon(1.65, '#a64e34', .17);

  // Exercise area.
  const local = (u, v) => [ex.x + ex.tx * u + ex.nx * v, ex.z + ex.tz * u + ex.nz * v];
  const padAngle = Math.atan2(ex.nx, ex.nz) + Math.PI;
  const su = ex.length / 30, sv = ex.depth / 16;
  // One rigid level slab: its height is the highest ground under it, so nothing can poke through.
  let padY = -Infinity;
  for (let u = -16; u <= 16; u += 1) for (let v = -10; v <= 10; v += 1) { const [x, z] = local(u * su, v * sv); padY = Math.max(padY, world.heightAt(x, z)); }
  const place = (u, v) => { const [x, z] = local(u * su, v * sv); return [x, z, padY + .1]; };
  const atPad = (geo, hex, u, v, lift = 0, angle = padAngle) => { const [x, z, y] = place(u, v); addAt(geo, hex, x, y + lift, z, angle); };
  const matTop = padY + .17; // Where equipment and people stand.
  const slab = (u0, u1, v0, v1, hex, top, depth = 1.2) => atPad(new THREE.BoxGeometry((u1 - u0) * su, depth, (v1 - v0) * sv), hex, (u0 + u1) / 2, (v0 + v1) / 2, top - depth / 2);
  const mat = (u0, u1, v0, v1, hex) => {
    slab(u0 - .14, u1 + .14, v0 - .14, v1 + .14, '#eee8da', .055, .1); // Painted border.
    slab(u0, u1, v0, v1, hex, .07, .1);
  };
  slab(-15, 15, -8, 8, '#c9c3b2', .04);         // Concrete base.
  mat(-14, -5, -7, 7, '#a9573c');               // Strength zone.
  mat(-4, 6, -7, 7, '#2f7f70');                 // Cardio zone.
  mat(7, 14, -7, 2, '#3a6c97');                 // Stretching area.
  slab(7, 14, 3, 7.6, '#d8d2c0', .06, .1);      // Under the shelter.
  slab(-2, 2, -11.4, -8, '#c9c3b2', .03);       // Entrance from the jogging path.

  const STATION_LIST = [
    ['pullup', -12, -3.5], ['pullup', -12, 2.5], ['parallel', -8.5, -4], ['parallel', -8.5, 2.5], ['monkey', -9.5, 5.8],
    ['trainer', -3, -4], ['trainer', 0, -4], ['trainer', 3, -4], ['twist', 5.2, -4],
    ['situp', -3, 2.5], ['situp', 0, 2.5], ['press', 3, 2.5], ['press', 5.2, 2.5],
  ];
  const stations = STATION_LIST.map(([name, u, v]) => {
    const [x, z] = local(u * su, v * sv);
    unit(name, x, z, padAngle, matTop);
    return { name, x, z };
  });

  // Kerb, with a gap at the entrance.
  const K = '#e6e0d0';
  for (const u of [-8.5, 8.5]) atPad(new THREE.BoxGeometry(13 * su, .32, .3), K, u, -8, .08);
  atPad(new THREE.BoxGeometry(30 * su, .32, .3), K, 0, 8, .08);
  for (const u of [-15, 15]) atPad(new THREE.BoxGeometry(.3, .32, 16 * sv), K, u, 0, .08);

  // A clipped hedge along the landward side, up to the shelter.
  atPad(new THREE.BoxGeometry(21.6 * su, .8, 1), '#3f7a3a', -4.2, 9.1, .3);
  atPad(new THREE.BoxGeometry(21.2 * su, .2, .72), '#4a8842', -4.2, 9.1, .8);
  // Open-sided shelter with benches.
  for (const u of [7.6, 13.4]) for (const v of [3.4, 7.2]) atPad(new THREE.CylinderGeometry(.09, .11, 3, 8), '#6b4a30', u, v, 1.5);
  const roofGeo = () => new THREE.ConeGeometry(5.2, 1.4, 4).rotateY(Math.PI / 4).scale(1.04, 1, .74);
  atPad(roofGeo(), '#a9502f', 10.5, 5.3, 3.65);
  const [bx1, bz1] = local(9 * su, 5.3 * sv), [bx2, bz2] = local(12 * su, 5.3 * sv);
  unit('bench', bx1, bz1, padAngle, padY + .16); unit('bench', bx2, bz2, padAngle, padY + .16);

  // Drinking fountain.
  atPad(new THREE.CylinderGeometry(.22, .3, 1, 12), '#b9b4a6', 6.5, 7.2, .5);
  atPad(new THREE.SphereGeometry(.24, 10, 8).scale(1.4, .5, 1.4), '#7fb9d6', 6.5, 7.2, 1.04);

  // Jetty and ticket kiosk.
  const f = frames[pier];
  const inward = [-f.nx, -f.nz];
  const jetAngle = Math.atan2(inward[0], inward[1]);
  const jetY = lake.level + .72, JET = 34;
  const jet = (along, side) => [f.x + inward[0] * along + f.tx * side, f.z + inward[1] * along + f.tz * side];
  for (let a = -4; a < JET; a += .62) {
    const [x, z] = jet(a, 0);
    addAt(new THREE.BoxGeometry(3.2, .1, .54), a % 1.86 < .62 ? '#94693f' : '#a97a4c', x, jetY, z, jetAngle);
  }
  for (const s of [-1.5, 1.5]) for (let a = -2; a <= JET; a += 6) {
    const [x, z] = jet(a, s);
    addAt(new THREE.CylinderGeometry(.13, .15, 7.2, 8), DARKWOOD, x, jetY - 3.3, z);
    addAt(new THREE.CylinderGeometry(.05, .05, 1.1, 6), DARKWOOD, x, jetY + .6, z);
  }
  const [railX0, railZ0] = jet(-4, 1.5), [railX1, railZ1] = jet(JET, 1.5);
  staticParts.push(part(bar([railX0, jetY + 1.1, railZ0], [railX1, jetY + 1.1, railZ1], .035), '#caa873'));
  const [railX2, railZ2] = jet(-4, -1.5), [railX3, railZ3] = jet(JET, -1.5);
  staticParts.push(part(bar([railX2, jetY + 1.1, railZ2], [railX3, jetY + 1.1, railZ3], .035), '#caa873'));

  const [kx, kz] = [f.x + f.nx * 3.6 + f.tx * 8, f.z + f.nz * 3.6 + f.tz * 8];
  const ky = world.heightAt(kx, kz) + .05, kAng = jetAngle;
  addAt(new THREE.BoxGeometry(3.4, 2.5, 2.8), '#efe6d2', kx, ky + 1.25, kz, kAng);
  addAt(new THREE.BoxGeometry(2.2, .95, .1), '#2a3640', kx + inward[0] * 1.42, ky + 1.55, kz + inward[1] * 1.42, kAng);
  addAt(new THREE.BoxGeometry(2.6, .1, .5), '#caa873', kx + inward[0] * 1.6, ky + 1.05, kz + inward[1] * 1.6, kAng);
  addAt(new THREE.ConeGeometry(3.1, 1.3, 4).rotateY(Math.PI / 4), '#c2453a', kx, ky + 3.1, kz, kAng);

  // Children's Park.
  const pa = radii.map((r, a) => { const t = a / radii.length * Math.PI * 2; return { r, dx: Math.sin(t), dz: Math.cos(t) }; });
  const parkPoints = [];
  const RINGS = 6;
  for (let ring = 0; ring <= RINGS; ring++) for (let a = 0; a <= pa.length; a++) {
    const p = pa[a % pa.length], rr = p.r * ring / RINGS;
    parkPoints.push([park.x + p.dx * rr, park.z + p.dz * rr]);
  }
  scene.add(drapedGrid(world, parkPoints, RINGS, pa.length, '#b89c6c', .12));
  const parkY = (x, z) => world.heightAt(x, z) + .1;
  pa.forEach((p, a) => {
    const q = pa[(a + 1) % pa.length];
    const ax = park.x + p.dx * p.r, az = park.z + p.dz * p.r, bx = park.x + q.dx * q.r, bz = park.z + q.dz * q.r;
    const y0 = parkY(ax, az), y1 = parkY(bx, bz);
    staticParts.push(part(bar([ax, y0, az], [ax, y0 + 1, az], .05), '#3a7355'));
    staticParts.push(part(bar([ax, y0 + .92, az], [bx, y1 + .92, bz], .03), '#3a7355'));
    staticParts.push(part(bar([ax, y0 + .35, az], [bx, y1 + .35, bz], .025), '#3a7355'));
  });
  const reach = (angle) => { const a = ((angle / (Math.PI * 2)) % 1 + 1) % 1 * pa.length; return pa[Math.floor(a) % pa.length].r; };
  const slots = [];
  for (const [ring, count, turn] of [[0, 1, 0], [.42, 6, .3], [.75, 10, 0]]) for (let i = 0; i < count; i++) slots.push({ ring, t: i / count * Math.PI * 2 + turn });
  const toPlace = ['round', 'swings', 'slide', 'climber', 'seesaw', 'swings', 'seesaw', 'bench', 'bench', 'bench'];
  const placedPlay = [];
  for (const s of slots) {
    if (placedPlay.length >= toPlace.length) break;
    const r = reach(s.t), d = s.ring * r;
    const x = park.x + Math.sin(s.t) * d, z = park.z + Math.cos(s.t) * d;
    const radius = toPlace[placedPlay.length] === 'bench' ? 1.4 : 3.2;
    if (r - d < radius + .6 || placedPlay.some(p => Math.hypot(p.x - x, p.z - z) < p.radius + radius + 1)) continue;
    unit(toPlace[placedPlay.length], x, z, s.t + Math.PI, parkY(x, z));
    placedPlay.push({ x, z, radius, name: toPlace[placedPlay.length], angle: s.t + Math.PI, y: parkY(x, z) });
  }

  // Lakeside lamps.
  const lampSpots = [];
  for (let i = 0; i < n; i += 11) {
    const a = path[i], g = frames[i], x = a.x + g.nx * 2.6, z = a.z + g.nz * 2.6, y = world.heightAt(x, z);
    staticParts.push(part(new THREE.CylinderGeometry(.04, .06, 3.2, 6).translate(x, y + 1.6, z), '#30393f'));
    staticParts.push(part(new THREE.SphereGeometry(.16, 8, 6).translate(x, y + 3.25, z), '#f5eedb'));
    lampSpots.push(x, y + 3.3, z);
  }
  const sprite = document.createElement('canvas'); sprite.width = sprite.height = 48;
  const sc = sprite.getContext('2d', { willReadFrequently: true });
  const grad = sc.createRadialGradient(24, 24, 0, 24, 24, 24);
  grad.addColorStop(0, 'rgba(255,240,205,1)'); grad.addColorStop(.25, 'rgba(255,205,135,.6)'); grad.addColorStop(1, 'rgba(255,170,80,0)');
  sc.fillStyle = grad; sc.fillRect(0, 0, 48, 48);
  const lampGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lampSpots, 3));
  const lampMat = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(sprite), size: 6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false });
  const lamps = new THREE.Points(lampGeo, lampMat);
  lamps.visible = false; scene.add(lamps);

  const staticMesh = new THREE.Mesh(mergeGeometries(staticParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .7, metalness: .1 }));
  staticMesh.castShadow = staticMesh.receiveShadow = true;
  scene.add(staticMesh);

  // --- People ------------------------------------------------------------------
  const JOG = low ? 40 : 90;
  const joggers = createCrowd(scene, personGeometry(), JOG, rand, { colors: ['#2d3a55', '#d9d3c5', '#b84035', '#3e6a9f', '#3f7d62', '#e0b83f', '#55606b', '#f0ece2'], mix: 'sport' });
  const runners = Array.from({ length: JOG }, (_, i) => {
    const jogging = rand() < .58;
    joggers.setMotion(i, jogging ? 10.5 + rand() * 1.5 : 6, jogging ? .75 : .42);
    return { s: rand() * pathLength, dir: rand() < .5 ? 1 : -1, speed: jogging ? 2.6 + rand() * .9 : 1.1 + rand() * .45, lateral: .35 + rand() * .55, rank: rand(), scale: .94 + rand() * .14, heading: 0, jogging };
  });
  joggers.commit();

  const others = [];
  const statics = createCrowd(scene, personGeometry(), 30, rand, { colors: CLOTHES, mix: 'adults' });
  let staticIndex = 0;
  const pose = (x, z, y, heading, scale, rate, amp) => {
    if (staticIndex >= 30) return;
    statics.setMotion(staticIndex, rate, amp);
    statics.mesh.setMatrixAt(staticIndex, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading), new THREE.Vector3(scale, scale, scale)));
    others.push(staticIndex++);
  };
  for (let q = 0; q < 6; q++) {
    const [x, z] = jet(-2.5 + q * .8, -.55);
    pose(x, z, jetY + .05, jetAngle, 1 - (q % 3 === 2 ? .3 : 0), 0, 0);
  }
  const queueStart = staticIndex;
  for (let a = 0; a < 6; a++) {
    const t = a / 6 * 6.28 + 1, r = reach(t) + -1.4;
    const x = park.x + Math.sin(t) * r, z = park.z + Math.cos(t) * r;
    pose(x, z, parkY(x, z) + .05, t + Math.PI, 1, 0, 0);
  }
  statics.commit();
  statics.mesh.instanceMatrix.needsUpdate = true;
  void queueStart;

  // --- Children: each one is doing something in the playground ----------------
  // --- People at the Exercise Park ----------------------------------------------
  const GYM = 22;
  const gymCrowd = createCrowd(scene, personGeometry(), GYM, rand, { colors: ['#2d3a55', '#b84035', '#3e6a9f', '#3f7d62', '#e0b83f', '#f0ece2', '#c95f83'], mix: 'sport' });
  const hangCrowd = createCrowd(scene, personGeometry(true), 3, rand, { colors: ['#2d3a55', '#b84035', '#3f7d62'], mix: 'sport' });
  const gym = [];
  const cosA = Math.cos(padAngle), sinA = Math.sin(padAngle);
  let gymIndex = 0, hangIndex = 0;
  for (const st of stations) {
    const type = st.name === 'parallel' ? 'dip' : st.name;
    const ground = matTop;
    if (type === 'pullup' || type === 'monkey') {
      if (hangIndex < 3) { hangCrowd.setMotion(hangIndex, 0, 0); gym.push({ crowd: hangCrowd, i: hangIndex++, type, x: st.x, z: st.z, ground, phase: rand() * 6.28 }); }
      continue;
    }
    const motion = { trainer: [5, .5], press: [2.4, .5], situp: [0, 0], twist: [0, 0], dip: [0, 0] }[type];
    gymCrowd.setMotion(gymIndex, motion[0], motion[1]);
    gym.push({ crowd: gymCrowd, i: gymIndex++, type, x: st.x, z: st.z, ground, phase: rand() * 6.28 });
  }
  for (const [u, v, faceBack] of [[8.3, -4.6], [10.5, -4.6], [12.7, -4.6], [8.3, -1.4], [10.5, -1.4], [12.7, -1.4], [10.5, -6.3, true]]) {
    if (gymIndex >= GYM) break;
    const [x, z] = local(u * su, v * sv);
    gymCrowd.setMotion(gymIndex, 1.5, .85);
    gym.push({ crowd: gymCrowd, i: gymIndex++, type: 'stretch', x, z, ground: matTop, phase: 0, heading: padAngle + (faceBack ? 0 : Math.PI) });
  }
  const gymMatrixEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  for (let i = gymIndex; i < GYM; i++) gymCrowd.mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
  gymCrowd.commit(); hangCrowd.commit();
  function updateGym(time, night) {
    for (const a of gym) {
      const t = time * 1.5 + a.phase, up01 = .5 + .5 * Math.sin(t);
      let x = a.x, z = a.z, y = a.ground, heading = a.heading ?? padAngle, pitch = 0;
      if (a.type === 'pullup') y += .35 + .42 * up01;
      else if (a.type === 'monkey') { const along = -2 + 4 * (.5 + .5 * Math.sin(time * .35 + a.phase)); x += along * cosA; z -= along * sinA; y += .7; }
      else if (a.type === 'dip') y += .3 + .2 * up01;
      else if (a.type === 'trainer') { x += -.15 * sinA; z += -.15 * cosA; y += .3 + .05 * up01; }
      else if (a.type === 'press') { x += -.35 * sinA; z += -.35 * cosA; y -= .28; }
      else if (a.type === 'twist') heading += .55 * Math.sin(t * 1.3);
      else if (a.type === 'situp') { x += .62 * sinA; z += .62 * cosA; y += .88; pitch = -1.25 + .72 * up01; }
      gymMatrixEuler.set(pitch, heading, 0);
      a.crowd.mesh.setMatrixAt(a.i, matrix.compose(pos.set(x, y, z), quat.setFromEuler(gymMatrixEuler), (night > .6 || shared.crowd.value < .75) && a.i % 3 ? hide : scale));
    }
    gymCrowd.mesh.instanceMatrix.needsUpdate = hangCrowd.mesh.instanceMatrix.needsUpdate = true;
  }

  const KIDS = 24;
  const children = createCrowd(scene, personGeometry(), KIDS, rand, { colors: ['#d9534f', '#f0ad4e', '#5bc0de', '#5cb85c', '#c95f83', '#7b3f75', '#f7f2e8'], mix: 'kids' });
  const playMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .6, metalness: .1 });
  const KID_HIP = .86;
  const anchor = (item) => {
    const g = new THREE.Group();
    g.position.set(item.x, item.y, item.z);
    g.rotation.y = item.angle;
    scene.add(g);
    return g;
  };
  const toWorld = (item, lx, lz) => {
    const c = Math.cos(item.angle), s = Math.sin(item.angle);
    return [item.x + lx * c + lz * s, item.z - lx * s + lz * c];
  };
  const seatGeo = mergeGeometries([part(bar([-.2, 0, 0], [-.2, -2.05, 0], .012), GREY), part(bar([.2, 0, 0], [.2, -2.05, 0], .012), GREY), part(box(.5, .05, .22, 0, -2.1, 0), YELLOW)]);
  const plankGeo = mergeGeometries([part(box(.26, .08, 3.4, 0, -.04, 0), YELLOW), part(bar([-.17, .24, 1.4], [.17, .24, 1.4], .025), RED), part(bar([-.17, .24, -1.4], [.17, .24, -1.4], .025), RED)]);
  const roundParts = [part(new THREE.CylinderGeometry(1.25, 1.25, .08, 18).translate(0, .32, 0), RED), part(bar([0, .3, 0], [0, 1.05, 0], .06), STEEL)];
  for (let i = 0; i < 4; i++) { const t = i * Math.PI / 2, rx = Math.sin(t) * 1.05, rz = Math.cos(t) * 1.05; roundParts.push(part(bar([0, 1, 0], [rx, .75, rz], .025), YELLOW), part(bar([rx, .75, rz], [rx, .34, rz], .025), YELLOW)); }
  const roundGeo = mergeGeometries(roundParts);
  const moving = (geo, parent) => { const m = new THREE.Mesh(geo, playMaterial); m.receiveShadow = true; parent.add(m); return m; };

  const SITTING = [0, 0], WALK = [6, .42], CLIMB = [5, .62];
  const actors = [], animators = [];
  const SLIDE_LOOP = [[0, 0, -3.15, .75, CLIMB], [0, 1.95, -2.05, 1, WALK], [0, 1.92, -1.5, 3, SITTING], [0, .28, 1.35, 1.3, WALK], [1.35, 0, 1.9, 1.5, WALK], [1.35, 0, -3.15, 1.5, WALK]];
  const CLIMB_LOOP = [[-1.75, 0, 0, .4, CLIMB], [-1.75, 1.45, 0, .55, CLIMB], [-1.6, 2.25, .9, .35, CLIMB], [-1.75, 1.2, 1, .45, CLIMB], [-1.75, 0, 1, 1, WALK]];
  const loopLength = (loop) => loop.map((p, i) => { const q = loop[(i + 1) % loop.length]; return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]); });
  for (const item of placedPlay) {
    if (item.name === 'swings') {
      for (const seatX of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(seatX, 2.6, 0);
        anchor(item).add(pivot);
        moving(seatGeo, pivot);
        actors.push({ kind: 'swing', item, pivot, seatX, swing: .34 + rand() * .3, phase: rand() * 6.28 });
      }
    } else if (item.name === 'seesaw') {
      const pivot = new THREE.Group();
      pivot.position.set(0, .55, 0);
      anchor(item).add(pivot);
      moving(plankGeo, pivot);
      const game = { pivot, phase: rand() * 6.28, rate: 1.1 + rand() * .4 };
      animators.push(game);
      actors.push({ kind: 'seesaw', item, game, side: 1 }, { kind: 'seesaw', item, game, side: -1 });
    } else if (item.name === 'round') {
      const spinner = anchor(item);
      moving(roundGeo, spinner);
      const ride = { item, spinner, base: item.angle, spin: 0, rate: .8 };
      animators.push(ride);
      for (let k = 0; k < 3; k++) actors.push({ kind: 'round', item, ride, offset: k / 3 * Math.PI * 2 + .3 });
    } else if (item.name === 'slide') {
      const lengths = loopLength(SLIDE_LOOP);
      for (let k = 0; k < 3; k++) actors.push({ kind: 'loop', item, loop: SLIDE_LOOP, lengths, seg: k * 2 % SLIDE_LOOP.length, d: 0, heading: 0, mode: null });
    } else if (item.name === 'climber') {
      const lengths = loopLength(CLIMB_LOOP);
      for (let k = 0; k < 2; k++) actors.push({ kind: 'loop', item, loop: CLIMB_LOOP, lengths, seg: k * 2, d: 0, heading: 0, mode: null });
    }
  }
  const pickPlayPoint = () => { const t = rand() * 6.28, r = reach(t) * (.25 + rand() * .55); return [park.x + Math.sin(t) * r, park.z + Math.cos(t) * r]; };
  const runnersList = [];
  while (actors.length < KIDS) {
    const [x, z] = pickPlayPoint();
    const r = { kind: 'run', x, z, target: pickPlayPoint(), speed: 1.1 + rand() * 1.1, pause: rand() * 3, heading: rand() * 6.28, moving: null, chase: runnersList.length % 3 === 1 ? runnersList[runnersList.length - 1] : null };
    runnersList.push(r);
    actors.push(r);
  }
  const kidScale = actors.map(() => .54 + rand() * .14);
  actors.forEach((a, i) => { a.index = i; children.setMotion(i, a.kind === 'run' ? 6 : 0, a.kind === 'run' ? .42 : 0); });
  children.commit();
  let motionChanged = false;
  const setKidMotion = (a, m) => { children.setMotion(a.index, m[0], m[1]); motionChanged = true; };
  const placeKid = (a, x, y, z, heading, visible) => {
    const k = kidScale[a.index];
    children.mesh.setMatrixAt(a.index, matrix.compose(pos.set(x, y, z), quat.setFromAxisAngle(up, heading), visible ? scale.setScalar(k) : hide));
  };

  // --- Boats -------------------------------------------------------------------
  const models = boatModels();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .55, envMapIntensity: 1 });
  material.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aPaint;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor = mix(color, color * instanceColor, aPaint);');
  };
  const MOORED = 6, ROAMING = low ? 5 : 8;
  const pedalCount = Math.ceil((MOORED + ROAMING) * .65), rowCount = MOORED + ROAMING - pedalCount;
  const pedal = new THREE.InstancedMesh(models.pedal, material, pedalCount - MOORED), tied = new THREE.InstancedMesh(models.pedalEmpty, material, MOORED), row = new THREE.InstancedMesh(models.row, material, rowCount);
  const BOAT_COLORS = ['#3e8fb5', '#d8533f', '#e0b83f', '#3f9d72', '#f0ece2', '#c95f83'];
  for (const m of [pedal, tied, row]) {
    m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
    for (let i = 0; i < m.count; i++) m.setColorAt(i, new THREE.Color(BOAT_COLORS[i % BOAT_COLORS.length]));
    m.instanceColor.needsUpdate = true;
  }

  const wakeMat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.); }',
    fragmentShader: `varying vec2 vUv; void main() {
      float x = abs(vUv.x - .5) * 2., y = vUv.y;
      float arm = smoothstep(.2, .0, abs(x - y * .85));
      float trail = smoothstep(.22, .0, x) * .55;
      float a = max(arm, trail) * pow(1. - y, 1.5) * smoothstep(0., .04, y) * .55;
      gl_FragColor = vec4(.92, .96, .98, a);
    }`,
  });
  const wakeGeometry = new THREE.PlaneGeometry(6, 14).rotateX(-Math.PI / 2).translate(0, 0, -7);
  const wake = new THREE.InstancedMesh(wakeGeometry, wakeMat, ROAMING);
  wake.frustumCulled = false; wake.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(wake);

  // Moving limbs for everyone out on the water, rebuilt each frame from where their hands and feet should be.
  const LIMBS = ROAMING * 21;
  const limbs = new THREE.InstancedMesh(part(new THREE.CylinderGeometry(1, 1, 1, 7).translate(0, .5, 0), '#ffffff', 1), material, LIMBS);
  const rowerTops = new THREE.InstancedMesh(models.rowerTop, material, rowCount);
  for (const m of [limbs, rowerTops]) { m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
  for (let i = 0; i < rowCount; i++) rowerTops.setColorAt(i, new THREE.Color(BOAT_COLORS[(i + 2) % BOAT_COLORS.length]));
  rowerTops.instanceColor.needsUpdate = true;
  const limbColor = new THREE.Color(), limbUp = new THREE.Vector3(0, 1, 0), limbDir = new THREE.Vector3(), limbQuat = new THREE.Quaternion(), limbScale = new THREE.Vector3(), limbMat = new THREE.Matrix4();
  const SKIN_TONE = '#7b5238', TROUSERS = '#39414d', OAR = '#caa873', CRANK = '#b7bbbd';
  const boatMat = new THREE.Matrix4(), pA = new THREE.Vector3(), pB = new THREE.Vector3();
  const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  let limbIndex = 0;
  function limb(a, b, radius, hex) { // a and b are [x, y, z] in the boat's own space.
    pA.set(...a).applyMatrix4(boatMat); pB.set(...b).applyMatrix4(boatMat);
    limbDir.copy(pB).sub(pA);
    const length = limbDir.length();
    limbQuat.setFromUnitVectors(limbUp, limbDir.divideScalar(length || 1));
    limbs.setMatrixAt(limbIndex, limbMat.compose(pA, limbQuat, limbScale.set(radius, length, radius)));
    limbs.setColorAt(limbIndex++, limbColor.set(hex));
  }
  /** Finds the knee or elbow joining two equal bones, bending towards a given direction. */
  function joint(a, b, bone, bend) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], d = Math.min(Math.hypot(dx, dy, dz), bone * 1.98), h = Math.sqrt(Math.max(0, bone * bone - d * d / 4));
    return [(a[0] + b[0]) / 2 + bend[0] * h, (a[1] + b[1]) / 2 + bend[1] * h, (a[2] + b[2]) / 2 + bend[2] * h];
  }
  function twoBones(a, b, bone, bend, radius, hex) { const m = joint(a, b, bone, bend); limb(a, m, radius, hex); limb(m, b, radius * .9, hex); return m; }
  function drawRower(b, u, drive, topMatrix) {
    const lean = u * .3, zSeat = -.5, zLock = -.95;
    rowerTops.setMatrixAt(b.slot, topMatrix.copy(boatMat).multiply(limbMat.makeTranslation(0, .5, zSeat)).multiply(rotX.makeRotationX(lean)).multiply(rotY.makeRotationY(Math.PI)));
    const angle = u * .55, tipY = .02 + (1 - drive) * .58, lockY = .72;
    for (const side of [-1, 1]) {
      const lock = [side * .62, lockY, zLock];
      const blade = [lock[0] + side * Math.cos(angle) * 1.45, tipY, zLock - Math.sin(angle) * 1.45];
      const handle = [side * .13 + lock[0] * .0 + side * .49 * (1 - Math.cos(angle)), lockY + (lockY - tipY) * .34, zLock + Math.sin(angle) * .5];
      limb(handle, blade, .024, OAR);
      const shoulder = [side * .24, .5 + .46 * Math.cos(lean), zSeat + .46 * Math.sin(lean)];
      twoBones(shoulder, handle, .4, [side * .7, -.7, 0], .05, SKIN_TONE);
      twoBones([side * .1, .52, zSeat], [side * .13, .22, -1.5], .56, [0, 1, 0], .075, TROUSERS);
    }
  }
  function drawPedallers(b, crank, steer) {
    [-.3, .3].forEach((x, person) => {
      const hipZ = -.35, centre = [x, .62, .78];
      let knee = null;
      [-1, 1].forEach((side, leg) => {
        const a = crank + person * 1.1 + leg * Math.PI, foot = [x + side * .1, centre[1] + Math.sin(a) * .15, centre[2] + Math.cos(a) * .15];
        limb(centre, foot, .018, CRANK);
        const k = twoBones([x + side * .1, .55, hipZ], foot, .6, [0, 1, 0], .075, TROUSERS);
        if (side === (person ? 1 : -1)) knee = k;
      });
      // The outer hand rests on the moving knee; the inner hand of the steerer works the lever.
      const outer = person ? 1 : -1, inner = -outer;
      const handle = [Math.sin(steer) * .1, .95, .12 + Math.cos(steer * 3) * .02];
      twoBones([x + outer * .24, .96, hipZ], [knee[0], knee[1] + .08, knee[2]], .34, [outer * .7, -.7, 0], .05, SKIN_TONE);
      const onLever = person === 0;
      twoBones([x + inner * .24, .96, hipZ], onLever ? handle : [knee[0] + inner * .14, knee[1] + .08, knee[2]], .34, [outer * -.2, -.9, .2], .05, SKIN_TONE);
      if (onLever) limb([0, .5, .12], handle, .02, CRANK);
    });
  }
  const rotX = new THREE.Matrix4(), rotY = new THREE.Matrix4(), topM = new THREE.Matrix4();
  function drawCrew(b, boatMatrix, dt) {
    boatMat.copy(boatMatrix);
    const pace = Math.min(1.3, b.speed / 1.5);
    b.stroke = (b.stroke ?? b.phase) + dt * pace * (b.mesh === row ? .55 : 1.25);
    if (b.mesh === row) {
      const s = b.stroke % 1, t = s < .42 ? s / .42 : (s - .42) / .58, ease = t * t * (3 - 2 * t), u = s < .42 ? -1 + 2 * ease : 1 - 2 * ease;
      const edge = Math.min(1, Math.min(s, .42 - s) / .05), drive = s < .42 ? Math.max(0, edge) : 0;
      drawRower(b, u, drive, topM);
    } else drawPedallers(b, b.stroke * Math.PI * 2, b.turn ?? 0);
  }

  const boats = [];
  for (let i = 0; i < MOORED + ROAMING; i++) {
    const usePedal = i < pedalCount;
    boats.push({ mesh: i < MOORED ? tied : usePedal ? pedal : row, slot: i < MOORED ? i : usePedal ? i - MOORED : i - pedalCount, moored: i < MOORED, x: 0, z: 0, heading: 0, speed: 0, phase: rand() * 6.28, cruise: 1.3 + rand() * 1, waypoint: null, length: usePedal ? 3.7 : 4.3 });
  }
  const mooredBoats = boats.filter(b => b.moored).concat();
  // Mooring alternates sides of the jetty.
  // Start far enough along the jetty that every boat floats in open water, clear of the bank.
  const BOAT_GAP = 6.5, ROWS = Math.ceil(MOORED / 2), inWater = (a) => [-1, 1].every(sign => [-2, 2].every(l => [-3.8, -1.6].every(o => { const [x, z] = jet(a + l * 1.1, o * sign); return world.heightAt(x, z) < lake.level - .35; })));
  let firstBerth = 8;
  while (firstBerth < JET - (ROWS - 1) * BOAT_GAP - 3 && !inWater(firstBerth)) firstBerth += .5;
  mooredBoats.forEach((b, i) => {
    const along = firstBerth + Math.floor(i / 2) * BOAT_GAP, side = (i % 2 ? 1 : -1) * (1.6 + (b.length < 4 ? 1.05 : .85) + .35); // Tied up alongside, clear of the deck.
    const [x, z] = jet(along, side);
    b.x = x; b.z = z; b.heading = jetAngle;
  });
  const near = (b) => deep.reduce((best, p) => Math.hypot(p[0] - b.x, p[1] - b.z) < Math.hypot(best[0] - b.x, best[1] - b.z) ? p : best, deep[0]);
  const roaming = boats.filter(b => !b.moored);
  roaming.forEach((b, i) => {
    const [px, pz] = deep[Math.floor(rand() * deep.length)];
    b.x = px; b.z = pz; b.heading = rand() * 6.28; b.speed = b.cruise; void near;
    b.id = i;
  });

  function lineIsDeep(ax, az, bx, bz) {
    const steps = Math.max(2, Math.floor(Math.hypot(bx - ax, bz - az) / 14));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (!data.inside(lake.p, x, z) || distanceToShore(x, z) < 26) return false;
    }
    return true;
  }
  function newWaypoint(b) {
    for (let tries = 0; tries < 40; tries++) {
      const [x, z] = deep[Math.floor(rand() * deep.length)], d = Math.hypot(x - b.x, z - b.z);
      if (d > 90 && d < 380 && lineIsDeep(b.x, b.z, x, z)) { b.waypoint = [x, z]; return; }
    }
    b.waypoint = near(b);
  }
  roaming.forEach(newWaypoint);

  const matrix = new THREE.Matrix4(), euler = new THREE.Euler(0, 0, 0, 'YXZ'), quat = new THREE.Quaternion(), pos = new THREE.Vector3(), scale = new THREE.Vector3(1, 1, 1), hide = new THREE.Vector3(0, 0, 0), up = new THREE.Vector3(0, 1, 0);
  const pathAt = (s, out) => {
    const d = ((s % pathLength) + pathLength) % pathLength;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid - 1; }
    const a = path[lo], b = path[(lo + 1) % n], span = (lo === n - 1 ? pathLength - cum[lo] : cum[lo + 1] - cum[lo]) || 1, t = (d - cum[lo]) / span;
    out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t; out.tx = (b.x - a.x) / span; out.tz = (b.z - a.z) / span;
    out.y = trackY[lo] + (trackY[(lo + 1) % n] - trackY[lo]) * t;
    return out;
  };
  const sampleP = {};
  let time = 0, roamingHidden = false;

  function updateBoat(b, dt, others2) {
    const [wx, wz] = b.waypoint;
    const toward = Math.atan2(wx - b.x, wz - b.z);
    let want = toward, slow = 1;
    for (const o of others2) {
      if (o === b) continue;
      const d = Math.hypot(o.x - b.x, o.z - b.z);
      if (d < 42) {
        const away = Math.atan2(b.x - o.x, b.z - o.z);
        const delta = Math.atan2(Math.sin(away - want), Math.cos(away - want));
        want += delta * (1 - d / 42) * .75;
        if (d < 18) slow = Math.min(slow, Math.max(.25, (d - 8) / 10));
      }
    }
    const delta = Math.atan2(Math.sin(want - b.heading), Math.cos(want - b.heading));
    // Rudder-like steering: the turn rate itself eases in and out.
    const wantTurn = THREE.MathUtils.clamp(delta * .55, -.2, .2);
    b.turn = (b.turn || 0) + (wantTurn - (b.turn || 0)) * Math.min(1, dt * .9);
    b.heading += b.turn * dt;
    b.speed += THREE.MathUtils.clamp(b.cruise * slow - b.speed, -.6 * dt, .3 * dt);
    const nx = b.x + Math.sin(b.heading) * b.speed * dt, nz = b.z + Math.cos(b.heading) * b.speed * dt;
    if (distanceToShore(nx, nz) > 22) { b.x = nx; b.z = nz; } else { b.turn = .2; b.speed *= .99; newWaypoint(b); }
    if (Math.hypot(wx - b.x, wz - b.z) < 16) newWaypoint(b);
  }

  return {
    update(dt, night, camera, focus) {
      time += dt;
      lamps.visible = night > .02; lampMat.opacity = night;
      const showRoaming = night < .5;

      for (const b of roaming) if (showRoaming || b.pinned) updateBoat(b, dt, roaming);
      let w = 0;
      limbIndex = 0;
      for (const b of boats) {
        const visible = b.moored || showRoaming || b.pinned;
        b.y = lake.level;
        const y = lake.level - .28 + Math.sin(time * 1.1 + b.phase) * .05;
        euler.set(Math.sin(time * .9 + b.phase) * .025, b.heading, Math.sin(time * .7 + b.phase) * .03);
        b.mesh.setMatrixAt(b.slot, matrix.compose(pos.set(b.x, y, b.z), quat.setFromEuler(euler), visible ? scale : hide));
        if (!b.moored) {
          if (visible) drawCrew(b, matrix, dt);
          else if (b.mesh === row) rowerTops.setMatrixAt(b.slot, zeroM);
          quat.setFromAxisAngle(up, b.heading);
          wake.setMatrixAt(w++, matrix.compose(pos.set(b.x, lake.level + .06, b.z), quat, visible ? scale.clone().set(1, 1, Math.min(1.2, b.speed / 1.5)) : hide));
        }
      }
      pedal.instanceMatrix.needsUpdate = tied.instanceMatrix.needsUpdate = row.instanceMatrix.needsUpdate = wake.instanceMatrix.needsUpdate = true;
      for (let i = limbIndex; i < LIMBS; i++) limbs.setMatrixAt(i, zeroM);
      limbs.instanceMatrix.needsUpdate = rowerTops.instanceMatrix.needsUpdate = true;
      if (limbs.instanceColor) limbs.instanceColor.needsUpdate = true;
      roamingHidden = !showRoaming;

      const far = focus > 1700;
      joggers.setVisible(!far); statics.setVisible(!far); children.setVisible(!far); gymCrowd.setVisible(!far); hangCrowd.setVisible(!far);
      if (far) return;
      scale.setScalar(1);
      updateGym(time, night);
      const share = (1 - .6 * night) * shared.crowd.value;
      runners.forEach((r, i) => {
        r.s += r.speed * r.dir * dt;
        pathAt(r.s, sampleP);
        const tx = sampleP.tx * r.dir, tz = sampleP.tz * r.dir;
        const x = sampleP.x + tz * r.lateral, z = sampleP.z - tx * r.lateral;
        const want = Math.atan2(tx, tz);
        r.heading = turnToward(r.heading, want, dt);
        r.x = x; r.z = z; r.y = sampleP.y + .18;
        joggers.mesh.setMatrixAt(i, matrix.compose(pos.set(x, r.y, z), quat.setFromAxisAngle(up, r.heading), r.rank < share || r.pinned ? scale.setScalar(r.scale) : hide));
      });
      scale.setScalar(1);
      joggers.mesh.instanceMatrix.needsUpdate = true;

      const dayKids = night < .6 && shared.crowd.value > .75, swingRate = 2.18;
      for (const g of animators) {
        if (g.pivot) { g.tilt = .15 * Math.sin(time * g.rate + g.phase); g.pivot.rotation.x = g.tilt; }
        else { g.spin += g.rate * dt; g.spinner.rotation.y = g.base + g.spin; }
      }
      for (const a of actors) {
        if (a.kind === 'swing') {
          const angle = a.swing * Math.sin(time * swingRate + a.phase);
          a.pivot.rotation.x = angle;
          const [x, z] = toWorld(a.item, a.seatX, -Math.sin(angle) * 2.08);
          placeKid(a, x, a.item.y + 2.6 - Math.cos(angle) * 2.08 - KID_HIP * kidScale[a.index] + .08, z, a.item.angle, dayKids);
        } else if (a.kind === 'seesaw') {
          const lz = a.side * 1.32, [x, z] = toWorld(a.item, 0, lz);
          placeKid(a, x, a.item.y + .55 - lz * Math.sin(a.game.tilt) + .06 - KID_HIP * kidScale[a.index] * .55, z, a.item.angle + (a.side > 0 ? Math.PI : 0), dayKids);
        } else if (a.kind === 'round') {
          const t = a.ride.spin + a.offset, lx = Math.sin(t) * .85, lz = Math.cos(t) * .85, [x, z] = toWorld(a.item, lx, lz);
          placeKid(a, x, a.item.y + .36, z, a.item.angle + t + Math.PI / 2, dayKids);
        } else if (a.kind === 'loop') {
          const p = a.loop[a.seg], q = a.loop[(a.seg + 1) % a.loop.length], len = a.lengths[a.seg] || 1;
          if (a.mode !== p[4]) { a.mode = p[4]; setKidMotion(a, p[4]); }
          a.d += p[3] * dt;
          if (a.d >= len) { a.d = 0; a.seg = (a.seg + 1) % a.loop.length; }
          const t = Math.min(1, a.d / len), lx = p[0] + (q[0] - p[0]) * t, ly = p[1] + (q[1] - p[1]) * t, lz = p[2] + (q[2] - p[2]) * t;
          const want = Math.atan2(q[0] - p[0], q[2] - p[2]);
          if (Math.hypot(q[0] - p[0], q[2] - p[2]) > .05) a.heading = turnToward(a.heading, want, dt);
          const [x, z] = toWorld(a.item, lx, lz);
          placeKid(a, x, a.item.y + ly + (p[4] === SITTING ? .05 - KID_HIP * kidScale[a.index] * .5 : .03), z, a.item.angle + a.heading, dayKids);
        } else {
          let move = false;
          if (a.pause > 0) a.pause -= dt;
          else {
            if (a.chase) a.target = [a.chase.x, a.chase.z];
            const dx = a.target[0] - a.x, dz = a.target[1] - a.z, d = Math.hypot(dx, dz);
            if (d < (a.chase ? 1.6 : .4)) { if (a.chase) a.pause = .4 + rand() * .8; else { a.pause = .6 + rand() * 2.6; a.target = pickPlayPoint(); a.speed = 1.1 + rand() * 1.1; } }
            else {
              move = true;
              const want = Math.atan2(dx, dz);
              a.heading = turnToward(a.heading, want, dt);
              const pace = a.chase ? Math.min(a.speed, a.chase.speed * .94) : a.speed;
              a.x += Math.sin(a.heading) * pace * dt; a.z += Math.cos(a.heading) * pace * dt;
              for (const item of placedPlay) {
                const ox = a.x - item.x, oz = a.z - item.z, od = Math.hypot(ox, oz), keep = item.radius + .35;
                if (od < keep && od > .01) { a.x = item.x + ox / od * keep; a.z = item.z + oz / od * keep; }
              }
            }
          }
          if (a.moving !== move) { a.moving = move; setKidMotion(a, move ? [4.2 + a.speed * 2.6, .36 + a.speed * .13] : SITTING); }
          placeKid(a, a.x, parkY(a.x, a.z) + .03, a.z, a.heading, dayKids);
        }
      }
      scale.setScalar(1);
      if (motionChanged) { children.commit(); motionChanged = false; }
      children.mesh.instanceMatrix.needsUpdate = true;
    },
    /** The running figure closest to a point, with its position filled in even if the crowd is paused far away. */
    nearestJogger(x, z) {
      let best = null, bestD = Infinity;
      for (const r of runners) {
        if (!r.jogging) continue;
        pathAt(r.s, sampleP);
        const tx = sampleP.tx * r.dir, tz = sampleP.tz * r.dir;
        const rx = sampleP.x + tz * r.lateral, rz = sampleP.z - tx * r.lateral, d = Math.hypot(rx - x, rz - z);
        if (d < bestD) { bestD = d; best = r; r.x = rx; r.z = rz; r.y = sampleP.y + .18; r.heading = Math.atan2(tx, tz); }
      }
      return best;
    },
    nearestBoat(x, z) {
      return roaming.reduce((best, b) => Math.hypot(b.x - x, b.z - z) < Math.hypot(best.x - x, best.z - z) ? b : best, roaming[0]);
    },
    views() {
      const e = ex, pierF = frames[pier];
      const y = e.y;
      return {
        lakeside: { pos: [e.x - e.nx * 46 + e.tx * 18, y + 13, e.z - e.nz * 46 + e.tz * 18], target: [e.x, y - 3, e.z] },
        boats: { pos: [pierF.x - pierF.nx * 62 + pierF.tx * 46, lake.level + 11, pierF.z - pierF.nz * 62 + pierF.tz * 46], target: [pierF.x - pierF.nx * 16, lake.level - 4, pierF.z - pierF.nz * 16] },
        park: { pos: [park.x - pierF.nx * 44 - pierF.tx * 14, world.heightAt(park.x, park.z) + 15, park.z - pierF.nz * 44 - pierF.tz * 14], target: [park.x, world.heightAt(park.x, park.z) - 5, park.z] },
      };
    },
    pins() {
      const pierF = frames[pier];
      return [
        { view: 'lakeside', label: 'Exercise Park', at: [ex.x, ex.y + 58, ex.z] },
        { view: 'boats', label: 'Boat Ride', at: [pierF.x - pierF.nx * 14, lake.level + 12, pierF.z - pierF.nz * 14] },
        { view: 'park', label: "Children's Park", at: [park.x, world.heightAt(park.x, park.z) + 13, park.z] },
      ];
    },
    stats() {
      let minShore = Infinity, minGap = Infinity, onLand = 0;
      for (const b of roaming) {
        minShore = Math.min(minShore, distanceToShore(b.x, b.z));
        if (!data.inside(lake.p, b.x, b.z)) onLand++;
        for (const o of roaming) if (o !== b) minGap = Math.min(minGap, Math.hypot(o.x - b.x, o.z - b.z));
      }
      const first = path[0], last = path[n - 1];
      return {
        pathMeters: Math.round(pathLength), loopGap: +Math.hypot(first.x - last.x, first.z - last.z).toFixed(1), pathPoints: n, pathTouchingRoadOrBuilding: data.blockedCount,
        pathShape: (() => {
          let sharpest = 0, at = null, near = 0;
          for (let i = 0; i < n; i++) {
            const a = path[(i - 3 + n) % n], b = path[i], c = path[(i + 3) % n];
            let turn = Math.atan2(c.x - b.x, c.z - b.z) - Math.atan2(b.x - a.x, b.z - a.z);
            turn = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) * 57.3;
            if (turn > sharpest) { sharpest = turn; at = [Math.round(b.x), Math.round(b.z)]; }
          }
          const furthest = data.offsets.reduce((m, o, i) => (o < data.offsets[m] ? i : m), 0);
          return { sharpestTurnDeg: Math.round(sharpest), at, furthestOutM: Math.round(-data.offsets[furthest]), furthestAt: [Math.round(path[furthest].x), Math.round(path[furthest].z)] };
        })(),
        pathWet: path.filter(p => world.heightAt(p.x, p.z) < lake.level + .2).length, reclaimedPoints: data.newShore.filter(v => v < -.5).length,
        offsetRange: [+Math.min(...data.offsets).toFixed(1), +Math.max(...data.offsets).toFixed(1)], minBank: +Math.min(...data.bank).toFixed(1),
        exercise: [Math.round(ex.x), Math.round(ex.z), ex.length, ex.depth], boats: roaming.length, boatMinShore: +minShore.toFixed(1), boatMinGap: +minGap.toFixed(1), boatsOnLand: onLand, roamingHidden,
        park: [park.x, park.z], playItems: placedPlay.length,
      };
    },
  };
}

export { attachGroundShadow };

// Athugala Road up to the back of the Buddha statue: solid tarmac, a car park and a footpath.
import * as THREE from 'three';

function smooth(values, radius, passes) {
  let a = values;
  for (let p = 0; p < passes; p++) a = a.map((_, i) => {
    let sum = 0, count = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(a.length - 1, i + radius); k++) { sum += a[k]; count++; }
    return sum / count;
  });
  return a;
}
const round1 = (v) => Math.round(v * 10) / 10;
const ROAD_HALF = 2.7, SHOULDER = 2.3, BED = 1;

/** Rounds off the mapped road's corners while keeping the points where other roads join it. */
function smoothRoute(points, joins) {
  const raw = [], anchors = [];
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i], len = Math.hypot(bx - ax, bz - az);
    if (i === 1 || joins.has(`${ax},${az}`)) anchors.push(raw.length);
    if (joins.has(`${ax},${az}`)) raw.push([ax, az]);
    const count = Math.max(1, Math.round(len / 3));
    for (let k = joins.has(`${ax},${az}`) ? 1 : 0; k < count; k++) raw.push([ax + (bx - ax) * k / count, az + (bz - az) * k / count]);
  }
  raw.push(points[points.length - 1]);
  anchors.push(raw.length - 1);
  const fixed = [...new Set(anchors)].sort((a, b) => a - b);
  let xs = smooth(raw.map(p => p[0]), 4, 2), zs = smooth(raw.map(p => p[1]), 4, 2);
  // Ease the smoothed line back onto every join point.
  const offsetX = new Array(raw.length).fill(0), offsetZ = new Array(raw.length).fill(0);
  for (const a of fixed) {
    const ex = raw[a][0] - xs[a], ez = raw[a][1] - zs[a];
    for (let i = Math.max(0, a - 12); i <= Math.min(raw.length - 1, a + 12); i++) {
      const w = 1 - Math.abs(i - a) / 12;
      if (Math.abs(offsetX[i]) + Math.abs(offsetZ[i]) === 0 || w > .5) { offsetX[i] = ex * w; offsetZ[i] = ez * w; }
    }
  }
  xs = xs.map((x, i) => x + offsetX[i]); zs = zs.map((z, i) => z + offsetZ[i]);
  const out = xs.map((x, i) => [round1(x), round1(zs[i])]);
  for (const a of fixed) out[a] = raw[a];
  return out.filter((p, i) => !i || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1]);
}

/** Runs before the street network is built, so this road and its turning loop join it. */
export function prepareTempleRoad(world) {
  const { statue, clock } = world.landmarks;
  const road = world.roads.find((r) => {
    if (r.c !== 'residential') return false;
    let len = 0;
    for (let i = 1; i < r.p.length; i++) len += Math.hypot(r.p[i][0] - r.p[i - 1][0], r.p[i][1] - r.p[i - 1][1]);
    return len > 1000 && Math.min(...r.p.map(([x, z]) => Math.hypot(x - statue.x, z - statue.z))) < 120;
  });
  const fromStatue = (p) => Math.hypot(p[0] - statue.x, p[1] - statue.z);
  if (fromStatue(road.p[0]) < fromStatue(road.p[road.p.length - 1])) road.p.reverse();
  road.temple = true;

  // The statue faces the town, so "rear" points directly away from the Clock Tower.
  const facing = Math.hypot(statue.x - clock.x, statue.z - clock.z);
  const rearX = (statue.x - clock.x) / facing, rearZ = (statue.z - clock.z) / facing;
  const dx = -rearX, dz = -rearZ, lx = dz, lz = -dx;

  const P0 = road.p[road.p.length - 1], before = road.p[road.p.length - 2];
  const l0 = Math.hypot(P0[0] - before[0], P0[1] - before[1]);
  const t0 = [(P0[0] - before[0]) / l0, (P0[1] - before[1]) / l0];
  const J = [round1(statue.x + rearX * 63), round1(statue.z + rearZ * 63)];
  const P1 = [P0[0] + t0[0] * 8, P0[1] + t0[1] * 8], P2 = [J[0] - dx * 8, J[1] - dz * 8];
  for (let k = 1; k <= 12; k++) {
    const t = k / 12, u = 1 - t;
    road.p.push(k === 12 ? J : [
      round1(u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * J[0]),
      round1(u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * J[1]),
    ]);
  }

  const joins = new Set();
  for (const r of world.roads) {
    if (r === road) continue;
    for (const p of r.p) if (road.p.some(q => q[0] === p[0] && q[1] === p[1])) joins.add(`${p[0]},${p[1]}`);
  }
  road.p = smoothRoute(road.p, joins);
  const line = road.p;
  const count = line.length, arrive = statue.y + 5, EASE = 26;
  const heightsAlong = smooth(line.map(([x, z]) => world.heightAt(x, z)), 6, 3).map((y, i) => {
    const t = Math.min(1, Math.max(0, (i - (count - EASE)) / (EASE - 1)));
    return y + (arrive - y) * t * t * (3 - 2 * t);
  });
  const topY = arrive;

  const centre = [J[0] + dx * 15, J[1] + dz * 15], PAD = 19.5;
  const point = (th) => {
    const f = 30 * (1 - Math.cos(th)) / 2, g = 12 * Math.sin(th) * (1 - Math.cos(th)) / 2;
    return [round1(J[0] + dx * f + lx * g), round1(J[1] + dz * f + lz * g)];
  };
  const half1 = [J], half2 = [];
  for (let k = 1; k <= 18; k++) half1.push(point(k / 18 * Math.PI));
  half2.push(half1[half1.length - 1]);
  for (let k = 1; k < 18; k++) half2.push(point(Math.PI + k / 18 * Math.PI));
  half2.push(J);
  world.templeLoop = [half1, half2];

  const bays = [], parking = [];
  for (const side of [1, -1]) for (let f = 8.5; f <= 21; f += 3) bays.push({ f, side, x: J[0] + dx * f + lx * 13.2 * side, z: J[1] + dz * f + lz * 13.2 * side });
  bays.forEach((b, i) => { if ((i * 7 + 3) % 10 < 7) parking.push({ x: b.x, z: b.z, heading: Math.atan2(-lx * b.side, -lz * b.side) }); });
  world.templeParking = parking;

  const tip = point(Math.PI);
  const walkTo = [statue.x + rearX * 15.5, statue.z + rearZ * 15.5];
  const footLine = [], footY = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    footLine.push([tip[0] + (walkTo[0] - tip[0]) * t, tip[1] + (walkTo[1] - tip[1]) * t]);
    footY.push(topY + (statue.y + .6 - topY) * t);
  }

  // The land is cut just below the road surface, wide enough that it can never poke through.
  const { N, half, cell, heights } = world;
  const nearest = new Map(), CORE = 13, REACH = 24;
  const carve = (pts, ys) => pts.forEach(([x, z], p) => {
    for (let j = Math.max(0, Math.floor((z - REACH + half) / cell)); j <= Math.min(N - 1, Math.ceil((z + REACH + half) / cell)); j++) {
      for (let i = Math.max(0, Math.floor((x - REACH + half) / cell)); i <= Math.min(N - 1, Math.ceil((x + REACH + half) / cell)); i++) {
        const d = Math.hypot(-half + i * cell - x, -half + j * cell - z), k = j * N + i, best = nearest.get(k);
        if (d <= REACH && (!best || d < best.d)) nearest.set(k, { d, y: ys[p] });
      }
    }
  });
  carve(line, heightsAlong);
  carve(footLine, footY);
  for (const [k, { d, y }] of nearest) heights[k] += (y - .8 - heights[k]) * (1 - Math.max(0, (d - CORE) / (REACH - CORE)));
  const PAD_CORE = PAD + 10, PAD_SOFT = 8;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const d = Math.hypot(-half + i * cell - centre[0], -half + j * cell - centre[1]);
    if (d < PAD_CORE + PAD_SOFT) heights[j * N + i] += (topY - .8 - heights[j * N + i]) * (1 - Math.max(0, (d - PAD_CORE) / PAD_SOFT));
  }

  // Everything standing on the road uses its true surface, not the coarser land beneath.
  const landHeight = world.heightAt;
  const CELL = 8, hash = new Map();
  const add = (i) => {
    const key = `${Math.floor(line[i][0] / CELL)},${Math.floor(line[i][1] / CELL)}`;
    if (!hash.has(key)) hash.set(key, []);
    hash.get(key).push(i);
  };
  line.forEach((_, i) => add(i));
  world.heightAt = (x, z) => {
    if (Math.hypot(x - centre[0], z - centre[1]) <= PAD) return topY;
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    let best = Infinity, y = null;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const a of hash.get(`${ci + i},${cj + j}`) || []) {
      for (const b of [a, a + 1]) {
        if (b < 1 || b >= count) continue;
        const [ax, az] = line[b - 1], [bx, bz] = line[b], dx2 = bx - ax, dz2 = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx2 + (z - az) * dz2) / (dx2 * dx2 + dz2 * dz2 || 1)));
        const d = Math.hypot(x - ax - dx2 * t, z - az - dz2 * t);
        if (d < best) { best = d; y = heightsAlong[b - 1] + (heightsAlong[b] - heightsAlong[b - 1]) * t; }
      }
    }
    if (best > ROAD_HALF + SHOULDER) return landHeight(x, z);
    return y - Math.max(0, best - ROAD_HALF) / SHOULDER * BED;
  };

  // Forest grows up both sides of the road and around the car park.
  const forest = line.filter(([x, z], i) => i % 2 === 0 && Math.hypot(x - centre[0], z - centre[1]) > PAD + 22);
  world.templeForest = forest;
  const fade = 42, solid = 28;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    if (!world.rock[k]) continue;
    const x = -half + i * cell, z = -half + j * cell;
    let d = Infinity;
    for (const [px, pz] of forest) { const q = Math.abs(px - x) + Math.abs(pz - z); if (q < d * 1.5) d = Math.min(d, Math.hypot(px - x, pz - z)); }
    if (d < fade) world.rock[k] = Math.round(world.rock[k] * Math.max(0, (d - solid) / (fade - solid)));
  }

  (world.keepClear ||= []).push({ line, width: 11 }, { circle: centre, radius: PAD + 16 }, { circle: [statue.x, statue.z], radius: 45 }, { line: footLine, width: 7 });
  world.stairLine = [...(world.stairLine || []), ...line.filter((_, i) => i % 3 === 0), centre, tip, walkTo];
  world.buildings = world.buildings.filter(b => Math.hypot(b.p[0] - centre[0], b.p[1] - centre[1]) > PAD + 3);
  return { line, heightsAlong, J, dx, dz, lx, lz, centre, PAD, half1, half2, bays, footLine, footY, topY };
}

function surfaceMaterial(color, offset) {
  return new THREE.MeshStandardMaterial({ color, roughness: .94, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset });
}
function sides(line, i) {
  const [ax, az] = line[Math.max(0, i - 2)], [bx, bz] = line[Math.min(line.length - 1, i + 2)], l = Math.hypot(bx - ax, bz - az) || 1;
  return [(bz - az) / l, -(bx - ax) / l];
}
function mesh(positions, material, shadow = true) {
  // Every triangle must face upwards, or the surface is lit from below and looks brown.
  for (let i = 0; i < positions.length; i += 9) {
    const ux = positions[i + 3] - positions[i], uz = positions[i + 5] - positions[i + 2], vx = positions[i + 6] - positions[i], vz = positions[i + 8] - positions[i + 2];
    if (uz * vx - ux * vz < 0) for (let k = 0; k < 3; k++) [positions[i + 3 + k], positions[i + 6 + k]] = [positions[i + 6 + k], positions[i + 3 + k]];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = shadow;
  return m;
}
const quad = (out, a, b, c, d) => out.push(...a, ...c, ...b, ...b, ...c, ...d);

export function buildTempleRoad(world, scene, data) {
  const { line, heightsAlong, centre, PAD, bays, dx, dz, lx, lz, J, topY } = data;
  const tarmac = [], shoulder = [], paint = [];
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1], [bx, bz] = line[i], ya = heightsAlong[i - 1], yb = heightsAlong[i];
    const [anx, anz] = sides(line, i - 1), [bnx, bnz] = sides(line, i);
    const at = (x, y, z, nx, nz, o, drop) => [x + nx * o, y - drop, z + nz * o];
    quad(tarmac, at(ax, ya, az, anx, anz, ROAD_HALF, 0), at(ax, ya, az, anx, anz, -ROAD_HALF, 0), at(bx, yb, bz, bnx, bnz, ROAD_HALF, 0), at(bx, yb, bz, bnx, bnz, -ROAD_HALF, 0));
    for (const s of [1, -1]) quad(shoulder, at(ax, ya, az, anx, anz, s * ROAD_HALF, .02), at(ax, ya, az, anx, anz, s * (ROAD_HALF + SHOULDER), BED), at(bx, yb, bz, bnx, bnz, s * ROAD_HALF, .02), at(bx, yb, bz, bnx, bnz, s * (ROAD_HALF + SHOULDER), BED));
    if (i % 3 === 0) quad(paint, at(ax, ya + .03, az, anx, anz, .07, 0), at(ax, ya + .03, az, anx, anz, -.07, 0), at(bx, yb + .03, bz, bnx, bnz, .07, 0), at(bx, yb + .03, bz, bnx, bnz, -.07, 0));
  }

  // Car park slab with a sloped edge down to the land.
  const slab = [], edge = [], SEGMENTS = 64;
  for (let a = 0; a < SEGMENTS; a++) {
    const t0 = a / SEGMENTS * Math.PI * 2, t1 = (a + 1) / SEGMENTS * Math.PI * 2;
    const ring = (t, r, y) => [centre[0] + Math.sin(t) * r, y, centre[1] + Math.cos(t) * r];
    slab.push(...ring(t0, 0, topY), ...ring(t1, PAD, topY), ...ring(t0, PAD, topY));
    quad(edge, ring(t0, PAD, topY - .02), ring(t0, PAD + 1.2, topY - 1.2), ring(t1, PAD, topY - .02), ring(t1, PAD + 1.2, topY - 1.2));
  }
  const marks = [];
  for (const b of bays) for (const shift of [-1.5, 1.5]) {
    const x = J[0] + dx * (b.f + shift) + lx * 13.2 * b.side, z = J[1] + dz * (b.f + shift) + lz * 13.2 * b.side, y = topY + .05, ux = lx * 2.4, uz = lz * 2.4, wx = dx * .07, wz = dz * .07;
    quad(marks, [x - ux + wx, y, z - uz + wz], [x - ux - wx, y, z - uz - wz], [x + ux + wx, y, z + uz + wz], [x + ux - wx, y, z + uz - wz]);
  }

  const grass = surfaceMaterial('#68753f', -1);
  const asphalt = surfaceMaterial('#4a4843', -3); // One surface for the road and the whole turning area.
  scene.add(mesh(shoulder, grass), mesh(edge, surfaceMaterial('#8f8a7c', -1)), mesh(slab, asphalt), mesh(tarmac, asphalt), mesh(paint, surfaceMaterial('#e7e2d2', -6), false), mesh(marks, surfaceMaterial('#ece8db', -7), false));

  // A planted island that the turning traffic circles.
  const ix = J[0] + dx * 21, iz = J[1] + dz * 21;
  const solid = (geo, color, y) => { const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: .9 })); m.position.set(ix, topY + y, iz); m.castShadow = m.receiveShadow = true; scene.add(m); };
  solid(new THREE.CylinderGeometry(4.5, 4.6, .3, 40), '#d8d2c0', .15);
  solid(new THREE.CylinderGeometry(4.15, 4.15, .32, 40), '#6f8a45', .17);
  solid(new THREE.CylinderGeometry(.22, .34, 3, 10), '#6b4a30', 1.8);
  solid(new THREE.IcosahedronGeometry(2.1, 1), '#4f7f3c', 4.4);

  return {
    view() {
      return { pos: [centre[0] + lx * 38 - dx * 34, topY + 24, centre[1] + lz * 38 - dz * 34], target: [centre[0] + dx * 18, topY - 1, centre[1] + dz * 18] };
    },
    stats() {
      let poke = 0, worst = 0;
      for (let i = 0; i < line.length; i++) for (const o of [-ROAD_HALF, 0, ROAD_HALF]) {
        const [nx, nz] = sides(line, i), x = line[i][0] + nx * o, z = line[i][1] + nz * o;
        const fx = (x + world.half) / world.cell, fz = (z + world.half) / world.cell, i0 = Math.floor(fx), j0 = Math.floor(fz), u = fx - i0, v = fz - j0, H = world.heights, N2 = world.N, k = j0 * N2 + i0;
        const land = u + v < 1 ? H[k] + (H[k + 1] - H[k]) * u + (H[k + N2] - H[k]) * v : H[k + N2 + 1] + (H[k + N2] - H[k + N2 + 1]) * (1 - u) + (H[k + 1] - H[k + N2 + 1]) * (1 - v);
        const over = land - heightsAlong[i];
        if (over > 0) poke++;
        worst = Math.max(worst, over);
      }
      let sharpest = 0;
      for (let i = 2; i < line.length; i++) {
        const a = Math.atan2(line[i - 1][0] - line[i - 2][0], line[i - 1][1] - line[i - 2][1]), b = Math.atan2(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
        sharpest = Math.max(sharpest, Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))));
      }
      return { points: line.length, landPokingThrough: poke, worstOver: +worst.toFixed(2), sharpestBendDeg: Math.round(sharpest * 57.3) };
    },
  };
}

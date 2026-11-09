// Town landmarks on their mapped sites: cricket stadium, mosque and kovil.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { mulberry } from './world.js';
import { part } from './traffic.js';
import { drapedGrid } from './lakeside.js';
import { createCrowd, personGeometry, CLOTHES } from './people.js';

function inside(poly, x, z) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) hit = !hit;
  }
  return hit;
}
const footprintCentre = (b) => { let x = 0, z = 0; for (let i = 0; i < b.p.length; i += 2) { x += b.p[i]; z += b.p[i + 1]; } return [x / (b.p.length / 2), z / (b.p.length / 2)]; };
function summary(poly) {
  const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2 };
}

/** Clears the sites and levels the land, before streets, ground and trees are made. */
export function preparePlaces(world) {
  const { stadium, mosque, kovil } = world.landmarks.places;
  const zones = [stadium, mosque, kovil];
  world.buildings = world.buildings.filter((b) => { const [x, z] = footprintCentre(b); return !zones.some(p => inside(p, x, z)); });
  const site = { stadium: summary(stadium), mosque: summary(mosque), kovil: summary(kovil) };
  const { N, half, cell, heights } = world;
  const level = (s, soft) => {
    const y = world.heightAt(s.x, s.z), reach = Math.max(s.hx, s.hz) + soft;
    for (let j = Math.max(0, Math.floor((s.z - reach + half) / cell)); j <= Math.min(N - 1, Math.ceil((s.z + reach + half) / cell)); j++) {
      for (let i = Math.max(0, Math.floor((s.x - reach + half) / cell)); i <= Math.min(N - 1, Math.ceil((s.x + reach + half) / cell)); i++) {
        const d = Math.max(0, Math.hypot((-half + i * cell - s.x) / s.hx, (-half + j * cell - s.z) / s.hz) - 1) * Math.max(s.hx, s.hz);
        const blend = 1 - Math.min(1, d / soft);
        if (blend > 0) heights[j * N + i] += (y - heights[j * N + i]) * blend;
      }
    }
    s.y = y;
  };
  level(site.stadium, 16);
  level(site.mosque, 8);
  level(site.kovil, 10);
  (world.keepClear ||= []).push(
    { circle: [site.stadium.x, site.stadium.z], radius: Math.max(site.stadium.hx, site.stadium.hz) * .94 },
    { circle: [site.mosque.x, site.mosque.z], radius: 24 },
    { circle: [site.kovil.x, site.kovil.z], radius: 36 },
  );
  return site;
}

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const dome = (r, x, y, z) => new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, y, z);
const cylinder = (r0, r1, h, x, y, z, sides = 18) => new THREE.CylinderGeometry(r0, r1, h, sides).translate(x, y + h / 2, z);

function solid(parts, scene, x, y, z, angle = 0) {
  const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .72 }));
  mesh.position.set(x, y, z);
  mesh.rotation.y = angle;
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
}

function buildStadium(world, scene, s, low) {
  const rand = mulberry(5151);
  const rx = s.hx * .7, rz = s.hz * .7;
  const ring = (fraction, rings, segs = 72) => {
    const points = [];
    for (let r = 0; r <= rings; r++) for (let a = 0; a <= segs; a++) {
      const t = a / segs * Math.PI * 2, k = fraction * r / rings;
      points.push([s.x + Math.sin(t) * rx * k, s.z + Math.cos(t) * rz * k]);
    }
    return { points, rings, segs };
  };
  const disc = (fraction, hex, lift) => { const g = ring(fraction, 5); scene.add(drapedGrid(world, g.points, g.rings, g.segs, hex, lift)); };
  disc(1.03, '#d6d2c2', .06);   // Boundary rope.
  disc(1, '#6c9f49', .1);       // Outfield.
  disc(.45, '#7aae52', .14);    // Inner circle.
  const rect = (hw, hl, hex, lift, offset = 0) => {
    const points = [];
    for (let r = 0; r <= 4; r++) for (let c = 0; c <= 1; c++) points.push([s.x + (c ? hw : -hw), s.z + offset - hl + hl * 2 * r / 4]);
    scene.add(drapedGrid(world, points, 4, 1, hex, lift));
  };
  rect(1.6, 11.5, '#c8b388', .18);
  rect(1.5, .06, '#f2eee0', .22, 9.5);
  rect(1.5, .06, '#f2eee0', .22, -9.5);

  // Stands follow the oval, with an open arc so the ground reads clearly.
  const parts = [];
  const STANDS = 46, seats = [];
  const COLORS = ['#a8c4d8', '#e0b83f', '#c7543f', '#a8c4d8', '#3e8f6c'];
  for (let a = 0; a < STANDS; a++) {
    const t = a / STANDS * Math.PI * 2;
    if (Math.sin(t) < -.45) continue;
    const dx = Math.sin(t), dz = Math.cos(t), angle = Math.atan2(dx * rz, dz * rx);
    const width = Math.PI * 2 * Math.max(rx, rz) / STANDS * 1.02;
    for (let tier = 0; tier < 3; tier++) {
      const out = 1.09 + tier * .055, x = s.x + dx * rx * out, z = s.z + dz * rz * out, h = 1 + tier * 1.7;
      parts.push(part(new THREE.BoxGeometry(width, h, 4.4).rotateY(angle).translate(x, s.y + h / 2, z), COLORS[Math.floor(a / 5) % COLORS.length]));
      if (a % 2 === 0) seats.push({ x, y: s.y + h, z, angle: angle + Math.PI });
    }
  }
  // Main pavilion with a roof, on the eastern side.
  const pavilion = [box(46, 9, 11, 0, 0, 0), box(50, .5, 15, 0, 9, 1)].map((g, i) => part(g, i ? '#c2453a' : '#efe7d3'));
  pavilion.push(part(box(40, 1.7, .2, 0, 4.4, -5.6), '#2a3640'));
  solid(pavilion, scene, s.x + rx * 1.32, s.y, s.z, -Math.PI / 2);

  // Four floodlight masts.
  for (const [ox, oz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = s.x + ox * rx * .93, z = s.z + oz * rz * .93, y = world.heightAt(x, z);
    parts.push(part(cylinder(.3, .5, 36, x, y, z, 8), '#c9c9c4'), part(box(6, 3, .5, x, y + 35, z), '#e8e4d2'));
  }
  // The scoreboard stands at the open end.
  parts.push(part(box(18, 8, 1, s.x, s.y + 2.5, s.z - rz * 1.12), '#20343a'), part(box(.6, 3, .6, s.x - 7, s.y, s.z - rz * 1.12), '#555'), part(box(.6, 3, .6, s.x + 7, s.y, s.z - rz * 1.12), '#555'));
  solid(parts, scene, 0, 0, 0);

  const SPECTATORS = low ? 70 : 170;
  const crowd = createCrowd(scene, personGeometry(), SPECTATORS, rand, { colors: CLOTHES });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), zero = new THREE.Vector3();
  for (let i = 0; i < SPECTATORS; i++) {
    const seat = seats[Math.floor(rand() * seats.length)];
    crowd.setMotion(i, 0, 0);
    crowd.mesh.setMatrixAt(i, m.compose(p.set(seat.x + (rand() - .5) * 2, seat.y, seat.z + (rand() - .5) * 2), q.setFromAxisAngle(up, seat.angle), one));
  }
  crowd.commit();
  crowd.mesh.instanceMatrix.needsUpdate = true;

  // A game in progress: fielders set around the ground, with a bowler running in.
  const players = createCrowd(scene, personGeometry(), 13, rand, { colors: ['#f4f1e6'], mix: 'sport' });
  const FIELD = [[0, -10.7], [0, 10.2], [.1, 12.7], [-2, 8], [6, 6], [-8, -2], [.45, .35], [-.5, .4], [.72, -.3], [-.7, -.5], [.3, -.72], [-.2, .7]];
  FIELD.forEach(([a, b], i) => {
    const x = i < 4 || (i >= 4 && i < 6) ? s.x + a : s.x + a * rx, z = i < 6 ? s.z + b : s.z + b * rz, h = world.heightAt(x, z) + .1;
    players.setMotion(i, 0, 0);
    players.mesh.setMatrixAt(i, m.compose(p.set(x, h, z), q.setFromAxisAngle(up, Math.atan2(s.x - x, s.z - z)), one));
  });
  players.setMotion(12, 11, .78);
  players.commit();
  players.mesh.instanceMatrix.needsUpdate = true;
  let run = 0;
  return {
    update(dt, night, far) {
      crowd.setVisible(!far && night < .5); players.setVisible(!far && night < .5);
      if (far) return;
      run = (run + dt * .2) % 1;
      const forward = run < .55, u = forward ? run / .55 : 1 - (run - .55) / .45;
      const z = s.z - 9.5 - 16 * (1 - u);
      players.mesh.setMatrixAt(12, m.compose(p.set(s.x + 1, world.heightAt(s.x + 1, z) + .1, z), q.setFromAxisAngle(up, forward ? 0 : Math.PI), one));
      players.mesh.instanceMatrix.needsUpdate = true;
    },
    view: { pos: [s.x - rx * .55, s.y + 58, s.z + rz * 1.6], target: [s.x, s.y + 2, s.z - 8] },
  };
  void zero;
}

function buildMosque(world, scene, s) {
  const W = '#f4f0e4', G = '#3e8f6c', T = '#cfc5ae', D = '#35404a';
  const parts = [
    part(box(26, 1, 21, 0, -1, 0), T), part(box(22, 7, 17, 0, 0, 0), W), part(box(23, .6, 18, 0, 7, 0), T),
    part(cylinder(5.4, 5.4, 2.4, 0, 7.6, 0, 24), W), part(dome(5.7, 0, 10, 0), G), part(cylinder(.14, .2, 1.6, 0, 15.6, 0, 8), '#d6b34a'),
  ];
  parts.push(part(new THREE.TorusGeometry(.5, .08, 8, 18, 4.6).rotateZ(.7).translate(0, 17.7, 0), '#d6b34a'));
  for (const x of [-8, -4, 0, 4, 8]) parts.push(part(box(2, 4.2, .15, x, 1.1, 8.55), D), part(dome(1, x, 5.3, 8.55).scale(1, 1, .08).translate(0, 0, 8), D), part(box(2, 4.2, .15, x, 1.1, -8.55), D));
  for (const z of [-5, 0, 5]) for (const x of [-11.05, 11.05]) parts.push(part(box(.15, 4.2, 2, x, 1.1, z), D));
  for (const x of [-10, 10]) {
    parts.push(part(cylinder(1.2, 1.5, 19, x, 0, 8.4, 12), W), part(cylinder(1.9, 1.7, .8, x, 13, 8.4, 12), G), part(cylinder(.9, 1, 3, x, 19, 8.4, 12), W), part(dome(1.15, x, 22, 8.4), G), part(cylinder(.05, .1, 1.2, x, 23.1, 8.4, 6), '#d6b34a'));
  }
  const angle = s.hz > s.hx ? Math.PI / 2 : 0;
  solid(parts, scene, s.x, s.y, s.z, angle);
  return { view: { pos: [s.x + 34, s.y + 20, s.z + 34], target: [s.x, s.y + 7, s.z] } };
}

function buildKovil(world, scene, s) {
  // The gateway tower goes on the side closest to a road.
  let best = { d: Infinity, side: [0, 1] };
  for (const r of world.roads) for (const [x, z] of r.p) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d < best.d) best = { d, side: Math.abs(x - s.x) > Math.abs(z - s.z) ? [Math.sign(x - s.x), 0] : [0, Math.sign(z - s.z)] };
  }
  const angle = Math.atan2(best.side[0], best.side[1]);
  const hw = Math.max(16, Math.min(s.hx, s.hz) * .86);
  const parts = [];
  const STRIPE = ['#b5462d', '#efe7d3'];
  for (let i = -hw; i < hw; i += 2) for (const [a, b, c, d] of [[i, hw, 2, .5], [i, -hw, 2, .5], [hw, i, .5, 2], [-hw, i, .5, 2]]) {
    if (b === hw && c === 2 && Math.abs(i + 1) < 5) continue; // Gateway opening.
    parts.push(part(box(c, 2.2, d, a + (c === 2 ? 1 : 0), 0, b + (d === 2 ? 1 : 0)), STRIPE[Math.abs(Math.round(i / 2)) % 2]));
  }
  // Gopuram: stacked, narrowing tiers in bright colours.
  const TIERS = ['#d9583c', '#e8b23a', '#3e8fc2', '#d9583c', '#4aa36f', '#e8b23a', '#c95f83'];
  let y = 0, w = 12, d = 7;
  parts.push(part(box(12.5, 6, 7.5, 0, 0, hw), '#efe7d3'), part(box(4.6, 5, 8, 0, 0, hw), '#2b2622'));
  y = 6;
  TIERS.forEach((hex) => {
    parts.push(part(box(w, 1.5, d, 0, y, hw), hex), part(box(w * .9, .35, d * .9, 0, y + 1.5, hw), '#f5ecd7'));
    for (let x = -w / 2 + .9; x < w / 2 - .4; x += 1.6) parts.push(part(box(.5, .9, .3, x, y + .3, hw + d / 2 + .05), '#f4d9a0'));
    y += 1.85; w -= 1.25; d -= .55;
  });
  parts.push(part(box(w + 1, 1, d + .6, 0, y, hw), '#c9403a'));
  for (const x of [-1.2, 0, 1.2]) parts.push(part(cylinder(.08, .3, 1.2, x, y + 1, hw, 8), '#d6b34a'));

  // Pillared hall and the inner shrine with its own tower.
  parts.push(part(box(16, .7, 12, 0, 0, 3), '#d8cfba'), part(box(17, .6, 13, 0, 5.2, 3), '#c9403a'));
  for (const x of [-7, -3.5, 0, 3.5, 7]) for (const z of [-2.2, 3, 8.2]) parts.push(part(cylinder(.3, .36, 4.5, x, .7, z, 10), '#efe7d3'));
  parts.push(part(box(9, 6.5, 9, 0, 0, -8), '#efe7d3'));
  let ty = 6.5, tw = 8.4;
  for (const hex of ['#e8b23a', '#3e8fc2', '#d9583c', '#4aa36f']) { parts.push(part(box(tw, 1.5, tw, 0, ty, -8), hex)); ty += 1.6; tw -= 1.9; }
  parts.push(part(dome(1.1, 0, ty, -8), '#d6b34a'));
  solid(parts, scene, s.x, s.y, s.z, angle);
  const front = [Math.sin(angle), Math.cos(angle)];
  return { view: { pos: [s.x + front[0] * 48 + front[1] * 16, s.y + 32, s.z + front[1] * 48 - front[0] * 16], target: [s.x + front[0] * 6, s.y + 7, s.z + front[1] * 6] } };
}

// Stadium, mosque and kovil are temporarily off the map; their sites stay cleared.
// To restore them, set this to true and uncomment their buttons in index.html.
const SHOW_PLACES = false;

export function buildPlaces(world, scene, site, { low = false } = {}) {
  const stadium = SHOW_PLACES ? buildStadium(world, scene, site.stadium, low) : null;
  const mosque = SHOW_PLACES ? buildMosque(world, scene, site.mosque) : null;
  const kovil = SHOW_PLACES ? buildKovil(world, scene, site.kovil) : null;
  return {
    update(dt, night, focus) { stadium?.update(dt, night, focus > 2200); },
    views: SHOW_PLACES ? { stadium: stadium.view, mosque: mosque.view, kovil: kovil.view } : {},
    stats: () => ({ stadium: [Math.round(site.stadium.x), Math.round(site.stadium.z)], mosque: [Math.round(site.mosque.x), Math.round(site.mosque.z)], kovil: [Math.round(site.kovil.x), Math.round(site.kovil.z)] }),
  };
}

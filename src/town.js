// Buildings from real OSM footprints, street lights, and trees placed around them.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { shared, mulberry } from './world.js';

const FLOOR = 3.2, CHUNKS = 8;
const WALLS = ['#e8dfc9', '#f0e7d6', '#d9c7a2', '#e7d3b6', '#cfdcc9', '#dfc7c0', '#e9e1b8', '#c9d6df', '#f3efe6', '#d8b98e'];
const SHOP_WALLS = ['#f2eee4', '#e6e2d8', '#d6d8d6', '#efe2c8', '#c9d5dc', '#ddd2bf'];
const TILES = ['#9c5a3f', '#8f5340', '#a7694b', '#83503f', '#976348', '#75503f'];
const CONCRETE = ['#b4b0a6', '#a39f96', '#c3beb2', '#928f88'];

class Sink {
  pos = []; nor = []; col = []; uv = [];
  tri(a, b, c, n, color, ua = -1, ub = -1, uc = -1) {
    for (const [p, u] of [[a, ua], [b, ub], [c, uc]]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color.r, color.g, color.b);
      this.uv.push(u === -1 ? -1 : u[0], u === -1 ? -1 : u[1]);
    }
  }
  /** Adds a triangle facing up, computing its normal. */
  face(a, b, c, color) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const m = Math.hypot(nx, ny, nz) || 1;
    if (ny < 0) { [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz; }
    this.tri(a, b, c, [nx / m, ny / m, nz / m], color);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

function orientedBox(pts) {
  let best = 0, angle = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d > best) { best = d; angle = Math.atan2(q[1] - p[1], q[0] - p[0]); }
  });
  const ca = Math.cos(angle), sa = Math.sin(angle);
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const [x, z] of pts) {
    const a = x * ca + z * sa, b = -x * sa + z * ca;
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  const at = (a, b) => [a * ca - b * sa, a * sa + b * ca];
  return { a0, a1, b0, b1, at, area: (a1 - a0) * (b1 - b0) };
}

function addBuilding(sink, b, world, tmp) {
  const rand = mulberry(b.s * 7919 + 13);
  let pts = [];
  for (let i = 0; i < b.p.length; i += 2) pts.push([b.p[i], b.p[i + 1]]);
  let area2 = 0;
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; area2 += p[0] * q[1] - q[0] * p[1]; });
  if (area2 < 0) pts.reverse();
  const area = Math.abs(area2) / 2;

  const heights = pts.map(([x, z]) => world.heightAt(x, z));
  const base = heights.reduce((a, c) => a + c, 0) / heights.length;
  const foot = Math.min(...heights) - 2;
  const wallHeight = b.f * FLOOR;
  const top = base + wallHeight;
  const palette = b.k === 1 ? SHOP_WALLS : WALLS;
  const wall = tmp.wall.set(b.k === 2 ? '#f6f2e8' : palette[(rand() * palette.length) | 0]);

  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    if (len < .01) return;
    const n = [dz / len, 0, -dx / len];
    const span = Math.max(1, Math.round(len / FLOOR)) * FLOOR + (b.s % 50) * FLOOR;
    const u0 = (b.s % 50) * FLOOR;
    const a0 = [p[0], foot, p[1]], a1 = [p[0], top, p[1]], b0 = [q[0], foot, q[1]], b1 = [q[0], top, q[1]];
    const v0 = foot - base;
    sink.tri(a0, a1, b0, n, wall, [u0, v0], [u0, wallHeight], [span, v0]);
    sink.tri(b0, a1, b1, n, wall, [span, v0], [u0, wallHeight], [span, wallHeight]);
  });

  const box = orientedBox(pts);
  const hip = b.k !== 1 && area / box.area > .7 && b.f <= 2 && Math.min(box.a1 - box.a0, box.b1 - box.b0) < 22;
  if (hip) {
    const color = tmp.roof.set(b.k === 2 ? '#c8743a' : TILES[(rand() * TILES.length) | 0]);
    const o = .55, A0 = box.a0 - o, A1 = box.a1 + o, B0 = box.b0 - o, B1 = box.b1 + o;
    const alongA = A1 - A0 >= B1 - B0;
    const w = Math.min(A1 - A0, B1 - B0) / 2, rise = w * .55;
    const P = (a, b, y) => { const [x, z] = box.at(a, b); return [x, y, z]; };
    const c0 = P(A0, B0, top - .15), c1 = P(A1, B0, top - .15), c2 = P(A1, B1, top - .15), c3 = P(A0, B1, top - .15);
    const mid = (A0 + A1) / 2, midB = (B0 + B1) / 2;
    const r0 = alongA ? P(A0 + w, midB, top + rise) : P(mid, B0 + w, top + rise);
    const r1 = alongA ? P(A1 - w, midB, top + rise) : P(mid, B1 - w, top + rise);
    if (alongA) {
      sink.face(c0, c1, r1, color); sink.face(c0, r1, r0, color);
      sink.face(c2, c3, r0, color); sink.face(c2, r0, r1, color);
      sink.face(c1, c2, r1, color); sink.face(c3, c0, r0, color);
    } else {
      sink.face(c1, c2, r1, color); sink.face(c1, r1, r0, color);
      sink.face(c3, c0, r0, color); sink.face(c3, r0, r1, color);
      sink.face(c0, c1, r0, color); sink.face(c2, c3, r1, color);
    }
  } else {
    const color = tmp.roof.set(b.k === 2 ? '#f0ebdf' : CONCRETE[(rand() * CONCRETE.length) | 0]);
    const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      sink.face([pts[i][0], top, pts[i][1]], [pts[j][0], top, pts[j][1]], [pts[k][0], top, pts[k][1]], color);
    }
  }
}

export function buildTown(world, scene) {
  const sinks = Array.from({ length: CHUNKS * CHUNKS }, () => new Sink());
  const tmp = { wall: new THREE.Color(), roof: new THREE.Color() };
  const span = (2 * world.half) / CHUNKS;
  for (const b of world.buildings) {
    const i = Math.min(CHUNKS - 1, Math.max(0, ((b.p[0] + world.half) / span) | 0));
    const j = Math.min(CHUNKS - 1, Math.max(0, ((b.p[1] + world.half) / span) | 0));
    addBuilding(sinks[j * CHUNKS + i], b, world, tmp);
  }

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .82, envMapIntensity: .7 });
  material.onBeforeCompile = (s) => {
    s.uniforms.uNight = shared.uNight;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 uv; varying vec2 vWall;'.replace('attribute vec2 uv; ', ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = uv;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; varying vec2 vWall; float gWin, gLit;
        float rnd(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        gWin = 0.; gLit = 0.;
        if (vWall.x >= 0.) {
          vec2 g = vWall / ${FLOOR.toFixed(1)};
          vec2 f = fract(g), w = fwidth(g);
          float blur = max(w.x, w.y);
          float x = smoothstep(.27 - blur, .27 + blur, f.x) * smoothstep(.73 + blur, .73 - blur, f.x);
          float y = smoothstep(.32 - blur, .32 + blur, f.y) * smoothstep(.76 + blur, .76 - blur, f.y);
          gWin = x * y * step(0., g.y);
          float far = smoothstep(.22, .6, blur);
          vec3 glass = vec3(.075, .1, .125);
          diffuseColor.rgb = mix(mix(diffuseColor.rgb, glass, gWin * .9), diffuseColor.rgb * .78, far);
          gLit = step(.56, rnd(floor(g))) * (1. - far) + far * .34;
          if (far >= 1.) gWin = 1.;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1., .68, .34) * gWin * gLit * uNight * 1.7;`);
  };

  for (const s of sinks) {
    if (!s.pos.length) continue;
    const mesh = new THREE.Mesh(s.geometry(), material);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

export function buildStreetLights(world, scene) {
  const pos = [];
  for (const r of world.roads) {
    if (r.w < 5) continue;
    const step = r.w >= 8 ? 34 : 62;
    let carry = 0;
    for (let i = 0; i + 1 < r.p.length; i++) {
      const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1], len = Math.hypot(bx - ax, bz - az);
      for (let d = step - carry; d < len; d += step) {
        const x = ax + (bx - ax) * d / len, z = az + (bz - az) * d / len;
        if (Math.abs(x) < world.half && Math.abs(z) < world.half) pos.push(x, world.heightAt(x, z) + 7, z);
      }
      carry = (carry + len) % step;
    }
  }
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 64;
  const g = sprite.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,205,1)');
  grad.addColorStop(.18, 'rgba(255,200,125,.7)');
  grad.addColorStop(1, 'rgba(255,160,70,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(sprite), size: 8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false });
  const points = new THREE.Points(geo, mat);
  points.visible = false;
  scene.add(points);
  return (night) => { mat.opacity = night; points.visible = night > .02; };
}

function treeGeometries() {
  // Broadleaf: a rounded canopy of three lobes on a short trunk.
  const lobe = (r, x, y, z, turn) => new THREE.IcosahedronGeometry(r, 0).rotateY(turn).rotateX(turn * .7).translate(x, y, z);
  const trunkA = new THREE.CylinderGeometry(.09, .15, .75, 4).translate(0, .37, 0);
  const crown = mergeGeometries([lobe(.78, 0, 1.3, 0, 0), lobe(.66, 0, 1.22, 0, 1.1), lobe(.56, .46, 1, .18, 2), lobe(.52, -.38, 1.02, -.3, .5)]);
  softenCrown(crown);
  paint(crown, null);
  const trunk = trunkA.toNonIndexed();
  paint(trunk, 0x6a4a31);
  const broadleaf = mergeGeometries([crown, trunk].map(strip));

  // Coconut palm: slender leaning trunk and drooping fronds.
  const parts = [];
  const pole = new THREE.CylinderGeometry(.018, .035, 1, 4, 3, true).translate(0, .5, 0);
  const p = pole.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + p.getY(i) * p.getY(i) * .1);
  const trunkP = pole.toNonIndexed();
  trunkP.computeVertexNormals();
  paint(trunkP, 0x8c7559);
  parts.push(strip(trunkP));
  for (let f = 0; f < 8; f++) {
    const verts = [];
    const ang = f / 8 * Math.PI * 2 + (f % 2) * .2, ca = Math.cos(ang), sa = Math.sin(ang);
    const rows = [[0, 0, .012], [.17, .1, .08], [.34, .06, .07], [.5, -.09, .006]];
    for (let r = 0; r + 1 < rows.length; r++) {
      const [d0, y0, w0] = rows[r], [d1, y1, w1] = rows[r + 1];
      const P = (d, y, s) => [d * ca - s * sa + .1, 1 + y - Math.abs(s) * .5, d * sa + s * ca];
      const q = [P(d0, y0, -w0), P(d0, y0, w0), P(d1, y1, -w1), P(d1, y1, w1)];
      verts.push(...q[0], ...q[1], ...q[2], ...q[2], ...q[1], ...q[3]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.computeVertexNormals();
    paint(g, null);
    parts.push(g);
  }
  return { broadleaf, palm: mergeGeometries(parts) };
}

// Rounded normals make the angular canopy lobes read as soft foliage.
function softenCrown(g) {
  const p = g.attributes.position, n = g.attributes.normal, c = new THREE.Vector3(0, 1.18, 0), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(c).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
}

function strip(g) {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'aLeaf'].includes(k)) g.deleteAttribute(k);
  return g;
}

// aLeaf: 1 on foliage (tinted per tree), 0 on trunks; the bark colour is stored in vertex colour.
function paint(g, hex) {
  const n = g.attributes.position.count;
  g.setAttribute('aLeaf', new THREE.BufferAttribute(new Float32Array(n).fill(hex === null ? 1 : 0), 1));
  strip(g);
}

export function buildTrees(world, scene) {
  const SIZE = 1300, k = SIZE / (2 * world.half), c = SIZE / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tracePts = (p) => { ctx.beginPath(); p.forEach(([x, z], i) => ctx[i ? 'lineTo' : 'moveTo'](x * k + c, z * k + c)); };

  // Green encodes planting density; a red mark means nothing may grow here.
  ctx.fillStyle = 'rgb(0,150,0)'; ctx.fillRect(0, 0, SIZE, SIZE);
  const density = { forest: 255, wood: 255, orchard: 210, residential: 165, farmland: 7, retail: 26, commercial: 26, civic_admin: 45, industrial: 25, grass: 28, pitch: 0, grassland: 45, meadow: 45, park: 80, garden: 90, village_green: 28 };
  for (const u of world.landuse) {
    if (density[u.t] === undefined) continue;
    tracePts(u.p); ctx.fillStyle = `rgb(0,${density[u.t]},0)`; ctx.fill();
  }
  ctx.fillStyle = ctx.strokeStyle = 'rgb(255,0,0)';
  ctx.lineCap = 'round';
  for (const l of world.lakes) { tracePts(l.p); ctx.closePath(); ctx.lineWidth = 14 * k; ctx.stroke(); ctx.fill(); }
  ctx.fillStyle = 'rgb(0,0,255)'; // Rock: blank for ordinary planting, but the temple forest may grow here.
  for (const r of world.rocks) { tracePts(r.p); ctx.closePath(); ctx.fill(); }
  ctx.fillStyle = ctx.strokeStyle = 'rgb(255,0,0)';
  for (const r of world.roads) { tracePts(r.p); ctx.lineWidth = Math.max(1, (r.w + 3) * k); ctx.stroke(); }
  for (const zone of world.keepClear || []) {
    if (zone.circle) { ctx.beginPath(); ctx.arc(zone.circle[0] * k + c, zone.circle[1] * k + c, zone.radius * k, 0, 7); ctx.fill(); }
    else { tracePts(zone.line); if (zone.closed) ctx.closePath(); ctx.lineWidth = zone.width * k; ctx.stroke(); }
  }
  const tower = world.landmarks.clock;
  ctx.beginPath(); ctx.arc(tower.x * k + c, tower.z * k + c, 48 * k, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc((tower.x - 44) * k + c, (tower.z + 56) * k + c, 30 * k, 0, 7); ctx.fill(); // keeps the landmark view clear
  ctx.lineWidth = 2 * k;
  for (const b of world.buildings) {
    ctx.beginPath();
    for (let i = 0; i < b.p.length; i += 2) ctx[i ? 'lineTo' : 'moveTo'](b.p[i] * k + c, b.p[i + 1] * k + c);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;

  const rand = mulberry(2024);
  const buckets = Array.from({ length: CHUNKS * CHUNKS }, () => ({ broad: [], palm: [] }));
  const span = (2 * world.half) / CHUNKS;
  const MAX = 24000, clock = world.landmarks.clock;
  let placed = 0;
  for (let tries = 0; tries < 900000 && placed < MAX; tries++) {
    const x = (rand() - .5) * (2 * world.half - 8), z = (rand() - .5) * (2 * world.half - 8);
    const p = (Math.min(SIZE - 1, (x * k + c) | 0) + Math.min(SIZE - 1, (z * k + c) | 0) * SIZE) * 4;
    if (px[p] > 40) continue;
    const near = THREE.MathUtils.smoothstep(2700 - Math.hypot(x - clock.x, z - clock.z), 0, 1700);
    if (rand() > (px[p + 1] / 255) * (.35 + .65 * near)) continue;
    const cellI = Math.max(0, Math.min(world.N - 1, Math.round((x + world.half) / world.cell)));
    const cellJ = Math.max(0, Math.min(world.N - 1, Math.round((z + world.half) / world.cell)));
    if (world.rock[cellJ * world.N + cellI] > 70) continue;
    const y = world.heightAt(x, z);
    const palmy = px[p + 1] >= 150 && px[p + 1] < 200 ? .62 : px[p + 1] > 200 ? .16 : .42;
    const b = buckets[Math.min(CHUNKS - 1, ((z + world.half) / span) | 0) * CHUNKS + Math.min(CHUNKS - 1, ((x + world.half) / span) | 0)];
    (rand() < palmy ? b.palm : b.broad).push([x, y - .3, z, rand(), rand(), rand()]);
    placed++;
  }

  // Thick forest either side of the temple road and around the car park.
  for (const [fx, fz] of world.templeForest || []) for (let n = 0; n < 2; n++) {
    const angle = rand() * 6.283, reach = 7 + Math.pow(rand(), 1.4) * 30;
    const x = fx + Math.cos(angle) * reach, z = fz + Math.sin(angle) * reach;
    if (Math.abs(x) > world.half - 4 || Math.abs(z) > world.half - 4) continue;
    const p = (Math.min(SIZE - 1, (x * k + c) | 0) + Math.min(SIZE - 1, (z * k + c) | 0) * SIZE) * 4;
    if (px[p] > 40) continue;
    const b = buckets[Math.min(CHUNKS - 1, ((z + world.half) / span) | 0) * CHUNKS + Math.min(CHUNKS - 1, ((x + world.half) / span) | 0)];
    (rand() < .22 ? b.palm : b.broad).push([x, world.heightAt(x, z) - .3, z, rand(), rand(), rand()]);
    placed++;
  }

  // Shuffled, so that lowering tree density for slower devices thins every area evenly.
  for (const b of buckets) for (const list of [b.broad, b.palm]) for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }

  const { broadleaf, palm } = treeGeometries();
  const makeMaterial = (sway) => {
    const m = new THREE.MeshStandardMaterial({ roughness: .9, side: sway ? THREE.DoubleSide : THREE.FrontSide, envMapIntensity: .6 });
    m.onBeforeCompile = (s) => {
      s.uniforms.uTime = shared.uTime;
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aLeaf; varying float vLeaf; varying float vH; uniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vLeaf = aLeaf; vH = position.y;
          ${sway ? 'transformed.xz += aLeaf * .012 * sin(uTime * 1.6 + instanceMatrix[3][0] * .3 + instanceMatrix[3][2] * .2 + position.x * 12.);' : ''}`);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vLeaf; varying float vH;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb = vLeaf > .5 ? diffuseColor.rgb * (.68 + .3 * clamp(vH * ${sway ? '1.' : '.6'}, 0., 1.3)) : vec3(.12, .075, .045);`);
    };
    return m;
  };
  const broadMat = makeMaterial(false), palmMat = makeMaterial(true);
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), color = new THREE.Color(), P = new THREE.Vector3(), Sv = new THREE.Vector3();
  const LEAF = ['#3f7230', '#4f8236', '#2f6229', '#5e8d3a', '#3a6a33'], FROND = ['#6d9440', '#5d8a3a', '#7ea047'];
  const meshes = [];

  function instances(list, geometry, material, palette, scaleFn) {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach(([x, y, z, a, b, d], i) => {
      P.set(x, y, z); q.setFromAxisAngle(up, a * 6.283); scaleFn(Sv, b);
      mesh.setMatrixAt(i, matrix.compose(P, q, Sv));
      mesh.setColorAt(i, color.set(palette[(d * palette.length) | 0]).multiplyScalar(.85 + d * .3));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.userData.full = list.length;
    scene.add(mesh);
    meshes.push(mesh);
  }
  for (const b of buckets) {
    instances(b.broad, broadleaf, broadMat, LEAF, (s, r) => { const v = 6 + r * 6.5; s.set(v, v * (.95 + r * .3), v); });
    instances(b.palm, palm, palmMat, FROND, (s, r) => { const v = 13 + r * 11; s.set(v * 1.05, v, v * 1.05); });
  }
  return {
    count: placed,
    setDensity(f) { for (const m of meshes) m.count = Math.floor(m.userData.full * f); },
  };
}

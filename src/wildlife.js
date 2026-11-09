// Birds over the lake, waterbirds along its edges, and dogs by the jogging path.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { shared, mulberry } from './world.js';
import { part, paintVertexShader, attachGroundShadow } from './traffic.js';

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const sphere = (x, y, z, sx, sy, sz) => new THREE.IcosahedronGeometry(1, 1).scale(sx, sy, sz).translate(x, y, z);

function withFlap(geometry, amount) {
  const p = geometry.attributes.position, flap = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) flap[i] = amount ? Math.abs(p.getX(i)) * amount : 0;
  geometry.setAttribute('aFlap', new THREE.BufferAttribute(flap, 1));
  return geometry;
}
const wingShape = () => {
  const g = new THREE.BufferGeometry();
  // Each wing is two triangles, with the tip free to beat.
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, .16, .34, .01, .1, 0, 0, -.18, .34, .01, .1, .34, .01, -.12, 0, 0, -.18,
    .34, .01, .1, .78, 0, -.02, .34, .01, -.12,
    0, 0, .16, 0, 0, -.18, -.34, .01, .1, -.34, .01, .1, 0, 0, -.18, -.34, .01, -.12,
    -.34, .01, .1, -.34, .01, -.12, -.78, 0, -.02,
  ], 3));
  g.computeVertexNormals();
  return g;
};
function birdGeometry() {
  return mergeGeometries([
    withFlap(part(sphere(0, 0, 0, .1, .1, .32), '#ffffff', 1), 0),
    withFlap(part(sphere(0, .04, .36, .06, .06, .1), '#ffffff', 1), 0),
    withFlap(part(new THREE.ConeGeometry(.02, .15, 5).rotateX(Math.PI / 2).translate(0, .04, .5), '#d39a2c'), 0),
    withFlap(part(new THREE.ConeGeometry(.08, .22, 5).rotateX(-Math.PI / 2).translate(0, 0, -.38), '#ffffff', 1), 0),
    withFlap(part(wingShape(), '#ffffff', 1), .85),
  ]);
}
function egretGeometry() {
  return mergeGeometries([
    part(sphere(0, .68, 0, .1, .13, .24), '#ffffff', 1),
    part(new THREE.CylinderGeometry(.03, .05, .42, 6).rotateX(.5).translate(0, .95, .17), '#ffffff', 1),
    part(sphere(0, 1.15, .28, .05, .05, .09), '#ffffff', 1),
    part(new THREE.ConeGeometry(.02, .16, 5).rotateX(Math.PI / 2).translate(0, 1.15, .44), '#d6a22d'),
    part(new THREE.CylinderGeometry(.012, .012, .62, 5).translate(-.04, .31, 0), '#27211c'),
    part(new THREE.CylinderGeometry(.012, .012, .62, 5).translate(.04, .31, 0), '#27211c'),
  ]);
}
function duckGeometry() {
  return mergeGeometries([
    part(sphere(0, .12, 0, .13, .1, .25), '#ffffff', 1),
    part(sphere(0, .28, .18, .07, .08, .08), '#ffffff', 1),
    part(new THREE.ConeGeometry(.03, .1, 5).rotateX(Math.PI / 2).translate(0, .27, .28), '#d8862a'),
    part(new THREE.ConeGeometry(.06, .14, 5).rotateX(-1.1).translate(0, .18, -.26), '#ffffff', 1),
  ]);
}
function dogGeometry() {
  const legs = [[-.1, .26], [.1, .26], [-.1, -.26], [.1, -.26]].map(([x, z], i) => {
    const g = part(box(.07, .34, .08, x, 0, z), '#ffffff', .85);
    const n = g.attributes.position.count;
    g.setAttribute('aSwing', new THREE.BufferAttribute(new Float32Array(n).fill(i === 0 || i === 3 ? 1 : -1), 1));
    g.setAttribute('aPivot', new THREE.BufferAttribute(new Float32Array(n).fill(.34), 1));
    return g;
  });
  const solid = (g) => {
    const n = g.attributes.position.count;
    g.setAttribute('aSwing', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aPivot', new THREE.BufferAttribute(new Float32Array(n), 1));
    return g;
  };
  return mergeGeometries([
    ...legs,
    solid(part(box(.25, .24, .72, 0, .32, 0), '#ffffff', 1)),
    solid(part(box(.17, .2, .22, 0, .54, .4), '#ffffff', 1)),
    solid(part(box(.1, .09, .16, 0, .55, .58), '#3d2f24')),
    solid(part(box(.05, .1, .08, -.07, .73, .36), '#2f251c')),
    solid(part(box(.05, .1, .08, .07, .73, .36), '#2f251c')),
    solid(part(new THREE.CylinderGeometry(.02, .04, .34, 5).rotateX(-.9).translate(0, .62, -.47), '#ffffff', 1)),
  ]);
}

function paintedMaterial(extra) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78, side: THREE.DoubleSide });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = shared.uTime;
    s.vertexShader = paintVertexShader(s.vertexShader).replace('#include <common>', `#include <common>\nuniform float uTime;\n${extra?.declare || ''}`);
    if (extra?.body) s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${extra.body}`);
  };
  return m;
}

export function buildWildlife(world, scene, data, { low = false } = {}) {
  const rand = mulberry(6060);
  const { lake, frames, path, pathLength, cum, deep } = data;
  const level = lake.level, n = frames.length;
  const up = new THREE.Vector3(0, 1, 0), matrix = new THREE.Matrix4(), quat = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ'), pos = new THREE.Vector3(), size = new THREE.Vector3(), zero = new THREE.Vector3();

  function instanced(geometry, material, count, colors) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i++) mesh.setColorAt(i, new THREE.Color(colors[Math.floor(rand() * colors.length)]));
    mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    return mesh;
  }

  // Flying flocks.
  const FLOCKS = low ? 3 : 5, PER = 14;
  const flyGeometry = birdGeometry();
  const flapPhase = new Float32Array(FLOCKS * PER), flapRate = new Float32Array(FLOCKS * PER);
  for (let i = 0; i < flapPhase.length; i++) { flapPhase[i] = rand() * 6.28; flapRate[i] = 9 + rand() * 4; }
  flyGeometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(flapPhase, 1));
  flyGeometry.setAttribute('aRate', new THREE.InstancedBufferAttribute(flapRate, 1));
  const flyers = instanced(flyGeometry, paintedMaterial({
    declare: 'attribute float aFlap, aPhase, aRate;',
    body: 'transformed.y += aFlap * sin(uTime * aRate + aPhase) * .55;',
  }), FLOCKS * PER, ['#ffffff', '#f6f3ea', '#f6f3ea', '#1f2227']);

  const anchors = [];
  for (let f = 0; f < FLOCKS; f++) anchors.push(deep[Math.floor((f + .5) / FLOCKS * deep.length)]);
  const flocks = anchors.map(([x, z], f) => ({
    x, z, a: 70 + rand() * 120, b: 60 + rand() * 90, speed: (rand() < .5 ? 1 : -1) * (.09 + rand() * .06), phase: rand() * 6.28, y: 16 + rand() * 24, f,
    members: Array.from({ length: PER }, (_, i) => ({ ox: (rand() - .5) * 26, oy: (rand() - .5) * 6, oz: -i * 1.8 + (rand() - .5) * 8, w: rand() * 6.28, r: 1.2 + rand() * 1.6, scale: 1.25 + rand() * .45 })),
  }));
  const flockAt = (fl, t) => {
    const u = t * fl.speed + fl.phase;
    return [fl.x + Math.cos(u) * fl.a, level + fl.y + Math.sin(u * 2.3) * 5, fl.z + Math.sin(u * 1.7) * fl.b];
  };

  // Standing egrets and paddling ducks along the shallows.
  const egretMaterial = paintedMaterial();
  const EGRETS = low ? 16 : 34, DUCKS = low ? 12 : 26;
  const egrets = instanced(egretGeometry(), egretMaterial, EGRETS, ['#ffffff', '#f7f4ea']);
  egrets.castShadow = true;
  for (let i = 0; i < EGRETS; i++) {
    const f = frames[Math.floor(rand() * n)];
    const inset = 3 + rand() * 7, x = f.x - f.nx * inset, z = f.z - f.nz * inset;
    const y = Math.max(world.heightAt(x, z), level - .55);
    egrets.setMatrixAt(i, matrix.compose(pos.set(x, y, z), quat.setFromAxisAngle(up, rand() * 6.28), size.setScalar(.85 + rand() * .25)));
  }
  egrets.instanceMatrix.needsUpdate = true;

  const ducks = instanced(duckGeometry(), egretMaterial, DUCKS, ['#6c5a42', '#8b7656', '#ffffff', '#4c4538']);
  const paddlers = Array.from({ length: DUCKS }, (_, i) => {
    const f = frames[Math.floor(i / DUCKS * n)];
    const inset = 16 + rand() * 18;
    return { cx: f.x - f.nx * inset, cz: f.z - f.nz * inset, rx: 3 + rand() * 7, rz: 3 + rand() * 7, t: rand() * 6.28, speed: (rand() < .5 ? 1 : -1) * (.06 + rand() * .1), scale: 1.3 + rand() * .35 };
  });

  // Dogs keep to the grass beside the jogging path.
  const DOGS = low ? 5 : 11;
  const dogGeo = dogGeometry();
  const dogPhase = new Float32Array(DOGS);
  for (let i = 0; i < DOGS; i++) dogPhase[i] = rand() * 6.28;
  dogGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(dogPhase, 1));
  const dogMaterial = paintedMaterial({
    declare: 'attribute float aSwing, aPivot, aPhase;',
    body: `if (aSwing != 0.) { float angle = aSwing * .55 * sin(uTime * 9. + aPhase); float c0 = cos(angle), s0 = sin(angle), y0 = transformed.y - aPivot, z0 = transformed.z; transformed.y = aPivot + y0 * c0 - z0 * s0; transformed.z = y0 * s0 + z0 * c0; }`,
  });
  const dogs = instanced(dogGeo, dogMaterial, DOGS, ['#8a6a44', '#b08d5e', '#3f352b', '#d7c6a3', '#6d5238']);
  attachGroundShadow(dogs, scene);
  const strays = Array.from({ length: DOGS }, () => ({ s: rand() * pathLength, dir: rand() < .5 ? 1 : -1, speed: .9 + rand() * .7, rest: 0, side: 3 + rand() * 1.5, heading: 0, timer: 5 + rand() * 18, scale: .95 + rand() * .3 }));
  const pathAt = (s, out) => {
    const d = ((s % pathLength) + pathLength) % pathLength;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid - 1; }
    const a = path[lo], b = path[(lo + 1) % n], span = (lo === n - 1 ? pathLength - cum[lo] : cum[lo + 1] - cum[lo]) || 1, t = (d - cum[lo]) / span;
    out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t; out.tx = (b.x - a.x) / span; out.tz = (b.z - a.z) / span;
  };
  const sample = {};
  let time = 0;

  return {
    update(dt, night) {
      time += dt;
      const awake = night < .55;
      let index = 0;
      for (const fl of flocks) {
        const [cx, cy, cz] = flockAt(fl, time), [ax, , az] = flockAt(fl, time + .4);
        const heading = Math.atan2(ax - cx, az - cz), sin = Math.sin(heading), cos = Math.cos(heading);
        for (const m of fl.members) {
          const wobbleX = Math.sin(time * .9 + m.w) * m.r, wobbleY = Math.cos(time * 1.2 + m.w) * m.r * .5;
          const x = cx + cos * (m.ox + wobbleX) + sin * m.oz, z = cz - sin * (m.ox + wobbleX) + cos * m.oz, y = cy + m.oy + wobbleY;
          euler.set(0, heading, Math.sin(time * .7 + m.w) * .25);
          flyers.setMatrixAt(index++, matrix.compose(pos.set(x, y, z), quat.setFromEuler(euler), awake ? size.setScalar(m.scale) : zero));
        }
      }
      flyers.instanceMatrix.needsUpdate = true;

      paddlers.forEach((d, i) => {
        d.t += d.speed * dt;
        const x = d.cx + Math.cos(d.t) * d.rx, z = d.cz + Math.sin(d.t) * d.rz;
        const dx = -Math.sin(d.t) * d.speed * d.rx, dz = Math.cos(d.t) * d.speed * d.rz;
        ducks.setMatrixAt(i, matrix.compose(pos.set(x, level - .03 + Math.sin(time * 1.6 + i) * .02, z), quat.setFromAxisAngle(up, Math.atan2(dx, dz)), size.setScalar(d.scale)));
      });
      ducks.instanceMatrix.needsUpdate = true;

      strays.forEach((d, i) => {
        d.timer -= dt;
        if (d.timer <= 0) { d.timer = 6 + rand() * 20; d.rest = rand() < .4 ? 2 + rand() * 6 : 0; if (rand() < .3) d.dir = -d.dir; }
        if (d.rest > 0) d.rest -= dt; else d.s += d.speed * d.dir * dt;
        pathAt(d.s, sample);
        const tx = sample.tx * d.dir, tz = sample.tz * d.dir, side = d.dir * d.side;
        const x = sample.x + tz * side, z = sample.z - tx * side;
        const want = Math.atan2(tx, tz);
        d.heading += Math.atan2(Math.sin(want - d.heading), Math.cos(want - d.heading)) * Math.min(1, dt * 3);
        dogs.setMatrixAt(i, matrix.compose(pos.set(x, world.heightAt(x, z) + .08, z), quat.setFromAxisAngle(up, d.heading), size.setScalar(d.scale)));
      });
      dogs.instanceMatrix.needsUpdate = true;
    },
  };
}

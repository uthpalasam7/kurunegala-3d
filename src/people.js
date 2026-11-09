// Pedestrians who keep to the sidewalks and use crossings, busiest around the Clock Tower.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { shared, mulberry } from './world.js';
import { part, paintVertexShader, attachGroundShadow } from './traffic.js';

const SKIN = '#7b5238', HAIR = '#17130f';
export const CLOTHES = ['#d9d3c5', '#f0ece2', '#3e6a9f', '#b84035', '#d58a2a', '#3f7d62', '#7b3f75', '#c95f83', '#2d3a55', '#e0b83f', '#8c5a3a', '#55606b'];
const SWING = `if (aSwing.x != 0.) {
  float angle = aSwing.x * aAmp * sin(uTime * aRate + aBody.w);
  float c0 = cos(angle), s0 = sin(angle), y0 = VAR.y - aPivot, z0 = VAR.z;
  VAR.y = aPivot + y0 * c0 - z0 * s0;
  VAR.z = y0 * s0 + z0 * c0;
}
if ((aSwing.y == 1. && aBody.y < .5) || (aSwing.y == 2. && aBody.y > .5) || (aSwing.y == 3. && aBody.z < .5)) VAR = vec3(0.);
if (aSwing.y > 3.5) {
  bool umbrella = aBody.w >= 0. && fract(aBody.w * 7.) < .62;
  if (uRain < .5 || (aSwing.y == 4.) != umbrella) VAR = vec3(0.);
}
VAR *= aBody.x;`;

// Who a crowd is made of: [share, height, wears a long skirt or sari, has long hair].
const MIXES = {
  everyone: [[.42, 1, 0, 0], [.36, .95, 1, 1], [.12, .62, 0, 0], [.1, .6, 1, 1]],
  adults: [[.52, 1, 0, 0], [.48, .95, 1, 1]],
  sport: [[.58, 1, 0, 0], [.42, .95, 0, 1]],
  kids: [[.52, 1, 0, 0], [.48, 1, 1, 1]],
};
const SKIRT = 1, LEGS = 2, LONG_HAIR = 3, UMBRELLA = 4, RAINCOAT = 5;

function swing(geometry, amount, pivot, kind = 0) {
  const n = geometry.attributes.position.count;
  const swingData = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { swingData[i * 2] = amount; swingData[i * 2 + 1] = kind; } // Amount of swing, and which body type shows this part.
  geometry.setAttribute('aSwing', new THREE.BufferAttribute(swingData, 2));
  geometry.setAttribute('aPivot', new THREE.BufferAttribute(new Float32Array(n).fill(pivot), 1));
  return geometry;
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);

/** A fitted knee-length raincoat with an open hood, in the wearer's own colour with darker trim. */
function raincoat(armsUp) {
  const FABRIC = '#ffffff', TRIM = '#23262b', REFLECT = '#c8ccc9', LINING = '#2c2e33';
  const coat = (geometry, hex, paint = 0, amount = 0, pivot = 0) => swing(part(geometry, hex, paint), amount, pivot, RAINCOAT);
  const shape = (points) => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 12).scale(1, 1, .66);
  const sleeve = (x, amount) => coat(new THREE.CylinderGeometry(.098, .105, .6, 7).translate(x, armsUp ? 1.72 : 1.14, 0), FABRIC, 1, armsUp ? 0 : amount, 1.42);
  const cuff = (x, amount) => coat(new THREE.CylinderGeometry(.112, .112, .05, 7).translate(x, armsUp ? 2.02 : .86, 0), TRIM, 0, armsUp ? 0 : amount, 1.42);
  // Faces outward at the front; the opening frames the face.
  const hoodShell = (radius, hex, paint, flip) => {
    const g = new THREE.SphereGeometry(radius, 10, 8, Math.PI / 2 + .9, Math.PI * 2 - 1.8).scale(flip ? -1 : 1, 1.08, 1).translate(0, 1.66, -.02);
    return coat(g, hex, paint);
  };
  return [
    coat(shape([[.33, .46], [.3, .68], [.265, .98], [.275, 1.2], [.26, 1.38], [.13, 1.48], [.08, 1.5]]), FABRIC, 1),
    coat(shape([[.334, .46], [.334, .5], [.33, .5]]).translate(0, 0, 0), TRIM),
    coat(shape([[.306, .68], [.298, .73], [.292, .73]]), REFLECT),
    coat(shape([[.285, 1.12], [.285, 1.17], [.28, 1.17]]), REFLECT),
    sleeve(-.275, -.8), sleeve(.275, .8), cuff(-.275, -.8), cuff(.275, .8),
    coat(new THREE.BoxGeometry(.026, .94, .02).rotateX(-.055).translate(0, .95, .197), TRIM),
    ...[-1, 1].map(side => coat(new THREE.BoxGeometry(.12, .1, .02).rotateY(side * .38).translate(side * .17, .74, .173), TRIM)),
    coat(new THREE.CylinderGeometry(.11, .125, .09, 10).scale(1, 1, .9).translate(0, 1.5, 0), FABRIC, 1),
    hoodShell(.178, FABRIC, 1, false), hoodShell(.17, LINING, 0, true),
    coat(new THREE.TorusGeometry(.142, .017, 5, 12).scale(.9, 1.2, 1).rotateX(-.2).translate(0, 1.66, .105), TRIM),
  ];
}

export function personGeometry(armsUp = false) {
  return mergeGeometries([
    swing(part(box(.15, .84, .17, -.11, .02, 0), '#b4ada0', .5), 1, .86, LEGS),
    swing(part(box(.15, .84, .17, .11, .02, 0), '#b4ada0', .5), -1, .86, LEGS),
    swing(part(new THREE.CylinderGeometry(.23, .33, .84, 12).scale(1, 1, .74).translate(0, .46, 0), '#ffffff', 1), 0, 0, SKIRT),
    swing(part(box(.17, .06, .3, -.11, 0, .05), '#231c16'), 1, .86),
    swing(part(box(.17, .06, .3, .11, 0, .05), '#231c16'), -1, .86),
    swing(part(box(.42, .62, .23, 0, .82, 0), '#ffffff', 1), 0, 0),
    swing(part(box(.1, .6, .12, -.27, armsUp ? 1.42 : .82, 0), SKIN), armsUp ? 0 : -.8, 1.42),
    swing(part(box(.1, .6, .12, .27, armsUp ? 1.42 : .82, 0), SKIN), armsUp ? 0 : .8, 1.42),
    swing(part(box(.1, .12, .1, 0, 1.43, 0), SKIN), 0, 0),
    swing(part(new THREE.IcosahedronGeometry(.13, 1).translate(0, 1.64, .01), SKIN), 0, 0),
    swing(part(new THREE.IcosahedronGeometry(.135, 1).scale(1, .75, 1).translate(0, 1.7, -.02), HAIR), 0, 0),
    swing(part(box(.3, .6, .08, 0, 1.08, -.14), HAIR), 0, 0, LONG_HAIR),
    // Shown only in the rain: an umbrella for most people, a hooded raincoat for the rest.
    swing(part(new THREE.CylinderGeometry(.014, .014, 1.3, 5).translate(.2, 1.6, .1), '#2a2a2a'), 0, 0, UMBRELLA),
    swing(part(new THREE.ConeGeometry(.68, .3, 10).translate(.1, 2.3, .04), '#ffffff', 1), 0, 0, UMBRELLA),
    ...raincoat(armsUp),
    swing(part(new THREE.IcosahedronGeometry(.1, 1).translate(0, 1.68, -.17), HAIR), 0, 0, LONG_HAIR),
  ]);
}

/** Turns a heading gently towards another, never faster than a person can comfortably pivot. */
export function turnToward(heading, want, dt, rate = 2.4) {
  const delta = Math.atan2(Math.sin(want - heading), Math.cos(want - heading)), step = delta * Math.min(1, dt * 5), most = rate * dt;
  return heading + Math.max(-most, Math.min(most, step));
}

/** An instanced group of animated figures, with its instant ground shadow. */
export function createCrowd(scene, geometry, count, rand, { colors = CLOTHES, mix = 'everyone' } = {}) {
  const rate = new Float32Array(count).fill(6.2), amp = new Float32Array(count).fill(.42);
  const body = new Float32Array(count * 4), pick = mulberry(count * 131 + 7), groups = MIXES[mix];
  for (let i = 0; i < count; i++) {
    let r = pick(), g = 0;
    while (g < groups.length - 1 && (r -= groups[g][0]) > 0) g++;
    body.set([...groups[g].slice(1), rand() * 6.283 * (mix === 'sport' ? -1 : 1) - (mix === 'sport' ? .01 : 0)], i * 4); // Sporty people (negative phase) get raincoats, not umbrellas.
    // Height, skirt, long hair, stride phase.
  }
  geometry.setAttribute('aBody', new THREE.InstancedBufferAttribute(body, 4));
  geometry.setAttribute('aRate', new THREE.InstancedBufferAttribute(rate, 1));
  geometry.setAttribute('aAmp', new THREE.InstancedBufferAttribute(amp, 1));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, envMapIntensity: .75 });
  material.onBeforeCompile = (s) => {
    s.uniforms.uTime = shared.uTime;
    s.uniforms.uRain = shared.uRain;
    s.vertexShader = paintVertexShader(s.vertexShader)
      .replace('#include <common>', '#include <common>\nattribute float aPivot, aRate, aAmp; attribute vec2 aSwing; attribute vec4 aBody; uniform float uTime, uRain;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWING.replaceAll('VAR', 'transformed')}`);
  };
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  const shadow = attachGroundShadow(mesh, scene, SWING.replaceAll('VAR', 'p'));
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) mesh.setColorAt(i, color.set(colors[(rand() * colors.length) | 0]).multiplyScalar(.82 + rand() * .3));
  mesh.instanceColor.needsUpdate = true;
  return {
    mesh, shadow,
    setMotion(i, r, a) { rate[i] = r; amp[i] = a; },
    commit() { geometry.attributes.aRate.needsUpdate = true; geometry.attributes.aAmp.needsUpdate = true; },
    setVisible(on) { mesh.visible = shadow.visible = on; },
  };
}

export function buildPeople(world, scene, streets, traffic, { total = 1500 } = {}) {
  const rand = mulberry(909);
  const clock = world.landmarks.clock;
  const VISIBLE = 1200;

  let sum = 0;
  const table = streets.sidewalks.map((seg) => {
    const [x, z] = seg.pts[seg.pts.length >> 1];
    sum += seg.len * (seg.temple ? .05 : seg.w >= 6 ? 1.6 : 1) * Math.exp(-Math.hypot(x - clock.x, z - clock.z) / 430); // Almost everyone drives up to the temple.
    return sum;
  });
  const pickSidewalk = () => {
    const r = rand() * sum;
    let lo = 0, hi = table.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (table[mid] < r) lo = mid + 1; else hi = mid; }
    return streets.sidewalks[lo];
  };

  const crowd = createCrowd(scene, personGeometry(), total, rand);
  const { mesh, shadow } = crowd;

  const walkers = Array.from({ length: total }, (_, i) => {
    const seg = pickSidewalk();
    return {
      seg, s: rand() * seg.len, dir: rand() < .5 ? 1 : -1, speed: 1 + rand() * .65, lateral: (rand() - .5) * .9, rank: rand(), scale: .92 + rand() * .16,
      heading: null, state: 'walk', pause: 0, check: 0, crossing: null, t: 0, x: 0, z: 0, lastCross: 0,
    };
  });

  function positionOnSidewalk(w) {
    const { pts, cum } = w.seg;
    let lo = 0, hi = cum.length - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= w.s) lo = mid; else hi = mid - 1; }
    const [ax, az] = pts[lo], [bx, bz] = pts[lo + 1], span = cum[lo + 1] - cum[lo] || 1, t = (w.s - cum[lo]) / span;
    const tx = (bx - ax) / span * w.dir, tz = (bz - az) / span * w.dir;
    w.x = ax + (bx - ax) * t + tz * w.lateral; w.z = az + (bz - az) * t - tx * w.lateral;
    return Math.atan2(tx, tz);
  }

  function beginWaiting(w, crossing) {
    w.state = 'wait'; w.crossing = crossing; w.check = 0; w.pause = 45;
    const dx = crossing.x1 - crossing.x0, dz = crossing.z1 - crossing.z0;
    w.waitHeading = Math.atan2(dx, dz);
  }

  function advance(w, dt) {
    if (w.state === 'pause') {
      if ((w.pause -= dt) <= 0) w.state = 'walk';
      return;
    }
    if (w.state === 'wait') {
      w.pause -= dt;
      w.check -= dt;
      if (w.pause <= 0) { w.state = 'walk'; w.dir = -w.dir; w.crossing = null; return; }
      if (w.check <= 0) {
        w.check = .35;
        const c = w.crossing;
        if (traffic.roadClear(c.x0, c.z0, c.x1, c.z1)) { w.state = 'cross'; w.t = 0; w.length = Math.hypot(c.x1 - c.x0, c.z1 - c.z0) || 1; }
      }
      return;
    }
    if (w.state === 'cross') {
      const c = w.crossing;
      w.t += (w.speed * 1.15) * dt / w.length;
      w.x = c.x0 + (c.x1 - c.x0) * w.t; w.z = c.z0 + (c.z1 - c.z0) * w.t;
      if (w.t >= 1) {
        w.seg = c.seg; w.s = Math.min(c.seg.len, c.toS); w.dir = rand() < .5 ? 1 : -1;
        w.state = 'walk'; w.crossing = null; w.lastCross = 30 + rand() * 40;
      }
      return;
    }
    const before = w.s;
    w.s += w.speed * w.dir * dt;
    w.lastCross = Math.max(0, w.lastCross - dt);
    if (!w.lastCross) for (const c of w.seg.crossings) {
      if ((before - c.s) * (w.s - c.s) <= 0 && rand() < .45) { w.s = c.s; beginWaiting(w, c); return; }
    }
    if (w.s < 0 || w.s > w.seg.len) {
      const hop = w.s < 0 ? w.seg.hopStart : w.seg.hopEnd;
      w.s = Math.max(0, Math.min(w.seg.len, w.s));
      if (hop && rand() < .8) beginWaiting(w, { ...hop, seg: hop.seg, toS: hop.s });
      else { w.dir = -w.dir; w.state = 'pause'; w.pause = .6 + rand() * 2; }
    }
  }

  const matrix = new THREE.Matrix4(), hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const quat = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), size = new THREE.Vector3();

  return {
    walkers,
    update(dt, night, camera, distanceToFocus) {
      const away = distanceToFocus > 1700;
      mesh.visible = shadow.visible = !away;
      const share = (1 - .75 * night) * shared.crowd.value;
      traffic.crossers.length = 0;
      walkers.forEach((w, i) => {
        if (w.rank >= share) {
          if (w.state === 'cross') return advance(w, dt);
          if (!away) mesh.setMatrixAt(i, hidden);
          return;
        }
        advance(w, dt);
        if (w.state === 'cross') traffic.crossers.push(w);
        if (away) return;
        let want;
        if (w.state === 'cross') want = Math.atan2(w.crossing.x1 - w.crossing.x0, w.crossing.z1 - w.crossing.z0);
        else {
          want = positionOnSidewalk(w);
          if (w.state === 'wait') want = w.waitHeading;
        }
        if (camera.position.distanceToSquared(pos.set(w.x, camera.position.y, w.z)) > VISIBLE * VISIBLE) { mesh.setMatrixAt(i, hidden); return; }
        // The figure trails its route slightly, rounding off the corners of the sidewalk line.
        if (w.vx === undefined || Math.hypot(w.x - w.vx, w.z - w.vz) > 8) { w.vx = w.x; w.vz = w.z; }
        const ease = Math.min(1, dt * 3.2), stepX = (w.x - w.vx) * ease, stepZ = (w.z - w.vz) * ease;
        w.vx += stepX; w.vz += stepZ;
        if ((w.state === 'walk' || w.state === 'cross') && Math.hypot(stepX, stepZ) > dt * .25) want = Math.atan2(stepX, stepZ);
        if (w.heading === null) w.heading = want;
        w.heading = turnToward(w.heading, want, dt);
        pos.set(w.vx, world.heightAt(w.vx, w.vz) + .08, w.vz);
        quat.setFromAxisAngle(up, w.heading);
        mesh.setMatrixAt(i, matrix.compose(pos, quat, size.setScalar(w.scale)));
      });
      if (!away) mesh.instanceMatrix.needsUpdate = true;
    },
    stats() {
      const counts = { walk: 0, wait: 0, pause: 0, cross: 0 };
      for (const w of walkers) counts[w.state]++;
      return counts;
    },
  };
}

// Hand-modelled landmarks: the Clock Tower, the seated Buddha, and boulders on Elephant Rock.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { shared, mulberry, NOISE_GLSL } from './world.js';

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z).toNonIndexed();

function stoneMaterial(color, scale) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: .86, envMapIntensity: .8 });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vO;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvO = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}\nvarying vec3 vO;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float wear = fbm(vec2(vO.x + vO.z, vO.y) * ${scale.toFixed(2)});
        float streak = smoothstep(.62, .3, fbm(vec2((vO.x + vO.z) * 1.6, vO.y * .22)));
        diffuseColor.rgb *= .82 + .3 * wear - .1 * streak;`);
  };
  return m;
}

function buildClockTower(world, scene, glowing) {
  const { x, y, z } = world.landmarks.clock;
  const group = new THREE.Group();
  group.position.set(x, y - .25, z);

  const plaster = [], granite = [], trim = [], dark = [];
  // Roundabout island and stepped granite plinth.
  const island = new THREE.CylinderGeometry(8.1, 8.4, .9, 40).translate(0, -.1, 0).toNonIndexed();
  const lawn = new THREE.CylinderGeometry(7.4, 7.4, .9, 40).translate(0, .02, 0).toNonIndexed();
  granite.push(box(7.6, .45, 7.6, 0, .35, 0), box(6.5, .45, 6.5, 0, .8, 0), box(5.6, 3.1, 5.6, 0, 1.25, 0));
  trim.push(box(6, .35, 6, 0, 4.3, 0));
  // Shaft, string courses and the wider clock stage.
  plaster.push(box(4.5, 9.6, 4.5, 0, 4.6, 0));
  trim.push(box(4.9, .25, 4.9, 0, 9, 0), box(5.3, .35, 5.3, 0, 13.9, 0));
  plaster.push(box(5, 4.7, 5, 0, 14.25, 0));
  trim.push(box(5.8, .4, 5.8, 0, 18.95, 0));
  // Castle-like parapet with merlons and corner turrets.
  plaster.push(box(5.2, .8, 5.2, 0, 19.35, 0));
  const merlon = 5.2 / 9;
  for (let i = 0; i < 9; i += 2) {
    const m = -2.6 + merlon * (i + .5);
    plaster.push(box(merlon, .75, .34, m, 20.15, 2.43), box(merlon, .75, .34, m, 20.15, -2.43), box(.34, .75, merlon, 2.43, 20.15, m), box(.34, .75, merlon, -2.43, 20.15, m));
  }
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    plaster.push(box(.72, 16.3, .72, a * 2.32, 4.6, b * 2.32), box(.95, .9, .95, a * 2.42, 20.9, b * 2.42));
    trim.push(box(1.12, .18, 1.12, a * 2.42, 21.8, b * 2.42));
  }
  plaster.push(box(3, 1.5, 3, 0, 19.9, 0));
  trim.push(box(3.4, .2, 3.4, 0, 21.4, 0));

  // Narrow slit windows and a doorway on each side; the plaque faces the road.
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const rotated = (g) => g.rotateY(a);
    dark.push(rotated(box(.52, 1.9, .1, 0, 6.3, 2.26)), rotated(box(.52, 1.9, .1, 0, 10.2, 2.26)));
    trim.push(rotated(box(.76, .2, .16, 0, 8.3, 2.28)), rotated(box(.76, .2, .16, 0, 12.2, 2.28)));
    dark.push(rotated(box(1.3, 2.2, .1, 0, 1.25, 2.82)));
  }

  const plasterMat = stoneMaterial('#e9e1cd', .55);
  const graniteMat = stoneMaterial('#8f8a80', 1.5);
  const trimMat = stoneMaterial('#f5efe0', .8);
  const darkMat = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: .7 });
  plasterMat.emissive.set('#ffd9a0'); trimMat.emissive.set('#ffd9a0'); graniteMat.emissive.set('#ffbe78');
  glowing.push([plasterMat, .22], [trimMat, .26], [graniteMat, .12]);

  for (const [parts, mat] of [[plaster, plasterMat], [granite.concat(island), graniteMat], [trim, trimMat], [dark, darkMat]]) {
    const mesh = new THREE.Mesh(mergeGeometries(parts), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  const grass = new THREE.Mesh(lawn, new THREE.MeshStandardMaterial({ color: '#6d9b43', roughness: 1 }));
  grass.receiveShadow = true;
  group.add(grass);

  // Four working faces.
  const faceMat = new THREE.MeshStandardMaterial({ color: '#fbf7e8', roughness: .5, emissive: '#ffe7b0', emissiveIntensity: 0 });
  glowing.push([faceMat, 1.5]);
  const ringMat = new THREE.MeshStandardMaterial({ color: '#2b2a29', roughness: .4, metalness: .5 });
  const handMat = new THREE.MeshStandardMaterial({ color: '#171717', roughness: .5 });
  const hands = [];
  for (let i = 0; i < 4; i++) {
    const face = new THREE.Group();
    face.rotation.y = i * Math.PI / 2;
    face.position.y = 16.55;
    const plate = new THREE.Mesh(new THREE.CircleGeometry(1.55, 48).translate(0, 0, 2.53), faceMat);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.58, .085, 8, 56).translate(0, 0, 2.54), ringMat);
    face.add(plate, ring);
    for (let t = 0; t < 12; t++) {
      const a = t / 12 * Math.PI * 2;
      const big = t % 3 === 0;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(big ? .11 : .06, big ? .32 : .2, .02), handMat);
      tick.position.set(Math.sin(a) * 1.3, Math.cos(a) * 1.3, 2.55);
      tick.rotation.z = -a;
      face.add(tick);
    }
    const hour = new THREE.Mesh(new THREE.BoxGeometry(.13, .9, .03).translate(0, .38, 2.58), handMat);
    const minute = new THREE.Mesh(new THREE.BoxGeometry(.08, 1.28, .03).translate(0, .54, 2.62), handMat);
    face.add(hour, minute);
    hands.push({ hour, minute });
    group.add(face);
  }
  scene.add(group);

  return function updateHands() {
    // Sri Lanka is UTC+5:30 all year.
    const minutes = ((Date.now() / 60000 + 330) % 720);
    for (const h of hands) {
      h.minute.rotation.z = -((minutes % 60) / 60) * Math.PI * 2;
      h.hour.rotation.z = -(minutes / 720) * Math.PI * 2;
    }
  };
}

function ellipsoid(sx, sy, sz, x, y, z) {
  return new THREE.SphereGeometry(1, 40, 28).scale(sx, sy, sz).translate(x, y, z);
}
function limb(ax, ay, az, bx, by, bz, ra, rb) {
  const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz), d = b.clone().sub(a), len = d.length();
  const parts = [
    new THREE.CylinderGeometry(rb, ra, len, 20, 1, true).translate(0, len / 2, 0),
    new THREE.SphereGeometry(ra, 18, 12), new THREE.SphereGeometry(rb, 18, 12).translate(0, len, 0),
  ].map(g => g.toNonIndexed());
  for (const g of parts) for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
  return mergeGeometries(parts).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())).translate(ax, ay, az);
}

function buildBuddha(world, scene, glowing) {
  const { x, y, z } = world.landmarks.statue;
  const clock = world.landmarks.clock;
  const group = new THREE.Group();
  group.position.set(x, y - .4, z);
  group.rotation.y = Math.atan2(clock.x - x, clock.z - z); // Faces out over the town.

  const white = new THREE.MeshStandardMaterial({ color: '#f7f3e9', roughness: .62, emissive: '#ffe8c4', emissiveIntensity: 0, envMapIntensity: 1 });
  glowing.push([white, .42]);
  const plain = (g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal'].includes(k)) n.deleteAttribute(k); return n; };
  // Modelled in metres from photographs of the statue: about 27 m tall, in meditation.
  const parts = [
    ellipsoid(12.2, 3.3, 7.4, 0, 5, 1.4),                    // folded legs
    ellipsoid(3.3, 2.6, 3.3, -10.2, 4.7, 5), ellipsoid(3.3, 2.6, 3.3, 10.2, 4.7, 5), // knees
    limb(-10.5, 4.7, 5.6, 4.5, 4.4, 7.4, 2.35, 1.55), limb(10.5, 5, 5.6, -4.5, 5.2, 7.7, 2.35, 1.55), // crossed shins
    ellipsoid(6.6, 7.8, 4.3, 0, 13, .1),                     // torso, one smooth form
    ellipsoid(7.5, 4.6, 3.95, 0, 15, .05),                   // broad upper chest, flowing into the shoulders
    ellipsoid(8, 2.1, 3.5, 0, 17, 0),                        // sloping shoulders
    limb(-7.4, 16.8, 0, -9.3, 10.6, 1.2, 1.8, 1.42), limb(7.4, 16.8, 0, 9.3, 10.6, 1.2, 1.8, 1.42),   // upper arms
    limb(-9.3, 10.6, 1.2, -2.7, 7.8, 5.7, 1.42, 1), limb(9.3, 10.6, 1.2, 2.7, 7.8, 5.7, 1.42, 1),     // forearms
    ellipsoid(3.7, .8, 2.3, 0, 7.5, 6),  ellipsoid(3.3, .6, 2, 0, 8.3, 6.1), // hands resting in the lap
    limb(-.5, 8.5, 7.7, 0, 9.05, 7.8, .34, .3), limb(.5, 8.5, 7.7, 0, 9.05, 7.8, .34, .3),            // touching thumbs
    limb(0, 18, 0, 0, 20.6, .1, 1.85, 1.65),                 // neck
    ellipsoid(3.15, 3.95, 3.4, 0, 23.2, .3),                 // head
    ellipsoid(1.85, 1.4, 2, 0, 20.8, 1.3),               // rounded chin
    ellipsoid(2.1, 1.35, 2.1, 0, 26.9, .15),                 // ushnisha, a low broad mound
    ellipsoid(.6, .7, .6, 0, 28.3, .15),                 // its crowning knob
    limb(-3.2, 24.3, .05, -3.5, 20.9, .1, .46, .42), limb(3.2, 24.3, .05, 3.5, 20.9, .1, .46, .42),   // long ears
    ellipsoid(.48, .62, .34, -3.55, 20.45, .1), ellipsoid(.48, .62, .34, 3.55, 20.45, .1),            // lobes
    ellipsoid(.42, .8, .4, 0, 23.15, 3.52),                  // nose
    ellipsoid(1.02, .24, .3, 0, 21.55, 3.32), ellipsoid(.86, .2, .3, 0, 21.15, 3.3), // lips
  ].map(plain);
  for (const y of [19.4, 19.95]) parts.push(plain(new THREE.TorusGeometry(1.84, .09, 8, 40).rotateX(Math.PI / 2).translate(0, y, .1))); // Neck folds.
  // Arched brows meeting at the nose.
  for (const x of [-1.52, 1.52]) parts.push(plain(new THREE.TorusGeometry(1.6, .11, 8, 18, 1.5).rotateZ(Math.PI / 2 - .75).scale(1, .5, 1).translate(x, 24.05, 3.02)));

  // Tight curls over the head and ushnisha, stopping at a rounded hairline.
  const curl = (x, y, z) => parts.push(plain(new THREE.IcosahedronGeometry(.42, 1).scale(1, .82, 1).translate(x, y, z)));
  const shell = (cx, cy, cz, a, b, c, spacing, fromLat, toLat, skip) => {
    for (let lat = fromLat; lat <= toLat; lat += 180 / Math.PI * spacing / b) {
      const la = lat * Math.PI / 180, count = Math.max(1, Math.round(2 * Math.PI * a * Math.cos(la) / spacing));
      for (let i = 0; i < count; i++) {
        const az = (i + (Math.round(lat) % 2) * .5) / count * Math.PI * 2;
        if (!skip?.(lat, az)) curl(cx + a * Math.cos(la) * Math.sin(az), cy + b * Math.sin(la), cz + c * Math.cos(la) * Math.cos(az));
      }
    }
  };
  shell(0, 23.2, .3, 3.3, 4.05, 3.55, .74, -12, 84, (lat, az) => lat < -12 + 46 * Math.max(0, Math.cos(az)) ** .55);
  shell(0, 26.9, .15, 2.15, 1.4, 2.15, .74, 8, 74);

  // Moulded white plinth on a ring of stone pillars, as at the real statue.
  const drum = (top, bottom, h, y0) => plain(new THREE.CylinderGeometry(top, bottom, h, 72).translate(0, y0 + h / 2, 0));
  parts.push(drum(13.1, 13.5, .95, 1.1), drum(14, 14.5, .85, .25), drum(15, 15.5, .75, -.5), drum(15.9, 16, .6, -1.1));
  const stone = [drum(16.7, 16.7, .55, -5.2), drum(16.6, 19.5, 30, -35.6)], pillars = [];
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2;
    pillars.push(plain(box(.95, 3.45, .95, 0, -4.65, 15).rotateY(a)));
    parts.push(plain(box(1.25, .2, 1.25, 0, -1.3, 15).rotateY(a)));
  }
  const add = (geos, material) => { const m = new THREE.Mesh(mergeGeometries(geos), material); m.castShadow = m.receiveShadow = true; group.add(m); return m; };
  add(parts, white);
  // Downcast eyes, as fine shadowed lines.
  const eyes = [];
  for (const x of [-1.42, 1.42]) eyes.push(plain(new THREE.TorusGeometry(.92, .06, 6, 14, 2.2).rotateZ(Math.PI * 1.5 - 1.1).scale(1, .38, 1).translate(x, 24.05, 3.36)));
  eyes.push(plain(new THREE.BoxGeometry(1.5, .05, .06).translate(0, 21.37, 3.57)));
  add(eyes, new THREE.MeshStandardMaterial({ color: '#7f7666', roughness: .8 }));
  add(stone, stoneMaterial('#8e8a80', .35));
  add(pillars, stoneMaterial('#9a968c', 1.2));
  add([drum(13.2, 13.2, 4.2, -5.0)], new THREE.MeshStandardMaterial({ color: '#46433e', roughness: .9 })); // Shaded wall behind the pillars.
  scene.add(group);
}

function buildBoulders(world, scene) {
  const rand = mulberry(77);
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const s = 1 + .22 * Math.sin(p.getX(i) * 4.1 + p.getY(i) * 3.3) * Math.cos(p.getZ(i) * 3.7);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
  }
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: '#7f7a70', roughness: .96, flatShading: true });
  const placed = [];
  for (const rock of world.rocks) {
    const n = rock.p.length;
    for (let i = 0; i < n * 3; i++) {
      const [ax, az] = rock.p[(rand() * n) | 0], [bx, bz] = rock.p[(rand() * n) | 0];
      const t = rand() * .14;
      const cx = ax + (bx - ax) * t + (rand() - .5) * 16, cz = az + (bz - az) * t + (rand() - .5) * 16;
      if (world.stairLine?.some(([sx, sz]) => Math.hypot(sx - cx, sz - cz) < 14)) continue;
      if (Math.abs(cx) < world.half && Math.abs(cz) < world.half) placed.push([cx, world.heightAt(cx, cz), cz]);
    }
  }
  const mesh = new THREE.InstancedMesh(geometry, material, placed.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(), color = new THREE.Color();
  placed.forEach(([x, y, z], i) => {
    const r = 1.8 + rand() * rand() * 7;
    S.set(r * (.8 + rand() * .6), r * (.55 + rand() * .4), r * (.8 + rand() * .6));
    P.set(x, y, z); q.setFromEuler(e.set(rand() * 3, rand() * 6, rand() * 3));
    mesh.setMatrixAt(i, m.compose(P, q, S));
    mesh.setColorAt(i, color.setScalar(.72 + rand() * .42));
  });
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
}

export function buildLandmarks(world, scene) {
  const glowing = [];
  const updateHands = buildClockTower(world, scene, glowing);
  buildBuddha(world, scene, glowing);
  buildBoulders(world, scene);
  return {
    updateHands,
    setNight(night) { for (const [m, v] of glowing) m.emissiveIntensity = v * night; },
  };
}

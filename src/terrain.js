// Ground: a painted map texture draped over real elevation, plus lakes and distant hills.
import * as THREE from 'three';
import { shared, mulberry, NOISE_GLSL } from './world.js';

const LANDUSE = {
  farmland: '#8fb04c', orchard: '#5f8a3b', forest: '#3f6a31', wood: '#3f6a31', grassland: '#86a54d', meadow: '#86a54d',
  grass: '#86a84f', village_green: '#7ea64b', park: '#74a24a', garden: '#74a24a', pitch: '#7fae4f', greenfield: '#889f51',
  residential: '#73844a', retail: '#9c9480', commercial: '#9c9480', civic_admin: '#938e78', industrial: '#8b8676',
  brownfield: '#8e805f', farmyard: '#84794f', religious: '#8d8a68', cemetery: '#70874f',
};

function trace(ctx, pts, S) {
  ctx.beginPath();
  pts.forEach(([x, z], i) => ctx[i ? 'lineTo' : 'moveTo'](x * S.k + S.cx, z * S.k + S.cz));
}

function paddyPattern(ctx) {
  const c = document.createElement('canvas');
  c.width = c.height = 22;
  const g = c.getContext('2d');
  g.fillStyle = '#93b64d'; g.fillRect(0, 0, 22, 22);
  g.fillStyle = '#7ba342'; g.fillRect(0, 0, 11, 11); g.fillRect(11, 11, 11, 11);
  g.fillStyle = 'rgba(70,85,40,.45)'; g.fillRect(0, 0, 22, 1); g.fillRect(0, 0, 1, 22);
  return ctx.createPattern(c, 'repeat');
}

function paintGround(world, size, region = null, streets = null) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const k = size / (2 * (region ? region.half : world.half));
  const S = { k, cx: size / 2 - (region ? region.x : 0) * k, cz: size / 2 - (region ? region.z : 0) * k };
  const rand = mulberry(11);
  ctx.fillStyle = '#5c7f3c';
  ctx.fillRect(0, 0, size, size);

  // Large soft patches keep unmapped countryside from looking flat.
  for (let i = 0; i < 2600; i++) {
    const x = rand() * size, y = rand() * size, r = 8 + rand() * 46;
    ctx.fillStyle = ['rgba(58,96,46,.34)', 'rgba(114,137,63,.25)', 'rgba(78,112,49,.32)'][i % 3];
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }

  const paddy = paddyPattern(ctx);
  for (const u of world.landuse) {
    const color = LANDUSE[u.t];
    if (!color) continue;
    trace(ctx, u.p, S);
    ctx.fillStyle = u.t === 'farmland' ? paddy : color;
    ctx.globalAlpha = u.t === 'residential' ? .7 : .95;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Bare earth around homes, joining compounds into a lived-in texture.
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(158,130,88,.42)';
  ctx.fillStyle = 'rgba(158,130,88,.5)';
  ctx.lineWidth = 7 * S.k;
  for (const b of world.buildings) {
    ctx.beginPath();
    for (let i = 0; i < b.p.length; i += 2) ctx[i ? 'lineTo' : 'moveTo'](b.p[i] * S.k + S.cx, b.p[i + 1] * S.k + S.cz);
    ctx.closePath(); ctx.stroke(); ctx.fill();
  }

  // Lake shores.
  ctx.strokeStyle = '#a99a70';
  ctx.lineWidth = 16 * S.k;
  for (const l of world.lakes) { trace(ctx, l.p, S); ctx.closePath(); ctx.stroke(); }

  for (const r of world.rocks) { trace(ctx, r.p, S); ctx.closePath(); ctx.fillStyle = '#88837a'; ctx.fill(); }

  // Forest floor along the temple road, over the bare rock.
  if (world.templeForest) {
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const [width, style] of [[70, 'rgba(74,104,54,.55)'], [56, '#4a6a36']]) {
      ctx.strokeStyle = style;
      ctx.lineWidth = width * S.k;
      ctx.beginPath();
      world.templeForest.forEach(([x, z], i) => ctx[i ? 'lineTo' : 'moveTo'](x * S.k + S.cx, z * S.k + S.cz));
      ctx.stroke();
    }
  }

  // Roads, widest last so junctions read correctly.
  const order = [...world.roads].sort((a, b) => a.w - b.w);
  ctx.strokeStyle = '#4d4940';
  for (const r of order) { trace(ctx, r.p, S); ctx.lineWidth = (r.w + 2.4) * S.k; ctx.stroke(); }
  for (const r of order) {
    trace(ctx, r.p, S);
    ctx.lineWidth = r.w * S.k;
    ctx.strokeStyle = r.w < 3 ? '#a58e65' : r.w < 6 ? '#77736a' : '#6a6862';
    ctx.stroke();
  }
  if (region) paintRoadDetail(ctx, order, S, streets);
  return canvas;
}

/** Sidewalks, lane markings, stop lines and zebra crossings for the sharper town-centre texture. */
function paintRoadDetail(ctx, roads, S, streets) {
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.strokeStyle = '#aaa18c';
  ctx.lineWidth = 2.5 * S.k;
  for (const seg of streets.sidewalks) { trace(ctx, seg.pts, S); ctx.stroke(); }

  ctx.setLineDash([3 * S.k, 5 * S.k]);
  ctx.strokeStyle = 'rgba(236,232,214,.72)';
  ctx.lineWidth = .3 * S.k;
  ctx.lineCap = 'butt';
  for (const r of roads) if (r.w >= 6 && !r.o) { trace(ctx, r.p, S); ctx.stroke(); }
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(238,235,220,.86)';
  for (const c of streets.crossings) {
    ctx.save();
    ctx.translate(c.x * S.k + S.cx, c.z * S.k + S.cz);
    ctx.rotate(Math.atan2(c.tz, c.tx));
    for (let o = -c.w / 2 + .4; o < c.w / 2 - .3; o += 1.1) ctx.fillRect(-1.6 * S.k, o * S.k, 3.2 * S.k, .55 * S.k);
    ctx.restore();
  }
  for (const signal of streets.signals) for (const a of signal.approaches) {
    ctx.save();
    ctx.translate(a.x * S.k + S.cx, a.z * S.k + S.cz);
    ctx.rotate(Math.atan2(a.tz, a.tx));
    // Canvas y is scene z here, so negative y is the driver's left, the side traffic uses.
    ctx.fillRect(-.25 * S.k, (a.oneway ? -a.w / 2 : -a.w / 2) * S.k, .5 * S.k, (a.oneway ? a.w : a.w / 2) * S.k);
    ctx.restore();
  }
}

function paintNightGlow(world) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const S = { k: 1024 / (2 * world.half), c: 512 };
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1024, 1024);
  ctx.lineCap = 'round';
  ctx.filter = 'blur(2px)';
  for (const r of world.roads) {
    if (r.w < 5) continue;
    trace(ctx, r.p, S);
    ctx.strokeStyle = r.w >= 8 ? '#b98342' : '#5b3f20';
    ctx.lineWidth = r.w >= 8 ? 5 : 2.5;
    ctx.stroke();
  }
  return canvas;
}

function gridGeometry(n, half, heightFn) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), nor = new Float32Array(n * n * 3);
  const c = 2 * half / (n - 1);
  for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++, k++) {
    pos[k * 3] = -half + i * c; pos[k * 3 + 1] = heightFn(k, i, j); pos[k * 3 + 2] = -half + j * c;
    uv[k * 2] = i / (n - 1); uv[k * 2 + 1] = 1 - j / (n - 1);
  }
  for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++, k++) {
    const l = pos[(k - (i > 0 ? 1 : 0)) * 3 + 1], r = pos[(k + (i < n - 1 ? 1 : 0)) * 3 + 1];
    const u = pos[(k - (j > 0 ? n : 0)) * 3 + 1], d = pos[(k + (j < n - 1 ? n : 0)) * 3 + 1];
    const nx = l - r, ny = 2 * c, nz = u - d, m = Math.hypot(nx, ny, nz);
    nor[k * 3] = nx / m; nor[k * 3 + 1] = ny / m; nor[k * 3 + 2] = nz / m;
  }
  const index = new Uint32Array((n - 1) * (n - 1) * 6);
  for (let j = 0, p = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const k = j * n + i;
    index[p++] = k; index[p++] = k + n; index[p++] = k + 1;
    index[p++] = k + 1; index[p++] = k + n; index[p++] = k + n + 1;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  return geo;
}

function groundShader(mat, detail) {
  mat.onBeforeCompile = (s) => {
    if (detail) Object.assign(s.uniforms, { uDetail: { value: detail.texture }, uDetailArea: { value: new THREE.Vector3(detail.x, detail.z, detail.half) } });
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aRock; varying float vRock; varying vec3 vP; varying float vUp;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRock = aRock; vP = position; vUp = normal.y;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        ${NOISE_GLSL} varying float vRock; varying vec3 vP; varying float vUp;
        ${detail ? 'uniform sampler2D uDetail; uniform vec3 uDetailArea;' : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        ${detail ? `
        vec2 detailUv = (vP.xz - uDetailArea.xy) / (uDetailArea.z * 2.) + .5;
        vec2 edge = min(detailUv, 1. - detailUv);
        float detailMix = smoothstep(0., .05, min(edge.x, edge.y));
        if (detailMix > 0.) diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uDetail, vec2(detailUv.x, 1. - detailUv.y)).rgb, detailMix);` : ''}
        float broad = fbm(vP.xz * .012), fine = fbm(vP.xz * .22);
        diffuseColor.rgb *= .8 + .24 * broad + .18 * fine;
        float steep = smoothstep(.76, .55, vUp);
        float rocky = clamp(max(vRock * 1.35, steep * .9), 0., 1.);
        if (rocky > .001) {
          float strata = fbm(vP.xz * .02 + vP.y * .003);
          float stain = fbm(vec2((vP.x - vP.z) * .085, vP.y * .012));
          float grain = fbm(vP.xz * .5 + vP.y);
          vec3 granite = mix(vec3(.2, .195, .18), vec3(.39, .38, .35), strata);
          granite *= mix(.62, 1.08, smoothstep(.3, .58, stain));
          granite *= .84 + .32 * grain;
          diffuseColor.rgb = mix(diffuseColor.rgb, granite, smoothstep(.15, .62, rocky));
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (rocky > .05) {
          vec2 q = vP.xz * .16 + vP.y * .08;
          float n0 = fbm(q), e = .06;
          vec3 bump = vec3(n0 - fbm(q + vec2(e, 0.)), 0., n0 - fbm(q + vec2(0., e))) * 5.;
          normal = normalize(normal + (viewMatrix * vec4(bump * rocky, 0.)).xyz);
        }`);
  };
}

export function buildGround(world, scene, renderer, textureSize = 4096, sharpenTown = false, streets = null) {
  const { N, ON, half, outerHalf, heights, outer, rock } = world;
  const max = renderer.capabilities.maxTextureSize;
  const tex = new THREE.CanvasTexture(paintGround(world, Math.min(textureSize, max)));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;

  const glow = new THREE.CanvasTexture(paintNightGlow(world));
  glow.colorSpace = THREE.SRGBColorSpace;

  const geo = gridGeometry(N, half, (k) => heights[k]);
  const rockAttr = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) rockAttr[i] = rock[i] / 255;
  geo.setAttribute('aRock', new THREE.BufferAttribute(rockAttr, 1));

  const material = new THREE.MeshStandardMaterial({ map: tex, roughness: .96, metalness: 0, emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: 0, envMapIntensity: .55 });
  let detail = null;
  if (sharpenTown) {
    const { clock } = world.landmarks;
    const region = { x: clock.x, z: clock.z, half: 550 };
    const texture = new THREE.CanvasTexture(paintGround(world, Math.min(4096, max), region, streets));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, tex.anisotropy);
    detail = { ...region, texture };
  }
  groundShader(material, detail);
  const ground = new THREE.Mesh(geo, material);
  ground.receiveShadow = ground.castShadow = true;
  scene.add(ground);

  // Real surrounding hills fade into the haze. Inside the detailed area they sit out of sight.
  const oc = 2 * outerHalf / (ON - 1);
  const outerGeo = gridGeometry(ON, outerHalf, (k, i, j) => {
    const x = -outerHalf + i * oc, z = -outerHalf + j * oc;
    return outer[k] - (Math.abs(x) < half - 40 && Math.abs(z) < half - 40 ? 30 : Math.abs(x) <= half && Math.abs(z) <= half ? 1.5 : 0);
  });
  const outerMat = new THREE.MeshStandardMaterial({ color: 0x5c7f3c, roughness: 1, envMapIntensity: .5 });
  outerMat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}\nvarying vec3 vP;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float n = fbm(vP.xz * .0016) * .6 + fbm(vP.xz * .03) * .4;
        diffuseColor.rgb *= .62 + .68 * n;`);
  };
  const distant = new THREE.Mesh(outerGeo, outerMat);
  distant.receiveShadow = false;
  scene.add(distant);

  return { material };
}

export function buildWater(world, scene) {
  const { N, half, cell, heights } = world;
  const pos = [], depth = [];
  for (const lake of world.lakes) {
    const v = (i, j) => {
      pos.push(-half + i * cell, lake.level, -half + j * cell);
      depth.push(Math.min(6, lake.level - heights[j * N + i]));
    };
    for (const [j, i0, i1] of lake.cells) for (let i = i0; i < i1; i++) {
      v(i, j); v(i, j + 1); v(i + 1, j);
      v(i + 1, j); v(i, j + 1); v(i + 1, j + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  geo.computeVertexNormals();

  const mat = new THREE.MeshPhysicalMaterial({ color: 0x1f5c63, roughness: .12, metalness: .05, transparent: true, envMapIntensity: 1.5, clearcoat: 1, clearcoatRoughness: .06 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = shared.uTime;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDepth; varying float vDepth; varying vec3 vP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepth = aDepth; vP = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}\nuniform float uTime; varying float vDepth; varying vec3 vP;
        float waves(vec2 p) { return .62 * vnoise(p * .085 + vec2(uTime * .09, uTime * .05)) + .38 * vnoise(p * .23 - vec2(uTime * .15, -uTime * .08)) + .24 * vnoise(p * .58 + vec2(-uTime * .22, uTime * .17)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float shallow = smoothstep(2.1, .1, vDepth);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.22, .39, .3), shallow);
        float foam = 0.;
        if (vDepth < .55) foam = smoothstep(.55, .0, vDepth) * smoothstep(.42, .66, fbm(vP.xz * .55 + uTime * .3));
        diffuseColor.rgb += foam * .24;
        diffuseColor.a = mix(.95, .68, smoothstep(.9, .0, vDepth)) * smoothstep(-.15, .12, vDepth);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float e = 1.2, w0 = waves(vP.xz);
        vec3 wn = vec3(w0 - waves(vP.xz + vec2(e, 0.)), 0., w0 - waves(vP.xz + vec2(0., e)));
        normal = normalize(normal + (viewMatrix * vec4(wn * .85, 0.)).xyz);`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

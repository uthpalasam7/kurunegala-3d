// Sky dome, sun or moon light, fog and image-based lighting, driven by time-of-day presets.
import * as THREE from 'three';
import { shared, NOISE_GLSL } from './world.js';

const sun = (elevation, azimuth) => {
  const e = THREE.MathUtils.degToRad(elevation), a = THREE.MathUtils.degToRad(azimuth);
  return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
};
const c = (hex) => new THREE.Color(hex);
const RAIN = {
  day: { zenith: c('#5d6873'), horizon: c('#9aa5ac'), cloud: c('#7f8a92') },
  sunset: { zenith: c('#5a5a66'), horizon: c('#a8958c'), cloud: c('#77726f') },
  night: { zenith: c('#070a12'), horizon: c('#151a25'), cloud: c('#1a2130') },
};

const PRESETS = {
  day: { dir: sun(58, 235), zenith: c('#2e6fbf'), horizon: c('#c6dcea'), sunColor: c('#fff1dc'), light: 3.1, hemiSky: c('#bcd8f2'), hemiGround: c('#7e7350'), hemi: 1.05, fog: .000052, env: .75, night: 0, cloud: c('#ffffff'), glow: .32, exposure: .92, cover: 0, storm: 0 },
  sunset: { dir: sun(11, 285), zenith: c('#3a68a8'), horizon: c('#f4b98c'), sunColor: c('#ffb778'), light: 3.5, hemiSky: c('#a8b9dc'), hemiGround: c('#7c5b3f'), hemi: .82, fog: .000072, env: .62, night: 0, cloud: c('#ffd2aa'), glow: 1, exposure: .98, cover: 0, storm: 0 },
  night: { dir: sun(52, 150), zenith: c('#050a1c'), horizon: c('#1e2b4a'), sunColor: c('#a9c1f0'), light: .62, hemiSky: c('#32466f'), hemiGround: c('#141a26'), hemi: .55, fog: .00006, env: .28, night: 1, cloud: c('#39486a'), glow: .08, exposure: 1.02, cover: 0, storm: 0 },
};

export function buildSky(scene, renderer) {
  const uniforms = {
    uDir: { value: PRESETS.sunset.dir.clone() }, uZenith: { value: c('#000') }, uHorizon: { value: c('#000') },
    uSun: { value: c('#fff') }, uCloud: { value: c('#fff') }, uGlow: { value: 1 }, uCover: { value: 0 }, uFlash: { value: 0 }, uNight: shared.uNight, uTime: shared.uTime,
  };
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms,
    vertexShader: `varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`,
    fragmentShader: `${NOISE_GLSL}
      uniform vec3 uDir, uZenith, uHorizon, uSun, uCloud; uniform float uGlow, uCover, uFlash, uNight, uTime; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.);
        vec3 col = mix(uHorizon, uZenith, pow(h, .52));
        float a = max(dot(d, uDir), 0.);
        col += uSun * (pow(a, 7.) * .3 + pow(a, 90.) * .55) * uGlow * (1. - uNight);
        col += uSun * smoothstep(.99955, .99985, a) * (uNight > .5 ? 1.1 : 12.) * (1. - uCover);
        if (d.y > .015) {
          vec2 p = d.xz / (d.y + .14);
          float n = fbm(p * 1.25 + uTime * .002) * .72 + fbm(p * 5.1 - uTime * .004) * .28;
          float cloud = smoothstep(mix(.5, .1, uCover), mix(.78, .5, uCover), n) * smoothstep(.015, .16, d.y);
          col = mix(col, uCloud * (.72 + .55 * n + pow(a, 5.) * uGlow), cloud * mix(.78, .97, uCover));
          vec3 s = floor(d * 760.), sf = fract(d * 760.) - .5;
          float star = fract(sin(dot(s, vec3(12.98, 78.23, 37.72))) * 43758.5);
          float twinkle = smoothstep(.42, .12, length(sf)) * (.45 + .55 * fract(star * 91.7));
          col += vec3(.9, .94, 1.) * step(.9978, star) * twinkle * uNight * (1. - cloud) * smoothstep(.05, .3, d.y) * 1.6;
        }
        col += vec3(.72, .78, 1.) * uFlash * 1.6;
        gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const geometry = new THREE.SphereGeometry(1000, 48, 32);
  const dome = new THREE.Mesh(geometry, material);
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  scene.add(dome);

  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(geometry, material));
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTarget = null;

  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.castShadow = true;
  light.shadow.mapSize.set(4096, 4096);
  light.shadow.bias = -.00025;
  scene.add(light, light.target);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(hemi);
  scene.fog = new THREE.FogExp2(0xffffff, .00007);

  const state = {};
  for (const [k, v] of Object.entries(PRESETS.sunset)) state[k] = v.clone ? v.clone() : v;
  let from = null, to = null, t = 1, framesSinceEnv = 0;
  let name = 'sunset', rainLevel = 0;
  const target = () => (rainLevel === 2 ? {
    ...PRESETS[name], ...RAIN[name], zenith: RAIN[name].zenith.clone().multiplyScalar(.5), horizon: RAIN[name].horizon.clone().multiplyScalar(.6), cloud: RAIN[name].cloud.clone().multiplyScalar(.5),
    sunColor: c('#aab4c0'), light: PRESETS[name].light * .1, hemi: PRESETS[name].hemi * .72, fog: PRESETS[name].fog * 5.5, env: PRESETS[name].env * .5, glow: 0, exposure: PRESETS[name].exposure * .84, cover: 1, storm: 1,
  } : rainLevel === 1 ? {
    ...PRESETS[name], ...RAIN[name], sunColor: PRESETS[name].sunColor.clone().lerp(c('#c9d0d6'), .7),
    light: PRESETS[name].light * .22, hemi: PRESETS[name].hemi * .95, fog: PRESETS[name].fog * 3.2, env: PRESETS[name].env * .72, glow: .08, exposure: PRESETS[name].exposure * .94, cover: 1,
  } : PRESETS[name]);
  function begin(instant) {
    from = {};
    for (const [k, v] of Object.entries(state)) from[k] = v.clone ? v.clone() : v;
    to = target();
    t = instant ? .999999 : 0;
  }

  function apply() {
    light.color.copy(state.sunColor); light.intensity = state.light;
    hemi.color.copy(state.hemiSky); hemi.groundColor.copy(state.hemiGround); hemi.intensity = state.hemi;
    scene.fog.color.copy(state.horizon); scene.fog.density = state.fog;
    scene.environmentIntensity = state.env;
    renderer.toneMappingExposure = state.exposure;
    uniforms.uDir.value.copy(state.dir); uniforms.uZenith.value.copy(state.zenith); uniforms.uHorizon.value.copy(state.horizon);
    uniforms.uSun.value.copy(state.sunColor); uniforms.uCloud.value.copy(state.cloud); uniforms.uGlow.value = state.glow; uniforms.uCover.value = state.cover;
    shared.uNight.value = state.night;
  }
  function refreshEnv() {
    const next = pmrem.fromScene(envScene, 0, 1, 2000);
    scene.environment = next.texture;
    envTarget?.dispose();
    envTarget = next;
  }
  apply();
  refreshEnv();

  // Lightning: a bolt on the horizon and a brief, soft flash, every several seconds during a storm.
  const boltGeometry = new THREE.BufferGeometry();
  const bolt = new THREE.LineSegments(boltGeometry, new THREE.LineBasicMaterial({ color: 0xf2f4ff, fog: false, toneMapped: false }));
  bolt.frustumCulled = false; bolt.visible = false;
  scene.add(bolt);
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches; // No strobing for people who ask for less motion.
  let strikeListener = null, nextStrike = 4, strikeTime = -1, flashing = false, pulses = [];
  const forward = new THREE.Vector3();
  function drawBolt(camera) {
    camera.getWorldDirection(forward);
    const a = Math.atan2(forward.x, forward.z) + (Math.random() - .5) * 1.2, d = 1600 + Math.random() * 1800;
    let x = camera.position.x + Math.sin(a) * d, z = camera.position.z + Math.cos(a) * d, y = camera.position.y + 620 + Math.random() * 200;
    const floor = Math.max(100, camera.position.y - 220), points = [];
    const walk = (px, py, pz, depth) => {
      while (py > floor) {
        const nx = px + (Math.random() - .5) * 90, ny = py - 45 - Math.random() * 55, nz = pz + (Math.random() - .5) * 90;
        for (const o of [0, 1.6, -1.6]) points.push(px + o, py, pz, nx + o, ny, nz);
        px = nx; py = ny; pz = nz;
        if (depth < 1 && Math.random() < .2) walk(px, py, pz, depth + 1);
        if (depth && Math.random() < .25) return;
      }
    };
    walk(x, y, z, 0);
    boltGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return d;
  }
  function setFlash(f) {
    uniforms.uFlash.value = f;
    hemi.intensity = state.hemi + f * 3.4;
    renderer.toneMappingExposure = state.exposure * (1 + f * .45);
  }
  function updateLightning(dt, camera) {
    if (state.storm > .6 && strikeTime < 0 && (nextStrike -= dt) <= 0) {
      strikeTime = 0;
      pulses = calm ? [[0, .22, .5]] : [[0, 1, .34], [.24, .45, .09], [.4, .3, .08]].slice(0, Math.random() < .35 ? 1 : 3);
      strikeListener?.(drawBolt(camera), 0); // The brightest flash comes first, together with the boom.
      nextStrike = 5 + Math.random() * 9;
    }
    if (strikeTime >= 0) {
      strikeTime += dt;
      let f = 0;
      for (const [start, power, fade] of pulses) if (strikeTime >= start) f = Math.max(f, power * Math.max(0, 1 - (strikeTime - start) / fade));
      setFlash(f);
      bolt.visible = !calm && f > .22;
      flashing = true;
      if (strikeTime > 1) { strikeTime = -1; bolt.visible = false; }
    } else if (flashing) { flashing = false; setFlash(0); }
  }

  return {
    light, get name() { return name; }, get night() { return state.night; }, get cover() { return state.cover; }, get storm() { return state.storm; }, set onStrike(listener) { strikeListener = listener; }, sunDir: state.dir,
    set(next, instant = false) {
      if (!PRESETS[next] || (next === name && t >= 1)) return;
      name = next;
      begin(instant);
    },
    setRain(level, instant = false) {
      if (level === rainLevel) return;
      rainLevel = level;
      begin(instant);
    },
    update(dt, camera) {
      dome.position.copy(camera.position);
      updateLightning(dt, camera);
      if (t >= 1) return false;
      t = Math.min(1, t + dt / 1.6);
      const e = t * t * (3 - 2 * t);
      for (const k of Object.keys(state)) {
        if (typeof state[k] === 'number') state[k] = from[k] + (to[k] - from[k]) * e;
        else if (state[k].isColor) state[k].copy(from[k]).lerp(to[k], e);
        else state[k].copy(from[k]).lerp(to[k], e).normalize();
      }
      apply();
      if (++framesSinceEnv > 7 || t >= 1) { refreshEnv(); framesSinceEnv = 0; }
      return true;
    },
  };
}

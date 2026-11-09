// Loads the baked map data and answers height queries. Shared shader uniforms live here too.
export const shared = { uRain: { value: 0 }, crowd: { value: 1 }, uTime: { value: 0 }, uNight: { value: 0 }, uSun: { value: { x: 0, y: 1, z: 0 } }, uShadow: { value: .4 } };

export function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NOISE_GLSL = /* glsl */`
  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
`;

export async function loadWorld() {
  const [scene, buffer] = await Promise.all([
    fetch('data/scene.json').then(r => { if (!r.ok) throw new Error('scene.json missing'); return r.json(); }),
    fetch('data/terrain.bin').then(r => { if (!r.ok) throw new Error('terrain.bin missing'); return r.arrayBuffer(); }),
  ]);
  const { n: N, outerN: ON, half } = scene;
  const heights = new Float32Array(buffer, 0, N * N);
  const outer = new Float32Array(buffer, N * N * 4, ON * ON);
  const rock = new Uint8Array(buffer, (N * N + ON * ON) * 4, N * N);
  const cell = 2 * half / (N - 1);

  function heightAt(x, z) {
    const fx = Math.max(0, Math.min(N - 1.001, (x + half) / cell));
    const fz = Math.max(0, Math.min(N - 1.001, (z + half) / cell));
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * N + i;
    return (heights[k] * (1 - u) + heights[k + 1] * u) * (1 - v) + (heights[k + N] * (1 - u) + heights[k + N + 1] * u) * v;
  }

  // Footprints on the bare rock are temple buildings, and one sits exactly where the statue goes.
  const st = scene.landmarks.statue;
  scene.buildings = scene.buildings.filter((b) => {
    if (Math.hypot(b.p[0] - st.x, b.p[1] - st.z) < 36) return false;
    const i = Math.round((b.p[0] + half) / cell), j = Math.round((b.p[1] + half) / cell);
    if (rock[j * N + i] > 110) { b.f = 1; b.k = 2; }
    return true;
  });

  // The tallest point near the statue is the summit of Elephant Rock.
  let summit = { x: 0, y: 0, z: 0 };
  const s = scene.landmarks.statue;
  for (let z = s.z - 450; z < s.z + 450; z += cell)
    for (let x = s.x - 450; x < s.x + 450; x += cell) {
      const y = heightAt(x, z);
      if (y > summit.y) summit = { x, y, z };
    }

  return { ...scene, N, ON, cell, heights, outer, rock, heightAt, summit };
}

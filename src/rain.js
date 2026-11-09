// Rain streaks in a box that travels with the camera, so it costs the same anywhere on the map.
import * as THREE from 'three';
import { shared } from './world.js';

const BOX = 110;

export function buildRain(scene, { low = false } = {}) {
  const count = low ? 7000 : 20000;
  const seeds = new Float32Array(count * 2 * 4), ends = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const s = [Math.random() * BOX, Math.random() * BOX, Math.random() * BOX, Math.random()];
    seeds.set(s, i * 8); seeds.set(s, i * 8 + 4);
    ends[i * 2 + 1] = 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  const uniforms = { uTime: shared.uTime, uCam: { value: new THREE.Vector3() }, uAmount: { value: 0 }, uStorm: { value: 0 }, uTint: { value: new THREE.Color('#cfd9e2') } };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, fog: false, toneMapped: false,
    vertexShader: `
      attribute vec4 aSeed; attribute float aEnd; uniform float uTime, uAmount, uStorm; uniform vec3 uCam; varying float vFade;
      void main() {
        const float BOX = ${BOX.toFixed(1)};
        float speed = 34. + aSeed.w * 16.;
        vec3 fall = vec3(-.09, -1., -.05) * speed;
        vec3 p = aSeed.xyz + fall * uTime;
        p = mod(p - uCam, BOX) - BOX * .5 + uCam;
        p += vec3(.09, 1., .05) * aEnd * (.75 + aSeed.w * .75) * (1. + uStorm * 1.3);
        float d = distance(p, uCam);
        vFade = step(aSeed.w, uAmount) * smoothstep(3., 9., d) * smoothstep(BOX * .55, BOX * .25, d) * (.5 + .5 * aEnd);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: 'uniform vec3 uTint; uniform float uAmount; varying float vFade; void main() { if (vFade < .01) discard; gl_FragColor = vec4(uTint, vFade * .42 * min(1., uAmount * 1.6)); }',
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.visible = false;
  lines.renderOrder = 5;
  scene.add(lines);

  return {
    update(amount, storm, night, camera) {
      uniforms.uStorm.value = storm;
      lines.visible = amount > .01;
      uniforms.uAmount.value = amount;
      uniforms.uCam.value.copy(camera.position);
      uniforms.uTint.value.set('#cfd9e2').multiplyScalar(1 - night * .55);
    },
  };
}

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const SpeedLensShader = {
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0 },
    aspect: { value: 1 },
    focus: { value: new THREE.Vector2(0.5, 0.42) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float aspect;
    uniform vec2 focus;
    varying vec2 vUv;

    void main() {
      vec2 ray = vUv - focus;
      float radius = length(vec2(ray.x * aspect, ray.y));
      float edgeMask = smoothstep(0.11, 0.74, radius);
      float blur = strength * edgeMask;
      vec2 stepUv = ray * blur;

      vec3 color = texture2D(tDiffuse, vUv).rgb * 0.34;
      color += texture2D(tDiffuse, vUv - stepUv * 0.20).rgb * 0.20;
      color += texture2D(tDiffuse, vUv - stepUv * 0.44).rgb * 0.16;
      color += texture2D(tDiffuse, vUv - stepUv * 0.70).rgb * 0.12;
      color += texture2D(tDiffuse, vUv - stepUv).rgb * 0.10;

      float fringe = blur * 0.32;
      color.r += texture2D(tDiffuse, vUv - stepUv * (1.0 + fringe)).r * 0.045;
      color.b += texture2D(tDiffuse, vUv - stepUv * (1.0 - fringe)).b * 0.025;
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export function createSpeedPostProcess({ qualityTier = 'high' } = {}) {
  const pass = new ShaderPass(SpeedLensShader);
  pass.enabled = false;
  const qualityScale = qualityTier === 'balanced' ? 0.72 : qualityTier === 'ultra' ? 1.08 : 1;
  let currentStrength = 0;

  return {
    pass,
    update({ speedKph = 0, boosting = false, aspect = 1, delta = 1 / 60 } = {}) {
      const speed = THREE.MathUtils.smoothstep(speedKph, 145, 330);
      const target = (0.026 + speed * 0.058 + (boosting ? 0.026 : 0)) * speed * qualityScale;
      currentStrength = THREE.MathUtils.damp(currentStrength, target, boosting ? 9 : 5, delta);
      pass.uniforms.strength.value = currentStrength;
      pass.enabled = currentStrength > 0.001;
      pass.uniforms.aspect.value = Math.max(0.6, aspect);
      pass.uniforms.focus.value.y = aspect < 0.8 ? 0.54 : 0.52;
    },
    resize(width, height) {
      pass.uniforms.aspect.value = width / Math.max(1, height);
    },
  };
}

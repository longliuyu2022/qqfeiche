import * as THREE from 'three';

export function createSky(root) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1050, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x02070c) },
        horizonColor: { value: new THREE.Color(0x123139) },
        glowColor: { value: new THREE.Color(0x14505a) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 glowColor;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y;
          float horizon = 1.0 - smoothstep(-0.08, 0.46, h);
          float cityGlow = pow(max(0.0, 1.0 - abs(h) * 5.0), 3.0);
          vec3 color = mix(topColor, horizonColor, horizon * 0.8);
          color += glowColor * cityGlow * 0.24;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    }),
  );
  sky.renderOrder = -100;
  root.add(sky);
}

export function createRain(root, random) {
  const count = 4200;
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const radius = Math.sqrt(random()) * 620;
    const angle = random() * Math.PI * 2;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = -8 + random() * 110;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
    speeds[i] = 26 + random() * 34;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('fallSpeed', new THREE.BufferAttribute(speeds, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      time: { value: 0 },
      color: { value: new THREE.Color(0xa8e9f2) },
    },
    vertexShader: `
      attribute float fallSpeed;
      uniform float time;
      varying float vFade;
      void main() {
        vec3 p = position;
        p.y = mod(position.y - time * fallSpeed + 18.0, 118.0) - 12.0;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(170.0 / -mvPosition.z, 1.2, 5.5);
        vFade = clamp(1.0 - (-mvPosition.z / 650.0), 0.12, 0.72);
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      varying float vFade;
      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float streak = smoothstep(0.13, 0.01, abs(p.x)) * smoothstep(0.5, 0.18, abs(p.y));
        gl_FragColor = vec4(color, streak * vFade * 0.58);
      }
    `,
  });
  const rain = new THREE.Points(geometry, material);
  rain.name = 'HarborRainField';
  rain.frustumCulled = false;
  root.add(rain);
  return rain;
}

export function createAtmosphere(root, random) {
  const starCount = 1400;
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);
  const cyan = new THREE.Color(0xa9edff);
  const rose = new THREE.Color(0xffbdd4);
  for (let i = 0; i < starCount; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 340 + random() * 620;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = 70 + random() * 360;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
    const color = random() > 0.13 ? cyan : rose;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const stars = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 1.05,
    vertexColors: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    sizeAttenuation: true,
    toneMapped: false,
  }));
  root.add(stars);

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(24, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xb8e4ed, toneMapped: false }),
  );
  moon.position.set(-430, 290, -560);
  root.add(moon);
  return stars;
}

export function addWorldLights(root) {
  const hemisphere = new THREE.HemisphereLight(0x7dcfe4, 0x09100f, 2.05);
  root.add(hemisphere);
  const moonLight = new THREE.DirectionalLight(0xb7e7f2, 3.05);
  moonLight.position.set(-230, 340, -260);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(2048, 2048);
  moonLight.shadow.camera.left = -180;
  moonLight.shadow.camera.right = 180;
  moonLight.shadow.camera.top = 180;
  moonLight.shadow.camera.bottom = -180;
  moonLight.shadow.camera.near = 10;
  moonLight.shadow.camera.far = 850;
  moonLight.shadow.bias = -0.0004;
  root.add(moonLight);

  const cityGlow = new THREE.PointLight(0x20e9ff, 48, 420, 1.8);
  cityGlow.position.set(0, 80, 0);
  root.add(cityGlow);
  const horizonGlow = new THREE.PointLight(0xff2d78, 180, 300, 2);
  horizonGlow.position.set(-260, 55, 160);
  root.add(horizonGlow);
  const harborGlow = new THREE.PointLight(0xff9f4a, 18, 330, 1.8);
  harborGlow.position.set(80, 34, -360);
  root.add(harborGlow);
  const mountainGlow = new THREE.PointLight(0x88c5d1, 150, 240, 2);
  mountainGlow.position.set(-315, 68, 80);
  root.add(mountainGlow);
}

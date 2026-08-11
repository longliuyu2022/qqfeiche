import * as THREE from 'three';

const TEXTURE_SIZE = 256;

const canUseCanvas = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

function paintBackground(ctx, baseColor) {
  const gradient = ctx.createLinearGradient(0, 0, 0, TEXTURE_SIZE);
  const base = new THREE.Color(baseColor);
  const highlight = base.clone().lerp(new THREE.Color(0xffffff), 0.1);
  const shade = base.clone().lerp(new THREE.Color(0x000000), 0.34);
  gradient.addColorStop(0, `#${highlight.getHexString()}`);
  gradient.addColorStop(0.55, `#${base.getHexString()}`);
  gradient.addColorStop(1, `#${shade.getHexString()}`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
}

// Every pattern covers the whole texture: car body UVs only sample a slice of
// it, so anything drawn in a band alone would be invisible on most panels.
const PATTERNS = Object.freeze({
  // Twin racing stripes running the length of the body.
  stripe(ctx, color) {
    ctx.fillStyle = color;
    ctx.fillRect(TEXTURE_SIZE * 0.34, 0, TEXTURE_SIZE * 0.11, TEXTURE_SIZE);
    ctx.fillRect(TEXTURE_SIZE * 0.55, 0, TEXTURE_SIZE * 0.11, TEXTURE_SIZE);
    ctx.globalAlpha = 0.5;
    ctx.fillRect(TEXTURE_SIZE * 0.05, 0, TEXTURE_SIZE * 0.04, TEXTURE_SIZE);
    ctx.fillRect(TEXTURE_SIZE * 0.91, 0, TEXTURE_SIZE * 0.04, TEXTURE_SIZE);
    ctx.globalAlpha = 1;
  },
  // Flame tongues, tiled top and bottom so every panel catches some.
  flame(ctx, color) {
    ctx.fillStyle = color;
    for (const [baseY, direction] of [[TEXTURE_SIZE, -1], [0, 1]]) {
      for (let index = 0; index < 6; index += 1) {
        const offset = index * (TEXTURE_SIZE / 6);
        const height = TEXTURE_SIZE * (0.4 + (index % 2) * 0.16);
        ctx.beginPath();
        ctx.moveTo(offset, baseY);
        ctx.quadraticCurveTo(offset + TEXTURE_SIZE * 0.05, baseY + direction * height * 0.6, offset + TEXTURE_SIZE * 0.02, baseY + direction * height);
        ctx.quadraticCurveTo(offset + TEXTURE_SIZE * 0.11, baseY + direction * height * 0.5, offset + TEXTURE_SIZE * 0.15, baseY);
        ctx.closePath();
        ctx.fill();
      }
    }
  },
  // Circuit-board traces with solder pads.
  circuit(ctx, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 4;
    for (let index = 0; index < 9; index += 1) {
      const y = 12 + index * 28;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(TEXTURE_SIZE * 0.34, y);
      ctx.lineTo(TEXTURE_SIZE * 0.46, y + (index % 2 ? 18 : -18));
      ctx.lineTo(TEXTURE_SIZE, y + (index % 2 ? 18 : -18));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(TEXTURE_SIZE * 0.46, y + (index % 2 ? 18 : -18), 5, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  // Finish-line checkers over the whole panel.
  checker(ctx, color) {
    const cells = 10;
    const cell = TEXTURE_SIZE / cells;
    ctx.fillStyle = color;
    for (let row = 0; row < cells; row += 1) {
      for (let column = 0; column < cells; column += 1) {
        if ((row + column) % 2) continue;
        ctx.fillRect(column * cell, row * cell, cell, cell);
      }
    }
  },
});

/**
 * Bakes a car livery: the paint colour as the background with the decal
 * pattern drawn on top, so one texture drives both without extra draw calls.
 * Returns null when there is no decal or no canvas (node/headless).
 */
export function createLiveryTexture({ baseColor = '#ff3b30', pattern, patternColor = '#ffffff' } = {}) {
  if (!pattern || !PATTERNS[pattern] || !canUseCanvas()) return null;
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paintBackground(ctx, baseColor);
  PATTERNS[pattern](ctx, patternColor);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

export const DECAL_PATTERNS = Object.freeze(Object.keys(PATTERNS));

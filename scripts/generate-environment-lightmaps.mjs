import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const modelRoot = path.join(root, 'public/assets/environment/models');
const lightmapRoot = path.join(root, 'public/assets/environment/lightmaps');
const kinds = ['mountainside', 'boulder', 'apartment', 'factory', 'fir'];
const levels = ['near', 'mid', 'far'];
const size = 64;
const componentCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const componentBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const light = [0.419, 0.82, 0.391];

await MeshoptDecoder.ready;

function readGlb(file) {
  const data = fs.readFileSync(file);
  if (data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(4) !== 2) {
    throw new Error(`Not a GLB v2: ${file}`);
  }
  const jsonLength = data.readUInt32LE(12);
  const jsonStart = 20;
  const json = JSON.parse(data.subarray(jsonStart, jsonStart + jsonLength).toString('utf8').trim());
  const binHeader = jsonStart + jsonLength;
  const binLength = data.readUInt32LE(binHeader);
  return {
    data,
    json,
    jsonLength,
    jsonStart,
    binChunk: data.subarray(binHeader, binHeader + 8 + binLength),
    bin: data.subarray(binHeader + 8, binHeader + 8 + binLength),
  };
}

function writeGlb(file, json, bin) {
  const paddedBin = bin.length % 4 === 0
    ? bin
    : Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]);
  json.buffers[0].byteLength = paddedBin.length;
  const finalJsonText = JSON.stringify(json);
  const finalJson = Buffer.from(finalJsonText.padEnd(Math.ceil(finalJsonText.length / 4) * 4, ' '));
  const totalLength = 12 + 8 + finalJson.length + 8 + paddedBin.length;
  const output = Buffer.alloc(totalLength);
  output.write('glTF', 0, 4, 'ascii');
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);
  output.writeUInt32LE(finalJson.length, 12);
  output.write('JSON', 16, 4, 'ascii');
  finalJson.copy(output, 20);
  const binHeader = 20 + finalJson.length;
  output.writeUInt32LE(paddedBin.length, binHeader);
  output.write('BIN\0', binHeader + 4, 4, 'ascii');
  paddedBin.copy(output, binHeader + 8);
  fs.writeFileSync(file, output);
}

async function addLightmapUv(file) {
  const glb = readGlb(file);
  const primitives = (glb.json.meshes ?? []).flatMap((mesh) => mesh.primitives ?? []);
  if (!primitives.length) throw new Error(`No mesh primitives in ${file}`);
  const grid = Math.ceil(Math.sqrt(primitives.length));
  const tileSize = 1 / grid;
  const padding = tileSize * 0.045;
  const cache = new Map();
  const chunks = [Buffer.from(glb.bin)];
  let byteOffset = glb.bin.length;

  for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex += 1) {
    const primitive = primitives[primitiveIndex];
    const sourceIndex = primitive.attributes?.TEXCOORD_0;
    if (sourceIndex === undefined) throw new Error(`Missing TEXCOORD_0 in ${file}`);
    const sourceAccessor = glb.json.accessors[sourceIndex];
    const source = await readAccessor(glb, sourceIndex, cache);
    const atlasUv = new Float32Array(source.length);
    let minU = Infinity;
    let minV = Infinity;
    let maxU = -Infinity;
    let maxV = -Infinity;
    for (let index = 0; index < source.length; index += 2) {
      minU = Math.min(minU, source[index]);
      minV = Math.min(minV, source[index + 1]);
      maxU = Math.max(maxU, source[index]);
      maxV = Math.max(maxV, source[index + 1]);
    }
    const rangeU = Math.max(1e-6, maxU - minU);
    const rangeV = Math.max(1e-6, maxV - minV);
    const tileX = primitiveIndex % grid;
    const tileY = Math.floor(primitiveIndex / grid);
    const usable = tileSize - padding * 2;
    for (let index = 0; index < source.length; index += 2) {
      atlasUv[index] = tileX * tileSize + padding + ((source[index] - minU) / rangeU) * usable;
      atlasUv[index + 1] = tileY * tileSize + padding + ((source[index + 1] - minV) / rangeV) * usable;
    }

    const uv2 = new Uint8Array(atlasUv.length);
    let atlasMinU = 1;
    let atlasMinV = 1;
    let atlasMaxU = 0;
    let atlasMaxV = 0;
    for (let index = 0; index < atlasUv.length; index += 2) {
      const u = Math.max(0, Math.min(1, atlasUv[index]));
      const v = Math.max(0, Math.min(1, atlasUv[index + 1]));
      uv2[index] = Math.round(u * 255);
      uv2[index + 1] = Math.round(v * 255);
      atlasMinU = Math.min(atlasMinU, u);
      atlasMinV = Math.min(atlasMinV, v);
      atlasMaxU = Math.max(atlasMaxU, u);
      atlasMaxV = Math.max(atlasMaxV, v);
    }
    const bytes = Buffer.from(uv2.buffer, uv2.byteOffset, uv2.byteLength);
    const bufferView = glb.json.bufferViews.length;
    glb.json.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length });
    const accessor = glb.json.accessors.length;
    glb.json.accessors.push({
      bufferView,
      componentType: 5121,
      normalized: true,
      count: sourceAccessor.count,
      type: 'VEC2',
      min: [atlasMinU, atlasMinV],
      max: [atlasMaxU, atlasMaxV],
    });
    primitive.attributes.TEXCOORD_1 = accessor;
    chunks.push(bytes);
    byteOffset += bytes.length;
  }
  glb.json.extras = {
    ...(glb.json.extras ?? {}),
    neonApexLightmap: 'atlas-irradiance-v2',
    lightmapUv: 'TEXCOORD_1',
    lightmapUvSource: 'dedicated-atlas-accessor',
    lightmapAtlasGrid: grid,
  };
  writeGlb(file, glb.json, Buffer.concat(chunks));
}

async function decodedView(glb, index, cache) {
  if (cache.has(index)) return cache.get(index);
  const view = glb.json.bufferViews[index];
  const compression = view.extensions?.EXT_meshopt_compression;
  let bytes;
  if (compression) {
    const source = glb.bin.subarray(
      compression.byteOffset ?? 0,
      (compression.byteOffset ?? 0) + compression.byteLength,
    );
    bytes = await MeshoptDecoder.decodeGltfBufferAsync(
      compression.count,
      compression.byteStride,
      source,
      compression.mode,
      compression.filter ?? 'NONE',
    );
  } else {
    bytes = glb.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  }
  cache.set(index, bytes);
  return bytes;
}

function readComponent(view, offset, componentType, normalized) {
  let value;
  if (componentType === 5120) value = view.getInt8(offset);
  else if (componentType === 5121) value = view.getUint8(offset);
  else if (componentType === 5122) value = view.getInt16(offset, true);
  else if (componentType === 5123) value = view.getUint16(offset, true);
  else if (componentType === 5125) value = view.getUint32(offset, true);
  else if (componentType === 5126) value = view.getFloat32(offset, true);
  else throw new Error(`Unsupported accessor component type: ${componentType}`);
  if (!normalized) return value;
  if (componentType === 5120) return Math.max(value / 127, -1);
  if (componentType === 5121) return value / 255;
  if (componentType === 5122) return Math.max(value / 32767, -1);
  if (componentType === 5123) return value / 65535;
  if (componentType === 5125) return value / 4294967295;
  return value;
}

async function readAccessor(glb, index, cache) {
  const accessor = glb.json.accessors[index];
  const bufferView = glb.json.bufferViews[accessor.bufferView];
  const bytes = await decodedView(glb, accessor.bufferView, cache);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const components = componentCounts[accessor.type];
  const bytesPerComponent = componentBytes[accessor.componentType];
  const stride = bufferView.extensions?.EXT_meshopt_compression?.byteStride
    ?? bufferView.byteStride
    ?? components * bytesPerComponent;
  const values = new Float32Array(accessor.count * components);
  for (let item = 0; item < accessor.count; item += 1) {
    for (let component = 0; component < components; component += 1) {
      values[item * components + component] = readComponent(
        view,
        (accessor.byteOffset ?? 0) + item * stride + component * bytesPerComponent,
        accessor.componentType,
        accessor.normalized,
      );
    }
  }
  return values;
}

function splat(sum, weight, u, v, irradiance) {
  const centerX = Math.floor((((u % 1) + 1) % 1) * (size - 1));
  const centerY = Math.floor((1 - (((v % 1) + 1) % 1)) * (size - 1));
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = Math.max(0, Math.min(size - 1, centerX + dx));
      const y = Math.max(0, Math.min(size - 1, centerY + dy));
      const index = y * size + x;
      const contribution = dx === 0 && dy === 0 ? 1 : 0.35;
      sum[index] += irradiance * contribution;
      weight[index] += contribution;
    }
  }
}

function fillUncovered(values, covered) {
  for (let pass = 0; pass < size; pass += 1) {
    const additions = [];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const index = y * size + x;
        if (covered[index]) continue;
        let sum = 0;
        let count = 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
          const neighbor = ny * size + nx;
          if (covered[neighbor]) {
            sum += values[neighbor];
            count += 1;
          }
        }
        if (count) additions.push([index, sum / count]);
      }
    }
    if (!additions.length) break;
    for (const [index, value] of additions) {
      values[index] = value;
      covered[index] = 1;
    }
  }
}

async function bakeLightmap(file, output) {
  const glb = readGlb(file);
  const cache = new Map();
  const sum = new Float32Array(size * size);
  const weight = new Float32Array(size * size);
  let bakedVertices = 0;

  for (const mesh of glb.json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const uvIndex = primitive.attributes?.TEXCOORD_1;
      const normalIndex = primitive.attributes?.NORMAL;
      if (uvIndex === undefined || normalIndex === undefined) continue;
      const [uv, normal] = await Promise.all([
        readAccessor(glb, uvIndex, cache),
        readAccessor(glb, normalIndex, cache),
      ]);
      const count = Math.min(uv.length / 2, normal.length / 3);
      for (let vertex = 0; vertex < count; vertex += 1) {
        const nx = normal[vertex * 3];
        const ny = normal[vertex * 3 + 1];
        const nz = normal[vertex * 3 + 2];
        const length = Math.hypot(nx, ny, nz) || 1;
        const normalX = nx / length;
        const normalY = ny / length;
        const normalZ = nz / length;
        const direct = Math.max(0, normalX * light[0] + normalY * light[1] + normalZ * light[2]);
        const sky = normalY * 0.5 + 0.5;
        const irradiance = 0.12 + direct * 0.28 + sky * 0.12;
        splat(sum, weight, uv[vertex * 2], uv[vertex * 2 + 1], irradiance);
        bakedVertices += 1;
      }
    }
  }
  if (!bakedVertices) throw new Error(`No lightmap vertices baked for ${file}`);

  const values = new Float32Array(size * size);
  const covered = new Uint8Array(size * size);
  for (let index = 0; index < values.length; index += 1) {
    if (weight[index] > 0) {
      values[index] = sum[index] / weight[index];
      covered[index] = 1;
    }
  }
  fillUncovered(values, covered);

  const png = new PNG({ width: size, height: size, colorType: 6, inputColorType: 6 });
  for (let index = 0; index < values.length; index += 1) {
    const irradiance = covered[index] ? values[index] : 0.16;
    const offset = index * 4;
    png.data[offset] = Math.round(Math.min(1, irradiance * 1.04) * 255);
    png.data[offset + 1] = Math.round(Math.min(1, irradiance) * 255);
    png.data[offset + 2] = Math.round(Math.min(1, irradiance * 0.92) * 255);
    png.data[offset + 3] = 255;
  }
  fs.writeFileSync(output, PNG.sync.write(png, { colorType: 6, inputColorType: 6, inputHasAlpha: true }));
  return bakedVertices;
}

fs.mkdirSync(lightmapRoot, { recursive: true });
let bakedVertices = 0;
for (const kind of kinds) {
  fs.mkdirSync(path.join(lightmapRoot, kind), { recursive: true });
  for (const level of levels) {
    const model = path.join(modelRoot, kind, `${kind}-${level}.glb`);
    await addLightmapUv(model);
    bakedVertices += await bakeLightmap(model, path.join(lightmapRoot, kind, `${kind}-${level}.png`));
  }
}
console.log(JSON.stringify({ generated: kinds.length * levels.length, bakedVertices, lightmapRoot }));

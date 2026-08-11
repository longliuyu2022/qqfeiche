// Shadow-challenge ghost replay: throttled recording, compact serialization,
// and interpolated playback. Pure logic module (no THREE / window) so it can
// run directly under node for tests.
//
// Serialized layout (little-endian, base64 of the raw bytes):
//   [0]  'N'                magic
//   [1]  'G'                magic
//   [2]  version            (1)
//   [3]  reserved flags     (0)
//   [4]  Uint32 count       sample count (>= 1)
//   [8]  Uint32 interval    nominal sample interval, microseconds
//   [12] Float64 duration   final race time, seconds
//   [20] Uint32 x count     sample times, milliseconds, non-decreasing
//   ...  Int32 x 3          first sample x/y/z, 1/32 m fixed point
//   ...  Int16 x 3 x (count - 1)  per-sample x/y/z deltas, 1/32 m fixed point
//   ...  Uint16 x count     heading, 65536 steps per full turn
//   ...  ceil(count / 8)    drifting bit flags, LSB-first per byte

const GHOST_VERSION = 1;
const DEFAULT_INTERVAL = 0.12;
const HEADER_SIZE = 20;
const MAGIC_0 = 0x4e; // 'N'
const MAGIC_1 = 0x47; // 'G'
const POSITION_SCALE = 32; // fixed point: 1/32 m
const HEADING_STEPS = 65536;
const TIME_SCALE = 1000; // milliseconds
const INTERVAL_SCALE = 1e6; // microseconds
const TAIL_HOLD_SECONDS = 0.5;
const TWO_PI = Math.PI * 2;
const MAX_COORDINATE = 1_000_000; // meters; keeps Int32 fixed point safe
const MAX_TIME_MS = 0xffffffff;
const THROTTLE_EPSILON = 1e-9;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

let base64Lookup = null;

function base64Encode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64_ALPHABET[(triple >> 18) & 63];
    out += BASE64_ALPHABET[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 63] : '=';
  }
  return out;
}

function base64Decode(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length % 4 !== 0) return null;
  if (!base64Lookup) {
    base64Lookup = new Int16Array(128).fill(-1);
    for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
      base64Lookup[BASE64_ALPHABET.charCodeAt(i)] = i;
    }
  }
  let padding = 0;
  if (text.endsWith('==')) padding = 2;
  else if (text.endsWith('=')) padding = 1;
  const byteLength = (text.length / 4) * 3 - padding;
  const bytes = new Uint8Array(byteLength);
  let out = 0;
  for (let i = 0; i < text.length; i += 4) {
    let triple = 0;
    for (let j = 0; j < 4; j += 1) {
      const code = text.charCodeAt(i + j);
      if (code === 61) { // '=' is only valid as trailing padding
        if (i + 4 < text.length || j < 4 - padding) return null;
        triple <<= 6;
        continue;
      }
      const value = code < 128 ? base64Lookup[code] : -1;
      if (value < 0) return null;
      triple = (triple << 6) | value;
    }
    if (out < byteLength) {
      bytes[out] = (triple >> 16) & 255;
      out += 1;
    }
    if (out < byteLength) {
      bytes[out] = (triple >> 8) & 255;
      out += 1;
    }
    if (out < byteLength) {
      bytes[out] = triple & 255;
      out += 1;
    }
  }
  return bytes;
}

function clampInt16(value) {
  if (value > 32767) return 32767;
  if (value < -32768) return -32768;
  return value;
}

function quantizeHeading(heading) {
  let normalized = heading % TWO_PI;
  if (normalized < 0) normalized += TWO_PI;
  return Math.round((normalized / TWO_PI) * HEADING_STEPS) % HEADING_STEPS;
}

function shortestAngleDelta(from, to) {
  let delta = (to - from) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  else if (delta < -Math.PI) delta += TWO_PI;
  return delta;
}

function sampleArray(value, count) {
  return value && typeof value.length === 'number' && value.length === count ? value : null;
}

function isValidGhostData(data) {
  if (!data || typeof data !== 'object' || data.v !== GHOST_VERSION) return false;
  const count = data.count;
  if (!Number.isInteger(count) || count < 1) return false;
  const interval = Number(data.interval);
  const duration = Number(data.duration);
  if (!Number.isFinite(interval) || interval <= 0) return false;
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const times = sampleArray(data.times, count);
  const xs = sampleArray(data.x, count);
  const ys = sampleArray(data.y, count);
  const zs = sampleArray(data.z, count);
  const headings = sampleArray(data.heading, count);
  const drifting = sampleArray(data.drifting, count);
  if (!times || !xs || !ys || !zs || !headings || !drifting) return false;
  let previous = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const t = Number(times[i]);
    if (!Number.isFinite(t) || t < 0 || t < previous || t * TIME_SCALE > MAX_TIME_MS) return false;
    const x = Number(xs[i]);
    const y = Number(ys[i]);
    const z = Number(zs[i]);
    if (!Number.isFinite(x) || Math.abs(x) > MAX_COORDINATE) return false;
    if (!Number.isFinite(y) || Math.abs(y) > MAX_COORDINATE) return false;
    if (!Number.isFinite(z) || Math.abs(z) > MAX_COORDINATE) return false;
    if (!Number.isFinite(Number(headings[i]))) return false;
    previous = t;
  }
  return true;
}

export function createGhostRecorder({ interval = DEFAULT_INTERVAL } = {}) {
  const step = Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_INTERVAL;
  let samples = [];
  let pending = null;
  let nextTime = 0;
  let lastRecordedTime = -Infinity;
  let recording = false;

  const record = (sample) => {
    samples.push(sample);
    lastRecordedTime = sample.t;
    pending = null;
  };

  return {
    get recording() {
      return recording;
    },
    begin() {
      samples = [];
      pending = null;
      nextTime = 0;
      lastRecordedTime = -Infinity;
      recording = true;
    },
    sample(raceTime, pose = {}) {
      if (!recording) return false;
      const t = Number(raceTime);
      const x = Number(pose.x);
      const y = Number(pose.y);
      const z = Number(pose.z);
      const heading = Number(pose.heading);
      if (!Number.isFinite(t) || t < 0 || t <= lastRecordedTime) return false;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(heading)) {
        return false;
      }
      const sample = { t, x, y, z, heading, drifting: pose.drifting ? 1 : 0 };
      if (samples.length === 0) {
        record(sample);
        nextTime = t + step;
        return true;
      }
      if (t + THROTTLE_EPSILON >= nextTime) {
        record(sample);
        nextTime += step;
        if (nextTime <= t) nextTime = t + step;
        return true;
      }
      pending = sample;
      return false;
    },
    complete(finalTime) {
      if (!recording) return null;
      recording = false;
      if (pending && pending.t > lastRecordedTime) samples.push(pending);
      const collected = samples;
      samples = [];
      pending = null;
      if (collected.length === 0) return null;
      const count = collected.length;
      const lastSampleTime = collected[count - 1].t;
      const parsedFinal = Number(finalTime);
      const duration = Number.isFinite(parsedFinal) && parsedFinal > 0
        ? Math.max(parsedFinal, lastSampleTime)
        : lastSampleTime;
      const times = new Float64Array(count);
      const xs = new Float64Array(count);
      const ys = new Float64Array(count);
      const zs = new Float64Array(count);
      const headings = new Float64Array(count);
      const drifting = new Uint8Array(count);
      for (let i = 0; i < count; i += 1) {
        const sample = collected[i];
        times[i] = sample.t;
        xs[i] = sample.x;
        ys[i] = sample.y;
        zs[i] = sample.z;
        headings[i] = sample.heading;
        drifting[i] = sample.drifting;
      }
      return { v: GHOST_VERSION, interval: step, duration, count, times, x: xs, y: ys, z: zs, heading: headings, drifting };
    },
    cancel() {
      recording = false;
      samples = [];
      pending = null;
    },
  };
}

export function serializeGhost(ghostData) {
  if (!isValidGhostData(ghostData)) return null;
  const count = ghostData.count;
  const byteLength = HEADER_SIZE + count * 4 + 12 + (count - 1) * 6 + count * 2 + Math.ceil(count / 8);
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  view.setUint8(0, MAGIC_0);
  view.setUint8(1, MAGIC_1);
  view.setUint8(2, GHOST_VERSION);
  view.setUint8(3, 0);
  view.setUint32(4, count, true);
  view.setUint32(8, Math.min(MAX_TIME_MS, Math.max(1, Math.round(Number(ghostData.interval) * INTERVAL_SCALE))), true);
  view.setFloat64(12, Number(ghostData.duration), true);
  let offset = HEADER_SIZE;
  for (let i = 0; i < count; i += 1) {
    view.setUint32(offset, Math.round(Number(ghostData.times[i]) * TIME_SCALE), true);
    offset += 4;
  }
  let previousX = 0;
  let previousY = 0;
  let previousZ = 0;
  for (let i = 0; i < count; i += 1) {
    const qx = Math.round(Number(ghostData.x[i]) * POSITION_SCALE);
    const qy = Math.round(Number(ghostData.y[i]) * POSITION_SCALE);
    const qz = Math.round(Number(ghostData.z[i]) * POSITION_SCALE);
    if (i === 0) {
      view.setInt32(offset, qx, true);
      view.setInt32(offset + 4, qy, true);
      view.setInt32(offset + 8, qz, true);
      offset += 12;
      previousX = qx;
      previousY = qy;
      previousZ = qz;
    } else {
      // Deltas accumulate from the reconstructed value so a clamped jump
      // (teleport farther than ~1023 m between samples) cannot corrupt the
      // rest of the trace.
      const dx = clampInt16(qx - previousX);
      const dy = clampInt16(qy - previousY);
      const dz = clampInt16(qz - previousZ);
      view.setInt16(offset, dx, true);
      view.setInt16(offset + 2, dy, true);
      view.setInt16(offset + 4, dz, true);
      offset += 6;
      previousX += dx;
      previousY += dy;
      previousZ += dz;
    }
  }
  for (let i = 0; i < count; i += 1) {
    view.setUint16(offset, quantizeHeading(Number(ghostData.heading[i])), true);
    offset += 2;
  }
  const driftBytes = new Uint8Array(buffer, offset);
  for (let i = 0; i < count; i += 1) {
    if (ghostData.drifting[i]) driftBytes[i >> 3] |= 1 << (i & 7);
  }
  return base64Encode(new Uint8Array(buffer));
}

export function deserializeGhost(text) {
  try {
    const bytes = base64Decode(text);
    if (!bytes || bytes.length < HEADER_SIZE) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint8(0) !== MAGIC_0 || view.getUint8(1) !== MAGIC_1) return null;
    if (view.getUint8(2) !== GHOST_VERSION) return null;
    const count = view.getUint32(4, true);
    if (count < 1) return null;
    const expected = HEADER_SIZE + count * 4 + 12 + (count - 1) * 6 + count * 2 + Math.ceil(count / 8);
    if (bytes.length !== expected) return null;
    const intervalUs = view.getUint32(8, true);
    const duration = view.getFloat64(12, true);
    if (intervalUs === 0 || !Number.isFinite(duration) || duration <= 0) return null;
    const times = new Float64Array(count);
    const xs = new Float64Array(count);
    const ys = new Float64Array(count);
    const zs = new Float64Array(count);
    const headings = new Float64Array(count);
    const drifting = new Uint8Array(count);
    let offset = HEADER_SIZE;
    let previousMs = 0;
    for (let i = 0; i < count; i += 1) {
      const ms = view.getUint32(offset, true);
      offset += 4;
      if (ms < previousMs) return null;
      previousMs = ms;
      times[i] = ms / TIME_SCALE;
    }
    let qx = 0;
    let qy = 0;
    let qz = 0;
    for (let i = 0; i < count; i += 1) {
      if (i === 0) {
        qx = view.getInt32(offset, true);
        qy = view.getInt32(offset + 4, true);
        qz = view.getInt32(offset + 8, true);
        offset += 12;
      } else {
        qx += view.getInt16(offset, true);
        qy += view.getInt16(offset + 2, true);
        qz += view.getInt16(offset + 4, true);
        offset += 6;
      }
      xs[i] = qx / POSITION_SCALE;
      ys[i] = qy / POSITION_SCALE;
      zs[i] = qz / POSITION_SCALE;
    }
    for (let i = 0; i < count; i += 1) {
      headings[i] = (view.getUint16(offset, true) / HEADING_STEPS) * TWO_PI;
      offset += 2;
    }
    for (let i = 0; i < count; i += 1) {
      drifting[i] = (bytes[offset + (i >> 3)] >> (i & 7)) & 1;
    }
    const data = {
      v: GHOST_VERSION,
      interval: intervalUs / INTERVAL_SCALE,
      duration,
      count,
      times,
      x: xs,
      y: ys,
      z: zs,
      heading: headings,
      drifting,
    };
    return isValidGhostData(data) ? data : null;
  } catch {
    return null;
  }
}

export function createGhostPlayer() {
  let data = null;

  const frameAt = (index) => ({
    x: data.x[index],
    y: data.y[index],
    z: data.z[index],
    heading: data.heading[index],
    drifting: Boolean(data.drifting[index]),
  });

  return {
    get active() {
      return data !== null;
    },
    get duration() {
      return data ? data.duration : 0;
    },
    start(ghostData) {
      data = isValidGhostData(ghostData) ? ghostData : null;
      return data !== null;
    },
    stop() {
      data = null;
    },
    sampleAt(raceTime) {
      if (!data) return null;
      const t = Number(raceTime);
      if (!Number.isFinite(t)) return null;
      const { times, count } = data;
      const last = count - 1;
      const end = Math.max(data.duration, times[last]);
      if (t > end + TAIL_HOLD_SECONDS) return null;
      if (t <= times[0]) return frameAt(0);
      if (t >= times[last]) return frameAt(last);
      let lo = 0;
      let hi = last;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= t) lo = mid;
        else hi = mid;
      }
      const t0 = times[lo];
      const t1 = times[hi];
      const f = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      const heading0 = data.heading[lo];
      return {
        x: data.x[lo] + (data.x[hi] - data.x[lo]) * f,
        y: data.y[lo] + (data.y[hi] - data.y[lo]) * f,
        z: data.z[lo] + (data.z[hi] - data.z[lo]) * f,
        heading: heading0 + shortestAngleDelta(heading0, data.heading[hi]) * f,
        drifting: Boolean(data.drifting[f < 0.5 ? lo : hi]),
      };
    },
  };
}

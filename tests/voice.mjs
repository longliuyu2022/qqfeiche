// 播报语音包：两套音色必须提供完全相同的 clip 键名，缺一条就是那句播报静音。
// 以后新增播报时，这个测试会在只补了一个包的时候直接失败。
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VOICE_PACK, VOICE_PACKS, voicePackBaseUrl } from '../src/audio.js';

const publicRoot = fileURLToPath(new URL('../public', import.meta.url));

function readManifest(pack) {
  const base = VOICE_PACKS[pack];
  const path = `${publicRoot}${base}manifest.json`;
  return { base, clips: JSON.parse(readFileSync(path, 'utf8')).clips };
}

assert.equal(DEFAULT_VOICE_PACK, 'female', '默认音色是女声');
assert.equal(voicePackBaseUrl('classic'), '/assets/audio/voice/');
assert.equal(voicePackBaseUrl('female'), '/assets/audio/voice-female/');
// 非法/缺失的音色名一律回落到默认包，绝不让播报整个哑掉。
assert.equal(voicePackBaseUrl('nope'), voicePackBaseUrl(DEFAULT_VOICE_PACK));
assert.equal(voicePackBaseUrl(undefined), voicePackBaseUrl(DEFAULT_VOICE_PACK));

const packs = Object.keys(VOICE_PACKS).map((pack) => ({ pack, ...readManifest(pack) }));
const [reference] = packs;
const expected = Object.keys(reference.clips).sort();
assert.ok(expected.length >= 13, 'the voice bank should cover every announcement');

for (const { pack, base, clips } of packs) {
  assert.deepEqual(Object.keys(clips).sort(), expected, `${pack} 的 clip 键名必须与其他音色一致`);
  for (const [name, entry] of Object.entries(clips)) {
    assert.ok(entry.file, `${pack}/${name} 缺少文件名`);
    assert.ok(entry.duration > 0, `${pack}/${name} 时长必须为正`);
    const size = statSync(`${publicRoot}${base}${entry.file}`).size;
    // 空文件也能通过 fetch，但播出来是静音，这里直接卡掉。
    assert.ok(size > 512, `${pack}/${name} 音频文件过小（${size} B）`);
  }
}

console.log(JSON.stringify({
  packs: packs.map((entry) => entry.pack),
  clips: expected.length,
  defaultPack: DEFAULT_VOICE_PACK,
}));

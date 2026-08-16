import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

// 这条断言存在的原因：GTAOPass 的 Denoise 分支会以 NoBlending 把降噪后的 AO 缓冲
// 直接写进输出，整帧画面被一张 AO 图取代 —— 无遮蔽处是白的，玩家看到的就是白屏。
// 只有 Default 分支才是"先写场景、再按 blendIntensity 混合遮蔽"。
// 这个坑不会报错、不会失败构建，balanced 档还完全看不出来（那档根本不启用后处理），
// 所以必须由测试守住。
assert.equal(GTAOPass.OUTPUT.Default, 0, 'GTAOPass.OUTPUT.Default 的取值发生了变化');
assert.notEqual(GTAOPass.OUTPUT.Denoise, GTAOPass.OUTPUT.Default);

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

const assignments = [...main.matchAll(/gtao\.output\s*=\s*GTAOPass\.OUTPUT\.(\w+)/g)].map((m) => m[1]);
assert.ok(assignments.length > 0, 'main.js 未显式设置 gtao.output');
for (const mode of assignments) {
  assert.equal(
    mode,
    'Default',
    `gtao.output 只能是 Default；${mode} 会把整帧替换成调试缓冲，高画质档直接白屏`,
  );
}

// blendIntensity 仅在 Default 分支生效，设了它却用别的输出模式就是自相矛盾。
if (/gtao\.blendIntensity\s*=/.test(main)) {
  assert.ok(
    assignments.every((mode) => mode === 'Default'),
    'blendIntensity 只有 OUTPUT.Default 会读取',
  );
}

// 其余调试输出（Depth/Normal/AO/Diffuse）同样会顶掉画面，一并挡住。
for (const debugMode of ['Depth', 'Normal', 'AO', 'Diffuse', 'Denoise']) {
  assert.ok(
    !main.includes(`GTAOPass.OUTPUT.${debugMode}`),
    `main.js 残留了 GTAOPass 调试输出 ${debugMode}`,
  );
}

console.log(JSON.stringify({ gtaoOutput: assignments.join(','), debugOutputs: 'none', blendIntensity: 'ok' }));

# Neon Apex 待完善清单

> 记录日期：2026-08-11
> 当前基线：`v1.5.0`，Android `versionCode 12`
> 在线地址：<https://gaokao.aiimage.icu/>

## 本轮已完成（v1.5.0「复刻QQ飞车手感」大版本）

### 喷射技巧体系（driving.js）

- 漂移结束（≥0.32s 有效漂移）触发瞬时小喷（+30 加速度 / 1.16 倍速度上限 / 0.62s）
- 小喷激活中按氮气升级双喷（+14 加速度叠加 / 1.24 倍速度上限），`doubleBoost` 事件 + 播报
- 连喷计数：combo 窗口内的连续小喷累计 `boostChain`，HUD 弹出「连喷 xN」
- 起步喷：倒计时最后 0.36s 内踩住油门 = 完美起步（双喷级 + 9m/s 冲量），0.85s 内 = 起步喷
- 落地喷：腾空 ≥0.28s 落地且带油门自动小喷
- 漂移集气阶段 `chargeLevel 0-3`（按本次漂移累计集气量，不受氮气满格影响）
- 碰撞/重生取消当前喷射与连喷链

### 赛道机关（track-features.js + track-feature-meshes.js）

- 每图 6 条加速带 + 2 座飞跃台，种子确定性布点、只落在曲率最平直路段、避开起点区
- 加速带：前向冲量 +6m/s + 0.9s 加速窗口（1.2 倍速度上限），单带 1.2s 冷却
- 飞跃台：smoothstep 坡面高度进入物理（车会沿坡爬升），出坡沿速度×坡度起跳，重力 30m/s²
- 渲染：滚动箭头发光条带 + 霓虹描边跳台楔体，每图 6 个合并网格，主题配色
- 检查点垂直容差放宽到 9m，腾空过检查点不再误判

### 表现层

- drift-effects.js：480 段环形缓冲胎痕、220 粒轮胎烟雾、160 粒集气火花（青/橙/紫红三阶），喷射时转为尾焰火花，低画质自动减半
- 氮气镜头：FOV 快攻（8.5）慢放（3.4）、`fovRush` 脉冲、径向模糊 rush 项、双喷尾焰 1.42 倍、Bloom +0.3
- 氮气条按集气阶段变色

### 玩法系统

- 车库：volt/raiden/nimbus/goliath 四台车（procedural-vehicle 变体外观 + car-catalog 属性乘数），首页选车、竞速中途不可换
- 道具赛：追踪导弹（沿赛道追击前车、护盾整格抵消）、香蕉皮（身后放置 45s）、水炸弹（前抛 35m 半径 7m）、名次加权发放（第 6 名导弹概率约为第 1 名 7 倍）
- 影子挑战：计时赛录制→量化压缩（90s≈12KB）→localStorage 每图一份→半透明幽灵回放，设置可关
- 本地排位：竞速按名次 [+30,+22,+14,+6,-8,-16] 积分，7 大段×3 小段，掉段 40 分软保护，首页徽章 + 结算加减分 + 晋级播报
- BGM：music.js lookahead 调度合成器，五图独立主题，强度随速度/氮气；播报：13 条 MiMo TTS 中文语音（public/assets/audio/voice/），缺失时合成音回退

### 测试

- tests/racing.mjs 新增小喷/双喷/连喷/起步喷/加速带/跳台/落地喷断言
- 新增 tests/track-features.mjs（五图布点确定性与转弯半径）、tests/ghost.mjs（往返精度/体积/坏输入）、tests/ranked.mjs（晋降/保护/持久化）
- `npm test` 12 套全绿；`npm run build` 通过；Playwright 冒烟验证首页车库、开赛、机关渲染、变体车、零 console 报错

## 后续建议

1. 近道/捷径：需要护栏开口 + 支路曲线 + 进度映射与反向判定改造，本轮未做
2. AI 对手也吃加速带/跳台（目前用基础速度 +3 补偿玩家收益）
3. 排位赛联机化：服务端记录段位、按段位匹配
4. 移动端帧时间、Draw Call 和显存预算回归（新增粒子系统后更有必要）
5. CI：逻辑测试、浏览器回归和生产构建全部通过后才允许部署
6. 完整跑一遍 `npm run test:visual` / `test:maps-browser` / `test:item-browser` 浏览器回归并更新基线截图（本轮只做了自定义冒烟）

## 验证命令

```bash
npm test
npm run build
BASE_URL=http://127.0.0.1:4175 npm run test:maps-browser
```

线上健康检查：

```bash
curl -fsS https://gaokao.aiimage.icu/.well-known/neon-apex-health.json
```

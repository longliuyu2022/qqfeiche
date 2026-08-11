# Neon Apex 待完善清单

> 记录日期：2026-08-11
> 当前基线：`v1.4.2`，Android `versionCode 11`
> 在线地址：<https://gaokao.aiimage.icu/>

## 本轮已完成

### 移动端漂移

- 手机漂移从“方向 + 油门 + 漂移”三指组合简化为“方向 + 漂移”两指组合
- 达到漂移速度后触屏漂移自动维持油门，主动刹车时立即取消辅助
- 漂移按钮使用中文标签，桌面键盘输入保持原有行为

### 路线可驾驶性

- 删除四张地图闭合处与反向车道重叠的 U 型回头支路，消除驶过弯道后误报“逆向”的路线歧义
- 四张修复地图的闭合方向点积达到 `0.997–0.999`，最小转弯半径提升至约 `19.6–43.4 m`
- `tests/tracks.mjs` 会检查闭合方向、最小转弯半径，并逐图验证 160 个路线点不会映射到反向路段

### 地图资源

- 五张地图均有可加载的 128×128 WebP 首页缩略图：夜港、晴川、雪岭极光、赤砂峡谷、蔚蓝海岸
- 三张 AI 创作工坊封面从 1536×1024 PNG 替换为 WebP，生产资源从约 8.56 MB 降至约 19 KB
- `tests/maps-browser.mjs` 验证五张封面 HTTP 200、`image/webp` 类型、首页无溢出和实时画布非空

### 联机服务

- 单消息 4 KB 和 35 条/秒限制继续保留
- 增加单 IP WebSocket 连接上限、全局连接上限、房间总数上限和建房/加入/恢复频率限制
- 未认证连接超时自动关闭；房间空闲和断线玩家继续自动清理
- 服务端校验比赛是否已开始、进度增长、位置瞬移、完赛圈数和最短完赛时间
- 完赛时间由服务端时钟生成，客户端上报的 `lap`、`finishTime` 不再直接作为排名依据
- `tests/multiplayer.mjs` 覆盖房间、连接和操作限流；`tests/race-validation.mjs` 覆盖状态校验

### 工程结构

- `src/world.js` 从 2915 行拆至约 1948 行
- 夜港赛道数据与放置几何移至 `src/night-track.js`
- 夜空、雨、星体和灯光移至 `src/night-atmosphere.js`
- 港口、跨桥和山路分区移至 `src/night-districts.js`
- 程序化车辆移至 `src/procedural-vehicle.js`
- `world.js` 继续保留原有 `TRACK_CURVE`、`createWorld`、`createHeroCar` 和 `createRivalCar` 导出兼容层

## 后续建议

这些不属于本轮 TODO 的阻塞项，可作为下一版本的独立迭代：

1. 增加移动端帧时间、Draw Call 和显存预算回归，而不只检查画布非黑。
2. 将 WebSocket 状态验证进一步升级为基于共享赛道曲线的服务器路线验证。
3. 添加 CI：逻辑测试、浏览器回归和生产构建全部通过后才允许部署。
4. 为联机比赛增加服务器断线、重连、房主迁移和比赛结束后的房间归档测试。
5. 按需继续拆分 `world.js` 中的城市道路、隧道和道路细节模块。

## 验证命令

```bash
npm test
npm run test:maps-browser
npm run build
```

线上健康检查：

```bash
curl -fsS https://gaokao.aiimage.icu/.well-known/neon-apex-health.json
curl -fsSI https://gaokao.aiimage.icu/assets/tracks/coast-cover.webp
```

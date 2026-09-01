# 幻境飞车待完善清单

> 记录日期：2026-09-01
> 当前基线：`v1.11.0`，Android `versionCode 21`
> 在线地址：<https://saiche.aiimage.icu/>

本清单只记录**尚未完成**的事项与验证方式。已发布内容见 [README.md](README.md) 的版本更新段落。

## 待完善

按「影响 × 确定性」排序。每条都标注了核实状态：写清单时实际查过代码的结论，而不是印象。

### 1. 钱包写入端点没有服务端校验（已知，暂不处理）

单机金币完全由客户端计算，`PUT /multiplayer/auth/wallet` 整份覆盖，服务端只挡「数字变小」（`server/wallet-store.mjs` 的防清零规则以 `totalEarned` 为判据）。实测：新注册账号直接 PUT 一份 `coins: 9999999` 会被原样接受。

不改的理由是这是既有设计——`wallet-store.mjs` 里写明「客户端是钱包的唯一计算方，服务端只负责校验和保存」，而且离线也要能单机赚钱。要收口得把单机结算搬到服务端，或让服务端按完赛记录与时长推算金币上限来卡异常增长，代价是牺牲离线可玩性。

联机金币不走这条路：`onlineRaceReward` 由服务端按名次计算、`walletStore.credit` 直接入账，是目前唯一可信的入账通道。

### 2. 没有 lint / 格式化 / 类型检查

`src/` 共 22,121 行 JS（`main.js` 2449 行、`world.js` 2100、`driving.js` 2023），没有 ESLint、Prettier 或 jsconfig，全靠测试和人眼兜。加 ESLint 能挡住手误型错误。

### 3. 浏览器回归只出图，不比对基线

12 个浏览器测试（`visual` / `maps-browser` / `spectator-browser` / `performance` 等）CI 明确跳过，靠人工在本地跑。`tests/visual.mjs` 会截图并校验赛制配置（圈数、参赛人数），但**不比对像素基线**——`artifacts/` 下 42 张截图是产物，不是对照基线。也就是说渲染回退不会被自动发现。

需要在有 GPU 的机器上跑全量并固化基线。观战功能（v1.11.0 的主要特性）的回归测试 `spectator-browser.mjs` 就属于这一档。

### 4. 新赛制与新系统缺成就

20 条成就的类别分布：里程碑 6、技巧 5、竞速 3、收藏 2、段位 2、近道 2。`MODE_IDS` 含 kart，所以 `mode-explorer` 覆盖了卡丁车；但**训练场、每日/每周挑战、赛道变体（反向/镜像）没有任何专属成就**。`kartBest` 纪录字段存了，也没有对应成就。

### 5. 经济体量偏小，没有终局

商店 26 件共 45,900 金币。单机单场典型收益 750（简单/第一/技巧满/净胜），天花板 1,181（困难 + 卡丁 1.05 倍 + 破纪录），即 39–62 场清空商店，3 圈赛按 2–3 分钟算约 2–3 小时。

商店没有任何前置门槛（grep `requires|unlock|locked|level|tier` 零命中），地图也全部开放，所以第一天就能看到全部内容。买完之后金币没有用途，长线只剩排位段位分。

### 6. 赛季没有轮换机制

`src/season.js` 只有一个读排行榜的函数，赛季名来自服务端 `process.env.NEON_APEX_SEASON || 'S1'`（`server/index.mjs`）。没有赛季结算、重置或归档逻辑。如果本来就打算手动改环境变量，那没问题；如果指望自动轮换，现在不会。

### 7. 仓库体积

`.git` 86M，跟踪的二进制 63M（`public/assets/CarConcept.glb` 单个 12M）。`artifacts/*.png` 截图每次发版覆盖重传，history 里累计 19.2MB，只涨不跌。可考虑移出仓库或只留缩略图。

比赛歌单的 MP3 已按授权未确认排除在外（`.gitignore` 挡掉 `*.mp3` / `*.ogg` / `*.m4a`，`manifest.json` 与 README 仍入库）。

### 8. v1.7.0 遗留的建议（逐条核实：均未完成）

1. **联机对局同步近道状态** — 服务端仍无近道校验（grep `shortcut|支路|branch` 在 `server/` 零命中）。近道是本地物理，联机时远端车辆走支路的位置由状态同步覆盖，表现正常但服务端不验支路合法性
2. **成就解锁专属涂装** — `src/achievements.js` 无涂装奖励逻辑
3. **贴花精确定位** — 图案由整幅纹理决定比例，要精确控制位置需为每台车做专属 UV。这是资产层面的设计约束，不是代码缺陷
4. **首页背景改视频或实时 3D** — `index.html` 无 `<video>`，仍是静态图 + ken-burns 动效

## 验证命令

```bash
bash scripts/preflight.sh          # 部署前门禁（Node 版本、工作区、测试、构建、三处版本号一致）
npm test                           # 35 套纯 Node 逻辑测试
npm run build

# 浏览器回归（需要先起 preview，且需要本机 Chromium）
npx vite preview --port 4176 --host 127.0.0.1 &
BASE_URL=http://127.0.0.1:4176 npm run test:performance
```

线上健康检查：

```bash
curl -fsS https://saiche.aiimage.icu/.well-known/neon-apex-health.json
curl -fsS https://saiche.aiimage.icu/multiplayer/healthz
```

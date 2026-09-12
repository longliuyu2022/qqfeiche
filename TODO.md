# 幻境飞车待完善清单

> 记录日期：2026-09-05
> 当前基线：`v1.11.0` 加本轮未发布修复，Android `versionCode 21`
> 在线地址：<https://saiche.aiimage.icu/>

本清单只记录**尚未完成**的事项与验证方式。已发布内容见 [README.md](README.md) 的版本更新段落。

## 待完善

按「影响 × 确定性」排序。每条都标注了核实状态：写清单时实际查过代码的结论，而不是印象。

### 1. 钱包写入端点没有服务端校验（已知，暂不处理）

单机金币仍由客户端计算。新版 `/multiplayer/auth/wallet/sync` 已用持久化操作队列解决离线丢失、多设备覆盖和重复重试，但收入操作本身仍来自客户端，不是可信完赛凭据；旧 `PUT /multiplayer/auth/wallet` 保留兼容旧版本，也仍然接受客户端钱包数值。

要收口需要调整离线经济的信任模型：由服务端验证完赛凭据或限制离线可兑换收入，再逐步下线旧快照写入接口。数据同步可靠性与防作弊是两项独立要求。

联机金币不走这条路：`onlineRaceReward` 由服务端按名次计算、`walletStore.credit` 直接入账，是目前唯一可信的入账通道。

### 2. 渐进式类型检查

ESLint 已接入 `npm run lint`、CI 和发布预检，现有告警已处理。下一步可给钱包操作、联机协议和赛事结果补 JSDoc/类型检查；暂不需要为了格式化而重写全部源码。

### 3. 完整视觉基线与 GPU 性能回归

账号、钱包跨设备/离线恢复和桌面/手机基础画面已接入独立浏览器 CI。它会检查画布非空、驾驶操作、暂停与页面溢出并保存截图，但**不比对像素基线**。全地图、观战、道具、语音和 GPU 性能专项仍需本地/发布前运行。

需要在固定字体、浏览器和 GPU 环境下跑全量并固化基线，以发现基础指标无法捕捉的细小视觉回退。

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

### 8. 其他后续建议

1. **继续加强联机公平性** — 服务端已按实际路线校验坐标与进度，含七图、三种方向和 42 条近道组合；仍未验证客户端输入或在服务端模拟物理，不能将基本一致性校验等同于完整防作弊
2. **成就解锁专属涂装** — `src/achievements.js` 无涂装奖励逻辑
3. **贴花精确定位** — 图案由整幅纹理决定比例，要精确控制位置需为每台车做专属 UV。这是资产层面的设计约束，不是代码缺陷
4. **首页背景改视频或实时 3D** — `index.html` 无 `<video>`，仍是静态图 + ken-burns 动效

## 验证命令

```bash
bash scripts/preflight.sh          # 部署前门禁（Node 版本、工作区、测试、构建、三处版本号一致）
npm test                           # 35 套纯 Node 逻辑测试
npm run lint
npm run build
npm run test:browser-smoke          # 自行启动隔离服务的基础浏览器回归

# 浏览器回归（需要先起 preview，且需要本机 Chromium）
npx vite preview --port 4176 --host 127.0.0.1 &
BASE_URL=http://127.0.0.1:4176 npm run test:performance
```

线上健康检查：

```bash
curl -fsS https://saiche.aiimage.icu/.well-known/neon-apex-health.json
curl -fsS https://saiche.aiimage.icu/multiplayer/healthz
```

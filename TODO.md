# Neon Apex 待完善清单

> 记录日期：2026-08-11
> 审查基线：本地工作区 `v1.3.0`（`package.json`），线上 build `20260810T134910Z`
> 状态：**仅记录，未做任何改动**

审查方式：跑通 `npm test`（8 个逻辑测试全部通过），对照 `src/`、`server/`、`tests/`、`dist/`、
`android/`、线上健康端点和 `public/assets/` 的实际内容。

主线功能本身完整；问题集中在「新赛道这批在制品没收尾」和「工程化缺口」两块。

---

## 🔴 P0 — 新赛道在制品未收尾

三条新赛道（雪岭极光 `alpine`、赤砂峡谷 `canyon`、蔚蓝海岸 `coast`）的代码链路已经打通：
`src/track-catalog.js`、`src/scenic-worlds.js`、`src/main.js:42-52`、`src/preferences.js:15`、
`server/index.mjs:10`、`index.html:107-109`、`tests/tracks.mjs`、`tests/maps-browser.mjs` 都已就位，
`npm run test:tracks` 能跑出五条赛道的长度和场景对象数。但收尾工作全部缺失。

### 1. `coast-cover.png` 缺失，蔚蓝海岸封面是坏的

- `src/style.css:142` 引用 `/assets/tracks/coast-cover.png`
- `public/assets/tracks/` 实际只有 `alpine-cover.png`、`canyon-cover.png`
- 线上请求该路径返回 `content-type: text/html`（SPA 兜底的 index.html），
  首页第 5 张赛道卡片只剩 `background-color: #10202a` 兜底

验证：

```bash
ls public/assets/tracks/
curl -s -I https://gaokao.aiimage.icu/assets/tracks/coast-cover.png | grep -i content-type
```

### 2. 版本号与文档没跟上，产物未发布

| 位置 | 当前值 | 问题 |
| --- | --- | --- |
| `package.json` | `1.3.0` | 未 bump |
| `README.md` | 只写「夜港 / 晴川」两张地图 | 缺三条新赛道 |
| `android/app/build.gradle:29-30` | `versionCode 8` / `1.3.0` | 未 bump |
| `artifacts/apk`、`artifacts/aab` | 8月10日 21:48 构建 | 不含新赛道 |
| 线上 `neon-apex-health.json` | `20260810T134910Z` | 本地 `dist/` 今天 10:59 已重建但**未部署** |

即：新赛道玩家现在拿不到，网页和 APK 都还是 v1.3.0 的两张地图。

### 3. 封面图体积失控

| 文件 | 尺寸 | 体积 |
| --- | --- | --- |
| `alpine-cover.png` | 1536×1024 | 2.77 MB |
| `canyon-cover.png` | 1536×1024 | 2.66 MB |
| `coast-cover.png` | — | 缺失 |

这些图只显示在 `.track-swatch` 的 **42×42** 区域（`src/style.css:139`）。
三张齐了约 8 MB，纯首屏带宽浪费。压到 128px WebP 单张可进 10 KB 以内。

附带的一致性问题：`night` / `day` 用 CSS 渐变（`src/style.css:140-141`），
新三条用照片，同一排卡片两种视觉语言。

### 4. `tests/maps-browser.mjs` 没接进 npm 脚本

`tests/` 下 13 个测试里只有 `maps-browser.mjs` 在 `package.json` 中没有对应入口，
`npm test` 也覆盖不到。它检查三条新赛道的首页封面和画布渲染，
**本来正好能抓出第 1 条那个坏封面**。

建议加 `"test:maps": "node tests/maps-browser.mjs"`，并考虑纳入浏览器测试组。

验证：

```bash
for f in tests/*.mjs; do b=$(basename "$f" .mjs); \
  grep -q "tests/$b.mjs" package.json || echo "MISS $b"; done
```

---

## 🟡 P1 — 工程化缺口

### 5. 整个项目没有 Git 仓库

```
$ git status
fatal: not a git repository (or any of the parent directories): .git
```

9600 行源码 + Android 正式签名工程，无历史、无法回滚、无法 diff 排查。
目前**最大的单点风险**。`.gitignore` 已经写好（覆盖 `node_modules/`、`dist/`、
`.android-sdk/`、`android/app/build/` 等），却一直没 `git init`。

注意：初始化时要确认签名材料 `~/.config/neon-apex/signing.properties` 和
`*.jks` 绝不进仓库（README 已声明该纪律）。

### 6. 联机服务缺连接层防护

`server/index.mjs` 已有的防护：

- 单条消息 4 KB 上限（`:222`）
- 房间空了自动删除（`:103-105`）+ 定时清理（`:278`、`:291`）
- 昵称过滤控制字符并截断 12 字（`:23`）
- 地图 ID 白名单（`:10`、`:28`）
- 单房间最多 6 人（`:7`、`:142`）

缺失的：

- **单 IP 连接数限制** —— 无
- **房间总数上限** —— 无（`rooms` 只在健康端点里被统计，`:253`）
- **建房 / 加入频率限制** —— 无

公网暴露的 WebSocket 服务，一个脚本就能把房间表撑爆。

### 7. `src/world.js` 体积过大

2915 行 / 109 KB，是第二大文件 `main.js`（1422 行）的两倍多。
夜港的赛道、城市、港口、山路场景全在一个模块里。

新赛道已经按 `src/scenic-worlds.js`（802 行，三条赛道）的方式拆分了，
`world.js` 可以照同样思路收一收。属于重构，不紧急。

---

## 建议执行顺序

1. `git init` 并提交当前状态（先把现状锁住，后续都可回滚）
2. 补 `coast-cover.png`，把三张封面压成小尺寸 WebP
3. 接上 `test:maps`，跑一遍浏览器回归确认封面和画布
4. 统一 bump 到 `v1.4.0`：README + `package.json` + `versionCode 9`
5. 构建 APK/AAB，`npm run deploy` + `npm run deploy:server` 发布
6. 服务端限流单独做一轮

---

## 已确认健康的部分

- `npm test` 8 项全绿：赛制、道具赛、纪录、设置、赛道、联机、触控、键盘
- 五条赛道在 `preferences` / `server` / `index.html` / 测试中的 ID 完全一致，无遗漏
- 记录与设置都有损坏存储的降级测试（`corruptStorageFallback`）
- 部署脚本用 `mktemp` 暂存目录 + 原子切换，有线上一致性验证和健康检查
- 资源许可信息齐全（`public/assets/ASSET-LICENSES.md`）

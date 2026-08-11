# Neon Apex（霓虹竞速）

一款受《QQ 飞车》操作节奏启发的 3D 街机竞速游戏。项目使用 Three.js 和 Vite 开发，支持桌面浏览器、手机触控以及 Android APK。

> 项目根目录：`/root/neon-apex`
>
> 当前版本：`v1.4.2`（Android `versionCode 11`）
>
> 在线游戏：<https://gaokao.aiimage.icu/>
>
> Android 下载：[APK](https://gaokao.aiimage.icu/downloads/neon-apex-release.apk) · [AAB](https://gaokao.aiimage.icu/downloads/neon-apex-release.aab)

## v1.4.2 更新

- 手机漂移改为两指操作：达到入弯速度后，同时按方向和“漂移”即可自动维持油门
- 触屏刹车会覆盖漂移油门辅助，桌面键盘操作与驾驶手感保持不变
- Android 版本更新为 `1.4.2 (11)`

## v1.4.1 更新

- 删除晴川、雪岭、峡谷和海岸地图闭合处与反向车道重叠的 U 型回头支路，避免驶过后被识别为逆向
- 重新同步联机服务端的五地图长度，并增加闭合方向、最小转弯半径和同向路线采样回归测试
- Android 版本更新为 `1.4.1 (10)`

## v1.4.0 更新

- 地图从 2 张扩展到 5 张：新增雪岭极光、赤砂峡谷和蔚蓝海岸，并保留夜港与晴川
- 三张新地图使用各自独立的闭环路线、PBR 沥青与地表材质、护栏、路肩、路标、植被、岩层和地标建筑
- 雪岭加入动态极光、飘雪、冰湖和缆车塔；峡谷加入夕阳、风沙、台地与天然石拱；海岸加入动态海面、灯塔和旋转光束
- 首页地图选择器支持横向滚动和吸附，桌面与手机均可快速浏览五张地图；三张新地图使用 AI 创作工坊 `gpt-image-2` 生成的专属封面
- 联机房间协议支持五张地图，房主选择的新地图会完整传递到准备和同步发车阶段
- 新增五地图单元测试和桌面/手机横屏 Playwright 画布回归，检查封面、场景对象、路线长度、页面溢出与非空渲染
- Android 版本更新为 `1.4.0 (9)`

## v1.3.0 更新

- 新增“霓虹道具大奖赛”：3 圈、6 车、12 个赛道道具箱，支持氮气瓶、能量盾、电磁脉冲和冲击波
- 新增桌面 `E` 键和手机道具按钮；AI 对手会拾取并使用道具，护盾可抵消攻击
- 漂移比赛以 38% 氮气起步，持续有效漂移按侧滑质量即时充能，漂移结束再结算额外氮气并显示 `N2O` 获得量
- 道具赛独立保存最佳成绩和比赛次数，不影响已有竞速、计时和漂移记录
- Android 版本更新为 `1.3.0 (8)`

## v1.2.3 更新

- 优化手机网页与 Android WebView 的速度仪表：改为右下方紧凑半透明布局，避开屏幕中央赛道视野，并与油门/方向触控区保持间距
- Android 版本更新为 `1.2.3 (7)`

## v1.2.2 更新

- 按追尾相机的真实屏幕方向修正控制：左侧触屏按钮与 `A` / 左方向键使车辆向屏幕左侧行驶，右侧按钮与 `D` / 右方向键使车辆向屏幕右侧行驶
- 非正面撞墙后自动将车头引导至护栏切线，持续按油门仍能沿墙前进，不再因轮胎抓地反复推向墙面而停住
- 将正面撞击阈值收紧到接近垂直入墙，普通斜向碰撞保留更多沿墙速度
- 回归测试改用真实相机投影和持续三秒的斜向撞墙操作，不再以内部航向角符号代替屏幕方向
- Android 版本更新为 `1.2.2 (6)`

## v1.2.1 更新

- 修复键盘和移动端方向控制：`A` / 左方向键使车头向左，`D` / 右方向键使车头向右，并降低数字方向键的转向幅度
- 优化护栏碰撞：斜向擦墙保留沿赛道方向的速度，只有接近正面撞击时才显著减速并触发重生判定
- 修复 Android 版退出日景比赛后无法切换夜景地图的问题，返回首页可重新选择任意地图
- Android 版本更新为 `1.2.1 (5)`，可与已发送的 `1.2.0 (4)` 明确区分并正常覆盖安装

## v1.2.0 更新

- 新增 2–6 人房间码好友赛，支持游客昵称、房主发车和真实玩家排名
- 新增 WebSocket 状态同步、远端车辆插值和 20 秒断线自动恢复
- 新增独立“晴川山谷环线”白天地图，使用不同路线、干燥路面、山谷、农田、看台和晴空环境
- 首页新增夜港/晴川地图选择与联机大厅，重型 3D 资源仍在发车后加载
- Android WebView 可直接连接线上联机服务，版本更新为 `1.2.0 (4)`

## v1.1.1 更新

- 首页改为轻量启动层，用户点击“开始比赛”后才加载 Three.js、车辆、赛道和 HDRI
- Android release 改用独立 RSA-4096 正式证书，APK 支持 v2/v3 签名
- 同时生成可直接安装的 APK 和用于 Play Store 的 AAB
- 新增 `NA` 霓虹自适应桌面图标，支持圆形裁切与 Android 13 主题图标
- 修复从比赛返回首页后“开始比赛”按钮仍处于禁用状态的问题
- Android 版本更新为 `1.1.1 (3)`

## 已实现功能

- 三圈完整比赛流程：倒计时、排名、计时、检查点、冲线结算和重新开始
- 独立游戏首页，确认开始后才加载重型 3D 运行时并进入比赛倒计时
- 四种赛事模式：3 圈多人竞速、3 圈道具赛、单圈计时赛和单圈漂移挑战
- 2–6 人房间码联机好友赛，包含同步发车、实时车辆状态、排名和断线恢复
- 6 车同场竞速，包含 AI 超车、封堵和动态车道策略
- 街机驾驶手感：加速、制动、倒车、转向、漂移和氮气加速
- 漂移积分、连击倍率、漂移氮气充能、氮气衔接以及错误路线重生
- 道具箱、氮气瓶、能量盾、电磁脉冲、冲击波和 AI 道具行为
- 分模式保存最佳总时间、计时赛纪录、漂移最高分、最佳圈速和胜场
- 持久化声音、音量、画质、触感反馈、镜头震动和上次赛事模式
- 五张独立地图：夜港、晴川、雪岭极光、赤砂峡谷和蔚蓝海岸
- 三张新地图包含独立路线、PBR 路面、程序化地形、动态天气/水面和大型地标
- 动态追尾镜头、速度线、粒子、Bloom 和基于速度的后处理
- 键盘与多点触控操作，适配竖屏和横屏手机
- 暂停菜单、比赛结果、迷你地图、仪表盘和比赛提示
- WebGL 运行监控、画面回归测试、赛制单元测试和触控测试
- 可独立运行的 Android WebView 壳、正式签名 APK/AAB 和自适应桌面图标

## 快速运行

环境要求：Node.js 20 或更高版本。

```bash
cd /root/neon-apex
npm install
npm run dev -- --port 4173
```

浏览器打开 <http://localhost:4173/>。开发服务器默认监听所有网络接口，局域网内也可通过主机 IP 访问。

## 操作方式

| 功能 | 键盘 | 触控 |
| --- | --- | --- |
| 加速 | `W` / `↑` | 右下角加速键 |
| 制动 / 倒车 | `S` / `↓` | 右下角制动键 |
| 转向 | `A` `D` / `←` `→` | 左下角方向键 |
| 漂移 | `Space` | `DRIFT` |
| 氮气 | `Shift` / `N` | `N₂O` |
| 使用道具 | `E` | 道具槽按钮 |
| 重生 | `R` | 自动错误路线重生 |
| 暂停 | `Esc` | 右上角暂停键 |

## 常用命令

```bash
# 生产构建
npm run build

# 赛制与车辆逻辑
npm run test:race

# 道具赛逻辑
npm run test:items

# 多点触控输入
npm run test:touch

# 键盘转向输入
npm run test:keyboard

# 全部逻辑测试（赛制、纪录、设置、触控）
npm test

# 本地联机服务（开发服务器会代理 /multiplayer）
npm run server

# 双浏览器联机与白天地图回归
npm run test:online-browser

# 桌面、竖屏和横屏视觉回归
npm run test:visual

# 道具赛桌面/手机流程、布局和画布回归
BASE_URL=http://127.0.0.1:4175 npm run test:item-browser

# 五地图封面、选择器和桌面/手机横屏实时画布回归
BASE_URL=http://127.0.0.1:4175 npm run test:maps-browser

# 港口、城市和山路分段截图
npm run test:sections
```

视觉测试需要 Chromium。默认可执行文件为 `/usr/local/bin/chromium-browser`，也可通过 `CHROMIUM_PATH` 指定：

```bash
CHROMIUM_PATH=/path/to/chromium npm run test:visual
```

测试截图会写入 `artifacts/`。

## Android APK

现有 Android 产物：

```text
artifacts/apk/neon-apex-release.apk
artifacts/aab/neon-apex-release.aab
```

当前已部署产物（2026-08-11，`v1.4.2 (11)`）：

```text
APK SHA-256  0495ae7d877c9012a190535a9b8d1a1f6c28e7457e6cdc5ed7e3592dc74c6f5c
AAB SHA-256  4c64e465f7ec6e13643203b5ddfecf5b0e950239c49f006180fd48a51f249e85
证书 SHA-256 165b461910953729306cf12464a993ea300d44edb553f0f79191e44d72b43b6c
```

重新构建：

```bash
bash scripts/build-apk.sh
```

脚本会先构建网页版本，再同步到 Android assets，并生成正式签名的 APK 与 Play Store AAB。它还会执行 Gradle `lintVital`、R8 资源压缩、APK 签名验证、AAB JAR 签名验证和 SHA-256 计算。

签名配置默认从 `~/.config/neon-apex/signing.properties` 读取，必须包含以下字段：

```properties
storeFile=/absolute/path/to/neon-apex-release.jks
storePassword=<secret>
keyAlias=neon-apex-release
keyPassword=<secret>
```

密钥及配置不得提交到项目。当前服务器的签名资料位于 `/root/.config/neon-apex/`，需要离线备份；丢失正式证书后将无法向现有用户发布可覆盖安装的更新。此前 `v1.1.0` 使用调试证书，已安装旧版的设备需要先卸载，再安装 `v1.1.1` 正式签名版。

本项目目录内已经准备了 Android SDK 和 Gradle 缓存；首次在其他机器构建时需要联网下载对应工具。

## 项目结构

```text
neon-apex/
├── index.html                 # 游戏界面与 HUD 结构
├── package.json               # 依赖和脚本
├── src/
│   ├── main.js                # 游戏循环、镜头、特效和 UI 协调
│   ├── bootstrap.js           # 轻量首页与游戏运行时延迟加载
│   ├── driving.js             # 车辆物理、输入、漂移和检查点逻辑
│   ├── race-modes.js          # 赛事模式的共享定义
│   ├── race-system.js         # AI 对手、排名和比赛结果
│   ├── item-race.js           # 道具箱、道具效果和 AI 道具行为
│   ├── world.js               # 夜港场景总装配与兼容导出
│   ├── night-track.js         # 夜港赛道曲线与通用放置几何
│   ├── night-atmosphere.js    # 夜空、雨、星体和灯光
│   ├── night-districts.js     # 港口、跨桥和山路分区
│   ├── procedural-vehicle.js  # 程序化主车与 AI 车辆
│   ├── day-world.js           # 独立白天山谷赛道与场景
│   ├── scenic-worlds.js       # 雪岭、峡谷、海岸路线与高细节场景
│   ├── track-catalog.js       # 首页与运行时共享的地图信息
│   ├── multiplayer-client.js  # 房间连接、同步与断线恢复
│   ├── vehicle-assets.js      # 主车模型加载与程序化备用车
│   ├── speed-postprocess.js   # 高速画面后处理
│   ├── audio.js               # 引擎、漂移和氮气音效
│   ├── preferences.js         # 画质、音量与反馈设置持久化
│   ├── race-records.js        # 分模式本地比赛纪录
│   ├── telemetry.js           # WebGL 性能与错误监控
│   └── style.css              # HUD 和响应式触控布局
├── public/assets/             # 车辆、地图封面、HDRI 和 PBR 材质资源
├── tests/                     # 逻辑、触控和 Playwright 视觉测试
├── server/                    # 2–6 人房间和 WebSocket 状态服务
│   └── race-validation.mjs    # 联机进度、位置和完赛校验
├── scripts/                   # APK 构建与线上部署脚本
├── android/                   # 原生 Android 工程、正式签名配置和启动器图标引用
├── dist/                      # Vite 生产构建（可再生成）
└── artifacts/                 # 截图与 APK 成品
```

以下目录体积较大，但都不是业务源码：`node_modules/`、`.android-sdk/`、`.gradle-dist/`、`android/.gradle/` 和 `android/app/build/`。清理后可通过安装依赖或构建脚本重新生成。

## 美术资源与许可

主车辆使用 Khronos glTF Sample Assets 的 **Car Concept**，遵循 CC BY 4.0。环境材质来自 Poly Haven。具体来源、许可和文件校验信息见 [`public/assets/ASSET-LICENSES.md`](public/assets/ASSET-LICENSES.md)。主车辆加载失败时，游戏会自动切换到程序化备用车辆。

## 部署

```bash
npm run deploy
npm run deploy:server
```

网页部署脚本会原子切换 `/opt/neon-apex/dist` 并执行线上资源一致性验证；联机部署脚本会原子切换 `/opt/neon-apex/multiplayer/current`、重启 systemd 服务并检查本地健康端点。Caddy 将 `/multiplayer` 和 `/multiplayer/healthz` 反向代理到 `127.0.0.1:3010`。不要在未配置对应域名和目录的机器上直接执行。

线上健康标记：<https://gaokao.aiimage.icu/.well-known/neon-apex-health.json>

## 飞书交付

当前服务器使用 `cc-connect` 将 APK 发送到既有飞书会话，无需在项目中保存飞书应用密钥。默认只发送 APK；AAB 仅用于应用商店发布，不作为飞书附件：

```bash
cc-connect daemon status
cc-connect sessions list
cc-connect send -p codex-relay_d03f2587 \
  -m "Neon Apex v1.4.2 两指漂移 release" \
  --file /root/neon-apex/artifacts/apk/neon-apex-release.apk
```

仅在 `cc-connect` 返回 `Message sent successfully.` 后才能确认交付完成。若遇到 HTTP 429，应保持不超过 5 RPM，等待后继续重试。

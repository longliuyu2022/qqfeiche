# Neon Apex（霓虹竞速）

一款受《QQ 飞车》操作节奏启发的 3D 街机竞速游戏。项目使用 Three.js 和 Vite 开发，支持桌面浏览器、手机触控以及 Android APK。

> 项目根目录：`/root/neon-apex`
>
> 当前版本：`v1.7.0`（Android `versionCode 14`）
>
> 在线游戏：<https://gaokao.aiimage.icu/>
>
> Android 下载：[APK](https://gaokao.aiimage.icu/downloads/neon-apex-release.apk) · [AAB](https://gaokao.aiimage.icu/downloads/neon-apex-release.aab)

## v1.7.0 更新

- 新增「极致 3A」画质档：高端设备启用 GTAO 接触阴影、SMAA 抗锯齿、VSM 4096 阴影、最高 2x 像素密度；低端设备自动走轻量降级路径
- 五张地图全部接入对应的 Poly Haven CC0 HDRI，统一提升车漆、金属、路面和水面的环境反射与间接光；晴川新增完整 PBR 沥青材质
- Ultra 档提高五图山体、植被、云层、星空、雨雪和风沙密度，balanced 档同步降低场景复杂度
- 喷射体系补齐 `CWW` / `WCW` 组合喷判定、独立持续时间、技巧分和屏幕反馈
- 近道扩展到每图 2 条，互不重叠且各自至少省 12m（night 15.4+20.2m、day 12.6+38.4m、alpine 12.3+44.3m、canyon 12.5+21.4m、coast 17.1+26.2m）
- AI 对手会走近道：按性格决定是否切入（同一场里选择稳定可复现），实测单条支路省 0.40 秒/圈，收益只来自路程更短、不加速度
- 新增成就系统：20 条成就（里程碑/技巧/竞速/近道机关/收藏/段位六类），解锁发放 100–1500 金币，首页新增成就面板与进度条
- 商店扩展到 6 大类共 26 件商品：新增 4 款轮毂、4 款尾翼、4 种喇叭（双音/警笛/芯片音/气笛，按 `H` 键鸣笛）
- 轮毂与尾翼实时挂到车上，尾翼按车辆实际尺寸自适应缩放与就位（glTF 主车比程序化车宽 1.8 倍，固定尺寸会埋进车身）
- 排位赛联机化：新增「快速排位」按段位匹配 2–6 人，服务端持久化段位分并在赛后按名次结算（服务端不信任客户端上报的分数），大厅显示各车手段位
- 新增 GitHub Actions CI（测试 + 构建 + 产物校验）与 `scripts/preflight.sh` 部署前门禁（含版本号一致性检查）
- 新增 `tests/achievements.mjs`、`tests/ranked-online.mjs`，`npm test` 扩展到 16 套
- Android 版本更新为 `1.7.0 (14)`

## v1.6.0 更新

- 修复赛道穿模：五张地图的山体、岩层、植被和建筑改为按赛道实际距离排除放置（净空 = 半宽 8m + 12m，山体 20m），不再有物体插进路面；新增 `tests/terrain-clearance.mjs` 逐实例校验
- 新增近道系统：每张地图在弯道内侧生成一条支路，贴内侧线才能切入（中线与外侧无法误入），全程 12–44m 捷径；护栏在岔口自动开口，支路带霓虹门柱与发光边线，小地图虚线标示
- 近道进度映射到主赛道，被绕过的检查点自动补记——抄近道不再被判罚，但支路更窄，考验入弯精度
- AI 对手会真正使用机关：提前 40m 向加速带走线、吃到 +6m/s 冲量、经过飞跃台腾空并在落地获得提速；同时抵消上一版为补偿玩家收益而加的基础速度，难度与 v1.5.0 持平
- 新增改装商店与金币经济：完赛按名次、技巧分、净胜和破纪录结算金币，可购买 3 台车（云雀 3200 / 磐石 4200 / 雷鸣 6800）、6 款车漆和 4 款贴花；未购买的车在车库显示锁定
- 车漆与贴花会实时烘焙成车身纹理并应用到主车（glTF 主车与四台程序化车型统一处理），装备后立刻生效
- 首页视觉重做：五张 AI 生成的赛道主题背景图（ken-burns 动效 + 渐变蒙版）、段位与金币状态条、分区信息架构、发光选中态；桌面多栏、竖屏单栏自适应
- 结算界面新增本场金币奖励明细行
- 新增 `tests/shop.mjs`、`tests/ai-features.mjs`、`tests/terrain-clearance.mjs`、`tests/performance.mjs`，`npm test` 扩展到 15 套
- Android 版本更新为 `1.6.0 (13)`

## v1.5.0 更新

- 喷射技巧体系：漂移结束瞬时“小喷”，小喷窗口内开氮气升级“双喷”，弯弯相连累计“连喷 xN”，倒计时踩准油门触发“完美起步/起步喷”，腾空后落地触发“落地喷”
- 五张地图按曲率程序化布置 6 条发光加速带与 2 座飞跃台（种子确定性、只落在最直路段），加速带即时提速、飞跃台按车速起跳，小地图同步标记机关位置
- 漂移表现三件套：后轮环形缓冲胎痕、轮胎烟雾粒子、按集气阶段变色的火花（白→青蓝→金橙→紫红），氮气条颜色随集气阶段同步
- 氮气镜头语言：喷射瞬间 FOV 快攻慢放拉伸、径向模糊增强、双喷尾焰放大 1.4 倍、Bloom 与镜头震动分级
- 车库系统：幻影 Volt（A 均衡）、雷鸣 Raiden（S 极速）、云雀 Nimbus（A 集气）、磐石 Goliath（B 稳定）四台车，极速/加速/操控/氮气/集气五维属性差异，首页选车并持久化
- 道具赛新增追踪导弹、香蕉皮、水炸弹三种道具，按名次加权发放（越落后道具越强），AI 会发射导弹、领先放香蕉、中游抛水弹
- 影子挑战：计时赛自动录制最佳成绩轨迹（二进制量化压缩，90 秒约 12KB），刷新纪录自动保存，再跑时半透明幽灵车同场回放，可在设置关闭
- 本地排位：竞速模式按名次积分晋降，青铜→白银→黄金→铂金→钻石→星耀→车神（各三小段，掉段 40 分软保护），首页显示段位徽章、结算显示加减分与晋级提示
- 程序化 BGM 合成器：五图独立主题（bpm/调式/和弦/声部编排各异），强度随车速与氮气实时变化；新增 13 条中文播报语音（倒计时、双喷、连喷、落地喷、新纪录、最后一圈、超越、冲线、晋级），音乐/播报音量独立设置
- 新增 `tests/track-features.mjs`、`tests/ghost.mjs`、`tests/ranked.mjs` 单元测试并纳入 `npm test`
- Android 版本更新为 `1.5.0 (12)`

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
- QQ飞车式喷射体系：小喷、双喷、CWW/WCW、连喷、起步喷、落地喷与漂移集气阶段
- 五图程序化加速带、飞跃台与弯道近道，腾空物理与落地喷判定
- AI 对手会走加速带、飞跃台并按机关调整走线
- 四台可选车型与五维属性差异，首页车库选车
- 改装商店：金币结算，车辆/车漆/贴花/轮毂/尾翼/喇叭六类共 26 件商品
- 成就系统：20 条成就与金币奖励
- 快速排位联机：按段位匹配，服务端结算段位分
- 影子挑战幽灵回放、本地排位段位、程序化 BGM 与中文播报语音
- 2–6 人房间码联机好友赛，包含同步发车、实时车辆状态、排名和断线恢复
- 6 车同场竞速，包含 AI 超车、封堵和动态车道策略
- 街机驾驶手感：加速、制动、倒车、转向、漂移和氮气加速
- 漂移积分、连击倍率、漂移氮气充能、氮气衔接以及错误路线重生
- 道具箱、氮气瓶、能量盾、电磁脉冲、冲击波、追踪导弹、香蕉皮、水炸弹和名次加权发放
- 分模式保存最佳总时间、计时赛纪录、漂移最高分、最佳圈速和胜场
- 持久化声音、音乐、播报、幽灵、音量、画质、触感反馈、镜头震动、车型和上次赛事模式
- 五张独立地图：夜港、晴川、雪岭极光、赤砂峡谷和蔚蓝海岸
- 三张新地图包含独立路线、PBR 路面、程序化地形、动态天气/水面和大型地标
- 动态追尾镜头、胎痕烟雾火花、速度线、粒子、Bloom、GTAO、SMAA 和基于速度的后处理
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

当前已部署产物（2026-08-12，`v1.7.0 (14)`）：

```text
APK SHA-256  63387b8fd152a3ae0f681187a576e4fe66c42268aad5df7d3bbf1349a3fe6605
AAB SHA-256  b6c78c45f0fc4bd33d17929f0d26902a2fd674c0c66db37d6732a8e376e3adfe
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
│   ├── bootstrap.js           # 轻量首页、车库选车与游戏运行时延迟加载
│   ├── driving.js             # 车辆物理、输入、漂移、喷射体系、机关与检查点逻辑
│   ├── race-modes.js          # 赛事模式的共享定义
│   ├── race-system.js         # AI 对手、排名和比赛结果
│   ├── item-race.js           # 道具箱、道具效果、投射物和 AI 道具行为
│   ├── car-catalog.js         # 四台车型目录、属性乘数与车库数据
│   ├── shop.js                # 商店商品目录、金币结算与购买装备逻辑
│   ├── shop-ui.js             # 首页与游戏内共用的商店界面
│   ├── decals.js              # 车漆与贴花烘焙成车身纹理
│   ├── car-parts.js           # 轮毂/尾翼挂件与喇叭音效合成
│   ├── achievements.js        # 成就定义、解锁判定与奖励
│   ├── achievements-ui.js     # 成就面板
│   ├── track-features.js      # 加速带/飞跃台/近道布点计算与物理 zone
│   ├── track-feature-meshes.js# 加速带箭头、跳台与近道支路网格渲染
│   ├── drift-effects.js       # 胎痕、轮胎烟雾与集气火花
│   ├── ghost.js               # 影子挑战录制、压缩序列化与回放
│   ├── ranked.js              # 本地排位段位与积分逻辑
│   ├── music.js               # 五图程序化 BGM 合成器
│   ├── world.js               # 夜港场景总装配与兼容导出
│   ├── night-track.js         # 夜港赛道曲线与通用放置几何
│   ├── night-atmosphere.js    # 夜空、雨、星体和灯光
│   ├── night-districts.js     # 港口、跨桥和山路分区
│   ├── procedural-vehicle.js  # 程序化主车、车型变体与 AI 车辆
│   ├── day-world.js           # 独立白天山谷赛道与场景
│   ├── scenic-worlds.js       # 雪岭、峡谷、海岸路线与高细节场景
│   ├── track-catalog.js       # 首页与运行时共享的地图信息
│   ├── multiplayer-client.js  # 房间连接、同步与断线恢复
│   ├── vehicle-assets.js      # 主车模型加载与程序化备用车
│   ├── speed-postprocess.js   # 高速径向模糊后处理
│   ├── audio.js               # 引擎、漂移、氮气音效与播报语音
│   ├── preferences.js         # 画质、音量、车型与反馈设置持久化
│   ├── race-records.js        # 分模式本地比赛纪录与幽灵存档
│   ├── telemetry.js           # WebGL 性能与错误监控
│   └── style.css              # HUD、车库和响应式触控布局
├── public/assets/             # 车辆、地图封面、HDRI、PBR 材质与播报语音资源
├── tests/                     # 逻辑、触控和 Playwright 视觉测试
├── server/                    # 2–6 人房间和 WebSocket 状态服务
│   ├── race-validation.mjs    # 联机进度、位置和完赛校验
│   └── ranked-store.mjs       # 服务端段位分持久化
├── scripts/                   # APK 构建与线上部署脚本
├── android/                   # 原生 Android 工程、正式签名配置和启动器图标引用
├── dist/                      # Vite 生产构建（可再生成）
└── artifacts/                 # 截图与 APK 成品
```

以下目录体积较大，但都不是业务源码：`node_modules/`、`.android-sdk/`、`.gradle-dist/`、`android/.gradle/` 和 `android/app/build/`。清理后可通过安装依赖或构建脚本重新生成。

## 美术资源与许可

主车辆使用 Khronos glTF Sample Assets 的 **Car Concept**，遵循 CC BY 4.0。环境材质来自 Poly Haven。具体来源、许可和文件校验信息见 [`public/assets/ASSET-LICENSES.md`](public/assets/ASSET-LICENSES.md)。主车辆加载失败时，游戏会自动切换到程序化备用车辆。

## 持续集成

GitHub Actions 工作流 [`.github/workflows/ci.yml`](.github/workflows/ci.yml) 在推送到 `main` 和所有 Pull Request 上触发，使用 Node.js 20 依次执行：

1. `npm ci` 按 `package-lock.json` 安装依赖（带 npm 缓存）
2. `npm test` 跑完 15 套纯 Node 逻辑测试（赛制、纪录、赛道、地形、幽灵、段位、商店、道具、联机、触控、键盘等）
3. `npm run build` 生产构建
4. 校验构建产物：`dist/index.html` 以及 `dist/assets` 下的 `.js` 与 `.css` 均存在且非空

CI **不运行**浏览器测试（`test:visual`、`test:maps-browser`、`test:item-browser`、`test:online-browser`、`test:performance`、`test:sections`）。它们需要本机 Chromium（`/usr/local/bin/chromium-browser`，可用 `CHROMIUM_PATH` 覆盖）外加一个 `vite preview` 服务器，在 CI 的软件渲染环境下单次运行可能长达数十分钟，既会撞上 job 超时，也容易因渲染差异产生假失败。这些测试保留为本地和发布前的人工回归手段。Job 超时设为 20 分钟，同分支的新提交会自动取消仍在运行的旧任务。

### 部署前预检

本地发布前先跑门禁脚本，它把历史上容易漏掉的步骤固定下来：

```bash
bash scripts/preflight.sh                  # 全量：静态检查 + npm test + 生产构建
bash scripts/preflight.sh --skip-tests     # 只做静态检查（跳过测试与构建）
bash scripts/preflight.sh --allow-dirty    # 允许工作区存在未提交改动
```

七项检查依次为：

1. Node.js 版本 ≥ 20
2. Git 工作区无未提交改动（`--allow-dirty` 可跳过）
3. `npm test` 全绿（`--skip-tests` 可跳过）
4. `npm run build` 成功且 `dist` 产物存在非空（`--skip-tests` 可跳过）
5. `package.json` 的 `version` 与 `android/app/build.gradle` 的 `versionName` 一致
6. README 顶部记录的「当前版本」与 `package.json` 的 `version` 一致（找不到记录只告警，不阻断）
7. 汇总并打印 `PREFLIGHT OK vX.Y.Z`

第 5 项是硬性要求：网页版和 Android 版必须共用同一个版本号，发版时要同时更新 `package.json` 的 `version`、`android/app/build.gradle` 的 `versionName`（并递增 `versionCode`）和 README 顶部的当前版本说明，任一处遗漏都会让预检失败或告警。预检通过后再执行下面的部署命令。

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

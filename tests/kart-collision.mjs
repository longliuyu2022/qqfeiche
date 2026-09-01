import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ArcadeVehicle } from '../src/driving.js';
import { createKartCollisionSystem } from '../src/kart-collision.js';
import { RACE_MODES } from '../src/race-modes.js';
import { TRACK_CATALOG } from '../src/track-catalog.js';

const curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 100),
  new THREE.Vector3(100, 0, 0),
  new THREE.Vector3(0, 0, -100),
  new THREE.Vector3(-100, 0, 0),
], true, 'catmullrom', 0.5);

function makePlayer() {
  const player = new ArcadeVehicle({ trackCurve: curve, trackWidth: 16 });
  player.position.set(0, 0, 0);
  player.heading = 0;
  player.velocity.set(0, 0, 32);
  player.startRace();
  return player;
}

function makeRival({ x = 0, z = 3.2, yaw = Math.PI, speed = 22 } = {}) {
  const object = new THREE.Group();
  object.position.set(x, 0, z);
  object.rotation.y = yaw;
  object.visible = true;
  return { id: 'rival-1', object, speed, lane: 0, targetLane: 0 };
}

const player = makePlayer();
const rival = makeRival();
let events = 0;
const collisions = createKartCollisionSystem({
  player,
  rivals: [rival],
  trackCurve: curve,
  onCollision: () => { events += 1; },
});
const beforeSpeed = player.velocity.length();
const hit = collisions.update(1 / 60);
assert.equal(hit.length, 1, 'overlapping karts should collide');
assert.ok(hit[0].headOnRatio > 0.9, 'opposing headings should register a head-on hit');
assert.equal(hit[0].collisionType, 'head-on');
assert.ok(player.velocity.length() < beforeSpeed, 'a head-on impact should reduce player speed');
assert.ok(rival.speed < 22, 'the AI kart should also lose speed');
assert.equal(player.state.collisionCount, 1);
assert.equal(events, 1);

player.position.set(0, 0, 0);
rival.object.position.set(0, 0, 3.2);
assert.equal(collisions.update(1 / 60).length, 0, 'contact cooldown should suppress repeated frame hits');
player.position.set(0, 0, 0);
rival.object.position.set(0, 0, 3.2);
assert.equal(collisions.update(0.35).length, 1, 'contact should be allowed again after cooldown');

const sidePlayer = makePlayer();
const sideRival = makeRival({ x: 3.1, z: 0, yaw: 0, speed: 15 });
const sideSystem = createKartCollisionSystem({ player: sidePlayer, rivals: [sideRival], trackCurve: curve });
const yawBefore = sidePlayer.yawRate;
const lateralBefore = sidePlayer.velocity.x;
const sideHits = sideSystem.update(1 / 60);
assert.equal(sideHits.length, 1);
assert.ok(Math.abs(sidePlayer.yawRate - yawBefore) > 0.01, 'side contact should disturb steering');
assert.ok(Math.abs(sidePlayer.velocity.x - lateralBefore) > 0.1, 'side contact should add lateral velocity');

const disabledPlayer = makePlayer();
const disabledRival = makeRival();
const disabled = createKartCollisionSystem({
  player: disabledPlayer,
  rivals: [disabledRival],
  isEnabled: () => false,
});
assert.deepEqual(disabled.update(1 / 60), [], 'normal race mode should leave kart contacts disabled');

// --- 碰碰赛对全部地图开放 ---------------------------------------------------
// 回归：碰碰赛曾被菜单限制在糖果湾与糖果王国两张图，选卡丁车会强制换图、
// 其余五张图的按钮直接禁用。碰撞只作用于车与车之间，与赛道无关，因此赛制定义
// 里不应再出现任何白名单。
assert.equal(RACE_MODES.kart.kartCollisions, true, '碰碰赛必须开启碰撞');
assert.equal(RACE_MODES.kart.cuteTrack, undefined, '不应再有默认糖果地图');
assert.equal(RACE_MODES.kart.cuteTracks, undefined, '不应再有糖果地图白名单');
for (const [modeId, mode] of Object.entries(RACE_MODES)) {
  assert.equal(mode.cuteTrack, undefined, `${modeId} 不应限定赛道`);
  assert.equal(mode.cuteTracks, undefined, `${modeId} 不应限定赛道`);
}

// 七张地图的赛道曲线长度差异很大（1671m 到 4867m），碰撞系统必须都能吃下，
// 且不依赖任何糖果地图专属数据。
const trackIds = Object.keys(TRACK_CATALOG);
assert.equal(trackIds.length, 7);
for (const trackId of trackIds) {
  // 用不同尺度的闭环代表长短赛道，验证碰撞判定与赛道几何无关。
  const scale = trackId === 'candyland' ? 3 : 1;
  const mapCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 100 * scale),
    new THREE.Vector3(100 * scale, 0, 0),
    new THREE.Vector3(0, 0, -100 * scale),
    new THREE.Vector3(-100 * scale, 0, 0),
  ], true, 'catmullrom', 0.5);
  const mapPlayer = new ArcadeVehicle({ trackCurve: mapCurve, trackWidth: 16 });
  mapPlayer.position.set(0, 0, 0);
  mapPlayer.heading = 0;
  mapPlayer.velocity.set(0, 0, 32);
  mapPlayer.startRace();
  const mapRival = makeRival();
  const mapSystem = createKartCollisionSystem({
    player: mapPlayer,
    rivals: [mapRival],
    trackCurve: mapCurve,
  });
  const speedBefore = mapPlayer.velocity.length();
  assert.equal(mapSystem.update(1 / 60).length, 1, `${trackId} 应能判定正面碰撞`);
  assert.ok(mapPlayer.velocity.length() < speedBefore, `${trackId} 正面碰撞应掉速`);
  // 每张图都要有自己的碰碰赛标题，且霓虹五图不再带「糖果」字样。
  const kartTitle = TRACK_CATALOG[trackId].modeTitles?.kart;
  assert.ok(kartTitle, `${trackId} 缺少碰碰赛标题`);
  if (!trackId.startsWith('candy')) {
    assert.ok(!kartTitle.includes('糖果'), `${trackId} 的碰碰赛标题不该带「糖果」：${kartTitle}`);
  }
}

console.log(JSON.stringify({
  headOn: 'ok',
  sideImpact: 'ok',
  cooldown: 'ok',
  modeGate: 'ok',
  allTracks: trackIds.length,
  noTrackWhitelist: 'ok',
}));

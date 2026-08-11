import './style.css';
import { RACE_MODES } from './race-modes.js';
import { loadPreferences, savePreferences } from './preferences.js';
import { loadRaceRecords } from './race-records.js';
import { MultiplayerClient } from './multiplayer-client.js';
import { TRACK_CATALOG, normalizeTrackId } from './track-catalog.js';
import { CAR_CATALOG, getCarById } from './car-catalog.js';
import { formatRank, getRankTier, loadRankState } from './ranked.js';

const ui = Object.fromEntries([
  'homeMenu', 'homeBest', 'homeBestLabel', 'homeRaces', 'homeWins', 'homeKicker', 'homeRank',
  'homeEventMeta', 'homeEventTitle', 'homeEventRules', 'homeTrackSubtitle', 'trackSelector', 'garageSelector',
  'startRace', 'openMultiplayer',
  'openSettings', 'settingsMenu', 'closeSettings', 'soundEnabled',
  'masterVolume', 'volumeValue', 'qualitySetting', 'vibrationEnabled',
  'musicEnabled', 'musicVolume', 'musicVolumeValue', 'voiceEnabled', 'ghostEnabled',
  'cameraShakeEnabled', 'loading', 'multiplayerMenu', 'closeMultiplayer',
  'onlineConnect', 'onlineLobby', 'onlineName', 'roomCode', 'createRoom', 'joinRoom',
  'copyRoomCode', 'onlineRoomCode', 'onlineMapName', 'onlinePlayers', 'onlineStatus',
  'startOnlineRace', 'leaveRoom',
].map((id) => [id, document.getElementById(id)]));

let preferences = loadPreferences();
const raceRecords = loadRaceRecords();
let selectedMode = preferences.lastMode;
let selectedTrack = normalizeTrackId(preferences.lastTrack);
let selectedCarId = getCarById(preferences.carId).id;
let bootstrapActive = true;
let multiplayer = null;
let onlineBusy = false;

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--.---';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`;
}

function formatScore(score) {
  return String(Math.max(0, Math.round(score || 0))).padStart(6, '0');
}

function getModeBest(modeId) {
  if (modeId === 'timeTrial') return raceRecords.timeTrialBest;
  if (modeId === 'drift') return raceRecords.driftBest;
  return raceRecords.bestTime;
}

function eventTitle(trackId, modeId) {
  const track = TRACK_CATALOG[normalizeTrackId(trackId)];
  return track.modeTitles?.[modeId] ?? RACE_MODES[modeId]?.title ?? track.title;
}

function revealSelectedTrack(button) {
  if (!ui.trackSelector || !button) return;
  const visibleStart = ui.trackSelector.scrollLeft;
  const visibleEnd = visibleStart + ui.trackSelector.clientWidth;
  const buttonStart = button.offsetLeft;
  const buttonEnd = buttonStart + button.offsetWidth;
  const scrollLeft = buttonStart < visibleStart
    ? buttonStart
    : buttonEnd > visibleEnd
      ? buttonEnd - ui.trackSelector.clientWidth
      : null;
  if (scrollLeft === null) return;
  if (typeof ui.trackSelector.scrollTo === 'function') {
    ui.trackSelector.scrollTo({ left: scrollLeft, behavior: 'smooth' });
  } else {
    ui.trackSelector.scrollLeft = scrollLeft;
  }
}

function renderGarage() {
  if (!ui.garageSelector) return;
  const buttons = CAR_CATALOG.map((car) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.car = car.id;
    button.setAttribute('role', 'tab');
    const selected = car.id === selectedCarId;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.style.setProperty('--car-color', car.color);
    button.style.setProperty('--car-accent', car.accentColor);
    const chip = document.createElement('span');
    chip.className = 'car-chip';
    chip.textContent = car.carClass;
    const name = document.createElement('strong');
    name.textContent = car.name;
    const flavor = document.createElement('small');
    flavor.textContent = car.flavor;
    const stats = document.createElement('span');
    stats.className = 'car-stats';
    for (const [label, value] of [['速', car.stats.topSpeed], ['集', car.stats.charge], ['控', car.stats.handling]]) {
      const stat = document.createElement('em');
      const statLabel = document.createElement('span');
      statLabel.textContent = label;
      const bar = document.createElement('i');
      bar.style.setProperty('--stat', String(value));
      stat.append(statLabel, bar);
      stats.append(stat);
    }
    button.append(chip, name, flavor, stats);
    button.addEventListener('click', () => selectCar(car.id));
    return button;
  });
  ui.garageSelector.replaceChildren(...buttons);
}

function selectCar(carId) {
  if (!bootstrapActive || !getCarById(carId) || multiplayer?.room) return;
  selectedCarId = getCarById(carId).id;
  preferences = savePreferences({ ...preferences, carId: selectedCarId });
  renderGarage();
}

function renderRankBadge() {
  if (!ui.homeRank) return;
  const rank = loadRankState();
  ui.homeRank.textContent = formatRank(rank);
  ui.homeRank.dataset.tier = getRankTier(rank).id;
}

function renderHome() {
  const mode = RACE_MODES[selectedMode];
  const track = TRACK_CATALOG[selectedTrack];
  const best = getModeBest(selectedMode);
  for (const button of document.querySelectorAll('[data-race-mode]')) {
    const selected = button.dataset.raceMode === selectedMode;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  }
  let selectedTrackButton = null;
  for (const button of document.querySelectorAll('[data-track]')) {
    const selected = button.dataset.track === selectedTrack;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
    if (selected) selectedTrackButton = button;
  }
  revealSelectedTrack(selectedTrackButton);
  ui.homeKicker.textContent = track.kicker;
  if (ui.homeTrackSubtitle) ui.homeTrackSubtitle.textContent = track.shortTitle || track.label;
  ui.homeEventMeta.textContent = mode.id === 'race' ? track.meta : mode.meta;
  ui.homeEventTitle.textContent = eventTitle(selectedTrack, selectedMode);
  ui.homeEventRules.textContent = mode.rules;
  ui.homeBestLabel.textContent = selectedMode === 'drift' ? 'HIGH SCORE' : 'PERSONAL BEST';
  ui.homeBest.textContent = selectedMode === 'drift' ? formatScore(best) : formatTime(best);
  ui.homeRaces.textContent = String(raceRecords.modeRaces[selectedMode] ?? 0);
  ui.homeWins.textContent = String(raceRecords.wins);
  renderRankBadge();
  document.body.dataset.track = selectedTrack;
}

function selectMode(modeId) {
  if (!bootstrapActive || !RACE_MODES[modeId]) return;
  selectedMode = modeId;
  preferences = savePreferences({ ...preferences, lastMode: modeId });
  renderHome();
}

function selectTrack(trackId, { persist = true } = {}) {
  if (!bootstrapActive || !TRACK_CATALOG[trackId] || multiplayer?.room) return;
  selectedTrack = trackId;
  if (persist) preferences = savePreferences({ ...preferences, lastTrack: trackId });
  renderHome();
}

function syncSettings() {
  ui.soundEnabled.checked = preferences.soundEnabled;
  ui.masterVolume.value = String(preferences.masterVolume);
  ui.masterVolume.disabled = !preferences.soundEnabled;
  ui.volumeValue.textContent = `${Math.round(preferences.masterVolume * 100)}%`;
  ui.musicEnabled.checked = preferences.musicEnabled;
  ui.musicVolume.value = String(preferences.musicVolume);
  ui.musicVolume.disabled = !preferences.musicEnabled;
  ui.musicVolumeValue.textContent = `${Math.round(preferences.musicVolume * 100)}%`;
  ui.voiceEnabled.checked = preferences.voiceEnabled;
  ui.ghostEnabled.checked = preferences.ghostEnabled;
  ui.qualitySetting.value = preferences.quality;
  ui.vibrationEnabled.checked = preferences.vibration;
  ui.cameraShakeEnabled.checked = preferences.cameraShake;
}

function applyPreferences(changes) {
  if (!bootstrapActive) return;
  preferences = savePreferences({ ...preferences, ...changes });
  syncSettings();
}

function setSettingsVisible(visible) {
  if (!bootstrapActive) return;
  ui.settingsMenu.hidden = !visible;
  if (visible) syncSettings();
}

function setOnlineStatus(message, tone = '') {
  ui.onlineStatus.textContent = message;
  ui.onlineStatus.dataset.tone = tone;
}

function setOnlineBusy(value) {
  onlineBusy = value;
  ui.createRoom.disabled = value;
  ui.joinRoom.disabled = value;
}

function ensureMultiplayer() {
  if (multiplayer) return multiplayer;
  multiplayer = new MultiplayerClient();
  multiplayer.addEventListener('room', (event) => renderLobby(event.detail.room));
  multiplayer.addEventListener('error', (event) => setOnlineStatus(event.detail.message || '联机请求失败', 'error'));
  multiplayer.addEventListener('prepare', (event) => {
    selectedTrack = normalizeTrackId(event.detail.map);
    preferences = savePreferences({ ...preferences, lastTrack: selectedTrack });
    renderHome();
    setOnlineStatus('所有车手正在加载赛道…');
    launchGame({ online: true });
  });
  multiplayer.addEventListener('reconnecting', () => setOnlineStatus('连接中断，正在恢复…', 'warning'));
  multiplayer.addEventListener('resumed', () => setOnlineStatus('连接已恢复', 'success'));
  multiplayer.addEventListener('connection-lost', () => setOnlineStatus('连接已断开，请返回首页重试', 'error'));
  multiplayer.addEventListener('left', () => renderLobby(null));
  return multiplayer;
}

function renderLobby(room = multiplayer?.room) {
  const inRoom = Boolean(room);
  ui.onlineConnect.hidden = inRoom;
  ui.onlineLobby.hidden = !inRoom;
  if (!inRoom) {
    ui.onlinePlayers.replaceChildren();
    setOnlineStatus('2–6 人好友赛，由房主发车');
    return;
  }
  selectedTrack = normalizeTrackId(room.map);
  preferences = savePreferences({ ...preferences, lastTrack: selectedTrack });
  renderHome();
  ui.onlineRoomCode.textContent = room.code;
  ui.onlineMapName.textContent = TRACK_CATALOG[selectedTrack].title;
  const rows = room.players.map((player) => {
    const row = document.createElement('li');
    const marker = document.createElement('i');
    marker.style.background = `#${player.color.toString(16).padStart(6, '0')}`;
    const name = document.createElement('span');
    name.textContent = player.name;
    const state = document.createElement('small');
    state.textContent = player.id === room.hostId ? '房主' : player.connected ? '已加入' : '重连中';
    row.classList.toggle('offline', !player.connected);
    row.append(marker, name, state);
    return row;
  });
  ui.onlinePlayers.replaceChildren(...rows);
  const isHost = multiplayer.isHost;
  const connectedCount = room.players.filter((player) => player.connected).length;
  ui.startOnlineRace.hidden = !isHost;
  ui.startOnlineRace.disabled = connectedCount < 2 || room.phase !== 'lobby';
  ui.startOnlineRace.textContent = connectedCount < 2 ? '等待车手加入' : room.phase === 'lobby' ? '开始联机比赛' : '正在准备赛道';
  setOnlineStatus(
    isHost ? `${connectedCount}/${room.players.length} 名车手在线，至少 2 人可发车` : '已加入房间，等待房主发车',
    'success',
  );
}

function setMultiplayerVisible(visible) {
  if (!bootstrapActive || onlineBusy) return;
  ui.multiplayerMenu.hidden = !visible;
  if (visible) {
    ensureMultiplayer();
    renderLobby();
    setTimeout(() => ui.onlineName.focus(), 0);
  }
}

async function connectOnline(kind) {
  if (onlineBusy) return;
  const client = ensureMultiplayer();
  const name = ui.onlineName.value.trim();
  if (!name) {
    setOnlineStatus('请先输入游客昵称', 'error');
    ui.onlineName.focus();
    return;
  }
  if (kind === 'join' && ui.roomCode.value.trim().length !== 6) {
    setOnlineStatus('请输入 6 位房间码', 'error');
    ui.roomCode.focus();
    return;
  }
  setOnlineBusy(true);
  setOnlineStatus(kind === 'create' ? '正在创建房间…' : '正在加入房间…');
  try {
    const room = kind === 'create'
      ? await client.createRoom({ name, map: selectedTrack })
      : await client.joinRoom({ name, code: ui.roomCode.value });
    renderLobby(room);
  } catch (error) {
    setOnlineStatus(error.message || '连接失败，请重试', 'error');
  } finally {
    setOnlineBusy(false);
  }
}

async function launchGame({ online = false } = {}) {
  if (!bootstrapActive || window.__NEON_APEX_LOADING__) return;
  window.__NEON_APEX_LOADING__ = true;
  window.__NEON_APEX_AUTOSTART__ = online ? null : selectedMode;
  window.__NEON_APEX_TRACK__ = selectedTrack;
  window.__NEON_APEX_ONLINE__ = online ? multiplayer : null;
  preferences = savePreferences({ ...preferences, lastMode: selectedMode, lastTrack: selectedTrack });
  ui.settingsMenu.hidden = true;
  ui.multiplayerMenu.hidden = true;
  ui.startRace.disabled = true;
  ui.loading.style.display = 'flex';
  ui.loading.classList.remove('done');
  ui.loading.querySelector('p').textContent = 'NEON APEX';
  ui.loading.querySelector('small').textContent = TRACK_CATALOG[selectedTrack].loading;
  document.body.classList.add('game-loading');

  try {
    await import('./main.js');
    bootstrapActive = false;
    ui.startRace.disabled = false;
  } catch (error) {
    console.error('Unable to load Neon Apex runtime.', error);
    delete window.__NEON_APEX_AUTOSTART__;
    window.__NEON_APEX_LOADING__ = false;
    ui.startRace.disabled = false;
    ui.homeEventMeta.textContent = 'LOAD FAILED // RETRY';
    ui.homeEventTitle.textContent = '赛道加载失败';
    ui.homeEventRules.textContent = '请检查网络后重新开始';
    ui.loading.classList.add('done');
    setTimeout(() => { ui.loading.style.display = 'none'; }, 500);
    document.body.classList.remove('game-loading');
    if (online) multiplayer?.leave();
  }
}

for (const button of document.querySelectorAll('[data-race-mode]')) {
  button.addEventListener('click', () => selectMode(button.dataset.raceMode));
}
for (const button of document.querySelectorAll('[data-track]')) {
  button.addEventListener('click', () => selectTrack(button.dataset.track));
}
ui.startRace.addEventListener('click', () => launchGame());
ui.openMultiplayer.addEventListener('click', () => setMultiplayerVisible(true));
ui.closeMultiplayer.addEventListener('click', () => setMultiplayerVisible(false));
ui.createRoom.addEventListener('click', () => connectOnline('create'));
ui.joinRoom.addEventListener('click', () => connectOnline('join'));
ui.roomCode.addEventListener('input', () => { ui.roomCode.value = ui.roomCode.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6); });
ui.copyRoomCode.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(multiplayer?.room?.code || '');
    setOnlineStatus('房间码已复制', 'success');
  } catch {
    setOnlineStatus('房间码复制失败，请手动记录', 'error');
  }
});
ui.startOnlineRace.addEventListener('click', () => multiplayer?.startRace());
ui.leaveRoom.addEventListener('click', () => multiplayer?.leave());
ui.openSettings.addEventListener('click', () => setSettingsVisible(true));
ui.closeSettings.addEventListener('click', () => setSettingsVisible(false));
ui.soundEnabled.addEventListener('change', () => applyPreferences({ soundEnabled: ui.soundEnabled.checked }));
ui.masterVolume.addEventListener('input', () => applyPreferences({ masterVolume: Number(ui.masterVolume.value) }));
ui.musicEnabled.addEventListener('change', () => applyPreferences({ musicEnabled: ui.musicEnabled.checked }));
ui.musicVolume.addEventListener('input', () => applyPreferences({ musicVolume: Number(ui.musicVolume.value) }));
ui.voiceEnabled.addEventListener('change', () => applyPreferences({ voiceEnabled: ui.voiceEnabled.checked }));
ui.ghostEnabled.addEventListener('change', () => applyPreferences({ ghostEnabled: ui.ghostEnabled.checked }));
ui.qualitySetting.addEventListener('change', () => applyPreferences({ quality: ui.qualitySetting.value }));
ui.vibrationEnabled.addEventListener('change', () => applyPreferences({ vibration: ui.vibrationEnabled.checked }));
ui.cameraShakeEnabled.addEventListener('change', () => applyPreferences({ cameraShake: ui.cameraShakeEnabled.checked }));
window.addEventListener('keydown', (event) => {
  if (!bootstrapActive) return;
  if (!ui.settingsMenu.hidden) {
    if (event.code === 'Escape') setSettingsVisible(false);
    return;
  }
  if (!ui.multiplayerMenu.hidden) {
    if (event.code === 'Escape') setMultiplayerVisible(false);
    if (event.code === 'Enter' && !ui.onlineConnect.hidden) connectOnline(ui.roomCode.value ? 'join' : 'create');
    return;
  }
  if (event.code === 'Enter' || event.code === 'Space') {
    event.preventDefault();
    launchGame();
  }
});

window.__NEON_APEX_ANDROID_BACK__ = () => {
  if (!bootstrapActive) return false;
  if (!ui.settingsMenu.hidden) {
    setSettingsVisible(false);
    return true;
  }
  if (!ui.multiplayerMenu.hidden) {
    setMultiplayerVisible(false);
    return true;
  }
  return false;
};

document.body.classList.add('pre-game', 'menu-open');
ui.homeMenu.hidden = false;
ui.loading.classList.add('done');
ui.loading.style.display = 'none';
syncSettings();
renderGarage();
renderHome();
window.__NEON_APEX_BOOTSTRAP_READY__ = true;

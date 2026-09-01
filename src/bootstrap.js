import './style.css';
import { installErrorOverlay, recordHandled } from './error-overlay.js';
import { RACE_MODES } from './race-modes.js';
import { loadPreferences, savePreferences } from './preferences.js';
import { getModeBest as getDifficultyBest, loadRaceRecords } from './race-records.js';
import { MultiplayerClient } from './multiplayer-client.js';
import { TRACK_CATALOG, normalizeTrackId } from './track-catalog.js';
import { CAR_CATALOG, getCarById } from './car-catalog.js';
import { formatRank, getRankTier, loadRankState } from './ranked.js';
import { isOwned } from './shop.js';
import { getWalletSync } from './wallet-sync.js';
import { createShopUi } from './shop-ui.js';
import { createAchievementsUi } from './achievements-ui.js';
import { getAuthSession, loginAccount, logoutAccount, registerAccount } from './auth-client.js';
import { difficultyRule, trackVariantRule } from './race-rules.js';
import { listChallenges, loadChallengeState } from './challenges.js';
import { fetchSeasonLeaderboard } from './season.js';

// 尽早接管：此后任何未捕获的异常都会有可读的界面，而不是让玩家对着空屏。
installErrorOverlay();

const ui = Object.fromEntries([
  'homeMenu', 'homeBest', 'homeBestLabel', 'homeRaces', 'homeWins', 'homeKicker', 'homeRank', 'homeCoins',
  'homeEventMeta', 'homeEventTitle', 'homeEventRules', 'homeDifficulty', 'homeTrackSubtitle', 'trackSelector', 'garageSelector',
  'startRace', 'openMultiplayer', 'openShop', 'openAchievements', 'openAccount', 'openAccountAction', 'homeAccount',
  'openChallenges', 'challengesMenu', 'closeChallenges', 'challengeList', 'challengeStatus',
  'openLeaderboard', 'leaderboardMenu', 'closeLeaderboard', 'leaderboardTitle', 'leaderboardList', 'leaderboardStatus',
  'openSettings', 'settingsMenu', 'closeSettings', 'soundEnabled',
  'masterVolume', 'volumeValue', 'difficultySetting', 'trackVariantSetting', 'touchLayoutSetting', 'touchOpacitySetting', 'touchOpacityValue', 'qualitySetting', 'vibrationEnabled',
  'musicEnabled', 'musicVolume', 'musicVolumeValue', 'voiceEnabled', 'voicePack', 'ghostEnabled',
  'cameraShakeEnabled', 'loading', 'multiplayerMenu', 'closeMultiplayer',
  'onlineConnect', 'onlineLobby', 'onlineName', 'roomCode', 'roomPassword', 'createRoom', 'joinRoom', 'spectateRoom',
  'copyRoomCode', 'onlineRoomCode', 'onlineMapName', 'onlinePlayers', 'onlineStatus',
  'onlineQuality',
  'startOnlineRace', 'leaveRoom', 'quickMatch',
  'accountMenu', 'closeAccount', 'accountSignedOut', 'accountSignedIn', 'accountTabs',
  'accountForm', 'accountUsername', 'accountPassword', 'accountConfirmRow', 'accountConfirm',
  'accountSubmit', 'accountLogout', 'accountCurrentUser', 'accountStatus',
].map((id) => [id, document.getElementById(id)]));

let preferences = loadPreferences();
const raceRecords = loadRaceRecords();
const walletSync = getWalletSync();
let wallet = walletSync.read();
let selectedMode = preferences.lastMode;
let selectedTrack = normalizeTrackId(preferences.lastTrack);
const kartTracks = new Set(RACE_MODES.kart.cuteTracks ?? [RACE_MODES.kart.cuteTrack]);
const isKartTrack = (trackId) => kartTracks.has(trackId);
if (selectedMode === 'kart' && !isKartTrack(selectedTrack)) selectedTrack = RACE_MODES.kart.cuteTrack;
let selectedCarId = getCarById(preferences.carId).id;
let bootstrapActive = true;
let multiplayer = null;
let onlineBusy = false;
let accountUser = null;
let accountMode = 'login';
let accountBusy = false;
let challengeState = loadChallengeState();

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
  return getDifficultyBest(raceRecords, modeId, preferences.difficulty);
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
    const owned = isOwned(wallet, car.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.car = car.id;
    button.dataset.owned = String(owned);
    button.setAttribute('role', 'tab');
    const selected = car.id === selectedCarId;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.style.setProperty('--car-color', car.color);
    button.style.setProperty('--car-accent', car.accentColor);
    const chip = document.createElement('span');
    chip.className = 'car-chip';
    chip.textContent = owned ? car.carClass : '锁';
    const name = document.createElement('strong');
    name.textContent = car.name;
    const flavor = document.createElement('small');
    flavor.textContent = owned ? car.flavor : '前往商店解锁';
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
  const car = getCarById(carId);
  if (!isOwned(wallet, car.id)) {
    shopUi?.open();
    return;
  }
  selectedCarId = car.id;
  preferences = savePreferences({ ...preferences, carId: selectedCarId });
  renderGarage();
}

function renderWallet() {
  if (ui.homeCoins) ui.homeCoins.textContent = Number(wallet.coins || 0).toLocaleString('en-US');
}

function renderChallenges() {
  const challenges = listChallenges(challengeState);
  ui.challengeList?.replaceChildren(...challenges.map((challenge) => {
    const card = document.createElement('article');
    card.className = 'challenge-card';
    card.dataset.complete = String(challenge.completed);
    const title = document.createElement('b');
    title.textContent = `${challenge.period === 'daily' ? '今日' : '本周'} · ${challenge.label}`;
    const reward = document.createElement('em');
    reward.textContent = `+${challenge.reward}`;
    const count = document.createElement('small');
    count.textContent = `${challenge.current} / ${challenge.target} · ${challenge.completed ? '已领取' : '金币'}`;
    const progress = document.createElement('div');
    progress.className = 'challenge-progress';
    const fill = document.createElement('i');
    fill.style.width = `${Math.min(100, challenge.current / challenge.target * 100)}%`;
    progress.append(fill);
    card.append(title, reward, count, progress);
    return card;
  }));
}

function setChallengesVisible(visible) {
  if (!ui.challengesMenu) return;
  challengeState = loadChallengeState();
  ui.challengesMenu.hidden = !visible;
  if (visible) renderChallenges();
}

async function setLeaderboardVisible(visible) {
  if (!ui.leaderboardMenu) return;
  ui.leaderboardMenu.hidden = !visible;
  if (!visible) return;
  ui.leaderboardStatus.textContent = '正在读取赛季榜…';
  try {
    const result = await fetchSeasonLeaderboard();
    ui.leaderboardTitle.textContent = `赛季榜 ${result.season}`;
    ui.leaderboardList.replaceChildren(...result.players.map((player) => {
      const row = document.createElement('li');
      const position = document.createElement('b');
      position.textContent = `#${player.position}`;
      const name = document.createElement('span');
      name.textContent = player.label || `车手 ${player.position}`;
      const points = document.createElement('small');
      points.textContent = `${player.wins} 胜 · ${player.points} 分`;
      row.append(position, name, points);
      return row;
    }));
    ui.leaderboardStatus.textContent = result.players.length ? '按赛季段位积分排序' : '本赛季还没有公开纪录';
  } catch (error) {
    ui.leaderboardStatus.textContent = error.message || '赛季榜暂时不可用';
  }
}

// 登录拉到云端钱包、或退出回到游客钱包时，首页金币和车库解锁状态都要跟着刷新。
walletSync.subscribe((next) => {
  wallet = next;
  renderWallet();
  renderGarage();
});

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
    button.disabled = selectedMode === 'kart' && !isKartTrack(button.dataset.track);
    if (selected) selectedTrackButton = button;
  }
  revealSelectedTrack(selectedTrackButton);
  ui.homeKicker.textContent = track.kicker;
  if (ui.homeTrackSubtitle) ui.homeTrackSubtitle.textContent = track.shortTitle || track.label;
  ui.homeEventMeta.textContent = mode.id === 'race' ? track.meta : mode.meta;
  ui.homeEventTitle.textContent = eventTitle(selectedTrack, selectedMode);
  const difficulty = difficultyRule(preferences.difficulty);
  const variant = trackVariantRule(preferences.trackVariant);
  ui.homeEventRules.textContent = `${mode.rules} // ${difficulty.label} // ${variant.label}`;
  if (ui.homeDifficulty) {
    ui.homeDifficulty.textContent = difficulty.id === 'hard' ? '奖励 +25%' : '标准奖励';
    ui.homeDifficulty.dataset.difficulty = difficulty.id;
  }
  ui.homeBestLabel.textContent = selectedMode === 'drift' ? 'HIGH SCORE' : 'PERSONAL BEST';
  ui.homeBest.textContent = selectedMode === 'drift' ? formatScore(best) : formatTime(best);
  ui.homeRaces.textContent = String(raceRecords.modeRaces[selectedMode] ?? 0);
  ui.homeWins.textContent = String(raceRecords.wins);
  renderRankBadge();
  renderWallet();
  document.body.dataset.track = selectedTrack;
}

const achievementsUi = createAchievementsUi({});
const shopUi = createShopUi({
  getWallet: () => wallet,
  setWallet: (next) => { wallet = next; },
  onChange: () => {
    renderWallet();
    renderGarage();
  },
});

function selectMode(modeId) {
  if (!bootstrapActive || !RACE_MODES[modeId]) return;
  selectedMode = modeId;
  if (modeId === 'kart' && !isKartTrack(selectedTrack)) selectedTrack = RACE_MODES.kart.cuteTrack;
  preferences = savePreferences({ ...preferences, lastMode: modeId, lastTrack: selectedTrack });
  renderHome();
}

function selectTrack(trackId, { persist = true } = {}) {
  if (!bootstrapActive || !TRACK_CATALOG[trackId] || multiplayer?.room) return;
  if (selectedMode === 'kart' && !isKartTrack(trackId)) return;
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
  ui.voicePack.value = preferences.voicePack;
  ui.ghostEnabled.checked = preferences.ghostEnabled;
  ui.difficultySetting.value = preferences.difficulty;
  ui.trackVariantSetting.value = preferences.trackVariant;
  ui.touchLayoutSetting.value = preferences.touchLayout;
  ui.touchOpacitySetting.value = String(preferences.touchOpacity);
  ui.touchOpacityValue.textContent = `${Math.round(preferences.touchOpacity * 100)}%`;
  document.body.dataset.touchLayout = preferences.touchLayout;
  document.body.style.setProperty('--touch-opacity', String(preferences.touchOpacity));
  ui.qualitySetting.value = preferences.quality;
  ui.vibrationEnabled.checked = preferences.vibration;
  ui.cameraShakeEnabled.checked = preferences.cameraShake;
}

function applyPreferences(changes) {
  if (!bootstrapActive) return;
  preferences = savePreferences({ ...preferences, ...changes });
  syncSettings();
  renderHome();
}

function setSettingsVisible(visible) {
  if (!bootstrapActive) return;
  ui.settingsMenu.hidden = !visible;
  if (visible) syncSettings();
}

function setAccountStatus(message = '', tone = '') {
  ui.accountStatus.textContent = message;
  ui.accountStatus.dataset.tone = tone;
}

function setAccountBusy(value) {
  accountBusy = value;
  ui.accountUsername.disabled = value;
  ui.accountPassword.disabled = value;
  ui.accountConfirm.disabled = value;
  ui.accountSubmit.disabled = value;
  ui.accountLogout.disabled = value;
  for (const button of ui.accountTabs.querySelectorAll('[data-auth-mode]')) button.disabled = value;
}

function setAccountMode(mode) {
  if (accountBusy) return;
  accountMode = mode === 'register' ? 'register' : 'login';
  const registering = accountMode === 'register';
  for (const button of ui.accountTabs.querySelectorAll('[data-auth-mode]')) {
    const selected = button.dataset.authMode === accountMode;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  }
  ui.accountConfirmRow.hidden = !registering;
  ui.accountConfirm.required = registering;
  ui.accountPassword.autocomplete = registering ? 'new-password' : 'current-password';
  ui.accountSubmit.textContent = registering ? '创建账号' : '登录';
  setAccountStatus();
}

function renderAccount() {
  const signedIn = Boolean(accountUser);
  ui.accountSignedOut.hidden = signedIn;
  ui.accountSignedIn.hidden = !signedIn;
  ui.accountCurrentUser.textContent = accountUser?.username || '—';
  ui.homeAccount.textContent = accountUser?.username || '游客';
  ui.openAccount.dataset.signedIn = String(signedIn);
  if (signedIn) {
    ui.onlineName.value = accountUser.username;
    ui.onlineName.readOnly = true;
    ui.onlineName.setAttribute('aria-label', `已登录车手 ${accountUser.username}`);
  } else {
    ui.onlineName.readOnly = false;
    ui.onlineName.removeAttribute('aria-label');
  }
}

function setAccountVisible(visible) {
  ui.accountMenu.hidden = !visible;
  if (!visible) return;
  renderAccount();
  setAccountStatus();
  setTimeout(() => (accountUser ? ui.accountLogout : ui.accountUsername).focus(), 0);
}

async function refreshAccount() {
  try {
    const session = await getAuthSession();
    accountUser = session.user || null;
  } catch {
    accountUser = null;
  }
  renderAccount();
  // 会话有效就把云端钱包接过来；没登录则回到本机游客钱包。
  await (accountUser ? walletSync.signIn(accountUser) : walletSync.signOut());
  return accountUser;
}

async function submitAccount() {
  if (accountBusy) return;
  const username = ui.accountUsername.value.trim();
  const password = ui.accountPassword.value;
  if (accountMode === 'register' && password !== ui.accountConfirm.value) {
    setAccountStatus('两次输入的密码不一致', 'error');
    ui.accountConfirm.focus();
    return;
  }
  setAccountBusy(true);
  setAccountStatus(accountMode === 'register' ? '正在创建车手账号…' : '正在登录…');
  try {
    const result = accountMode === 'register'
      ? await registerAccount({ username, password })
      : await loginAccount({ username, password });
    accountUser = result.user || null;
    ui.accountPassword.value = '';
    ui.accountConfirm.value = '';
    renderAccount();
    await walletSync.signIn(accountUser);
    setAccountStatus(accountMode === 'register' ? '账号创建成功，已自动登录' : '登录成功', 'success');
  } catch (error) {
    setAccountStatus(error.message || '账号请求失败，请稍后重试', 'error');
  } finally {
    setAccountBusy(false);
  }
}

async function signOutAccount() {
  if (accountBusy) return;
  let signedOut = false;
  setAccountBusy(true);
  setAccountStatus('正在退出…');
  try {
    // 先把待上传的钱包推完再注销会话，否则最后一次同步会 401。
    await walletSync.signOut();
    await logoutAccount();
    accountUser = null;
    renderAccount();
    signedOut = true;
  } catch (error) {
    setAccountStatus(error.message || '退出失败，请稍后重试', 'error');
  } finally {
    setAccountBusy(false);
    if (signedOut) {
      setAccountMode('login');
      setAccountStatus('已退出登录', 'success');
    }
  }
}

function setOnlineStatus(message, tone = '') {
  ui.onlineStatus.textContent = message;
  ui.onlineStatus.dataset.tone = tone;
}

function setOnlineBusy(value) {
  onlineBusy = value;
  ui.createRoom.disabled = value;
  ui.joinRoom.disabled = value;
  ui.spectateRoom.disabled = value;
  if (ui.quickMatch) ui.quickMatch.disabled = value;
}

function ensureMultiplayer() {
  if (multiplayer) return multiplayer;
  multiplayer = new MultiplayerClient();
  multiplayer.addEventListener('room', (event) => renderLobby(event.detail.room));
  multiplayer.addEventListener('error', (event) => setOnlineStatus(event.detail.message || '联机请求失败', 'error'));
  multiplayer.addEventListener('prepare', (event) => {
    selectedTrack = normalizeTrackId(event.detail.map);
    selectedMode = RACE_MODES[event.detail.raceMode] ? event.detail.raceMode : 'race';
    preferences = savePreferences({ ...preferences, lastTrack: selectedTrack, lastMode: selectedMode, trackVariant: event.detail.trackVariant ?? preferences.trackVariant });
    renderHome();
    setOnlineStatus('所有车手正在加载赛道…');
    launchGame({ online: true });
  });
  multiplayer.addEventListener('reconnecting', () => setOnlineStatus('连接中断，正在恢复…', 'warning'));
  multiplayer.addEventListener('resumed', () => setOnlineStatus('连接已恢复', 'success'));
  multiplayer.addEventListener('connection-lost', () => setOnlineStatus('连接已断开，请返回首页重试', 'error'));
  multiplayer.addEventListener('kicked', (event) => {
    renderLobby(null);
    setOnlineStatus(event.detail.message || '你已被房主移出房间', 'error');
  });
  multiplayer.addEventListener('connection-quality', (event) => {
    const info = event.detail;
    ui.onlineQuality.textContent = `网络质量：${info.quality} · 延迟 ${info.latencyMs ?? '--'}ms${info.jitterMs === null ? '' : ` · 抖动 ${info.jitterMs}ms`}`;
    ui.onlineQuality.dataset.quality = info.quality;
  });
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
  selectedMode = RACE_MODES[room.raceMode] ? room.raceMode : 'race';
  preferences = savePreferences({ ...preferences, lastTrack: selectedTrack, lastMode: selectedMode, trackVariant: room.trackVariant ?? preferences.trackVariant });
  renderHome();
  ui.onlineRoomCode.textContent = room.code;
  ui.onlineMapName.textContent = `${TRACK_CATALOG[selectedTrack].title} · ${RACE_MODES[selectedMode].title}`;
  const rows = room.players.map((player) => {
    const row = document.createElement('li');
    const marker = document.createElement('i');
    marker.style.background = `#${player.color.toString(16).padStart(6, '0')}`;
    const name = document.createElement('span');
    name.textContent = player.name;
    const state = document.createElement('small');
    state.textContent = player.id === room.hostId ? '房主' : player.spectator ? '观战' : player.connected ? '已加入' : '重连中';
    const actions = document.createElement('div');
    actions.className = 'online-player-state';
    actions.append(state);
    row.classList.toggle('offline', !player.connected);
    row.append(marker, name, actions);
    if (player.rank?.label) {
      const rank = document.createElement('b');
      rank.className = 'player-rank';
      rank.textContent = player.rank.label;
      actions.prepend(rank);
    }
    if (multiplayer.isHost && player.id !== multiplayer.selfId && room.phase === 'lobby') {
      const kick = document.createElement('button');
      kick.type = 'button';
      kick.className = 'kick-player';
      kick.textContent = '移出';
      kick.addEventListener('click', () => multiplayer.kickPlayer(player.id));
      actions.append(kick);
    }
    return row;
  });
  ui.onlinePlayers.replaceChildren(...rows);
  const isHost = multiplayer.isHost;
  const participantCount = room.players.filter((player) => !player.spectator).length;
  const connectedCount = room.players.filter((player) => player.connected && !player.spectator).length;
  ui.startOnlineRace.hidden = !isHost;
  ui.startOnlineRace.disabled = connectedCount < 2 || room.phase !== 'lobby';
  ui.startOnlineRace.textContent = connectedCount < 2 ? '等待车手加入' : room.phase === 'lobby' ? '开始联机比赛' : '正在准备赛道';
  setOnlineStatus(
    isHost ? `${connectedCount}/${participantCount} 名车手在线，至少 2 人可发车` : '已加入房间，等待房主发车',
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
  if ((kind === 'join' || kind === 'spectate') && ui.roomCode.value.trim().length !== 6) {
    setOnlineStatus('请输入 6 位房间码', 'error');
    ui.roomCode.focus();
    return;
  }
  setOnlineBusy(true);
  setOnlineStatus(
    kind === 'create' ? '正在创建房间…' : kind === 'quick' ? '正在按段位匹配车手…' : '正在加入房间…',
  );
  try {
    const room = kind === 'create'
      ? await client.createRoom({ name, map: selectedTrack, raceMode: selectedMode === 'kart' ? 'kart' : 'race', trackVariant: preferences.trackVariant, password: ui.roomPassword.value })
      : kind === 'quick'
        ? await client.quickMatch({ name, raceMode: selectedMode === 'kart' ? 'kart' : 'race' })
        : await client.joinRoom({ name, code: ui.roomCode.value, password: ui.roomPassword.value, spectator: kind === 'spectate' });
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
  window.__NEON_APEX_TRACK_VARIANT__ = preferences.trackVariant;
  window.__NEON_APEX_RACE_MODE__ = selectedMode;
  window.__NEON_APEX_ONLINE__ = online ? multiplayer : null;
  preferences = savePreferences({ ...preferences, lastMode: selectedMode, lastTrack: selectedTrack });
  ui.settingsMenu.hidden = true;
  ui.multiplayerMenu.hidden = true;
  ui.accountMenu.hidden = true;
  ui.startRace.disabled = true;
  ui.loading.style.display = 'flex';
  ui.loading.classList.remove('done');
  ui.loading.querySelector('p').textContent = '幻境飞车';
  ui.loading.querySelector('small').textContent = TRACK_CATALOG[selectedTrack].loading;
  document.body.classList.add('game-loading');

  try {
    await import('./main.js');
    bootstrapActive = false;
    ui.startRace.disabled = false;
  } catch (error) {
    console.error('Unable to load Neon Apex runtime.', error);
    recordHandled(error, '赛道加载失败');
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
ui.quickMatch?.addEventListener('click', () => connectOnline('quick'));
ui.joinRoom.addEventListener('click', () => connectOnline('join'));
ui.spectateRoom.addEventListener('click', () => connectOnline('spectate'));
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
ui.openShop?.addEventListener('click', () => shopUi.open());
ui.openAchievements?.addEventListener('click', () => achievementsUi.open());
ui.openChallenges?.addEventListener('click', () => setChallengesVisible(true));
ui.closeChallenges?.addEventListener('click', () => setChallengesVisible(false));
ui.openLeaderboard?.addEventListener('click', () => setLeaderboardVisible(true));
ui.closeLeaderboard?.addEventListener('click', () => setLeaderboardVisible(false));
ui.openAccount.addEventListener('click', () => setAccountVisible(true));
ui.openAccountAction.addEventListener('click', () => setAccountVisible(true));
ui.closeAccount.addEventListener('click', () => setAccountVisible(false));
for (const button of ui.accountTabs.querySelectorAll('[data-auth-mode]')) {
  button.addEventListener('click', () => setAccountMode(button.dataset.authMode));
}
ui.accountForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitAccount();
});
ui.accountLogout.addEventListener('click', () => signOutAccount());
ui.soundEnabled.addEventListener('change', () => applyPreferences({ soundEnabled: ui.soundEnabled.checked }));
ui.masterVolume.addEventListener('input', () => applyPreferences({ masterVolume: Number(ui.masterVolume.value) }));
ui.musicEnabled.addEventListener('change', () => applyPreferences({ musicEnabled: ui.musicEnabled.checked }));
ui.musicVolume.addEventListener('input', () => applyPreferences({ musicVolume: Number(ui.musicVolume.value) }));
ui.voiceEnabled.addEventListener('change', () => applyPreferences({ voiceEnabled: ui.voiceEnabled.checked }));
ui.voicePack.addEventListener('change', () => applyPreferences({ voicePack: ui.voicePack.value }));
ui.ghostEnabled.addEventListener('change', () => applyPreferences({ ghostEnabled: ui.ghostEnabled.checked }));
ui.difficultySetting.addEventListener('change', () => applyPreferences({ difficulty: ui.difficultySetting.value }));
ui.trackVariantSetting.addEventListener('change', () => applyPreferences({ trackVariant: ui.trackVariantSetting.value }));
ui.touchLayoutSetting.addEventListener('change', () => applyPreferences({ touchLayout: ui.touchLayoutSetting.value }));
ui.touchOpacitySetting.addEventListener('input', () => applyPreferences({ touchOpacity: Number(ui.touchOpacitySetting.value) }));
ui.qualitySetting.addEventListener('change', () => applyPreferences({ quality: ui.qualitySetting.value }));
ui.vibrationEnabled.addEventListener('change', () => applyPreferences({ vibration: ui.vibrationEnabled.checked }));
ui.cameraShakeEnabled.addEventListener('change', () => applyPreferences({ cameraShake: ui.cameraShakeEnabled.checked }));
window.addEventListener('keydown', (event) => {
  if (!ui.accountMenu.hidden) {
    if (event.code === 'Escape') setAccountVisible(false);
    return;
  }
  if (!bootstrapActive) return;
  if (shopUi.visible) {
    if (event.code === 'Escape') shopUi.close();
    return;
  }
  if (achievementsUi.visible) {
    if (event.code === 'Escape') achievementsUi.close();
    return;
  }
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
  if (!ui.accountMenu.hidden) {
    setAccountVisible(false);
    return true;
  }
  if (!bootstrapActive) return false;
  if (shopUi.visible) {
    shopUi.close();
    return true;
  }
  if (achievementsUi.visible) {
    achievementsUi.close();
    return true;
  }
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
refreshAccount();
Object.defineProperty(window, '__NEON_APEX_ACCOUNT__', {
  configurable: true,
  get: () => accountUser ? { ...accountUser } : null,
});

import {
  ACHIEVEMENTS,
  achievementProgress,
  listAchievements,
  loadAchievementState,
} from './achievements.js';

/**
 * Read-only achievements panel shared by the bootstrap home screen and the
 * in-game home screen. Unlocking happens at race end; this only renders it.
 */
export function createAchievementsUi({ getState } = {}) {
  const ui = Object.fromEntries(
    ['achievementsMenu', 'achievementsList', 'achievementsSummary', 'achievementsCoins', 'closeAchievements']
      .map((id) => [id, document.getElementById(id)]),
  );

  const readState = () => getState?.() ?? loadAchievementState();

  function buildCard(entry) {
    const card = document.createElement('article');
    card.className = 'achievement-card';
    card.dataset.unlocked = String(Boolean(entry.unlocked));

    const badge = document.createElement('span');
    badge.className = 'achievement-badge';
    badge.textContent = entry.unlocked ? '✓' : '?';

    const name = document.createElement('strong');
    name.className = 'achievement-name';
    name.textContent = entry.name;

    const desc = document.createElement('small');
    desc.className = 'achievement-desc';
    desc.textContent = entry.desc ?? '';

    const meter = document.createElement('span');
    meter.className = 'achievement-meter';
    const fill = document.createElement('i');
    fill.style.setProperty('--ratio', String(Math.min(1, Math.max(0, entry.ratio ?? 0))));
    meter.append(fill);

    const reward = document.createElement('span');
    reward.className = 'achievement-reward';
    reward.textContent = `+${entry.coinReward ?? 0}`;

    card.append(badge, name, desc, meter, reward);
    if (!entry.unlocked && entry.target > 1) {
      desc.textContent = `${entry.desc ?? ''}（${Math.floor(entry.current ?? 0)} / ${entry.target}）`;
    }
    return card;
  }

  function render() {
    const state = readState();
    const entries = typeof listAchievements === 'function'
      ? listAchievements(state)
      : ACHIEVEMENTS.map((item) => ({ ...item, ...achievementProgress(state, item.id) }));
    const unlocked = entries.filter((entry) => entry.unlocked).length;
    const earned = entries.reduce((total, entry) => total + (entry.unlocked ? entry.coinReward ?? 0 : 0), 0);
    if (ui.achievementsSummary) ui.achievementsSummary.textContent = `已解锁 ${unlocked} / ${entries.length}`;
    if (ui.achievementsCoins) ui.achievementsCoins.textContent = Number(earned).toLocaleString('en-US');
    if (ui.achievementsList) ui.achievementsList.replaceChildren(...entries.map(buildCard));
  }

  function setVisible(visible) {
    if (!ui.achievementsMenu) return;
    ui.achievementsMenu.hidden = !visible;
    if (visible) render();
  }

  ui.closeAchievements?.addEventListener('click', () => setVisible(false));

  return {
    render,
    open: () => setVisible(true),
    close: () => setVisible(false),
    get visible() { return Boolean(ui.achievementsMenu && !ui.achievementsMenu.hidden); },
  };
}

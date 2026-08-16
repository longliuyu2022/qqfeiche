import {
  SHOP_ITEMS,
  equip,
  getItemById,
  isOwned,
  itemsByCategory,
  purchase,
} from './shop.js';
import { getWalletSync } from './wallet-sync.js';
import { getCarById } from './car-catalog.js';

const CATEGORY_LABELS = Object.freeze({
  car: '车辆',
  paint: '车漆',
  decal: '贴花',
  wheel: '轮毂',
  spoiler: '尾翼',
  horn: '喇叭',
});

const CATEGORY_EMPTY = Object.freeze({
  car: '暂无可购买的车辆',
  paint: '暂无可购买的车漆',
  decal: '暂无可购买的贴花',
  wheel: '暂无可购买的轮毂',
  spoiler: '暂无可购买的尾翼',
  horn: '暂无可购买的喇叭',
});

function formatCoins(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function actionLabel(item, wallet) {
  const owned = isOwned(wallet, item.id);
  if (!owned) return item.price <= 0 ? '获取' : `购买 ${formatCoins(item.price)}`;
  if (item.category === 'car') return '已拥有';
  const equipped = wallet.equipped?.[item.category] === item.id;
  return equipped ? '已装备' : '装备';
}

/**
 * Shared store front for the home screen. Both the lightweight bootstrap menu
 * and the in-game home screen mount this so the two entry points stay in sync.
 *
 * `onChange(wallet)` fires whenever the wallet is mutated so the caller can
 * refresh coin counters, the garage lock state and anything else it owns.
 */
export function createShopUi({ onChange, getWallet, setWallet } = {}) {
  const ui = Object.fromEntries(
    ['shopMenu', 'shopCoins', 'shopTabs', 'shopGrid', 'shopStatus', 'closeShop', 'openShop']
      .map((id) => [id, document.getElementById(id)]),
  );
  let category = 'car';
  let statusTimer = 0;

  const readWallet = () => getWallet?.() ?? getWalletSync().read();
  const writeWallet = (wallet) => {
    // 落本地并排队同步到账号，登录时购买/装备才能跨设备生效。
    getWalletSync().persist(wallet);
    setWallet?.(wallet);
    onChange?.(wallet);
  };

  function setStatus(message, tone = '') {
    if (!ui.shopStatus) return;
    ui.shopStatus.textContent = message;
    ui.shopStatus.dataset.tone = tone;
    clearTimeout(statusTimer);
    if (message) statusTimer = setTimeout(() => { ui.shopStatus.textContent = ''; ui.shopStatus.dataset.tone = ''; }, 2600);
  }

  function buildCard(item, wallet) {
    const owned = isOwned(wallet, item.id);
    const equipped = wallet.equipped?.[item.category] === item.id;
    const card = document.createElement('article');
    card.className = 'shop-card';
    card.dataset.owned = String(owned);
    card.dataset.equipped = String(equipped);
    card.dataset.category = item.category;
    card.dataset.item = item.id;

    const art = document.createElement('span');
    art.className = 'shop-card-art';
    // Car entries carry a catalog id as payload, so their livery comes from the
    // car catalog; paints and decals carry their colours inline.
    const colors = item.category === 'car'
      ? (() => {
        const car = getCarById(item.payload ?? item.id);
        return { color: car.color, accent: car.accentColor };
      })()
      : { color: item.payload?.color, accent: item.payload?.accentColor ?? item.payload?.color };
    art.style.setProperty('--item-color', colors.color ?? '#35e7ff');
    art.style.setProperty('--item-accent', colors.accent ?? '#a8f7ff');
    if (item.category === 'car') art.dataset.car = item.payload ?? item.id;
    if (item.category === 'decal') art.dataset.pattern = item.payload?.pattern ?? 'stripe';

    const name = document.createElement('strong');
    name.className = 'shop-card-name';
    name.textContent = item.name;

    const desc = document.createElement('small');
    desc.className = 'shop-card-desc';
    desc.textContent = item.desc ?? '';

    const price = document.createElement('span');
    price.className = 'shop-card-price';
    if (item.price > 0) {
      price.append(document.createElement('i'), document.createTextNode(formatCoins(item.price)));
    } else {
      // Starter kit: no price tag, just say it ships with the account.
      price.dataset.free = 'true';
      price.textContent = '初始赠送';
    }

    const action = document.createElement('button');
    action.className = 'shop-card-action';
    action.type = 'button';
    action.textContent = actionLabel(item, wallet);
    action.disabled = owned && item.category === 'car';
    action.addEventListener('click', () => handleAction(item));

    card.append(art, name, desc, price, action);
    return card;
  }

  function handleAction(item) {
    const wallet = readWallet();
    if (!isOwned(wallet, item.id)) {
      const result = purchase(wallet, item.id, Date.now());
      if (!result.ok) {
        setStatus(
          result.reason === 'insufficient'
            ? `金币不足，还差 ${formatCoins(item.price - wallet.coins)}`
            : result.reason === 'owned' ? '已经拥有该商品' : '该商品暂不可用',
          'error',
        );
        return;
      }
      writeWallet(result.wallet);
      setStatus(`已购买 ${item.name}`, 'success');
      render();
      return;
    }
    if (item.category === 'car') {
      setStatus('在首页车库中选择该车辆', '');
      return;
    }
    const result = equip(wallet, item.id);
    if (!result.ok) {
      setStatus('无法装备该商品', 'error');
      return;
    }
    writeWallet(result.wallet);
    const nowEquipped = result.wallet.equipped?.[item.category] === item.id;
    setStatus(nowEquipped ? `已装备 ${item.name}` : `已卸下 ${item.name}`, 'success');
    render();
  }

  function render() {
    const wallet = readWallet();
    if (ui.shopCoins) ui.shopCoins.textContent = formatCoins(wallet.coins);
    for (const button of ui.shopTabs?.querySelectorAll('[data-shop-tab]') ?? []) {
      const selected = button.dataset.shopTab === category;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    }
    if (!ui.shopGrid) return;
    const items = itemsByCategory(category);
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'shop-empty';
      empty.textContent = CATEGORY_EMPTY[category] ?? '暂无商品';
      ui.shopGrid.replaceChildren(empty);
      return;
    }
    ui.shopGrid.replaceChildren(...items.map((item) => buildCard(item, wallet)));
  }

  function setVisible(visible) {
    if (!ui.shopMenu) return;
    ui.shopMenu.hidden = !visible;
    if (visible) {
      setStatus('');
      render();
    }
  }

  for (const button of ui.shopTabs?.querySelectorAll('[data-shop-tab]') ?? []) {
    button.addEventListener('click', () => {
      const next = button.dataset.shopTab;
      if (!CATEGORY_LABELS[next] || next === category) return;
      category = next;
      render();
    });
  }
  ui.closeShop?.addEventListener('click', () => setVisible(false));

  return {
    render,
    open: () => setVisible(true),
    close: () => setVisible(false),
    get visible() { return Boolean(ui.shopMenu && !ui.shopMenu.hidden); },
    get element() { return ui.shopMenu; },
  };
}

export { SHOP_ITEMS, getItemById };

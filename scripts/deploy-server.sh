#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ROOT="/opt/neon-apex/multiplayer"
TARGET_DIR="${TARGET_ROOT}/current"
RELEASE_DIR="${TARGET_ROOT}/releases"
DATA_DIR="${TARGET_ROOT}/data"
SYSTEMD_DROPIN_DIR="/etc/systemd/system/neon-apex-multiplayer.service.d"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${TARGET_ROOT}"
STAGE_DIR="$(mktemp -d "${TARGET_ROOT}/stage-${STAMP}.XXXXXX")"
BACKUP_DIR=""
ACTIVATED=0

rollback() {
  local exit_code=$?
  if [[ ${exit_code} -ne 0 && ${ACTIVATED} -eq 1 && -n "${BACKUP_DIR}" && -d "${BACKUP_DIR}" ]]; then
    mv "${TARGET_DIR}" "${RELEASE_DIR}/${STAMP}-failed"
    mv "${BACKUP_DIR}" "${TARGET_DIR}"
    systemctl restart neon-apex-multiplayer.service || true
  fi
  if [[ -d "${STAGE_DIR}" ]]; then
    rm -rf -- "${STAGE_DIR}"
  fi
  exit "${exit_code}"
}
trap rollback EXIT

install -m 0644 "${PROJECT_DIR}/server/index.mjs" "${STAGE_DIR}/index.mjs"
install -m 0644 "${PROJECT_DIR}/server/auth-store.mjs" "${STAGE_DIR}/auth-store.mjs"
install -m 0644 "${PROJECT_DIR}/server/race-validation.mjs" "${STAGE_DIR}/race-validation.mjs"
install -m 0644 "${PROJECT_DIR}/server/race-routes.mjs" "${STAGE_DIR}/race-routes.mjs"
install -m 0644 "${PROJECT_DIR}/server/race-routes.json" "${STAGE_DIR}/race-routes.json"
install -m 0644 "${PROJECT_DIR}/server/ranked-store.mjs" "${STAGE_DIR}/ranked-store.mjs"
install -m 0644 "${PROJECT_DIR}/server/wallet-store.mjs" "${STAGE_DIR}/wallet-store.mjs"
sed "s|'./shop.js'|'./shop-catalog.mjs'|" "${PROJECT_DIR}/src/wallet-operations.js" > "${STAGE_DIR}/wallet-operations.mjs"
# The release directory is flat, so `../src/` is unreachable there. Stage the
# shared rank rules and shop catalog under the names the server imports
# (see server/ranked-rules.mjs and server/shop-catalog.mjs).
install -m 0644 "${PROJECT_DIR}/src/ranked.js" "${STAGE_DIR}/ranked-rules.mjs"
install -m 0644 "${PROJECT_DIR}/src/shop.js" "${STAGE_DIR}/shop-catalog.mjs"
install -m 0644 "${PROJECT_DIR}/src/race-rules.js" "${STAGE_DIR}/race-rules.js"
install -m 0644 "${PROJECT_DIR}/server/package.json" "${STAGE_DIR}/package.json"
install -m 0644 "${PROJECT_DIR}/server/package-lock.json" "${STAGE_DIR}/package-lock.json"
npm ci --omit=dev --ignore-scripts --prefix "${STAGE_DIR}"
node --check "${STAGE_DIR}/index.mjs"
node --check "${STAGE_DIR}/auth-store.mjs"
node --check "${STAGE_DIR}/race-validation.mjs"
node --check "${STAGE_DIR}/ranked-store.mjs"
node --check "${STAGE_DIR}/wallet-store.mjs"
node --check "${STAGE_DIR}/ranked-rules.mjs"
node --check "${STAGE_DIR}/shop-catalog.mjs"
node --check "${STAGE_DIR}/race-rules.js"
# Resolve the full import graph before switching: `node --check` only parses,
# it would not have caught the missing ranked-store module that broke a deploy.
node --input-type=module --eval "
  import { createRankedStore } from '${STAGE_DIR}/ranked-store.mjs';
  import { createAuthStore } from '${STAGE_DIR}/auth-store.mjs';
  import { createWalletStore } from '${STAGE_DIR}/wallet-store.mjs';
  import { validateRaceState } from '${STAGE_DIR}/race-validation.mjs';
  import { onlineRaceReward } from '${STAGE_DIR}/shop-catalog.mjs';
  if (typeof createRankedStore !== 'function' || typeof createAuthStore !== 'function' || typeof validateRaceState !== 'function') {
    throw new Error('staged multiplayer modules are incomplete');
  }
  if (typeof createWalletStore !== 'function') {
    throw new Error('staged wallet store is incomplete');
  }
  // 联机赛的金币结算依赖它；漏掉就会静默地不发钱。
  if (typeof onlineRaceReward !== 'function') {
    throw new Error('staged shop catalog is missing onlineRaceReward');
  }
  const store = createWalletStore({ filePath: '/tmp/neon-apex-deploy-check-wallets.json', flushIntervalMs: 0 });
  if (typeof store.credit !== 'function') {
    throw new Error('staged wallet store cannot credit online rewards');
  }
  store.close();
"
rm -f /tmp/neon-apex-deploy-check-wallets.json
chmod 0755 "${STAGE_DIR}"

# Account, rank and wallet data must survive atomic release swaps. The systemd
# service uses ProtectSystem=strict, so explicitly grant its www-data process
# access to this one persistent directory and nowhere else under /opt. Without
# NEON_APEX_WALLET_FILE the store would default inside the release directory,
# where writes are blocked and every deploy would discard the wallets.
mkdir -p "${DATA_DIR}" "${SYSTEMD_DROPIN_DIR}"
if [[ ! -e "${DATA_DIR}/ranked.json" && -s "${TARGET_DIR}/data/ranked.json" ]]; then
  install -m 0600 "${TARGET_DIR}/data/ranked.json" "${DATA_DIR}/ranked.json"
fi
chown -R www-data:www-data "${DATA_DIR}"
chmod 0750 "${DATA_DIR}"
cat > "${SYSTEMD_DROPIN_DIR}/storage.conf" <<EOF
[Service]
Environment=NEON_APEX_RANK_FILE=${DATA_DIR}/ranked.json
Environment=NEON_APEX_AUTH_FILE=${DATA_DIR}/accounts.json
Environment=NEON_APEX_WALLET_FILE=${DATA_DIR}/wallets.json
ReadWritePaths=${DATA_DIR}
EOF
systemctl daemon-reload

mkdir -p "${RELEASE_DIR}"
if [[ -d "${TARGET_DIR}" ]]; then
  BACKUP_DIR="${RELEASE_DIR}/${STAMP}"
  mv "${TARGET_DIR}" "${BACKUP_DIR}"
fi
mv "${STAGE_DIR}" "${TARGET_DIR}"
ACTIVATED=1

systemctl restart neon-apex-multiplayer.service
for attempt in 1 2 3 4 5; do
  if curl --fail --silent --show-error "http://127.0.0.1:3010/multiplayer/healthz" | grep -q '"status":"ok"'; then
    echo "Deployed multiplayer server ${STAMP}"
    trap - EXIT
    exit 0
  fi
  sleep 2
done

echo "Multiplayer health check failed" >&2
exit 1

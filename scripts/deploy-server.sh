#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ROOT="/opt/neon-apex/multiplayer"
TARGET_DIR="${TARGET_ROOT}/current"
RELEASE_DIR="${TARGET_ROOT}/releases"
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
install -m 0644 "${PROJECT_DIR}/server/race-validation.mjs" "${STAGE_DIR}/race-validation.mjs"
install -m 0644 "${PROJECT_DIR}/server/package.json" "${STAGE_DIR}/package.json"
install -m 0644 "${PROJECT_DIR}/server/package-lock.json" "${STAGE_DIR}/package-lock.json"
npm ci --omit=dev --ignore-scripts --prefix "${STAGE_DIR}"
node --check "${STAGE_DIR}/index.mjs"
node --check "${STAGE_DIR}/race-validation.mjs"
chmod 0755 "${STAGE_DIR}"

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

#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ROOT="/opt/neon-apex"
TARGET_DIR="${TARGET_ROOT}/dist"
RELEASE_DIR="${TARGET_ROOT}/releases"
SITE_URL="${SITE_URL:-https://gaokao.aiimage.icu}"
SITE_HTTP_URL="${SITE_HTTP_URL:-${SITE_URL/https:/http:}}"
REQUEST_INTERVAL_SECONDS="${REQUEST_INTERVAL_SECONDS:-13}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAGE_DIR="$(mktemp -d "${TARGET_ROOT}/deploy-${STAMP}.XXXXXX")"
VERIFY_DIR="$(mktemp -d "/tmp/neon-apex-verify-${STAMP}.XXXXXX")"
BACKUP_DIR=""
ACTIVATED=0
LAST_REQUEST_AT=0

limited_curl() {
  local attempt now wait_seconds exit_code=1
  for attempt in 1 2 3 4 5; do
    now="$(date +%s)"
    wait_seconds=$((LAST_REQUEST_AT + REQUEST_INTERVAL_SECONDS - now))
    if (( LAST_REQUEST_AT > 0 && wait_seconds > 0 )); then
      sleep "${wait_seconds}"
    fi
    if curl --retry 0 "$@"; then
      LAST_REQUEST_AT="$(date +%s)"
      return 0
    else
      exit_code=$?
      LAST_REQUEST_AT="$(date +%s)"
    fi
  done
  return "${exit_code}"
}

rollback() {
  local exit_code=$?
  if [[ ${exit_code} -ne 0 && ${ACTIVATED} -eq 1 && -n "${BACKUP_DIR}" && -d "${BACKUP_DIR}" ]]; then
    mv "${TARGET_DIR}" "${RELEASE_DIR}/${STAMP}-failed"
    mv "${BACKUP_DIR}" "${TARGET_DIR}"
    echo "Deployment failed; restored the previous release at ${TARGET_DIR}." >&2
  fi
  if [[ -d "${STAGE_DIR}" ]]; then
    rm -rf -- "${STAGE_DIR}"
  fi
  if [[ -d "${VERIFY_DIR}" ]]; then
    rm -rf -- "${VERIFY_DIR}"
  fi
  exit "${exit_code}"
}
trap rollback EXIT

cd "${PROJECT_DIR}"
npm run build

test -s dist/index.html
test -s dist/assets/CarConcept.glb
JS_FILE="$(find dist/assets -maxdepth 1 -type f -name 'index-*.js' -size +100c -print -quit)"
CSS_FILE="$(find dist/assets -maxdepth 1 -type f -name 'index-*.css' -size +100c -print -quit)"
PBR_FILE="$(find dist/assets/environment -type f -name '*.jpg' -size +100c -print -quit)"
HDRI_FILE="$(find dist/assets/environment -type f -name '*.hdr' -size +100c -print -quit)"
test -n "${JS_FILE}"
test -n "${CSS_FILE}"
test -n "${PBR_FILE}"
test -n "${HDRI_FILE}"

cp -a dist/. "${STAGE_DIR}/"
APK_FILE="${PROJECT_DIR}/artifacts/apk/neon-apex-release.apk"
AAB_FILE="${PROJECT_DIR}/artifacts/aab/neon-apex-release.aab"
if [[ -s "${APK_FILE}" ]]; then
  mkdir -p "${STAGE_DIR}/downloads"
  cp -f "${APK_FILE}" "${STAGE_DIR}/downloads/neon-apex-release.apk"
fi
if [[ -s "${AAB_FILE}" ]]; then
  mkdir -p "${STAGE_DIR}/downloads"
  cp -f "${AAB_FILE}" "${STAGE_DIR}/downloads/neon-apex-release.aab"
fi
mkdir -p "${STAGE_DIR}/.well-known"
cat > "${STAGE_DIR}/.well-known/neon-apex-health.json" <<EOF
{"status":"ok","build":"${STAMP}"}
EOF

caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
mkdir -p "${RELEASE_DIR}"
if [[ -d "${TARGET_DIR}" ]]; then
  BACKUP_DIR="${RELEASE_DIR}/${STAMP}"
  mv "${TARGET_DIR}" "${BACKUP_DIR}"
fi
mv "${STAGE_DIR}" "${TARGET_DIR}"
ACTIVATED=1

REMOTE_INDEX="${VERIFY_DIR}/index.html"
limited_curl --fail --silent --show-error "${SITE_URL}/" --output "${REMOTE_INDEX}"
grep -q 'NEON APEX' "${REMOTE_INDEX}"
HTTP_RESULT_FILE="${VERIFY_DIR}/http-result.txt"
limited_curl --fail --silent --show-error --head --max-time 15 --write-out '%{http_code} %{redirect_url}' --output /dev/null "${SITE_HTTP_URL}/" > "${HTTP_RESULT_FILE}"
HTTP_RESULT="$(<"${HTTP_RESULT_FILE}")"
[[ "${HTTP_RESULT}" == 3*" ${SITE_URL}/" ]]

for LOCAL_FILE in "${JS_FILE}" "${CSS_FILE}" "${PBR_FILE}" "${HDRI_FILE}" "dist/assets/CarConcept.glb"; do
  REMOTE_PATH="${LOCAL_FILE#dist}"
  DOWNLOAD_FILE="${VERIFY_DIR}/$(basename "${LOCAL_FILE}")"
  limited_curl --fail --silent --show-error "${SITE_URL}${REMOTE_PATH}" --output "${DOWNLOAD_FILE}"
  cmp --silent "${LOCAL_FILE}" "${DOWNLOAD_FILE}"
done

REMOTE_HEALTH="${VERIFY_DIR}/health.json"
limited_curl --fail --silent --show-error "${SITE_URL}/.well-known/neon-apex-health.json" --output "${REMOTE_HEALTH}"
grep -q "${STAMP}" "${REMOTE_HEALTH}"
if [[ -s "${APK_FILE}" ]]; then
  REMOTE_APK="${VERIFY_DIR}/neon-apex-release.apk"
  limited_curl --fail --silent --show-error "${SITE_URL}/downloads/neon-apex-release.apk" --output "${REMOTE_APK}"
  cmp --silent "${APK_FILE}" "${REMOTE_APK}"
fi
if [[ -s "${AAB_FILE}" ]]; then
  REMOTE_AAB="${VERIFY_DIR}/neon-apex-release.aab"
  limited_curl --fail --silent --show-error "${SITE_URL}/downloads/neon-apex-release.aab" --output "${REMOTE_AAB}"
  cmp --silent "${AAB_FILE}" "${REMOTE_AAB}"
fi
REMOTE_DEEP_LINK="${VERIFY_DIR}/deep-link.html"
limited_curl --fail --silent --show-error "${SITE_URL}/race/deep-link-check" --output "${REMOTE_DEEP_LINK}"
grep -q 'NEON APEX' "${REMOTE_DEEP_LINK}"

echo "Deployed ${STAMP} to ${SITE_URL}"
rm -rf -- "${VERIFY_DIR}"
trap - EXIT

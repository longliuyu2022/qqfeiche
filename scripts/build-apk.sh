#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_HOME_DIR="${ANDROID_HOME:-${PROJECT_DIR}/.android-sdk}"
GRADLE_VERSION="8.9"
GRADLE_DIR="${PROJECT_DIR}/.gradle-dist/gradle-${GRADLE_VERSION}"
GRADLE_ZIP="${PROJECT_DIR}/.gradle-dist/gradle-${GRADLE_VERSION}-bin.zip"

cd "${PROJECT_DIR}"
npm run build

if [[ ! -x "${GRADLE_DIR}/bin/gradle" ]]; then
  mkdir -p "${PROJECT_DIR}/.gradle-dist"
  if [[ ! -s "${GRADLE_ZIP}" ]]; then
    curl --fail --location --retry 3 --output "${GRADLE_ZIP}" "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip"
  fi
  unzip -q -o "${GRADLE_ZIP}" -d "${PROJECT_DIR}/.gradle-dist"
fi

ASSET_DIR="${PROJECT_DIR}/android/app/src/main/assets"
mkdir -p "${ASSET_DIR}"
find "${ASSET_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -a "${PROJECT_DIR}/dist/." "${ASSET_DIR}/"

ANDROID_HOME="${ANDROID_HOME_DIR}" "${GRADLE_DIR}/bin/gradle" --no-daemon --stacktrace -p android assembleRelease bundleRelease
mkdir -p "${PROJECT_DIR}/artifacts/apk"
mkdir -p "${PROJECT_DIR}/artifacts/aab"
APK_SOURCE="${PROJECT_DIR}/android/app/build/outputs/apk/release/app-release.apk"
test -s "${APK_SOURCE}"
cp -f "${APK_SOURCE}" "${PROJECT_DIR}/artifacts/apk/neon-apex-release.apk"
AAB_SOURCE="${PROJECT_DIR}/android/app/build/outputs/bundle/release/app-release.aab"
test -s "${AAB_SOURCE}"
cp -f "${AAB_SOURCE}" "${PROJECT_DIR}/artifacts/aab/neon-apex-release.aab"
APKSIGNER="${ANDROID_HOME_DIR}/build-tools/35.0.0/apksigner"
test -x "${APKSIGNER}"
"${APKSIGNER}" verify --verbose --print-certs "${PROJECT_DIR}/artifacts/apk/neon-apex-release.apk"
jarsigner -verify "${PROJECT_DIR}/artifacts/aab/neon-apex-release.aab"
sha256sum \
  "${PROJECT_DIR}/artifacts/apk/neon-apex-release.apk" \
  "${PROJECT_DIR}/artifacts/aab/neon-apex-release.aab"

#!/usr/bin/env bash
set -Eeuo pipefail

# 部署前门禁：在执行 npm run deploy / deploy:server / build-apk 之前跑一遍。
# 任一必检项失败即以非零码退出，并打印中文原因。
#
# 用法：
#   bash scripts/preflight.sh                  # 全量检查（含 npm test 与生产构建）
#   bash scripts/preflight.sh --skip-tests     # 只做静态检查（跳过测试与构建）
#   bash scripts/preflight.sh --allow-dirty    # 允许工作区存在未提交改动
#   bash scripts/preflight.sh --skip-tests --allow-dirty

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_TESTS=0
ALLOW_DIRTY=0
REQUIRED_NODE_MAJOR=20
WARNINGS=0

if [[ -t 1 ]]; then
  COLOR_GREEN=$'\033[32m'
  COLOR_RED=$'\033[31m'
  COLOR_YELLOW=$'\033[33m'
  COLOR_RESET=$'\033[0m'
else
  COLOR_GREEN=''
  COLOR_RED=''
  COLOR_YELLOW=''
  COLOR_RESET=''
fi

usage() {
  cat <<'EOF'
用法：bash scripts/preflight.sh [--skip-tests] [--allow-dirty]

  --skip-tests    跳过 npm test 与生产构建，只做静态检查（Node 版本、工作区、版本号一致性）
  --allow-dirty   允许工作区存在未提交改动
  -h, --help      显示本帮助
EOF
}

for ARG in "$@"; do
  case "${ARG}" in
    --skip-tests) SKIP_TESTS=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "${COLOR_RED}未知参数：${ARG}${COLOR_RESET}" >&2
      usage >&2
      exit 2
      ;;
  esac
done

step() {
  echo
  echo "==> $1"
}

fail() {
  echo "${COLOR_RED}✗ $1${COLOR_RESET}" >&2
  exit 1
}

pass() {
  echo "${COLOR_GREEN}✓ $1${COLOR_RESET}"
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  echo "${COLOR_YELLOW}! $1${COLOR_RESET}" >&2
}

on_error() {
  local exit_code=$?
  echo "${COLOR_RED}✗ 预检在第 ${BASH_LINENO[0]} 行中断（退出码 ${exit_code}）${COLOR_RESET}" >&2
  exit "${exit_code}"
}
trap on_error ERR

cd "${PROJECT_DIR}"

echo "Neon Apex 部署前预检"
echo "项目目录：${PROJECT_DIR}"
if (( SKIP_TESTS )); then
  echo "模式：仅静态检查（--skip-tests）"
fi
if (( ALLOW_DIRTY )); then
  echo "模式：允许脏工作区（--allow-dirty）"
fi

# 1. Node 版本 >= 20
step "1/7 检查 Node.js 版本（要求 >= ${REQUIRED_NODE_MAJOR}）"
if ! command -v node >/dev/null 2>&1; then
  fail "未找到 node，可执行文件不在 PATH 中。请安装 Node.js ${REQUIRED_NODE_MAJOR} 或更高版本。"
fi
NODE_VERSION="$(node --version)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if [[ ! "${NODE_MAJOR}" =~ ^[0-9]+$ ]]; then
  fail "无法解析 Node.js 版本号：${NODE_VERSION}"
fi
if (( NODE_MAJOR < REQUIRED_NODE_MAJOR )); then
  fail "Node.js 版本过低：当前 ${NODE_VERSION}，要求 >= v${REQUIRED_NODE_MAJOR}.0.0。"
fi
pass "Node.js ${NODE_VERSION}"

# 2. 工作区干净
step "2/7 检查 Git 工作区是否干净"
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail "当前目录不是 Git 仓库，无法校验工作区状态。"
fi
GIT_DIRTY="$(git status --porcelain)"
if [[ -n "${GIT_DIRTY}" ]]; then
  if (( ALLOW_DIRTY )); then
    DIRTY_COUNT="$(printf '%s\n' "${GIT_DIRTY}" | wc -l | tr -d ' ')"
    warn "工作区有 ${DIRTY_COUNT} 项未提交改动，因 --allow-dirty 跳过。发布版本请先提交或清理："
    printf '%s\n' "${GIT_DIRTY}" | head -n 20 >&2
    if (( DIRTY_COUNT > 20 )); then
      echo "  …… 其余 $((DIRTY_COUNT - 20)) 项省略" >&2
    fi
  else
    echo "${COLOR_RED}未提交改动：${COLOR_RESET}" >&2
    printf '%s\n' "${GIT_DIRTY}" >&2
    fail "工作区不干净。请先提交或清理改动，或使用 --allow-dirty 跳过本项检查。"
  fi
else
  pass "工作区干净（无未提交改动）"
fi

# 3. 逻辑测试
step "3/7 运行逻辑测试（npm test）"
if (( SKIP_TESTS )); then
  warn "已按 --skip-tests 跳过 npm test"
else
  if ! npm test; then
    fail "npm test 未全绿。请修复失败用例后重试。"
  fi
  pass "npm test 全部通过"
fi

# 4. 生产构建与产物校验
step "4/7 生产构建并校验 dist 产物（npm run build）"
if (( SKIP_TESTS )); then
  warn "已按 --skip-tests 跳过生产构建与产物校验"
else
  if ! npm run build; then
    fail "npm run build 失败。"
  fi
  if [[ ! -s dist/index.html ]]; then
    fail "构建产物缺失：dist/index.html 不存在或为空。"
  fi
  BUILD_JS="$(find dist/assets -maxdepth 1 -type f -name '*.js' -size +100c -print -quit 2>/dev/null || true)"
  if [[ -z "${BUILD_JS}" ]]; then
    fail "构建产物缺失：dist/assets 下没有非空的 .js 文件。"
  fi
  BUILD_CSS="$(find dist/assets -maxdepth 1 -type f -name '*.css' -size +100c -print -quit 2>/dev/null || true)"
  if [[ -z "${BUILD_CSS}" ]]; then
    fail "构建产物缺失：dist/assets 下没有非空的 .css 文件。"
  fi
  pass "构建产物齐全：dist/index.html、${BUILD_JS}、${BUILD_CSS}"
fi

# 5. package.json version 与 Android versionName 一致
step "5/7 校验 package.json 与 android/app/build.gradle 的版本号一致"
PKG_VERSION="$(node -p "require('./package.json').version")"
if [[ -z "${PKG_VERSION}" || "${PKG_VERSION}" == "undefined" ]]; then
  fail "无法从 package.json 读取 version 字段。"
fi
GRADLE_FILE="android/app/build.gradle"
if [[ ! -f "${GRADLE_FILE}" ]]; then
  fail "找不到 ${GRADLE_FILE}，无法校验 Android 版本号。"
fi
GRADLE_VERSION="$(grep -Eo "versionName[[:space:]]+['\"][^'\"]+['\"]" "${GRADLE_FILE}" | head -n 1 | grep -Eo "['\"][^'\"]+['\"]" | tr -d "'\"" || true)"
if [[ -z "${GRADLE_VERSION}" ]]; then
  fail "无法从 ${GRADLE_FILE} 解析 versionName。"
fi
if [[ "${PKG_VERSION}" != "${GRADLE_VERSION}" ]]; then
  fail "版本号不一致：package.json version = ${PKG_VERSION}，${GRADLE_FILE} versionName = ${GRADLE_VERSION}。发布前必须同步这两处（同时记得递增 versionCode）。"
fi
pass "版本号一致：${PKG_VERSION}（package.json ↔ Android versionName）"

# 6. README「当前版本」一致（找不到只告警）
step "6/7 校验 README.md 记录的当前版本"
README_FILE="README.md"
if [[ ! -f "${README_FILE}" ]]; then
  warn "找不到 ${README_FILE}，跳过版本记录校验。"
else
  README_VERSION="$(grep -m 1 -Eo '当前版本[^`]*`v?[0-9]+\.[0-9]+\.[0-9]+`' "${README_FILE}" | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)"
  if [[ -z "${README_VERSION}" ]]; then
    warn "在 ${README_FILE} 中未找到「当前版本：\`vX.Y.Z\`」记录，跳过本项校验。"
  elif [[ "${README_VERSION}" != "${PKG_VERSION}" ]]; then
    warn "README.md 记录的当前版本为 v${README_VERSION}，与 package.json 的 ${PKG_VERSION} 不一致，请在发布说明里同步。"
  else
    pass "README.md 当前版本记录一致：v${README_VERSION}"
  fi
fi

# 7. 汇总
step "7/7 汇总"
if (( WARNINGS > 0 )); then
  echo "${COLOR_YELLOW}共 ${WARNINGS} 条告警（不阻断）。${COLOR_RESET}"
fi
echo "${COLOR_GREEN}PREFLIGHT OK v${PKG_VERSION}${COLOR_RESET}"
if (( SKIP_TESTS )); then
  echo "注意：本次为 --skip-tests 静态检查，未运行测试与构建，正式发布前请跑一次全量预检。"
fi
echo "接下来可以执行：npm run deploy（网页）／npm run deploy:server（联机服务）／bash scripts/build-apk.sh（APK 与 AAB）"

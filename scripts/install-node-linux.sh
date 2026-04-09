#!/usr/bin/env bash
set -euo pipefail

MIN_MAJOR=20
TARGET_NODE_VERSION="${TARGET_NODE_VERSION:-24}"

has_node() {
  command -v node >/dev/null 2>&1
}

node_major() {
  node -v | sed -E 's/^v([0-9]+).*/\1/'
}

if has_node; then
  CURRENT_MAJOR="$(node_major)"
  if [ "${CURRENT_MAJOR}" -ge "${MIN_MAJOR}" ]; then
    echo "Node.js is already installed (>= ${MIN_MAJOR}): $(node -v)"
    echo "Node.js 已安装且版本满足要求 (>= ${MIN_MAJOR})：$(node -v)"
    exit 0
  fi
  echo "Detected Node.js $(node -v), but version >= ${MIN_MAJOR} is required."
  echo "检测到 Node.js $(node -v)，但要求版本 >= ${MIN_MAJOR}。"
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required but not found. Please install curl first."
  echo "未找到 curl。请先安装 curl。"
  exit 1
fi

if ! command -v bash >/dev/null 2>&1; then
  echo "bash is required but not found."
  echo "未找到 bash。"
  exit 1
fi

if [ "${1:-}" = "--dry-run" ]; then
  echo "[dry-run] Would install nvm and Node.js ${TARGET_NODE_VERSION}."
  echo "[dry-run] 将安装 nvm 和 Node.js ${TARGET_NODE_VERSION}。"
  exit 0
fi

echo "Installing nvm..."
echo "正在安装 nvm..."
NVM_INSTALL_SCRIPT="$(mktemp)"
trap 'rm -f "${NVM_INSTALL_SCRIPT}"' EXIT
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh -o "${NVM_INSTALL_SCRIPT}"
bash "${NVM_INSTALL_SCRIPT}"

NVM_DIR="${HOME}/.nvm"
if [ ! -s "${NVM_DIR}/nvm.sh" ]; then
  echo "nvm installation failed: ${NVM_DIR}/nvm.sh not found."
  echo "nvm 安装失败：未找到 ${NVM_DIR}/nvm.sh。"
  exit 1
fi

# shellcheck disable=SC1090
. "${NVM_DIR}/nvm.sh"

echo "Installing Node.js ${TARGET_NODE_VERSION} via nvm..."
echo "通过 nvm 安装 Node.js ${TARGET_NODE_VERSION}..."
if ! nvm install "${TARGET_NODE_VERSION}"; then
  echo "Failed to install Node.js ${TARGET_NODE_VERSION} with nvm."
  echo "通过 nvm 安装 Node.js ${TARGET_NODE_VERSION} 失败。"
  exit 1
fi
if ! nvm alias default "${TARGET_NODE_VERSION}"; then
  echo "Failed to set default Node.js version to ${TARGET_NODE_VERSION}."
  echo "设置默认 Node.js 版本为 ${TARGET_NODE_VERSION} 失败。"
  exit 1
fi

echo "Done. Current Node.js version: $(node -v)"
echo "完成。当前 Node.js 版本：$(node -v)"

#!/usr/bin/env bash

set -euo pipefail

has_command() {
  command -v "$1" >/dev/null 2>&1
}

install_dir="${UV_INSTALL_DIR:-$HOME/.local/bin}"

if has_command uv; then
  exit 0
fi

mkdir -p "$install_dir"

echo "uv not found; bootstrapping into $install_dir..."

if has_command curl; then
  env UV_INSTALL_DIR="$install_dir" sh -c "$(curl -LsSf https://astral.sh/uv/install.sh)"
elif has_command wget; then
  env UV_INSTALL_DIR="$install_dir" sh -c "$(wget -qO- https://astral.sh/uv/install.sh)"
else
  echo "Missing required command: curl or wget"
  echo "Install curl/wget so uv can be bootstrapped automatically."
  exit 1
fi

if [[ -x "$install_dir/uv" ]]; then
  export PATH="$install_dir:$PATH"
fi

if ! has_command uv; then
  echo "uv installation finished, but \`uv\` is still not on PATH."
  echo "Add $install_dir to PATH and retry."
  exit 1
fi

echo "uv installed successfully."

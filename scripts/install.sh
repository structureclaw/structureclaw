#!/usr/bin/env bash
set -euo pipefail

MIN_NODE_MAJOR="${SCLAW_MIN_NODE_MAJOR:-20}"
BOOTSTRAP_NODE_MAJOR=24
NODE_DIST_BASE="${SCLAW_NODE_DIST_BASE:-https://nodejs.org/dist/latest-v24.x}"
NODE_INSTALL_PARENT="${SCLAW_NODE_INSTALL_PARENT:-${XDG_DATA_HOME:-$HOME/.local/share}/nodejs}"
NODE_DIST_BASE_EXPLICIT=0
if [ -n "${SCLAW_NODE_DIST_BASE:-}" ]; then
  NODE_DIST_BASE_EXPLICIT=1
fi
DEFAULT_STRUCTURECLAW_HOME="$HOME/.structureclaw"
STRUCTURECLAW_HOME="${SCLAW_DATA_DIR:-$DEFAULT_STRUCTURECLAW_HOME}"
PACKAGE_NAME="${SCLAW_PACKAGE_NAME:-@structureclaw/structureclaw}"
PACKAGE_TAG="${SCLAW_PACKAGE_TAG:-latest}"
NPM_PREFIX="${SCLAW_NPM_PREFIX:-$STRUCTURECLAW_HOME/npm-global}"
NPM_PREFIX_EXPLICIT=0
if [ -n "${SCLAW_NPM_PREFIX:-}" ]; then
  NPM_PREFIX_EXPLICIT=1
fi
RUN_DOCTOR=1
DRY_RUN=0
ASSUME_YES=0

log() {
  printf '[sclaw-install] %s\n' "$*"
}

die() {
  printf '[sclaw-install] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: scripts/install.sh [options]

Install StructureClaw for Linux/macOS users who may not have Node.js yet.

Options:
  --cn                    Use China-friendly npm and Node mirrors.
  --registry <url>        npm registry to use for the package install.
  --node-dist-base <url>  Node.js dist base, default latest-v24.x.
  --node-install-parent <dir>
                          Node.js install parent, default ~/.local/share/nodejs.
  --home <dir>            StructureClaw home, default ~/.structureclaw.
  --package <name>        npm package name, default @structureclaw/structureclaw.
  --tag <tag>             npm dist-tag/version, default latest.
  --prefix <dir>          npm global prefix, default ~/.structureclaw/npm-global.
  --skip-doctor           Do not run sclaw doctor after installing.
  --dry-run               Print commands without changing the system.
  -y, --yes               Use provided/default paths and skip interactive prompts.
  -h, --help              Show this help.

Environment overrides:
  SCLAW_DATA_DIR, SCLAW_NODE_DIST_BASE, SCLAW_NODE_INSTALL_PARENT,
  SCLAW_PACKAGE_NAME, SCLAW_PACKAGE_TAG, SCLAW_NPM_PREFIX,
  NPM_CONFIG_REGISTRY
EOF
}

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[sclaw-install] DRY RUN:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --cn)
      export NPM_CONFIG_REGISTRY="${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}"
      if [ "$NODE_DIST_BASE_EXPLICIT" -eq 0 ]; then
        NODE_DIST_BASE="https://npmmirror.com/mirrors/node/latest-v24.x"
      fi
      shift
      ;;
    --registry)
      [ "$#" -ge 2 ] || die "--registry requires a value"
      export NPM_CONFIG_REGISTRY="$2"
      shift 2
      ;;
    --node-dist-base)
      [ "$#" -ge 2 ] || die "--node-dist-base requires a value"
      NODE_DIST_BASE="$2"
      NODE_DIST_BASE_EXPLICIT=1
      shift 2
      ;;
    --node-install-parent)
      [ "$#" -ge 2 ] || die "--node-install-parent requires a value"
      NODE_INSTALL_PARENT="$2"
      shift 2
      ;;
    --home)
      [ "$#" -ge 2 ] || die "--home requires a value"
      STRUCTURECLAW_HOME="$2"
      if [ "$NPM_PREFIX_EXPLICIT" -eq 0 ]; then
        NPM_PREFIX="$STRUCTURECLAW_HOME/npm-global"
      fi
      shift 2
      ;;
    --package)
      [ "$#" -ge 2 ] || die "--package requires a value"
      PACKAGE_NAME="$2"
      shift 2
      ;;
    --tag)
      [ "$#" -ge 2 ] || die "--tag requires a value"
      PACKAGE_TAG="$2"
      shift 2
      ;;
    --prefix)
      [ "$#" -ge 2 ] || die "--prefix requires a value"
      NPM_PREFIX="$2"
      NPM_PREFIX_EXPLICIT=1
      shift 2
      ;;
    --skip-doctor)
      RUN_DOCTOR=0
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -y|--yes)
      ASSUME_YES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

export SCLAW_DATA_DIR="$STRUCTURECLAW_HOME"

refresh_structureclaw_home() {
  STRUCTURECLAW_HOME="$1"
  export SCLAW_DATA_DIR="$STRUCTURECLAW_HOME"
  if [ "$NPM_PREFIX_EXPLICIT" -eq 0 ]; then
    NPM_PREFIX="$STRUCTURECLAW_HOME/npm-global"
  fi
}

node_status() {
  if need_cmd node && need_cmd npm; then
    local version
    version="$(node -v 2>/dev/null || true)"
    if [ "$(node_major)" -ge "$MIN_NODE_MAJOR" ]; then
      printf 'found %s, will reuse existing Node.js' "$version"
      return 0
    fi
    printf 'found %s, will install bootstrap Node.js %s' "$version" "$BOOTSTRAP_NODE_MAJOR"
    return 0
  fi
  printf 'missing, will install bootstrap Node.js %s' "$BOOTSTRAP_NODE_MAJOR"
}

print_plan() {
  cat <<EOF

StructureClaw installer
======================

Node.js
  Status:       $(node_status)
  Install dir:  $NODE_INSTALL_PARENT
  Source:       $NODE_DIST_BASE

StructureClaw
  Home:         $STRUCTURECLAW_HOME
  npm prefix:   $NPM_PREFIX
  Package:      $PACKAGE_NAME@$PACKAGE_TAG
  Registry:     ${NPM_CONFIG_REGISTRY:-npm default}

Post-install
  Update PATH:  yes
  Persist home: $([ "$STRUCTURECLAW_HOME" != "$DEFAULT_STRUCTURECLAW_HOME" ] && printf 'yes' || printf 'no')
  Run doctor:   $([ "$RUN_DOCTOR" -eq 1 ] && printf 'yes' || printf 'no')

EOF
}

confirm_install_plan() {
  if [ "$DRY_RUN" -eq 1 ]; then
    print_plan
    return 0
  fi
  if [ "$ASSUME_YES" -eq 1 ]; then
    print_plan
    return 0
  fi
  if [ ! -t 0 ]; then
    print_plan
    log "No interactive terminal detected; continuing with the displayed defaults. Use --dry-run to preview only."
    return 0
  fi

  printf 'StructureClaw Home [%s]: ' "$STRUCTURECLAW_HOME"
  read -r home_reply
  if [ -n "$home_reply" ]; then
    refresh_structureclaw_home "$home_reply"
  fi

  print_plan
  printf 'Continue? [Y/n] '
  read -r reply
  case "$reply" in
    ""|Y|y|YES|Yes|yes) ;;
    *) die "Installation cancelled." ;;
  esac
}

download() {
  local url="$1"
  local output="$2"
  if need_cmd curl; then
    run curl -fsSL --proto '=https' --tlsv1.2 "$url" -o "$output"
    return 0
  fi
  if need_cmd wget; then
    run wget -q "$url" -O "$output"
    return 0
  fi
  die "curl or wget is required to download Node.js"
}

verify_sha256() {
  local sums_file="$1"
  local archive="$2"
  local archive_path="$3"
  local expected
  expected="$(awk -v name="$archive" '$2 == name { print $1; exit }' "$sums_file")"
  [ -n "$expected" ] || die "Could not find checksum for $archive"

  if need_cmd sha256sum; then
    (cd "$(dirname "$archive_path")" && printf '%s  %s\n' "$expected" "$(basename "$archive_path")" | sha256sum -c - >/dev/null)
    return 0
  fi
  if need_cmd shasum; then
    (cd "$(dirname "$archive_path")" && printf '%s  %s\n' "$expected" "$(basename "$archive_path")" | shasum -a 256 -c - >/dev/null)
    return 0
  fi

  die "sha256sum or shasum is required to verify Node.js downloads"
}

node_major() {
  node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || printf '0'
}

detect_node_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'x64' ;;
    aarch64|arm64) printf 'arm64' ;;
    *) die "Unsupported CPU architecture: $(uname -m)" ;;
  esac
}

ensure_node() {
  if need_cmd node && need_cmd npm && [ "$(node_major)" -ge "$MIN_NODE_MAJOR" ]; then
    log "Using existing Node.js $(node -v)"
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    log "Would install bootstrap Node.js $BOOTSTRAP_NODE_MAJOR under $NODE_INSTALL_PARENT"
    return 0
  fi

  local os_name
  os_name="$(uname -s)"
  if [ "$os_name" != "Linux" ] && [ "$os_name" != "Darwin" ]; then
    die "Unsupported OS: $os_name"
  fi

  if [ "$os_name" = "Darwin" ]; then
    if need_cmd brew; then
      log "Installing Node.js with Homebrew..."
      run brew install node@24 || run brew install node
      return 0
    fi
    die "Node.js $MIN_NODE_MAJOR+ is required on macOS. Install Homebrew or Node.js, then rerun."
  fi

  local arch sums version archive_url temp_dir archive install_root current_link
  arch="$(detect_node_arch)"
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "$temp_dir"' EXIT

  sums="$temp_dir/SHASUMS256.txt"
  log "Resolving latest Node.js 24 for linux-$arch..."
  download "$NODE_DIST_BASE/SHASUMS256.txt" "$sums"
  version="$(sed -n 's/.*  node-\(v[0-9][^ ]*\)-linux-'"$arch"'.tar.xz$/\1/p' "$sums" | head -n 1)"
  [ -n "$version" ] || die "Could not resolve Node.js version from $NODE_DIST_BASE"

  archive="node-$version-linux-$arch.tar.xz"
  archive_url="$NODE_DIST_BASE/$archive"
  install_root="$NODE_INSTALL_PARENT/$version"
  current_link="$NODE_INSTALL_PARENT/current"

  if [ ! -x "$install_root/bin/node" ]; then
    log "Installing Node.js $version to $install_root..."
    download "$archive_url" "$temp_dir/$archive"
    verify_sha256 "$sums" "$archive" "$temp_dir/$archive"
    run mkdir -p "$NODE_INSTALL_PARENT"
    run tar -xJf "$temp_dir/$archive" -C "$NODE_INSTALL_PARENT"
    run rm -rf "$install_root"
    run mv "$NODE_INSTALL_PARENT/node-$version-linux-$arch" "$install_root"
  fi

  run ln -sfn "$install_root" "$current_link"
  export PATH="$current_link/bin:$PATH"

  if ! need_cmd node || ! need_cmd npm; then
    die "Node.js installation finished, but node/npm is still unavailable"
  fi
  log "Using Node.js $(node -v)"
}

ensure_path_hint() {
  local bin_dir="$1"
  local export_line="export PATH=\"$bin_dir:\$PATH\""
  local rc_file="$HOME/.profile"

  case "${SHELL:-}" in
    */zsh) rc_file="$HOME/.zshrc" ;;
    */bash)
      if [ "$(uname -s)" = "Darwin" ]; then
        rc_file="$HOME/.bash_profile"
      else
        rc_file="$HOME/.bashrc"
      fi
      ;;
  esac

  if [ "$DRY_RUN" -eq 1 ]; then
    log "Would ensure PATH in $rc_file: $export_line"
    return 0
  fi

  mkdir -p "$(dirname "$rc_file")"
  touch "$rc_file"
  if ! grep -F "$bin_dir" "$rc_file" >/dev/null 2>&1; then
    {
      printf '\n# StructureClaw CLI\n'
      printf '%s\n' "$export_line"
    } >> "$rc_file"
    log "Added $bin_dir to PATH in $rc_file"
  fi
}

ensure_env_hint() {
  local name="$1"
  local value="$2"
  local export_line="export $name=\"$value\""
  local rc_file="$HOME/.profile"

  case "${SHELL:-}" in
    */zsh) rc_file="$HOME/.zshrc" ;;
    */bash)
      if [ "$(uname -s)" = "Darwin" ]; then
        rc_file="$HOME/.bash_profile"
      else
        rc_file="$HOME/.bashrc"
      fi
      ;;
  esac

  if [ "$DRY_RUN" -eq 1 ]; then
    log "Would ensure $name in $rc_file: $export_line"
    return 0
  fi

  mkdir -p "$(dirname "$rc_file")"
  touch "$rc_file"
  if ! grep -F "$name=" "$rc_file" >/dev/null 2>&1; then
    {
      printf '\n# StructureClaw home\n'
      printf '%s\n' "$export_line"
    } >> "$rc_file"
    log "Added $name to $rc_file"
  fi
}

confirm_install_plan
ensure_node

run mkdir -p "$NPM_PREFIX"
export NPM_CONFIG_PREFIX="$NPM_PREFIX"
export PATH="$NPM_PREFIX/bin:$PATH"

if [ -n "${NPM_CONFIG_REGISTRY:-}" ]; then
  log "Using npm registry: $NPM_CONFIG_REGISTRY"
fi

log "Installing $PACKAGE_NAME@$PACKAGE_TAG..."
run npm install -g "$PACKAGE_NAME@$PACKAGE_TAG"

if [ "$DRY_RUN" -eq 1 ]; then
  log "Dry run complete. No package was installed."
  exit 0
fi

ensure_path_hint "$NPM_PREFIX/bin"
if [ "$STRUCTURECLAW_HOME" != "$DEFAULT_STRUCTURECLAW_HOME" ]; then
  ensure_env_hint "SCLAW_DATA_DIR" "$STRUCTURECLAW_HOME"
fi

if ! need_cmd sclaw; then
  die "sclaw is not available on PATH. Add $NPM_PREFIX/bin to PATH and open a new terminal."
fi

log "Installed $(sclaw version 2>/dev/null || printf 'StructureClaw')"

if [ "$RUN_DOCTOR" -eq 1 ]; then
  log "Running sclaw doctor..."
  run sclaw doctor
else
  log "Skipped doctor. Run 'sclaw doctor' when ready."
fi

log "Done. Start StructureClaw with: sclaw start"

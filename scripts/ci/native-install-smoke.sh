#!/usr/bin/env bash
# Native install smoke: npm ci + production build for backend and frontend (no Docker).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "[ci-native-smoke] npm ci backend"
npm ci --prefix backend

echo "[ci-native-smoke] npm ci frontend"
npm ci --prefix frontend

echo "[ci-native-smoke] backend build"
npm run build --prefix backend

echo "[ci-native-smoke] frontend build"
npm run build --prefix frontend

echo "[ci-native-smoke] ok"

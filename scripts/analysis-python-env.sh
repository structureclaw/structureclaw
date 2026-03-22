#!/usr/bin/env bash

if [[ -z "${ROOT_DIR:-}" ]]; then
  ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

ANALYSIS_PYTHON_ROOT="$ROOT_DIR/backend/src/agent-skills/analysis-execution/python"
ANALYSIS_EXAMPLES_DIR="$ANALYSIS_PYTHON_ROOT/examples"
ANALYSIS_REGRESSION_DIR="$ANALYSIS_PYTHON_ROOT/regression"
ANALYSIS_PYTHONPATH="$ANALYSIS_PYTHON_ROOT:$ROOT_DIR/backend/src/agent-skills/geometry-input:$ROOT_DIR/backend/src/agent-skills/code-check:$ROOT_DIR/backend/src/agent-skills/material-constitutive${PYTHONPATH:+:$PYTHONPATH}"

resolve_analysis_python_bin() {
  if [[ -x "$ROOT_DIR/backend/.venv/bin/python" ]]; then
    printf '%s\n' "$ROOT_DIR/backend/.venv/bin/python"
    return 0
  fi
  if [[ -n "${ANALYSIS_PYTHON_BIN:-}" ]]; then
    printf '%s\n' "${ANALYSIS_PYTHON_BIN}"
    return 0
  fi
  return 1
}

require_analysis_python() {
  if ! PYTHON_BIN="$(resolve_analysis_python_bin)"; then
    echo "No Python environment found at backend/.venv and ANALYSIS_PYTHON_BIN is not set" >&2
    exit 1
  fi
  export PYTHON_BIN
  export ANALYSIS_PYTHON_ROOT
  export ANALYSIS_EXAMPLES_DIR
  export ANALYSIS_REGRESSION_DIR
  export PYTHONPATH="$ANALYSIS_PYTHONPATH"
}

#!/usr/bin/env bash
# Claude Code Stop hook 用の薄いラッパー。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/memory-core.sh" stop

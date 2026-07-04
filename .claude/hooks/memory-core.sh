#!/usr/bin/env bash
# メモリ操作の共通本体。session-start.sh / stop.sh から呼び出される。
# 他エージェント（Cline / Codex CLI 等）向けアダプタを追加する際も、
# 薄いラッパー経由でこのスクリプトを呼び出す想定。
set -euo pipefail

STATE_DIR="/tmp/agent-mem"

json_get() {
  local json="$1" key="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r --arg k "$key" '.[$k] // empty'
  else
    python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
print(d.get('$key', '') or '')
" <<< "$json"
  fi
}

emit_json() {
  # emit_json <key1> <val1> [<key2> <val2> ...] — 文字列値のみのフラットJSONを組み立てる
  if command -v jq >/dev/null 2>&1; then
    local args=() jqfilter="{"
    local i=1 first=true
    while [[ $# -gt 0 ]]; do
      local k="$1" v="$2"; shift 2
      args+=(--arg "k$i" "$k" --arg "v$i" "$v")
      if $first; then jqfilter+="(\$k$i): \$v$i"; first=false; else jqfilter+=", (\$k$i): \$v$i"; fi
      i=$((i+1))
    done
    jqfilter+="}"
    jq -n "${args[@]}" "$jqfilter"
  else
    python3 -c "
import json, sys
pairs = sys.argv[1:]
d = dict(zip(pairs[0::2], pairs[1::2]))
print(json.dumps(d))
" "$@"
  fi
}

cmd_session_start() {
  local input session_id cwd
  input="$(cat)"
  session_id="$(json_get "$input" session_id)"
  cwd="${CLAUDE_PROJECT_DIR:-$(json_get "$input" cwd)}"

  mkdir -p "$STATE_DIR"
  if [[ -n "$session_id" ]]; then
    date +%s > "$STATE_DIR/${session_id}.start"
    rm -f "$STATE_DIR/${session_id}.prompted"
  fi

  local index_file="$cwd/.memory/index.md"
  [[ -f "$index_file" ]] || exit 0

  local content
  content="$(cat "$index_file")"

  if command -v jq >/dev/null 2>&1; then
    jq -n --arg ctx "$content" \
      '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
  else
    python3 -c "
import json, sys
ctx = sys.stdin.read()
print(json.dumps({'hookSpecificOutput': {'hookEventName': 'SessionStart', 'additionalContext': ctx}}))
" <<< "$content"
  fi
}

cmd_stop() {
  local input session_id cwd stop_hook_active
  input="$(cat)"
  session_id="$(json_get "$input" session_id)"
  cwd="${CLAUDE_PROJECT_DIR:-$(json_get "$input" cwd)}"
  stop_hook_active="$(json_get "$input" stop_hook_active)"

  # Stopフックの再帰（同一cascade内の再発火）を防止
  [[ "$stop_hook_active" == "true" ]] && exit 0

  # セッション中に一度促し済みなら、以降のターンでは発火しない
  # （Stopはターンごとに発火するため、これがないと「書くことがない」セッションで毎ターンnagする）
  local prompted_file="$STATE_DIR/${session_id}.prompted"
  [[ -f "$prompted_file" ]] && exit 0

  local memory_dir="$cwd/.memory"
  local index_file="$memory_dir/index.md"
  [[ -f "$index_file" ]] || exit 0

  local auto_write
  auto_write="$(grep -m1 '^memory_auto_write:' "$index_file" | sed 's/memory_auto_write:[[:space:]]*//' | tr -d '[:space:]')"
  [[ "$auto_write" == "on" ]] || exit 0

  local start_file="$STATE_DIR/${session_id}.start"
  [[ -f "$start_file" ]] || exit 0
  local start_ts
  start_ts="$(cat "$start_file")"

  local updated=false
  for f in "$memory_dir"/*.md; do
    [[ -f "$f" ]] || continue
    local mtime
    mtime="$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null || echo 0)"
    if [[ "$mtime" -gt "$start_ts" ]]; then
      updated=true
      break
    fi
  done

  [[ "$updated" == true ]] && exit 0

  mkdir -p "$STATE_DIR"
  touch "$prompted_file"

  emit_json \
    decision block \
    reason ".memory/ に今回のセッションの変更が記録されていません。.memory/rules.md の判断基準に沿って書き込むべき情報がないか確認してください（このセッションでの確認はこれが最後です）。あれば.memory/へ保存し、なければそのまま終了してください。"
}

case "${1:-}" in
  session-start) cmd_session_start ;;
  stop) cmd_stop ;;
  *)
    echo "usage: memory-core.sh {session-start|stop}" >&2
    exit 1
    ;;
esac

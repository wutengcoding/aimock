#!/bin/bash
set -e

HOST="${MCP_HOST:-http://127.0.0.1:4010}"
MCP_URL="$HOST/mcp"
TOOL="${1:-feishu_calendar_freebusy}"
ARGS_FILE="${2:-}"   # 可选：JSON 文件路径，如 args.json

echo "=== MCP Mock Test ==="
echo "Target: $MCP_URL"
echo "Tool:   $TOOL"
echo ""

# 1. initialize
echo "[1/3] initialize..."
SESSION=$(curl -sf -D - -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  | grep -i mcp-session-id | awk '{print $2}' | tr -d '\r')

if [ -z "$SESSION" ]; then
  echo "ERROR: failed to get session id" >&2
  exit 1
fi
echo "session: $SESSION"
echo ""

# 2. initialized notification
curl -sf -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' > /dev/null

# 3. tools/list
echo "[2/3] tools/list..."
curl -sf -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
echo ""

# 4. tools/call — 从文件读 args，或用空 {}
echo ""
echo "[3/3] tools/call: $TOOL"
if [ -n "$ARGS_FILE" ] && [ -f "$ARGS_FILE" ]; then
  echo "args file: $ARGS_FILE"
  ARGS=$(cat "$ARGS_FILE")
else
  echo "args: {}"
  ARGS="{}"
fi

PAYLOAD='{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"'"$TOOL"'","arguments":'"$ARGS"'}}'

curl -sf -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION" \
  -d "$PAYLOAD"
echo ""

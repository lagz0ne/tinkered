#!/usr/bin/env bash
# Probe the Meta endpoint for one ReAct round trip (2026-09-21, both 200).
# Step 1: the model asks for the `read` tool (finish_reason: tool_calls).
# Step 2: we hand the tool result back, streamed; the model answers (finish_reason: stop).
# The key is read from the token file and never printed.
set -euo pipefail
cd "$(dirname "$0")"
url=https://api.meta.ai/v1/chat/completions
auth="Authorization: Bearer $(cat /home/paseo/pilot/.muse-token)"
for step in 1-ask 2-answer; do
  code=$(curl -s -o "/tmp/tinkerer-$step.out" -w '%{http_code}' "$url" \
    -H "$auth" -H "Content-Type: application/json" --data "@$step.request.json")
  echo "$step: HTTP $code"
done

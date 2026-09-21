# tinkerer probe — 2026-09-21

One ReAct round trip against the Meta endpoint, recorded.

- Endpoint: `https://api.meta.ai/v1/chat/completions`
- Model: `muse-spark-1.3-contributor`
- Shape: OpenAI chat completions
- Key: `/home/paseo/pilot/.muse-token` (never printed)

Findings:

- Step 1 (`1-ask`): HTTP 200, `finish_reason: "tool_calls"`, one call
  `read({"path":"README.md"})`, `reasoning_tokens: 203`.
- Step 2 (`2-answer`, `stream: true`): HTTP 200, SSE chunks with
  `delta.content`, last chunk `finish_reason: "stop"` plus `usage`,
  then `data: [DONE]`.
- Quirks: `max_completion_tokens`, not `max_tokens`.

The recorded responses are the first test fixtures for the `step` op.
Rerun: `packages/tinkerer/probe/run.sh`.

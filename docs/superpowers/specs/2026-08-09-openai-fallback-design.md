# OpenAI fallback provider

## Goal

Add OpenAI to the existing LLM fallback chain so a game can continue when the Gemini providers fail or reach their daily quota.

## Design

- The chain order is `gemini-free,gemini,openai,nvidia`.
- The OpenAI adapter calls the Chat Completions API with Structured Outputs and the request's existing JSON schema.
- It reads `OPEN_AI_API_KEY`, keeping the key server-side in Wrangler secrets and `.dev.vars` only.
- `OPENAI_MODEL` defaults to `gpt-5-mini`; it may be overridden by `MODEL_<KIND>` like the other providers.
- `LLM_DAILY_LIMIT_OPENAI` is enforced by the existing provider-keyed quota Durable Object.
- Health responses expose whether the key is configured and the selected model, never the key itself.

## Failure handling

Missing keys exclude the provider. Network errors, non-2xx responses, invalid or empty output, validation failures, timeouts, and quota rejection cause the chain to continue to NVIDIA.

## Tests

Cover successful OpenAI JSON output, OpenAI failure falling through to NVIDIA, and health metadata shape. Existing full test and typecheck commands verify integration.

# Providers and API keys

DashScope (Qwen)
- Endpoint: https://dashscope-intl.aliyuncs.com/api/v1
- Keys: https://dashscope.console.aliyun.com/
- Models: qwen-mt-turbo, qwen-mt-plus
- Notes: Streaming supported (SSE). Background keeps the key.

OpenAI
- Endpoint: https://api.openai.com/v1
- Keys: https://platform.openai.com/api-keys
- Models: gpt-4o-mini (chat/completions)
- Notes: Use a model available to your account. Background keeps the key.

Anthropic (Claude)
- Endpoint: https://api.anthropic.com/v1
- Keys: https://console.anthropic.com/account/api-keys
- Models: claude-4.1-haiku, claude-4.1-sonnet (legacy: claude-3-haiku, claude-3-sonnet)
- Notes: Streaming supported (/messages SSE). Background keeps the key.

DeepL
- Endpoint: https://api.deepl.com/v2
- Keys: https://www.deepl.com/pro-api
- Notes: No streaming for /translate; single-shot responses. Background keeps the key.

Google detection (optional)
- Set Detector to “Google” for auto-detect when Source is “auto”
- Create a key and enable Cloud Translation API: https://cloud.google.com/translate/docs/setup
- Store the key in “Detection API Key (Google)”. Used only for detection.

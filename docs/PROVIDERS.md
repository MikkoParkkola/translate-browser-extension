# Providers and API keys

Manage providers in the extension under **Settings → Providers**. Use **Add Provider** or **Add Local Provider** to supply API keys, endpoints and models.

DashScope (Qwen)
- Endpoint: https://dashscope-intl.aliyuncs.com/api/v1
- Keys: https://dashscope.console.aliyun.com/
- Models: qwen-mt-turbo, qwen-mt-plus
- Notes: Streaming supported (SSE). Background keeps the key.

OpenAI
- Preset: openai
- Endpoint: https://api.openai.com/v1
- Keys: https://platform.openai.com/api-keys
- Models: gpt-5, gpt-5-mini, gpt-5-nano (chat/completions)
- Notes: Use a model available to your account. Background keeps the key.

Gemini
- Endpoint: https://generativelanguage.googleapis.com/v1beta
- Keys: https://aistudio.google.com/app/apikey
- Models: gemini-1.5-flash, gemini-pro
- Notes: Streaming supported (SSE). Background keeps the key.

OpenRouter
- Preset: openrouter
- Endpoint: https://openrouter.ai/api/v1
- Keys: https://openrouter.ai/keys
- Models: fetched dynamically from OpenRouter
- Notes: Streaming supported. Background keeps the key.

Mistral
- Endpoint: https://api.mistral.ai/v1
- Keys: https://console.mistral.ai/
- Models: mistral-small, mistral-medium
- Notes: Streaming supported (SSE). Custom endpoints allow self-hosted deployments.

Anthropic (Claude)
- Endpoint: https://api.anthropic.com/v1
- Keys: https://console.anthropic.com/account/api-keys
- Models: claude-4.1-haiku, claude-4.1-sonnet (legacy: claude-3-haiku, claude-3-sonnet)
- Notes: Streaming supported (/messages SSE). Background keeps the key.

Local WASM
- Preset: local-wasm
- Endpoint: runs in-browser
- Keys: none
- Models: bundled Qwen translator
- Notes: Initializes the model on first use and caches it for reuse. Works offline.

DeepL
- Endpoint: https://api.deepl.com/v2
- Keys: https://www.deepl.com/pro-api
- Notes: No streaming for /translate; single-shot responses. Background keeps the key.

Google detection (optional)
- Set Detector to “Google” for auto-detect when Source is “auto”
- Create a key and enable Cloud Translation API: https://cloud.google.com/translate/docs/setup
- Store the key in “Detection API Key (Google)”. Used only for detection.

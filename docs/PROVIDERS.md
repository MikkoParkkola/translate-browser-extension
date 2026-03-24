# Providers and local models

Manage provider selection from the extension popup and configure cloud credentials from the options page.

## Local translation paths

### OPUS-MT
- Type: local model
- Runtime: `@huggingface/transformers` in the offscreen document
- Size: ~170MB per language pair
- Notes: Fast default local fallback. Runs on WASM, so it works even without GPU acceleration.

### TranslateGemma
- Type: local model
- Runtime: direct model + tokenizer loading in the offscreen document
- Size: ~3.6GB
- Notes: Higher-quality local translation. Requires WebGPU or WebNN acceleration.

### Chrome Built-in
- Type: native browser translation
- Availability: Chrome 138+
- Size: no download
- Notes: Uses the browser translator directly when available.

## Cloud providers

### DeepL
- Endpoint: `https://api.deepl.com/v2`
- Keys: <https://www.deepl.com/pro-api>
- Notes: High-quality translation API. Credentials stay in extension-managed storage.

### OpenAI
- Endpoint: `https://api.openai.com/v1`
- Keys: <https://platform.openai.com/api-keys>
- Notes: LLM-powered translation. Use a model available to your account.

### Anthropic
- Endpoint: `https://api.anthropic.com/v1`
- Keys: <https://console.anthropic.com/account/api-keys>
- Notes: Claude-powered translation via the extension background path.

### Google Cloud
- Endpoint: `https://translation.googleapis.com/`
- Keys: <https://cloud.google.com/translate/docs/setup>
- Notes: Google Cloud Translation API support for cloud translation workflows.

## Operational notes

- Local model downloads are tracked by extension metadata plus browser caches.
- `Clear All Models` removes locally tracked model metadata and clears matching model caches.
- Cloud providers remain optional; local translation continues to work without API keys.

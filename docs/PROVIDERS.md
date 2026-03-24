# Providers and local models

Manage provider selection from the extension popup and configure cloud credentials from the options page.

## Shipping status

### Stable shipped providers
- **Chrome Built-in** - preferred native path when Chrome 138+ exposes the browser translator.
- **OPUS-MT** - stable downloaded local baseline for offline translation.
- **DeepL / OpenAI / Anthropic / Google Cloud** - supported cloud providers when configured with API keys.

### Experimental provider
- **TranslateGemma** - higher-quality local path, but still experimental because it depends on WebGPU/WebNN acceleration and a much larger download.

## Local translation paths

### OPUS-MT
- Type: local model
- Runtime: `@huggingface/transformers` in the Chrome offscreen document or Firefox background page
- Size: ~170MB per language pair
- Notes: Stable default offline baseline. Runs on WASM, so it works even without GPU acceleration.

### TranslateGemma
- Type: local model
- Runtime: direct model + tokenizer loading in the Chrome offscreen document or Firefox background page
- Size: ~3.6GB
- Notes: Experimental higher-quality path. Requires WebGPU or WebNN acceleration.

### Chrome Built-in
- Type: native browser translation
- Availability: Chrome 138+
- Size: no download
- Notes: Uses the browser translator directly when available. Managed by Chrome rather than by extension model downloads.

## Runtime architecture

### Chrome
- **Downloaded local models** (`opus-mt`, `translategemma`) route through `popup/content -> background service worker -> offscreen document`.
- **Chrome Built-in** routes through `popup/content -> chrome.scripting.executeScript(...)` in the active tab's main world.
- **Cloud providers** route through `popup/content -> background service worker -> provider API`.

### Firefox
- Firefox uses `popup/content -> background-firefox` directly because it does not support the Chrome MV3 offscreen-document path.
- `chrome-builtin` is not available on Firefox.

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

- Downloaded models are tracked on a best-effort basis by extension metadata plus browser caches.
- `Clear Downloaded Models` removes locally tracked model metadata and clears matching model caches.
- Browser-managed translation such as Chrome Built-in is not included in downloaded-model storage stats.
- Cloud providers remain optional; local translation continues to work without API keys.

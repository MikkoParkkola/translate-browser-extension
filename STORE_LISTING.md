# Chrome Web Store Listing

## Short Description (132 characters max)

```
Translate entire web pages, PDFs, and selections. Offline WASM mode or 10+ API providers. Privacy-first, open source.
```

(117 characters)

## Category

Productivity

## Language

English

## Detailed Description

TRANSLATE! is an open-source browser extension that translates entire web pages, PDFs, and selected text using your choice of translation provider -- or no provider at all, with fully offline translation that runs directly in your browser.

### Local-First Translation

Run OPUS-MT translation models on your device via WebAssembly and WebGPU. No API key needed, no network connection required, and no data ever leaves your browser. This is the default mode for maximum privacy.

### 10+ Translation Providers

When you need cloud-powered translation, connect any combination of providers:

- DeepL
- OpenAI (GPT models)
- Google Cloud Translation
- Anthropic (Claude)
- Gemini
- DashScope (Qwen-MT)
- Mistral
- OpenRouter
- Ollama (self-hosted)
- macOS system translator

Switch between providers on the fly. Configure failover chains so if one provider is down or rate-limited, the next one takes over automatically. Distribute translation load across providers with configurable weights.

### Full-Page Translation

Translates all visible text on a page, including:

- Dynamically loaded content (SPAs, infinite scroll)
- Shadow DOM elements
- Same-origin iframes
- PDF documents with layout preservation

A MutationObserver watches for new content, so translations keep up as pages change.

### Smart Performance

- Identical strings are translated once and reused across all matching elements
- Hidden and off-screen elements are skipped to save tokens
- Session cache prevents redundant API calls
- Per-provider rate limiting with automatic retry on 429 errors
- Smart batching minimizes request count while maximizing throughput

### Keyboard Shortcuts

- Ctrl+Shift+P / Cmd+Shift+P -- Translate entire page
- Ctrl+Shift+T / Cmd+Shift+T -- Translate selected text
- Ctrl+Shift+U / Cmd+Shift+U -- Undo translation
- Alt+T -- Open popup

### 100+ Languages

Automatic source language detection with trigram-based fallback. Supports all major languages and many regional ones.

### Built-in Diagnostics

Live usage metrics, cost tracking, latency histogram, and connectivity checks -- all from the diagnostics dashboard in the popup.

### Privacy by Design

- All settings and API keys stored locally on your device
- No analytics, telemetry, or tracking
- No data collection or sharing
- Fully functional offline with WASM mode
- Open source (AGPL-3.0)

### Requirements

Chrome 116 or later. Also available for Firefox and Safari.

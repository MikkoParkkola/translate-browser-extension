# Changelog

## 2.2.0

### Minor Changes

- f45d0e8: feat: redesign diagnostics tab with user-friendly summaries
- eb1d643: fix: streamline translation memory management by removing heavy viewer and showing stats with export/import.

### Patch Changes

- d0f7576: Ensure auto-translate starts only for the active tab and stops all tabs when disabled.
- eabc003: fix: include per-provider usage in home init
- 10b4728: Add automation script for creating pull requests with security scanning.
- 6088c5a: Display product name link in popup header.
- 2a86400: fix: redact tokens in logger
- 1a76a66: fix: skip translating strings outside the selected source language

## [2.1.0] - 2025-09-20

- Multi-provider translation (DashScope, OpenAI, Anthropic, Mistral, Gemini, DeepL, Google Cloud, OpenRouter, Ollama)
- Local offline translation via OPUS-MT WebAssembly models
- PDF translation with layout preservation
- Smart batching and session caching
- Rate limiting with automatic failover
- Auto-translate on page load
- Diagnostics dashboard with usage metrics
- Safari (macOS/iOS) and Firefox support

## [1.4.1] - 2025-08-09

- Bug fixes and stability improvements

## [1.0.0] - 2025-07-01

- Initial release with Qwen-MT-Turbo translation
- Full-page translation with DOM mutation observer
- Chrome extension (Manifest V3)

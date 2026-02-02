# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

**TRANSLATE!** is a Chrome browser extension for high-quality local-first translation using OPUS-MT models via Transformers.js with WebGPU acceleration.

## Architecture (v2.0)

```
src/
├── types/                 # TypeScript type definitions
│   └── index.ts
├── core/                  # Core translation infrastructure
│   ├── throttle.ts        # Rate limiting with exponential backoff
│   ├── webgpu-detector.ts # WebGPU detection and setup
│   └── translation-router.ts # Intelligent provider selection
├── providers/             # Translation provider implementations
│   ├── base-provider.ts   # Abstract base class
│   └── opus-mt-local.ts   # Helsinki-NLP OPUS-MT via Transformers.js
├── popup/                 # Solid.js popup UI
│   ├── App.tsx
│   ├── index.tsx
│   ├── index.html
│   ├── styles/popup.css
│   └── components/
│       ├── ProviderStatus.tsx
│       ├── LanguageSelector.tsx
│       ├── StrategySelector.tsx
│       ├── UsageBar.tsx
│       └── CostMonitor.tsx
├── options/               # Settings page
│   └── index.html
├── background/            # Service worker
│   └── service-worker.ts
├── content/               # Content script
│   └── index.ts
└── manifest.json          # Extension manifest (MV3)
```

## Tech Stack

- **Language**: TypeScript (strict mode)
- **UI Framework**: Solid.js
- **Build Tool**: Vite
- **ML Runtime**: Transformers.js with WebGPU/WASM
- **Models**: Helsinki-NLP OPUS-MT (quantized)

## Common Commands

```bash
npm install          # Install dependencies
npm run dev          # Build with watch mode
npm run build        # Production build to dist/
npm run typecheck    # TypeScript type checking
npm run test         # Run Vitest tests
```

## Key Features

### Rate Limiting (`src/core/throttle.ts`)
- Sliding window rate limiting
- Exponential backoff with jitter
- Predictive batching for optimal API usage
- Token estimation (~4 chars per token)

### Provider System
- Unified interface via `BaseProvider`
- Strategy-based selection: Smart/Fast/Quality
- Usage tracking and cost monitoring
- WebGPU acceleration when available

### Translation Flow
1. Popup sends message to background service worker
2. Background uses router to select best provider
3. Throttle ensures rate limits respected
4. Provider translates via Transformers.js
5. Content script replaces DOM text nodes

## Development Notes

### Adding New Providers
1. Extend `BaseProvider` in `src/providers/`
2. Implement `translate()`, `isAvailable()`, `getSupportedLanguages()`
3. Register in `translation-router.ts`

### Testing
- Load unpacked extension from `dist/` folder
- Use `test/test-page.html` for manual testing
- Check DevTools console for `[Router]`, `[OPUS-MT]`, `[Content]` logs

### Legacy Code
Previous implementation archived in `_legacy/src/` for reference.
Do NOT import from `_legacy/` - it contains broken vanilla JS code.

## File Conventions

- TypeScript strict mode enabled
- Solid.js JSX in `.tsx` files
- CSS in component-specific files
- No emoji in code (user preference)

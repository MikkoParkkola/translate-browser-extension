# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome/Safari browser extension that translates web pages using Alibaba Cloud's Qwen MT models. The extension automatically translates visible text content on pages, handles dynamic content, and includes PDF viewing capabilities.

## Key Architecture

### Core Components
- **background.js**: Service worker that handles API requests, rate limiting, and cross-origin communication
- **contentScript.js**: Injected into all pages; scans DOM, batches text nodes, and manages translation UI
- **translator.js**: Core translation logic with caching, streaming support, and fallback mechanisms
- **popup.js**: Extension popup UI for configuration and testing
- **config.js**: Configuration management with Chrome storage sync
- **throttle.js**: Rate limiting implementation for API requests
- **pdfViewer.js/html**: Custom PDF viewer with translation support

### Translation Flow
1. Content script scans page for translatable text nodes
2. Text nodes are batched by token count (~6000 tokens max per batch)
3. Requests route through background script for rate limiting
4. Background script uses throttling system to respect API limits
5. Translated text replaces original with preserved whitespace
6. Results are cached to avoid duplicate API calls

### Rate Limiting System
- Configurable limits: requests/minute and tokens/minute (default: 60 req, 100k tokens)
- Global throttling via background script prevents API 429 errors
- Automatic retry with exponential backoff for failed requests
- Live usage tracking displayed in popup

## Common Commands

### Development
```bash
npm install          # Install dependencies
npm test            # Run Jest unit tests (uses jsdom environment)
npm run build:safari # Convert to Safari extension via script
```

### CLI Usage
The standalone CLI translator in `cli/translate.js`:
```bash
node cli/translate.js -k <API_KEY> [-e endpoint] [-m model] [--requests N] [--tokens M] [-d] [--no-stream] -s <source_lang> -t <target_lang>
```

### Testing
The extension includes comprehensive diagnostics via the popup's "Test Settings" button that validates:
- API connectivity and authentication
- Background script communication
- Content script injection and translation
- Storage access and configuration persistence

## File Structure Notes

- `src/` contains all extension files (copied as-is for installation)
- `manifest.json` defines MV3 extension structure and permissions
- `pdf.min.js` and `pdf.worker.min.js` are PDF.js library files for PDF translation
- `cli/translate.js` is a standalone CLI utility for batch translation
- Tests are in `test/` directory using Jest

## Translation Logic

### Text Processing
- Skips `<script>`, `<style>`, `<noscript>`, `<template>` elements
- Only translates visible elements (checks computed style and viewport)
- Preserves leading/trailing whitespace in translations
- Marks translated nodes to prevent re-translation
- Handles Shadow DOM and iframe content when accessible

### Caching Strategy
- Session-based cache using Map with `source:target:text` keys
- Identical strings translated once and reused across nodes
- Cache shared between direct and background translation calls

### API Integration
- Primary: Alibaba Cloud DashScope API (`qwen-mt-turbo` model)
- Fallback: XHR when fetch fails (CORS/CSP issues)
- Streaming and non-streaming translation modes
- Automatic language detection and batch processing

## Browser Extension Specifics

### Permissions Required
- `storage`: Configuration persistence
- `activeTab`, `tabs`, `scripting`: Content script injection
- `webRequest`, `webRequestBlocking`: PDF URL interception
- `<all_urls>`: Universal content access for translation

### Cross-Context Communication
- popup ↔ background: Chrome runtime messaging
- contentScript ↔ background: Translation request proxying
- All contexts share config.js and translator.js modules

### PDF Handling
- Intercepts PDF URLs and redirects to custom viewer
- Embeds are automatically replaced with iframe to custom viewer
- PDF.js integration for text extraction and translation overlay

## Extension Installation
For Chrome/Chromium browsers:
1. Build by copying `src/` folder contents 
2. Load unpacked extension in developer mode
3. Ensure folder contains `manifest.json` and all core files

For Safari (macOS/iOS):
1. Run `npm run build:safari` to generate Xcode project
2. Sign and build in Xcode for target platform
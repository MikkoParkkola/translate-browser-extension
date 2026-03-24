# TRANSLATE!

[![CI](https://github.com/MikkoParkkola/translate-browser-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/MikkoParkkola/translate-browser-extension/actions/workflows/ci.yml)
[![CodeQL](https://github.com/MikkoParkkola/translate-browser-extension/actions/workflows/codeql.yml/badge.svg)](https://github.com/MikkoParkkola/translate-browser-extension/actions/workflows/codeql.yml)
![Tests](https://img.shields.io/badge/tests-5%2C038%20passed-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript&logoColor=white)
![License](https://img.shields.io/github/license/MikkoParkkola/translate-browser-extension)
![Chrome](https://img.shields.io/badge/Chrome-116%2B-brightgreen?logo=googlechrome&logoColor=white)
![Safari](https://img.shields.io/badge/Safari-macOS%20%7C%20iOS-blue?logo=safari&logoColor=white)
![Firefox](https://img.shields.io/badge/Firefox-supported-orange?logo=firefox&logoColor=white)

Browser extension that translates web pages, PDFs, and selected text. Works where built-in browser translation falls short.

## Why use this instead of built-in translation?

Built-in browser translation (Chrome, Safari, Firefox) works well for many pages. But if you've run into any of these, TRANSLATE! is for you:

**The translate bar never shows up.** Browsers decide whether to offer translation based on the page's language tag. If the tag is missing, wrong, or matches your browser language, the translate bar silently doesn't appear -- even when the page is clearly in another language. TRANSLATE! lets you translate any page on demand, regardless of what the page declares.

**You need to translate a PDF.** Chrome's built-in translation does not work on PDFs. TRANSLATE! includes a PDF viewer that translates documents while preserving layout, and lets you save the translated version.

**You use Safari or iOS.** Safari has Apple's own translation (added in Safari 15 / macOS Monterey), but it supports fewer languages and isn't available on all pages. On iOS, options are even more limited. TRANSLATE! works across Chrome, Safari, Firefox, Edge, and Brave with the same feature set.

**You work with less common languages.** Translation quality for major pairs like English-Spanish or English-French is good across most services. For less common pairs -- Finnish-Thai, Estonian-Korean, Latvian-Vietnamese -- quality varies significantly between providers. TRANSLATE! lets you route through whichever supported path handles your language pair best, whether that's Chrome Built-in, OPUS-MT, DeepL, or a configured cloud provider.

**Pages with mixed languages don't translate correctly.** When a page contains text in multiple languages (e.g., a German forum on an English-tagged site), built-in translation often either skips it entirely or translates everything as if it were one language. TRANSLATE! detects language per text node using trigram analysis.

**You want control over where your text goes.** Built-in translation sends your page text to Google (Chrome), Apple (Safari), or Mozilla's servers (Firefox). TRANSLATE! lets you choose: use Chrome Built-in when available, use your own API keys with supported cloud providers, or run OPUS-MT locally in the browser via WebAssembly. Your text, your choice.

## What it does

- **Full-page translation** -- translates visible text on a page, including dynamically loaded content and iframes. A MutationObserver watches for DOM changes so content added after page load is caught.
- **PDF translation** -- built-in PDF viewer with layout-preserving translation. Supports provider document APIs (Google Cloud, DeepL) and a local WASM pipeline. Save translated PDFs.
- **7 shipping translation providers** -- Chrome Built-in, OPUS-MT, TranslateGemma (experimental), DeepL, OpenAI, Anthropic, and Google Cloud. Switch on the fly between the available native, local, and cloud paths.
- **Failover and load balancing** -- if your primary provider hits a rate limit or fails, requests automatically route to the next provider in your chain.
- **Smart batching and caching** -- identical strings translated once and reused. Hidden elements skipped. Session cache minimizes repeat API calls.
- **Auto-translate** -- optionally translate pages on load.
- **100+ languages** -- source language auto-detection with trigram-based fallback.
- **Keyboard shortcuts** -- `Ctrl+Shift+P` translate page, `Ctrl+Shift+T` translate selection, `Ctrl+Shift+U` undo.
- **Diagnostics dashboard** -- live usage metrics, cost tracking, latency histogram.

## Honest trade-offs

TRANSLATE! is not a drop-in replacement for built-in translation in every scenario:

- **Setup required.** Most providers need an API key. Built-in translation works with zero configuration.
- **API costs.** Cloud providers charge per character or token. Chrome Built-in and OPUS-MT avoid per-request API billing, but OPUS-MT usually has lower quality than the best cloud pairs.
- **Not instant.** Built-in translation is tightly integrated with the browser engine. TRANSLATE! works as a content script, which means a short delay on large pages.

If built-in translation works reliably for your languages and pages, you probably don't need this. TRANSLATE! is for the cases where it doesn't.

## Quality

| Metric | Value |
|--------|-------|
| Unit tests | 5,038 (127 test files) |
| Statement coverage | 100% |
| Branch coverage | 99.9% |
| Function coverage | 100% |
| Line coverage | 100% |
| Contract tests | 58 (provider interface conformance) |
| Mutation testing | Stryker configured for core + providers |
| E2E tests | Playwright (Chrome, Firefox, WebKit) |
| CI | GitHub Actions: lint, typecheck, test, build, e2e, CodeQL, SBOM |

The test suite runs in ~40 seconds and covers every source file. Coverage thresholds (100/98/100/100) are enforced in CI — the build fails if coverage drops.

<!-- Screenshots: TODO — take fresh marketing screenshots showing:
  1. Popup translating a real page (before/after)
  2. PDF translation with layout preserved
  3. Provider settings with multiple providers configured
  Place in pics/ and uncomment when ready. -->

## Browser Support

| Browser | Status | Notes |
|---------|--------|-------|
| **Chrome** (116+) | Full support | Primary platform, Manifest V3 |
| **Chromium-based** (Edge, Brave, etc.) | Full support | Load as unpacked extension |
| **Safari** (macOS, iOS, iPadOS) | Full support | Built via Xcode converter |
| **Firefox** | Supported | Separate build (`npm run build:firefox`) |

## Installation

### Chrome / Chromium

1. **Install dependencies**
   ```sh
   npm install
   ```
2. **Build the extension**
   ```sh
   npm run build
   ```
3. **Load in browser**
   - Open `chrome://extensions` (or the equivalent page in your Chromium-based browser).
   - Enable **Developer mode**.
   - Click **Load unpacked** and select the generated `dist/` directory.
4. The extension requests access to _all websites_ so translations can run automatically.
   Allow the permission prompt when loading the extension.

If Chrome reports **Service worker registration failed. Status code: 15**, ensure
you selected the `dist/` folder produced by the build step. Loading the repository
root or a directory missing `manifest.json` will cause the worker to fail.

### Safari (macOS and iOS/iPadOS)

Run the Safari converter on a Mac to produce an Xcode project for both macOS and iOS/iPadOS:

```sh
npm run build:safari
```

Open the generated project in Xcode to sign and build the extension for the desired platform.
See `safari/README.md` for detailed iOS/iPadOS deployment steps.

### Firefox

```sh
npm run build:firefox
npm run package:firefox
```

Load `dist-firefox/` as a temporary extension or install the generated `.xpi`.

## Uninstallation

Remove the extension from the browser's extension management page.

## Upgrade

Reload the unpacked extension after replacing the files with a newer version.

## Packaging and Signing

The repository includes a workflow that builds and signs a Chrome extension package.

1. Open the **Actions** tab and run **Sign Chrome Extension**.
2. The job builds the project, signs it using the `CRX_PRIVATE_KEY` secret, and uploads `translate-extension.crx` and `translate-extension.zip` as artifacts.

To sign locally:

```sh
npm run build
echo "$CRX_PRIVATE_KEY" | base64 -d > key.pem
npx -y crx pack dist -o translate-extension.crx --zip-output translate-extension.zip -p key.pem
```

## Configuration

Open the popup and click the gear button to access **Settings**. The settings page provides:

- **General** -- toggle automatic language detection and manage the glossary.
- **Providers** -- add, remove or reorder providers. Use **Edit** to supply API keys, endpoints, models and per-provider limits. Local providers such as Ollama or macOS can be added via **Add Local Provider**.
- **Advanced** -- enable or clear the translation cache.

Use the **Diagnostics** button on the home page to view usage metrics and run connectivity checks.

### Where to get API keys

| Provider | API Keys | Notes |
|----------|----------|-------|
| DashScope (Qwen) | [dashscope.console.aliyun.com](https://dashscope.console.aliyun.com/) | Qwen-MT-Turbo, Qwen-MT-Plus |
| OpenAI | [platform.openai.com](https://platform.openai.com/api-keys) | GPT models |
| Gemini | [aistudio.google.com](https://aistudio.google.com/app/apikey) | Gemini Flash/Pro |
| Anthropic (Claude) | [console.anthropic.com](https://console.anthropic.com/) | Claude models |
| Mistral | [console.mistral.ai](https://console.mistral.ai/) | Mistral models |
| DeepL | [deepl.com/pro-api](https://www.deepl.com/pro-api) | Document translation |
| Google Cloud | [cloud.google.com/translate](https://cloud.google.com/translate/docs/setup) | Translation + Detection |
| OpenRouter | [openrouter.ai](https://openrouter.ai/) | Multi-model hub |
| Ollama | Local, no key required | Self-hosted models |
| macOS translator | Built-in, no key required | System translation API |
| Local WASM | Built-in, no key required | Offline, in-browser |

See also: [docs/PROVIDERS.md](docs/PROVIDERS.md)

## Usage

1. Click the toolbar icon to open the popup.
2. Press **Translate page** or use `Ctrl+Shift+P`.
3. Enable **Auto-translate** to translate pages on load without clicking.

The extension translates visible text, watches for new content via MutationObserver, and caches translations for the session. Failed translations are queued and retried automatically. A status indicator appears in the bottom-right corner while work is in progress.

### PDF translation

PDFs open in a built-in viewer. Two translation modes:

- **Document API** -- sends the file to Google Cloud or DeepL's document translation endpoint (if configured). Returns a fully translated PDF.
- **Text extraction** -- extracts text, translates via your configured providers, renders a new PDF locally. Works with any provider.

Translated PDFs can be saved from the viewer.

### Rate limiting and costs

Requests are queued to stay within provider limits (default: 60 req/min, 100K tokens/min). The popup shows live usage bars that turn yellow/red as limits approach. If a provider returns 429, the request retries automatically or fails over to the next provider.

Cost tracking is built in -- the popup shows 24-hour and 7-day spend per provider.

## Troubleshooting

<details>
<summary>Common issues (click to expand)</summary>

- **Page not translating**: Check source/target language settings. Enable **Debug logging** in the popup and check the browser console.
- **Translate bar doesn't appear on some sites**: This is a browser limitation, not a TRANSLATE! issue. Use `Ctrl+Shift+P` or the popup button instead.
- **401/403 errors**: Invalid API key. Check provider config -- OpenAI uses `Bearer <key>`, DeepL uses `DeepL-Auth-Key <key>`.
- **429 rate limit**: Requests retry automatically. Lower requests/tokens per minute in settings, or wait.
- **CSP-restricted sites**: Some sites block content script DOM changes. Translation may be limited.
- **Frames**: Same-origin iframes and open Shadow DOM are supported. Cross-origin frames require host permissions.

Use the **Diagnostics** panel (popup home page) for cache stats, connectivity checks, and a latency histogram. **Copy Report** generates a shareable summary for bug reports.
</details>

## CLI

A command-line translator is included:

```sh
node cli/translate.js -k <API_KEY> -s <source_lang> -t <target_lang>
```

Streams translations by default. Use `--no-stream` for batch mode, `-d` for debug output. See `cli/translate.js --help`.

## Development

```sh
npm install          # Install dependencies
npm test             # Run 5,038 unit tests
npm run test:e2e     # Playwright PDF visual comparison tests
npm run build        # Chrome production build (dist/)
npm run build:firefox # Firefox build (dist-firefox/)
npm run build:safari  # Safari via Xcode converter
```

`dist/` is not tracked in git. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for architecture details, provider internals, and the throttle/registry system.

## Contributing

Use [Changesets](https://github.com/changesets/changesets) for all updates. Documentation-only changes should use release type `none`.

A nightly workflow rebases open PRs to keep branches current with `main`. See [AGENTS.md](AGENTS.md) for details.

## License

This project is licensed under the [GPL-3.0-or-later](LICENSE).

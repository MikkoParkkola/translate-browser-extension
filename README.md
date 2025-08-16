# Qwen Translator Extension

This Chrome extension translates the content of the active tab using Alibaba Cloud Qwen MT models. Dynamic pages are translated as new elements appear. It supports translation between more than one hundred languages.

## Installation
1. **Install dependencies**
   ```sh
   npm install
   ```
2. **Build the distributable** – this copies everything in `src/` to `dist/`.
   ```sh
   npm run build
   ```
3. **Load the extension**
   - Open `chrome://extensions` (or the equivalent page in your Chromium‑based browser).
   - Enable **Developer mode**.
   - Click **Load unpacked** and select the generated `dist/` directory.
4. The extension requests access to *all websites* so translations can run automatically.
   Allow the permission prompt when loading the extension.

If Chrome reports **Service worker registration failed. Status code: 15**, ensure
you selected the `dist/` folder produced by the build step. Loading the repository
root or a directory missing `manifest.json` will cause the worker to fail.

## Uninstallation
Remove the extension from the browser's extension management page.

## Upgrade
Reload the unpacked extension after replacing the files with a newer version.

### Safari (macOS and iOS/iPadOS)
Run the Safari converter on a Mac to produce an Xcode project for both macOS and iOS/iPadOS:

```sh
npm run build:safari
```

Open the generated project in Xcode to sign and build the extension for the desired platform.
See `safari/README.md` for detailed iOS/iPadOS deployment steps.

## Configuration
Use the popup to configure:
- Provider preset to auto-fill endpoint and a typical model (DashScope/Qwen, OpenAI, DeepL, Mistral)
- API key for your chosen provider (keys are stored locally; never injected into pages)
- Translation model name (e.g., `qwen-mt-turbo`, `gpt-4o-mini`)
- Source and target languages (Source can be “Auto-detect”)
- Detector mode: Local (default, private) or Google (needs a Detection API key)
- Automatic translation toggle
Click **Test Settings** in the popup to run a short diagnostic. The extension performs several quick checks:
1. Connect to the configured API endpoint
2. Send an OPTIONS preflight request to the translation URL
3. Perform a direct non-stream translation
4. Verify that the background service worker responds
5. Perform the same translation via the background service worker
6. Send a streaming translation request
7. Read the contents of the active tab
8. Translate a short string inside the active tab
9. Verify that extension settings can be saved
Each step displays a pass or fail result and honours the debug logging preference. Tooltips in the popup explain every field and acceptable values.
The active tab check may fail on browser-internal pages (such as the Chrome Web Store or settings). Open a regular web page before running the test.
The final end-to-end tab translation aborts after about 10 seconds if no response is received.
The sample phrase is chosen based on the configured source language so the translated text differs from the original.

### Where to get API keys
- DashScope (Qwen): https://dashscope.console.aliyun.com/
- OpenAI: https://platform.openai.com/api-keys
- Mistral: https://console.mistral.ai/
- DeepL: https://www.deepl.com/pro-api
- Google Cloud (Detection): https://cloud.google.com/translate/docs/setup

See also: docs/PROVIDERS.md

## Usage
1. Click the toolbar icon to open the popup.
2. Pick a **Provider preset** or enter a custom endpoint.
3. Paste your API key and choose source/target languages.
4. Press **Save** and then **Test settings** to verify connectivity.
5. Click **Translate Page** to translate once, or enable **Automatic translation** to translate pages on load.

Translations apply to dynamically added content as well as embedded frames or third‑party widgets whenever the browser grants access. If translation fails the affected text is kept in a queue and retried until the API succeeds. When the translated text matches the original the node is marked as untranslatable and skipped. Translations are cached for the current session to minimise API calls.
Identical strings are translated only once and reused across matching nodes, and hidden or off‑screen elements are ignored so tokens are spent only on visible text.
Translated nodes keep their original leading and trailing whitespace. Nodes are batched to minimise API requests and maximise throughput. While translations are running the extension's toolbar icon shows an activity badge and a temporary status box in the bottom‑right corner of the page reports current work or errors. The box disappears automatically when the extension is idle.

### Rate Limiting
The extension and CLI queue translation requests to stay within the provider limits.
The background worker maintains a single queue so multiple page nodes are translated sequentially rather than all at once, preventing bursts that would trigger HTTP 429 errors. Nodes are batched into combined translation requests to reduce the overall query count. If the provider still returns a 429 response the request is retried automatically.
You can adjust the limits under **Requests per minute** and **Tokens per minute** in the extension popup or via `--requests` and `--tokens` on the CLI. Defaults are 60 requests and 100,000 tokens every 60 seconds.
The popup displays live usage for the last minute and colour-coded bars turn yellow or red as limits are approached. Usage statistics refresh every second and also show total requests, total tokens and the current queue length.

### Troubleshooting
Both model refreshes and translation requests write trace logs to the browser console. Copy any on-page error and check the console for a matching entry to diagnose problems.
If the **Test Settings** button reports a timeout, the network request may be blocked by Content Security Policy or CORS restrictions. The extension automatically falls back to `XMLHttpRequest` when `fetch` fails, but some environments may still prevent the call entirely.
If the **Read active tab** check fails, make sure the currently focused tab is a normal web page; the extension cannot access Chrome or extension pages.
If the tab translation step fails, the page may block script execution or DOM updates.
Some sites impose strict Content Security Policies that prevent the test element from executing or restrict network requests. Open a simple page such as `https://example.com` before running the tests. Console errors from third-party resources do not affect the translation check.
Enable **Debug logging** in the popup to see details about the active tab and any error stack returned by the content script.
If a translated page appears unchanged, verify that the source and target languages are configured correctly. With debug logging enabled the console warns when the translation result matches the original text.
Shadow DOM content and same-origin iframes are scanned and translated automatically. Cross-origin frames may be translated when host permissions allow access, otherwise they are skipped.

## Development
Run the unit tests with:
```sh
npm install
npm test
```

Run the end-to-end PDF visual comparison tests (headless) with:
```sh
npm install
npm run test:e2e
```
These tests launch a headless browser to open `src/qa/compare.html`, render two PDFs via `pdf.js`, and compute a visual diff score. The page also supports automation via query params: `?src1=/path/A.pdf&src2=/path/B.pdf&diff=1&autoload=1`, and exposes `window.diffScore` (0..1, lower is better).

### Provider registry & throttling
Built-in providers are registered through `qwenProviders.initProviders()`. This initializer is no longer invoked automatically; call it before translating if you rely on the default set. `qwenProviders.isInitialized()` reports whether defaults have been loaded. Tests or host applications may create isolated registries with `qwenProviders.createRegistry()` and pre-register custom providers before calling `initProviders()` to avoid overrides. Each provider may expose a `throttle` config and receives its own rate-limit queue created via `createThrottle`, with optional per-context limits (for example, separate queues for streaming vs. standard requests) to tune burst behavior.

#### Quick start
```js
import { initProviders } from './providers';
import { qwenTranslate } from './translator';

initProviders(); // or qwenProviders.ensureProviders();

const res = await qwenTranslate({ text: 'Hello', target: 'es' });
```

`qwenTranslate` also accepts `autoInit: true` to invoke `initProviders()` on-demand:
```js
await qwenTranslate({ text: 'Hello', target: 'es', autoInit: true });
```

`qwenFetchStrategy.choose()` decides whether requests go directly or through the background proxy; override the selection via `qwenFetchStrategy.setChooser(fn)` for testing or custom routing.

Structured logging is available through `qwenLogger`. Log levels (`error`, `warn`, `info`, `debug`) respect a global `logLevel` config and logs can be captured in tests via `addCollector`. If translation is attempted before `qwenProviders.initProviders()` is called, the translator emits a warning reminding you to initialize the default providers.

Privacy and test PDFs
- Do not commit personal or private PDFs to the repository. Root-level `*.pdf` files are ignored by `.gitignore` and CI checks will fail if any are present.
- E2E tests use synthetic PDFs generated at runtime (via `pdf-lib`) to avoid storing files.
- For local testing with private PDFs, open the viewer (`src/pdfViewer.html`) using `file:` or temporary `blob:` URLs; do not upload such files to the repo or CI.

## Command Line Utility
A simple translator CLI is included in `cli/translate.js`. It streams translations as you type by default. Use `--no-stream` for request/response mode.

### Usage
```sh
node cli/translate.js -k <API_KEY> [-e endpoint] [-m model] [--requests N] [--tokens M] [-d] [--no-stream] -s <source_lang> -t <target_lang>
```
If no endpoint is specified the tool defaults to `https://dashscope-intl.aliyuncs.com/api/v1`.
Use `-d` to print detailed request and response logs.
Press `Ctrl+C` or `Ctrl+D` to exit.

### TypeScript
Basic type definitions for the translator APIs ship in `types/index.d.ts` and are referenced via the package `types` field.

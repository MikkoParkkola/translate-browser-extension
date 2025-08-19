# TRANSLATE! by Mikko

This Chrome extension translates the content of the active tab using multiple providers. Dynamic pages are translated as new elements appear. It supports translation between more than one hundred languages.

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

## Packaging and Signing
The repository includes a workflow that builds and signs a Chrome extension package.

1. Open the **Actions** tab and run **Sign Chrome Extension**.
2. The job builds the project, signs it using the `CRX_PRIVATE_KEY` secret, and uploads `qwen-translator-extension.crx` and `qwen-translator-extension.zip` as artifacts.

To sign locally:

```sh
npm run build
echo "$CRX_PRIVATE_KEY" | base64 -d > key.pem
npx -y crx pack dist -o qwen-translator-extension.crx --zip-output qwen-translator-extension.zip -p key.pem
```

## Configuration
Open the popup and click the ⚙️ button to access **Settings**. The settings page provides:
- **General** – toggle automatic language detection and manage the glossary.
- **Providers** – add, remove or reorder providers. Use **Edit** to supply API keys, endpoints, models and per‑provider limits. Local providers such as Ollama or macOS can be added via **Add Local Provider**.
- **Advanced** – enable or clear the translation cache.

Use the **Diagnostics** button on the home page to view usage metrics and run connectivity checks.

### Where to get API keys
- DashScope (Qwen): https://dashscope.console.aliyun.com/
- OpenAI: https://platform.openai.com/api-keys
- Mistral: https://console.mistral.ai/
- Anthropic (Claude): https://console.anthropic.com/
- DeepL: https://www.deepl.com/pro-api
- Google Cloud Translation & Detection: https://cloud.google.com/translate/docs/setup
- OpenRouter: https://openrouter.ai/
- Ollama (local, no key required)
- macOS system translator (no key required)

See also: docs/PROVIDERS.md

## Usage
1. Click the toolbar icon to open the popup.
2. Use **Translate page** to translate the current tab or enable **Auto-translate** for pages on load.
3. Click the ⚙️ button to manage providers or adjust settings.

Translations apply to dynamically added content as well as embedded frames or third‑party widgets whenever the browser grants access. If translation fails the affected text is kept in a queue and retried until the API succeeds. When the translated text matches the original the node is marked as untranslatable and skipped. Translations are cached for the current session to minimise API calls.
Identical strings are translated only once and reused across matching nodes, and hidden or off‑screen elements are ignored so tokens are spent only on visible text.
Translated nodes keep their original leading and trailing whitespace. Nodes are batched to minimise API requests and maximise throughput. While translations are running the extension's toolbar icon shows an activity badge and a temporary status box in the bottom‑right corner of the page reports current work or errors. The box disappears automatically when the extension is idle.

### PDF Translation
Top‑level PDF navigations are opened in a custom viewer. The viewer can translate PDFs in two ways:
- **Provider document translation** – if Google Cloud or DeepL Pro credentials are present the entire file is sent to the provider's `translateDocument` API and the returned PDF is displayed.
- **WASM pipeline** – otherwise the viewer extracts text, translates page segments through the normal text API and renders a new PDF locally.
Translated PDFs can be saved via the viewer's **Save translated PDF** action.

### Rate Limiting
The extension and CLI queue translation requests to stay within the provider limits.
The background worker maintains a single queue so multiple page nodes are translated sequentially rather than all at once, preventing bursts that would trigger HTTP 429 errors. Nodes are batched into combined translation requests to reduce the overall query count. If the provider still returns a 429 response the request is retried automatically.
You can adjust the limits under **Requests per minute** and **Tokens per minute** in the extension popup or via `--requests` and `--tokens` on the CLI. Defaults are 60 requests and 100,000 tokens every 60 seconds.
The popup displays live usage for the last minute and colour-coded bars turn yellow or red as limits are approached. Usage statistics refresh every second and also show total requests, total tokens and the current queue length.

### Pricing & Load Balancing
Each provider entry stores an approximate monthly character limit and a cost-per-token estimate. Defaults assume roughly 500k free characters for Google and DeepL. The popup reports 24‑hour and 7‑day spend based on these rates.
Translations can be distributed across multiple providers. `providerOrder` defines the failover chain and per‑provider weights bias how parallel batches are split. The background service checks remaining quotas and skips providers that drop below the `requestThreshold`, effectively load‑balancing work across those with capacity.

### Troubleshooting
- Console logs: enable **Debug logging** in the popup. Both provider calls and content-script steps log structured events. Copy any on‑page error and look for matching console entries.
- Test Settings timeout: often CSP/CORS. The background may fall back to `XMLHttpRequest`, but strict environments can still block. Try a simple page like `https://example.com` and re‑run.
- Active tab check: the test must run on a normal web page (not `chrome://` or extension pages).
- Page unchanged: confirm source/target languages. With debug on, the console warns if the translation equals the original (already target language).
- CSP/DOM restrictions: some sites block script execution/DOM updates. Translation may be limited on such pages.
- Frames and Shadow DOM: same‑origin iframes and open Shadow DOM are supported. Cross‑origin frames require host permissions; otherwise skipped.
- Common HTTP errors:
  - 401/403 unauthorized/forbidden: missing/invalid API key. Check provider config and key format. Example: OpenAI uses `Bearer <key>`, DeepL uses `DeepL-Auth-Key <key>`.
  - 429 rate limit: requests are retried automatically respecting `Retry-After`. Lower requests/tokens per minute in provider settings or wait.
  - 5xx provider outage: transient; automatic retries apply. If persistent, switch provider or model.
- Multi‑provider failover: ensure your `providerOrder`, `endpoints`, and (optional) `detector` are set. Content flows pass these values to translation, enabling fallback beyond the popup.
- Diagnostics: use the popup **Diagnostics** panel. It shows usage, cache/TM stats, configured providers, cost summary, and a latency histogram. Use **Copy Report** to share details when filing issues.

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
Built-in providers (DashScope, OpenAI, Mistral, OpenRouter, Gemini, Anthropic, DeepL, Google, Qwen and Local WASM) are registered through `qwenProviders.initProviders()`. This initializer is no longer invoked automatically; call it before translating if you rely on the default set. `qwenProviders.isInitialized()` reports whether defaults have been loaded. Tests or host applications may create isolated registries with `qwenProviders.createRegistry()` and pre-register custom providers before calling `initProviders()` to avoid overrides. Each provider may expose a `throttle` config and receives its own rate-limit queue created via `createThrottle`, with optional per-context limits (for example, separate queues for streaming vs. standard requests) to tune burst behavior.

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

Trigger CI re-run.

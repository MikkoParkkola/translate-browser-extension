# Qwen Translator Extension

This Chrome extension translates the content of the active tab using Alibaba Cloud Qwen MT models. Dynamic pages are translated as new elements appear. It supports translation between more than one hundred languages.

## Installation
1. Run `npm install` to install development dependencies.
2. Build the extension by copying the `src` folder contents into a folder of your choice.
3. In your Chromium based browser open the extensions page and enable "Developer mode".
4. Choose "Load unpacked" and select the folder containing the extension files.
   The extension requests the "tabs" permission so the popup can send
   messages to the active tab for translation.

## Uninstallation
Remove the extension from the browser's extension management page.

## Upgrade
Reload the unpacked extension after replacing the files with a newer version.

## Configuration
Use the popup to configure:
- API key and optional endpoint (keep your API key private)
- Translation model name (defaults to `qwen-mt-turbo`)
- Source and target languages
- Automatic translation toggle
Click **Test Settings** in the popup to run a short diagnostic. The extension performs several quick checks:
1. Connect to the configured API endpoint
2. Validate the API key with a simple translation request
3. Send a streaming translation request
4. Read the contents of the active tab
5. Verify that extension settings can be saved
Each step displays a pass or fail result and honours the debug logging preference.

## Usage
Click the extension icon and choose **Translate Page**. If automatic translation is enabled the page will be translated on load. Translations apply to dynamically added content.
If translation fails, an error message appears at the bottom-right of the page. Translations are cached for the current session to minimise API calls.

### Rate Limiting
The extension and CLI queue translation requests to stay within the provider limits.
You can adjust the limits under **Requests per minute** and **Tokens per minute** in the extension popup or via `--requests` and `--tokens` on the CLI. Defaults are 60 requests and 100,000 tokens every 60 seconds.

### Troubleshooting
Both model refreshes and translation requests write trace logs to the browser console. Copy any on-page error and check the console for a matching entry to diagnose problems.
If the **Test Settings** button reports a timeout, the network request may be blocked by Content Security Policy or CORS restrictions. The extension automatically falls back to `XMLHttpRequest` when `fetch` fails, but some environments may still prevent the call entirely.

## Development
Run the unit tests with:
```sh
npm install
npm test
```

## Command Line Utility
A simple translator CLI is included in `cli/translate.js`. It streams translations as you type by default. Use `--no-stream` for request/response mode.

### Usage
```sh
node cli/translate.js -k <API_KEY> [-e endpoint] [-m model] [--requests N] [--tokens M] [-d] [--no-stream] -s <source_lang> -t <target_lang>
```
If no endpoint is specified the tool defaults to `https://dashscope-intl.aliyuncs.com/api/v1`.
Use `-d` to print detailed request and response logs.
Press `Ctrl+C` or `Ctrl+D` to exit.


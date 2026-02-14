# Privacy Policy for TRANSLATE! by Mikko

**Last updated**: February 14, 2026

## Overview

TRANSLATE! is a browser extension that translates web page content, PDFs, and selected text. It is designed with a local-first philosophy: an offline translation mode is available that processes everything on your device with zero network requests.

## Data Collection

**TRANSLATE! does not collect, transmit, or store any user analytics, telemetry, or tracking data.** There are no third-party analytics services, no usage statistics, and no crash reporting.

## How Your Data Is Handled

### Page Content

TRANSLATE! reads text content from web pages you choose to translate. This content is processed in one of two ways:

1. **Offline / Local WASM mode**: Translation is performed entirely on your device using OPUS-MT models running via WebAssembly. No page content leaves your browser.
2. **API provider mode**: When you configure an external translation provider (such as DeepL, OpenAI, Google Cloud, Anthropic, or others), the text to be translated is sent to that provider's API. The provider's own privacy policy governs how they handle that data. TRANSLATE! sends only the text necessary for translation and receives only the translated result.

### API Keys and Configuration

- API keys you enter are stored locally in `chrome.storage.local` on your device.
- API keys are never transmitted to any server other than the specific translation provider you configured them for.
- API keys are never shared with the extension developer or any third party.

### User Preferences

Settings such as your preferred language pair, provider configuration, and UI preferences are stored locally in `chrome.storage.local`. These settings never leave your device.

### Translation Cache

Translated text may be cached locally in your browser session to avoid redundant API calls. This cache is stored on your device and is not transmitted anywhere.

## Data We Do NOT Collect

- No personal information (name, email, demographics)
- No browsing history or visited URLs
- No analytics or telemetry
- No device fingerprinting
- No advertising identifiers
- No data sold or shared with third parties

## Permissions Explained

| Permission | Why It Is Needed |
|---|---|
| `storage` | Save your settings and API keys locally |
| `activeTab` | Access the current page's text for translation |
| `scripting` | Inject translation results back into the page |
| `host_permissions (all URLs)` | Translate content on any website you visit |
| `offscreen` | Run WASM-based local translation in the background |
| `contextMenus` | Provide right-click "Translate selection" option |

## Third-Party Services

When you configure an external translation provider, your text is sent to that provider. Each provider has its own privacy policy:

- [DeepL Privacy Policy](https://www.deepl.com/privacy)
- [OpenAI Privacy Policy](https://openai.com/privacy)
- [Google Cloud Privacy](https://cloud.google.com/terms/cloud-privacy-notice)
- [Anthropic Privacy Policy](https://www.anthropic.com/privacy)

You choose which providers to use. You can use TRANSLATE! entirely offline with the local WASM mode, in which case no data is sent to any external service.

## Data Retention

All data is stored locally on your device. Uninstalling the extension removes all stored data.

## Children's Privacy

TRANSLATE! does not knowingly collect data from children under 13.

## Changes to This Policy

Updates to this policy will be reflected in new extension versions. The "Last updated" date at the top will be revised accordingly.

## Contact

For privacy questions, open an issue on the [GitHub repository](https://github.com/MikkoParkkola/translate-browser-extension).

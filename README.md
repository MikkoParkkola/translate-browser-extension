# Qwen Translator Extension

This Chrome extension translates the content of the active tab using Alibaba Cloud Qwen MT models. Dynamic pages are translated as new elements appear. It supports translation between more than one hundred languages.

## Installation
1. Run `npm install` to install development dependencies.
2. Build the extension by copying the `src` folder contents into a folder of your choice.
3. In your Chromium based browser open the extensions page and enable "Developer mode".
4. Choose "Load unpacked" and select the folder containing the extension files.

## Uninstallation
Remove the extension from the browser's extension management page.

## Upgrade
Reload the unpacked extension after replacing the files with a newer version.

## Configuration
Use the extension options page to set:
- API key and optional endpoint
  (keep your API key private)
- Translation model (click Refresh to fetch available models)
- Target language and ignored languages
- Automatic translation toggle
The language and model lists include search boxes to make selection easier.

## Usage
Click the extension icon and choose **Translate Page**. If automatic translation is enabled the page will be translated on load. Translations apply to dynamically added content.
If translation fails, an error message appears at the bottom-right of the page. Translations are cached for the current session to minimise API calls.

## Development
Run the unit tests with:
```sh
npm install
npm test
```

# Active Extension Files

## Core Extension Files (Active):
- `manifest.json` - Extension configuration
- `background-simple.js` - Service worker (simplified, no dependencies)
- `contentScript-simple.js` - Page content translation
- `popup-simple.js` - Extension popup controller
- `popup.html` - Popup user interface
- `options.html` - Settings page
- `options.js` - Settings functionality

## Support Files (Active):
- `languages.js` - Language definitions
- `styles/` - CSS styling
- `icons/` - Extension icons
- `i18n/` - Internationalization
- `pdf.min.js` & `pdf.worker.min.js` - PDF.js library
- `pdfViewer.html` & `pdfViewer.js` - PDF translation support

## Archived Files (Moved to /archive/):
- All complex Node.js-style files with require() statements
- `core/` directory - Complex core modules
- `lib/` directory - Complex libraries
- `providers/` directory - Complex provider modules
- `popup/` directory - Complex popup modules
- `translator/` directory - Complex translator modules
- `commands/` directory - Command modules
- `wasm/` directory - WebAssembly modules
- `scripts/` directory - Build scripts
- All legacy background, popup, content script files

## Extension Loading:
The extension should now load cleanly without:
- "require is not defined" errors
- Service worker registration failures
- Duplicate context menu errors
- Chinese URL issues

## API Configuration:
- Uses international Alibaba Cloud endpoints
- Supports Qwen MT Turbo, Qwen MT, DeepL Free/Pro
- Clean error handling and messaging
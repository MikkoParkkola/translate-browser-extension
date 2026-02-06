# Firefox Port Documentation

This document describes the Firefox port of the TRANSLATE! extension, including technical differences, limitations, and testing instructions.

## Architecture Differences

### Chrome (MV3)
```
popup.html  --->  service-worker.ts  --->  offscreen.ts (DOM context)
                         |                        |
                    rate limiting            Transformers.js ML
                      caching                    models
```

### Firefox (MV2)
```
popup.html  --->  background-firefox.ts (persistent background page with DOM)
                         |
                  rate limiting + caching + Transformers.js ML
```

## Key Differences

| Feature | Chrome | Firefox |
|---------|--------|---------|
| Manifest Version | 3 | 2 |
| Background Context | Service Worker (no DOM) | Background Page (has DOM) |
| ML Inference | Offscreen Document | Direct in background page |
| Action API | `chrome.action` | `browser.browserAction` |
| Permissions | `offscreen` permission required | Not needed |
| CSP Format | Object-based | String-based |

## Files Created

### Core Firefox Files
- `src/manifest.firefox.json` - Manifest V2 configuration
- `src/background-firefox.html` - Background page HTML
- `src/background/background-firefox.ts` - Combined background + ML inference

### Build Configuration
- `vite.config.firefox.ts` - Firefox-specific Vite configuration
- `scripts/build-firefox.sh` - Build script

### Shared Files (Browser-Agnostic)
- `src/core/browser-api.ts` - Unified browser API wrapper

## Building

```bash
# Build Chrome version
npm run build

# Build Firefox version
npm run build:firefox

# Build both
npm run build:all

# Create XPI package
npm run package:firefox
```

## Testing in Firefox

### Developer Edition (Recommended)
1. Download Firefox Developer Edition
2. Navigate to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select `dist-firefox/manifest.json`

### Regular Firefox
1. Navigate to `about:config`
2. Set `xpinstall.signatures.required` to `false`
3. Navigate to `about:addons`
4. Click gear icon -> "Install Add-on From File"
5. Select the `.xpi` file

## Known Limitations

### 1. No Service Worker
Firefox MV2 uses persistent background pages, not service workers. This means:
- Background page is always running (higher memory usage)
- No automatic suspension/wake-up
- Simpler architecture (no offscreen document needed)

### 2. WebGPU Support
Firefox WebGPU support is experimental:
- Enabled in Nightly by default
- In stable Firefox: `about:config` -> `dom.webgpu.enabled` = `true`
- Falls back to WASM if WebGPU unavailable

### 3. Chrome Translator API
The Chrome Built-in Translator (Chrome 138+) is not available in Firefox.
The `chrome-builtin` provider will show as unavailable.

### 4. Scripting API
Firefox MV2 uses different content script injection:
- `browser.tabs.executeScript()` instead of `browser.scripting.executeScript()`
- The popup includes fallback logic for Firefox

### 5. Extension URLs
Firefox uses `moz-extension://` URLs instead of `chrome-extension://`.
The popup handles both patterns when checking for restricted pages.

## Debugging

### Background Page
1. Navigate to `about:debugging#/runtime/this-firefox`
2. Find the extension
3. Click "Inspect"

### Content Script
1. Open DevTools on any page
2. Content script logs appear in the console with `[Content]` prefix

### Common Issues

**"Permission denied" errors**
- Check that `<all_urls>` is in permissions
- Ensure the CSP allows connections to HuggingFace CDN

**Model loading hangs**
- Check network tab for failed requests
- Verify IndexedDB is working (caching)
- Try clearing browser storage

**WebAssembly errors**
- Ensure `'wasm-unsafe-eval'` is in CSP
- Check that WASM files are in `assets/` directory

## Migration from Chrome

When porting Chrome extensions to Firefox:

1. **Manifest**: Use `manifest_version: 2`
2. **Background**: Change `service_worker` to `background.page`
3. **API calls**: Replace `chrome.*` with `browser.*` (or use polyfill)
4. **Permissions**: Remove Chrome-specific permissions (`offscreen`)
5. **Action**: Use `browser_action` instead of `action`
6. **CSP**: Use string format instead of object format

## Version History

- **v2.1.0**: Initial Firefox port
  - MV2 manifest
  - Background page with direct ML inference
  - Browser-agnostic API layer
  - Both Chrome and Firefox builds from same codebase

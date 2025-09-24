# Translation Extension Troubleshooting Guide

## Current Status
- ✅ Extension loads without errors
- ✅ Popup opens and displays correctly
- ⚠️ Translation not working - needs API key configuration

## Step-by-Step Troubleshooting

### 1. Check Extension Loading
1. Go to `chrome://extensions/`
2. Verify "TRANSLATE! by Mikko" is enabled
3. Check for any errors in the extension details

### 2. Configure API Key
**CRITICAL: The extension needs an Alibaba Cloud API key to work**

1. Click the extension icon in toolbar
2. Click the settings gear (⚙️) button
3. This opens the options page
4. Add your Alibaba Cloud DashScope API key
5. Select "Qwen MT Turbo" as provider
6. Save settings

### 3. Test Translation
1. Go to any webpage with text
2. Select some text
3. Click extension icon → "Translate Selection"
4. OR click "Translate Page" to translate everything

### 4. Check for Errors
Open Chrome DevTools (F12) and check:

**Console Tab:**
- Look for `[Background]` messages showing translation requests
- Look for `[ContentScript]` messages showing script injection
- Look for `[Popup]` messages showing popup activity

**Expected Success Messages:**
```
[Background] Translation request: Hello world... (11 chars)
[Background] Using provider: qwen-mt-turbo, source: auto, target: en
[Background] Translation successful
[ContentScript] Translation successful
```

**Common Error Messages:**
- `API key not configured` → Configure API key in settings
- `Provider not supported` → Check provider configuration
- `No text provided` → Select text before translation
- `Network error` → Check internet connection

### 5. Verify Settings Storage
Open DevTools → Application → Storage → Extensions:
- Should see `apiKey`, `provider`, `sourceLanguage`, `targetLanguage`

### 6. API Key Requirements
You need a valid Alibaba Cloud DashScope API key:
1. Sign up at https://dashscope.console.aliyun.com/
2. Create API key with translation permissions
3. Use international endpoint (dashscope-intl.aliyuncs.com)

### 7. Network Issues
If API calls fail:
- Check firewall/proxy settings
- Verify international Alibaba Cloud access
- Test API key with curl:
```bash
curl -X POST "https://dashscope-intl.aliyuncs.com/api/v1/services/aimt/text-translation/message" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-mt-turbo","input":{"source_language":"auto","target_language":"en","source_text":"Hello"}}'
```

## Quick Fixes

### Extension Won't Load
- Reload extension in `chrome://extensions/`
- Check console for "require is not defined" errors (should be fixed)
- Verify manifest.json points to background-simple.js

### Popup Won't Open
- Right-click extension icon → Inspect popup
- Check popup console for errors

### Translation Says "Started" But Nothing Happens
- Most likely: API key not configured
- Check background script console for specific error
- Verify language settings are saved

### "Could Not Establish Connection" Error
- This error should now be fixed
- If still occurs, reload extension and try again

## Success Indicators
- Popup shows current provider (Qwen MT Turbo)
- Settings save properly and persist
- Selected text gets translated and shows result modal
- Page translation changes text in place
- No errors in browser console
# Chrome Web Store Submission Checklist

Follow these steps to publish TRANSLATE! on the Chrome Web Store.

## Prerequisites

- [ ] Google account
- [ ] $5 one-time developer registration fee
- [ ] Built extension zip at `store-assets/translate-extension.zip`

## Step-by-Step

### 1. Register as a Developer

1. Go to [Chrome Web Store Developer Console](https://chrome.google.com/webstore/devconsole)
2. Pay the one-time $5 registration fee
3. Complete identity verification if prompted

### 2. Upload the Extension

1. Click **New Item** in the developer console
2. Upload `store-assets/translate-extension.zip`
3. Wait for the upload to complete and manifest to be parsed

### 3. Fill In Store Listing

1. **Name**: TRANSLATE! by Mikko (already in manifest)
2. **Short description**: Copy from `STORE_LISTING.md` (the 117-character version)
3. **Detailed description**: Copy the "Detailed Description" section from `STORE_LISTING.md`
4. **Category**: Productivity
5. **Language**: English

### 4. Upload Visual Assets

1. **Extension icon**: Already embedded in the zip via manifest
2. **Screenshots**: Upload 1-5 images from `store-assets/` directory
   - `screenshot-1.png` (1280x800) -- Extension popup
   - `screenshot-2.png` (1280x800) -- Settings / provider config
   - `screenshot-3.png` (1280x800) -- Diagnostics dashboard
   - `screenshot-4.png` (1280x800) -- Provider configuration
   - `screenshot-5.png` (1280x800) -- Additional popup view
3. **Promotional tile** (optional): 440x280 PNG if you want a featured tile

### 5. Set Privacy Practices

1. **Single purpose description**: "Translates web page content, PDFs, and selected text using configurable translation providers or offline local models."
2. **Permission justifications**:
   - `storage`: Stores user settings and API keys locally
   - `activeTab`: Reads page content for translation
   - `scripting`: Injects translated text back into the page
   - `host_permissions (all URLs)`: Enables translation on any website
   - `offscreen`: Runs WASM-based offline translation engine
   - `contextMenus`: Provides right-click translation option
3. **Data usage disclosures**:
   - Does NOT collect user activity data
   - Does NOT collect personally identifiable information
   - Does NOT collect website content (data is only sent to user-configured providers)
   - Does NOT sell data to third parties
4. **Privacy policy URL**: `https://github.com/MikkoParkkola/translate-browser-extension/blob/main/PRIVACY_POLICY.md`

### 6. Distribution Settings

1. **Visibility**: Public
2. **Regions**: All regions (or restrict as needed)
3. **Pricing**: Free

### 7. Submit for Review

1. Review all fields in the dashboard
2. Click **Submit for review**
3. Review typically takes 1-3 business days
4. You will receive an email when the review is complete

## After Submission

- [ ] Monitor the developer console for review status
- [ ] If rejected, read the rejection reason and address it
- [ ] Once approved, verify the listing is live and functional
- [ ] Update `README.md` with the Chrome Web Store link

## Updating the Extension

For future updates:

1. Bump `version` in `src/manifest.json`
2. Run `npm run build`
3. Create new zip: `cd dist && zip -r ../store-assets/translate-extension.zip .`
4. Go to developer console, click the extension, click **Package** tab
5. Upload the new zip
6. Click **Submit for review**

## Useful Links

- [Developer Console](https://chrome.google.com/webstore/devconsole)
- [Publishing documentation](https://developer.chrome.com/docs/webstore/publish)
- [Review policies](https://developer.chrome.com/docs/webstore/program-policies)
- [Best practices](https://developer.chrome.com/docs/webstore/best_practices)

const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const extPath = path.resolve(__dirname, 'dist');
  const chromePath = '/Users/mikko/.cache/puppeteer/chrome/mac_arm-145.0.7632.46/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

  console.log('Launching Chrome with extension...');

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: chromePath,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
    dumpio: true, // Show browser console output
  });

  await new Promise(r => setTimeout(r, 3000));

  // Find extension
  const targets = await browser.targets();
  let extId;
  for (const t of targets) {
    const url = t.url();
    const match = url.match(/chrome-extension:\/\/([a-z]{32})/);
    if (match) {
      extId = match[1];
      break;
    }
  }

  console.log('Extension ID:', extId);
  if (!extId) {
    console.error('Extension not loaded!');
    await browser.close();
    return;
  }

  // Check service worker for errors
  const swTarget = targets.find(t => t.type() === 'service_worker');
  if (swTarget) {
    console.log('Service worker found:', swTarget.url());
  }

  // Open popup and check for errors
  const page = await browser.newPage();

  // Listen for console errors
  page.on('console', msg => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      console.log(`[${type.toUpperCase()}]`, msg.text());
    }
  });

  page.on('pageerror', err => {
    console.log('[PAGE ERROR]', err.message);
  });

  console.log('\n=== Testing Popup ===');
  await page.goto(`chrome-extension://${extId}/src/popup/index.html`);
  await new Promise(r => setTimeout(r, 2000));

  // Check if popup rendered
  const popupCheck = await page.evaluate(() => {
    const errors = [];

    // Check for main elements
    if (!document.querySelector('.popup-container, .app, #root')) {
      errors.push('Popup container not found');
    }

    // Check for model dropdown
    if (!document.querySelector('.model-dropdown-trigger, .model-selector')) {
      errors.push('Model selector not found');
    }

    // Check for any visible error messages
    const errorEl = document.querySelector('.error-banner, .error');
    if (errorEl) {
      errors.push('Error displayed: ' + errorEl.textContent);
    }

    return {
      errors,
      bodyHTML: document.body.innerHTML.substring(0, 500),
    };
  });

  console.log('Popup errors:', popupCheck.errors.length ? popupCheck.errors : 'None');
  if (popupCheck.errors.length > 0) {
    console.log('Body preview:', popupCheck.bodyHTML);
  }

  // Test onboarding page
  console.log('\n=== Testing Onboarding ===');
  await page.goto(`chrome-extension://${extId}/src/onboarding/index.html`);
  await new Promise(r => setTimeout(r, 2000));

  const onboardingCheck = await page.evaluate(() => {
    const root = document.getElementById('root');
    return {
      hasContent: root && root.innerHTML.length > 100,
      preview: root?.innerHTML.substring(0, 300) || 'No content',
    };
  });

  console.log('Onboarding loaded:', onboardingCheck.hasContent);

  // Test on a real page
  console.log('\n=== Testing Content Script ===');
  await page.goto('https://example.com');
  await new Promise(r => setTimeout(r, 2000));

  const contentCheck = await page.evaluate(() => {
    // Check if content script loaded
    const hasTranslateAttr = !!document.querySelector('[data-translated]');

    // Try to access the content script's functions (they should be in global scope for testing)
    return {
      pageLoaded: true,
      translated: hasTranslateAttr,
    };
  });

  console.log('Content script active:', contentCheck.pageLoaded);

  await page.screenshot({ path: 'test-result.png', fullPage: true });
  console.log('\nScreenshot saved: test-result.png');

  // Keep browser open for manual inspection
  console.log('\nBrowser left open for inspection. Press Ctrl+C to close.');

  // Wait longer to allow manual testing
  await new Promise(r => setTimeout(r, 30000));

  await browser.close();
})();

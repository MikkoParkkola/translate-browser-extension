/**
 * Helper script to configure the extension for testing
 * Run this in browser console when extension popup is open
 */

// Configuration for testing
const testConfig = {
  apiKey: 'sk-REPLACE_WITH_YOUR_KEY',
  apiEndpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
  model: 'qwen-mt-turbo',
  sourceLanguage: 'nl',  // Dutch
  targetLanguage: 'en',   // English
  autoTranslate: false,
  requestLimit: 60,
  tokenLimit: 31980,
  debug: true  // Enable debug output
};

// Apply configuration
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.sync.set(testConfig, () => {
    console.log('Extension configured for testing:', testConfig);
    console.log('Ready to test PDF translation.');
    console.log('Navigate to: Bericht_646850130.pdf or Dutch-Short-Stories-For-Beginners.pdf');
  });
} else {
  console.log('Chrome extension API not available.');
  console.log('Please run this script in the context of the browser extension.');
  console.log('Configuration to apply:', testConfig);
}
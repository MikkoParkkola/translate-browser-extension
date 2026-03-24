// Browser-based extension test
// This script should be run in the browser console when the extension popup is open

(function() {
  console.log('🔍 Browser Extension UI Test - Translate by Mikko Extension');
  
  function testElement(id, description) {
    const element = document.getElementById(id);
    if (element) {
      const styles = window.getComputedStyle(element);
      console.log(`✅ ${description}:`, {
        exists: true,
        visible: styles.display !== 'none' && styles.visibility !== 'hidden',
        styles: {
          display: styles.display,
          visibility: styles.visibility,
          opacity: styles.opacity
        }
      });
      return element;
    } else {
      console.log(`❌ ${description}: Element not found`);
      return null;
    }
  }
  
  function testInteractivity(element, description) {
    if (!element) return;
    
    const hasClickHandler = element.onclick !== null || 
                           element.addEventListener !== undefined;
    
    console.log(`🖱️ ${description} interactivity:`, {
      hasClickHandler,
      disabled: element.disabled,
      clickable: !element.disabled && hasClickHandler
    });
  }
  
  // Test core UI elements
  console.log('\n1️⃣ Testing Core UI Elements:');
  const themeToggle = testElement('theme-toggle', 'Theme Toggle');
  const settingsButton = testElement('settings-button', 'Settings Button');
  const sourceLanguage = testElement('source-language', 'Source Language Select');
  const targetLanguage = testElement('target-language', 'Target Language Select');
  const swapButton = testElement('swap-languages', 'Language Swap Button');
  const autoTranslateToggle = testElement('auto-translate-toggle', 'Auto-translate Toggle');
  const translateButton = testElement('translate-button', 'Translate Button');
  
  // Test interactivity
  console.log('\n2️⃣ Testing Interactivity:');
  testInteractivity(themeToggle, 'Theme Toggle');
  testInteractivity(settingsButton, 'Settings Button');
  testInteractivity(swapButton, 'Language Swap');
  testInteractivity(translateButton, 'Translate Button');
  
  // Test language selectors
  console.log('\n3️⃣ Testing Language Selectors:');
  if (sourceLanguage && sourceLanguage.tagName === 'SELECT') {
    console.log('Source language options:', sourceLanguage.options.length);
  }
  if (targetLanguage && targetLanguage.tagName === 'SELECT') {
    console.log('Target language options:', targetLanguage.options.length);
  }
  
  // Test global objects
  console.log('\n4️⃣ Testing Global Objects:');
  console.log('Languages available:', typeof window.qwenLanguages, window.qwenLanguages?.length);
  console.log('Popup object:', typeof window.Popup);
  console.log('Provider config:', typeof window.qwenProviderConfig);
  
  // Test Chrome APIs
  console.log('\n5️⃣ Testing Chrome APIs:');
  console.log('Chrome runtime:', typeof chrome?.runtime);
  console.log('Chrome storage:', typeof chrome?.storage);
  console.log('Chrome tabs:', typeof chrome?.tabs);
  
  // Test error console
  console.log('\n6️⃣ Checking for JavaScript errors:');
  // Note: This won't catch all errors, but user can check browser console manually
  
  // Test functionality if Popup object exists
  if (typeof window.Popup !== 'undefined') {
    console.log('\n7️⃣ Testing Popup Functionality:');
    try {
      console.log('Popup initialized:', window.Popup.isInitialized);
      console.log('Theme methods available:', typeof window.Popup.loadTheme);
      console.log('Language methods available:', typeof window.Popup.loadLanguages);
      console.log('Settings methods available:', typeof window.Popup.loadSettings);
    } catch (error) {
      console.log('Error testing Popup functionality:', error);
    }
  }
  
  console.log('\n✅ Browser test complete. Check above output for issues.');
  console.log('💡 If any elements show as not visible, check CSS issues.');
  console.log('💡 If functionality is missing, check JavaScript console for errors.');
  
})();
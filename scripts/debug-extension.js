// Extension Debug Helper
// Copy and paste this code into the browser console when the extension popup is open

(function() {
  console.clear();
  console.log('🔍 Extension Debug Helper - Qwen Translator');
  console.log('================================================\n');
  
  // Helper function to check element state
  function checkElement(id, name) {
    const element = document.getElementById(id);
    const exists = !!element;
    let visible = false;
    let interactive = false;
    
    if (element) {
      const styles = window.getComputedStyle(element);
      visible = styles.display !== 'none' && 
                styles.visibility !== 'hidden' && 
                styles.opacity !== '0';
      interactive = !element.disabled && element.offsetParent !== null;
    }
    
    console.log(`${exists ? '✅' : '❌'} ${name}:`, {
      exists,
      visible,
      interactive,
      element: element || 'not found'
    });
    
    return element;
  }
  
  // Check all UI elements
  console.log('📋 UI Elements Status:');
  const themeToggle = checkElement('theme-toggle', 'Theme Toggle');
  const settingsBtn = checkElement('settings-button', 'Settings Button');
  const sourceSelect = checkElement('source-language', 'Source Language Select');
  const targetSelect = checkElement('target-language', 'Target Language Select');
  const swapBtn = checkElement('swap-languages', 'Language Swap Button');
  const autoToggle = checkElement('auto-translate-toggle', 'Auto-translate Toggle');
  const translateBtn = checkElement('translate-button', 'Translate Button');
  const loadingOverlay = checkElement('loading-overlay', 'Loading Overlay');
  const statsChart = checkElement('stats-chart', 'Stats Chart');
  const statsRefresh = checkElement('stats-refresh', 'Stats Refresh Button');
  
  // Check language options
  console.log('\n🌐 Language Options:');
  if (sourceSelect && sourceSelect.tagName === 'SELECT') {
    console.log('Source language options:', sourceSelect.options.length);
    if (sourceSelect.options.length === 0) {
      console.log('⚠️ No options in source language select!');
    }
  }
  
  if (targetSelect && targetSelect.tagName === 'SELECT') {
    console.log('Target language options:', targetSelect.options.length);
    if (targetSelect.options.length === 0) {
      console.log('⚠️ No options in target language select!');
    }
  }
  
  // Check global objects
  console.log('\n🔧 JavaScript Objects:');
  console.log('window.qwenLanguages:', typeof window.qwenLanguages, window.qwenLanguages?.length);
  console.log('window.Popup:', typeof window.Popup);
  console.log('window.qwenProviderConfig:', typeof window.qwenProviderConfig);
  console.log('window.qwenProviders:', typeof window.qwenProviders);
  
  // Check Chrome APIs
  console.log('\n⚡ Chrome Extension APIs:');
  console.log('chrome.runtime:', typeof chrome?.runtime);
  console.log('chrome.storage:', typeof chrome?.storage);
  console.log('chrome.tabs:', typeof chrome?.tabs);
  
  // Check initialization
  if (window.Popup) {
    console.log('\n🎯 Popup Object Status:');
    try {
      console.log('isInitialized:', window.Popup.isInitialized);
      console.log('themeToggle reference:', !!window.Popup.themeToggle);
      console.log('sourceLanguageSelect reference:', !!window.Popup.sourceLanguageSelect);
      console.log('targetLanguageSelect reference:', !!window.Popup.targetLanguageSelect);
    } catch (error) {
      console.log('Error checking Popup object:', error);
    }
  }
  
  // Test basic functionality
  console.log('\n🧪 Basic Functionality Tests:');
  
  // Test theme toggle
  if (themeToggle) {
    const hasThemeClass = document.documentElement.classList.contains('theme-dark') || 
                         document.documentElement.classList.contains('theme-light');
    console.log('Theme system:', hasThemeClass ? '✅ Working' : '⚠️ Not detected');
  }
  
  // Test translate button state
  if (translateBtn) {
    console.log('Translate button state:', {
      disabled: translateBtn.disabled,
      hasText: !!translateBtn.textContent.trim(),
      clickable: !translateBtn.disabled && translateBtn.offsetParent !== null
    });
  }
  
  // Check for common errors
  console.log('\n🐛 Error Detection:');
  const errors = [];
  
  if (!window.qwenLanguages || window.qwenLanguages.length === 0) {
    errors.push('Languages not loaded');
  }
  
  if (sourceSelect && sourceSelect.options.length === 0) {
    errors.push('Source language select is empty');
  }
  
  if (targetSelect && targetSelect.options.length === 0) {
    errors.push('Target language select is empty');
  }
  
  if (!window.Popup) {
    errors.push('Popup object not available');
  } else if (!window.Popup.isInitialized) {
    errors.push('Popup not initialized');
  }
  
  if (errors.length === 0) {
    console.log('✅ No obvious errors detected');
  } else {
    console.log('⚠️ Potential issues:');
    errors.forEach(error => console.log(`   - ${error}`));
  }
  
  // Suggestions
  console.log('\n💡 Debugging Suggestions:');
  console.log('1. Check browser console for JavaScript errors');
  console.log('2. Verify all script files are loading (Network tab)');
  console.log('3. Check Chrome extension permissions');
  console.log('4. Try reloading the extension');
  console.log('5. Test in a new incognito window');
  
  console.log('\n✅ Debug check complete!');
  console.log('Copy this output if reporting issues.');
  
})();
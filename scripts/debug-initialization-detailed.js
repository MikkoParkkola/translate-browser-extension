// Detailed initialization debugging script
// Paste this into browser console when extension popup is open

(function() {
  console.clear();
  console.log('🔍 DETAILED INITIALIZATION DEBUG');
  console.log('==================================\n');
  
  // Check if all global dependencies are available
  console.log('📚 Global Dependencies Check:');
  const globals = [
    'window.qwenLogger',
    'window.qwenErrorHandler', 
    'window.OnboardingWizard',
    'window.IntelligentLanguageSelection',
    'window.TranslationProgress',
    'window.qwenLanguages',
    'window.qwenProviderConfig',
    'window.qwenProviders',
    'window.Popup'
  ];
  
  globals.forEach(globalName => {
    try {
      const obj = eval(globalName);
      console.log(`✅ ${globalName}:`, typeof obj, obj ? '(available)' : '(null)');
    } catch (error) {
      console.log(`❌ ${globalName}: undefined or error -`, error.message);
    }
  });
  
  // Check Chrome APIs
  console.log('\n🌐 Chrome Extension APIs:');
  console.log('chrome.runtime:', typeof chrome?.runtime);
  console.log('chrome.storage:', typeof chrome?.storage);
  console.log('chrome.tabs:', typeof chrome?.tabs);
  
  // Check DOM elements
  console.log('\n🎨 DOM Elements Check:');
  const elements = [
    'init-loading',
    'theme-toggle',
    'source-language',
    'target-language', 
    'translate-button'
  ];
  
  elements.forEach(id => {
    const element = document.getElementById(id);
    console.log(`${element ? '✅' : '❌'} #${id}:`, element ? 'found' : 'not found');
  });
  
  // Test initialization sequence manually
  console.log('\n🔧 Manual Initialization Test:');
  
  if (window.Popup && !window.Popup.isInitialized) {
    console.log('🚀 Starting manual initialization...');
    
    // Override initialize method to add debug logging
    const originalInitialize = window.Popup.initialize;
    window.Popup.initialize = async function() {
      console.log('🏁 Step 1: Starting initialize()');
      
      if (this.isInitialized) {
        console.log('⏭️ Already initialized, skipping');
        return;
      }
      
      try {
        console.log('🔧 Step 2: Initializing UI elements...');
        
        // Check error handler availability
        if (!window.qwenErrorHandler) {
          console.log('⚠️ Error handler not available, may be loading...');
        }
        
        console.log('📋 Step 3: Calling waitForDependencies...');
        await this.waitForDependencies();
        console.log('✅ Dependencies wait complete');
        
        console.log('🎨 Step 4: Loading theme...');
        await this.loadTheme();
        console.log('✅ Theme loaded');
        
        console.log('🌐 Step 5: Loading languages...');
        await this.loadLanguages();
        console.log('✅ Languages loaded');
        
        console.log('⚙️ Step 6: Loading settings...');
        await this.loadSettings();
        console.log('✅ Settings loaded');
        
        console.log('🔗 Step 7: Initialize with background...');
        await this.initializeWithBackground();
        console.log('✅ Background communication initialized');
        
        console.log('📊 Step 8: Loading usage stats...');
        await this.loadUsageStats();
        console.log('✅ Usage stats loaded');
        
        console.log('👂 Step 9: Setting up event listeners...');
        this.setupEventListeners();
        console.log('✅ Event listeners setup');
        
        console.log('✨ Step 10: Initialize enhancements...');
        await this.initializeEnhancements();
        console.log('✅ Enhancements initialized');
        
        console.log('🎯 Step 11: Hiding loading indicator...');
        const initLoading = document.getElementById('init-loading');
        if (initLoading) {
          initLoading.style.display = 'none';
          console.log('✅ Loading indicator hidden');
        } else {
          console.log('⚠️ Loading indicator not found');
        }
        
        this.isInitialized = true;
        console.log('🎉 INITIALIZATION COMPLETE!');
        
      } catch (error) {
        console.error('💥 INITIALIZATION FAILED at step:', error);
        console.error('Stack trace:', error.stack);
      }
    };
    
    // Start initialization
    window.Popup.initialize().catch(error => {
      console.error('🚨 Initialization promise rejected:', error);
    });
    
  } else if (window.Popup && window.Popup.isInitialized) {
    console.log('✅ Popup is already initialized');
  } else {
    console.log('❌ Popup object not available');
  }
  
  console.log('\n📝 Instructions:');
  console.log('- Watch the console output above for where initialization stops');
  console.log('- If it hangs, the last logged step shows where the problem is');
  console.log('- Check browser Network tab for failed script loads');
  
})();
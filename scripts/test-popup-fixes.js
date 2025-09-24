/**
 * Browser Test Script for Popup Fixes
 * Run this in the extension popup's developer tools console
 */

console.log('🧪 POPUP FIXES VALIDATION TEST');
console.log('================================');

// Test 1: Verify Enhanced Dependency Waiting
console.log('\n📦 Testing Enhanced Dependency Waiting:');
const testDependencies = () => {
  const requiredGlobals = [
    'qwenLanguages',
    'window.onboardingWizard',
    'chrome',
    'chrome.runtime'
  ];
  
  let passed = 0;
  requiredGlobals.forEach(global => {
    const parts = global.split('.');
    let obj = window;
    let exists = true;
    
    for (const part of parts) {
      if (obj && obj[part]) {
        obj = obj[part];
      } else {
        exists = false;
        break;
      }
    }
    
    console.log(`${exists ? '✅' : '❌'} ${global}: ${exists ? 'Available' : 'Missing'}`);
    if (exists) passed++;
  });
  
  return passed === requiredGlobals.length;
};

const dependenciesOK = testDependencies();

// Test 2: Button Event Handler Tests
console.log('\n🔘 Testing Button Event Handlers:');
const testButtons = () => {
  const buttons = [
    { id: 'translate-button', name: 'Translate Button' },
    { id: 'theme-toggle', name: 'Theme Toggle' },
    { id: 'settings-button', name: 'Settings Button' },
    { id: 'auto-translate-toggle', name: 'Auto-translate Toggle' },
    { id: 'swap-languages', name: 'Swap Languages Button' }
  ];
  
  let workingButtons = 0;
  buttons.forEach(({ id, name }) => {
    const button = document.getElementById(id);
    if (button) {
      const events = getEventListeners ? getEventListeners(button) : {};
      const hasEvents = events && Object.keys(events).length > 0;
      console.log(`${hasEvents ? '✅' : '❌'} ${name}: ${hasEvents ? 'Has event listeners' : 'No event listeners'}`);
      if (hasEvents) workingButtons++;
    } else {
      console.log(`❌ ${name}: Element not found`);
    }
  });
  
  return workingButtons >= 3; // At least translate, theme, settings should work
};

const buttonsOK = testButtons();

// Test 3: API Key Configuration Check
console.log('\n🔑 Testing API Key Configuration:');
const testApiKeys = () => {
  return new Promise((resolve) => {
    if (chrome && chrome.storage) {
      chrome.storage.sync.get(null, (result) => {
        if (chrome.runtime.lastError) {
          console.log('❌ Storage access error:', chrome.runtime.lastError);
          resolve(false);
        } else {
          console.log('✅ Storage accessible');
          
          if (result.providers) {
            console.log('✅ Providers configuration found');
            const hasAnyApiKey = Object.values(result.providers).some(provider => provider.apiKey);
            console.log(`🔑 API Keys: ${hasAnyApiKey ? 'Present' : 'Missing'}`);
            
            if (!hasAnyApiKey && !result.hasCompletedOnboarding) {
              console.log('💡 Should show onboarding hint');
            }
          } else {
            console.log('⚠️ No providers configuration - should trigger onboarding');
          }
          resolve(true);
        }
      });
    } else {
      console.log('❌ Chrome storage not available');
      resolve(false);
    }
  });
};

// Test 4: Background Script Communication
console.log('\n📡 Testing Background Communication:');
const testBackgroundCommunication = () => {
  return new Promise((resolve) => {
    if (chrome && chrome.runtime) {
      chrome.runtime.sendMessage({ action: 'ping' }, response => {
        if (chrome.runtime.lastError) {
          console.log('❌ Background communication error:', chrome.runtime.lastError);
          resolve(false);
        } else {
          console.log('✅ Background script responding');
          resolve(true);
        }
      });
    } else {
      console.log('❌ Chrome runtime not available');
      resolve(false);
    }
  });
};

// Test 5: Notification System Test
console.log('\n🔔 Testing Notification System:');
const testNotifications = () => {
  if (window.Popup && window.Popup.showNotification) {
    try {
      window.Popup.showNotification('Test notification', 'info');
      console.log('✅ Notification system working');
      return true;
    } catch (error) {
      console.log('❌ Notification system error:', error);
      return false;
    }
  } else {
    console.log('❌ Notification system not available');
    return false;
  }
};

const notificationsOK = testNotifications();

// Test 6: Onboarding Hint Test
console.log('\n🎓 Testing Onboarding Hint:');
const testOnboardingHint = () => {
  if (window.Popup && window.Popup.showOnboardingHint) {
    try {
      // Check if hint should be shown based on configuration
      console.log('✅ Onboarding hint method available');
      console.log('💡 Try window.Popup.showOnboardingHint() to test');
      return true;
    } catch (error) {
      console.log('❌ Onboarding hint error:', error);
      return false;
    }
  } else {
    console.log('❌ Onboarding hint not available');
    return false;
  }
};

const onboardingHintOK = testOnboardingHint();

// Run async tests
(async () => {
  const apiKeysOK = await testApiKeys();
  const backgroundOK = await testBackgroundCommunication();
  
  // Final Summary
  setTimeout(() => {
    console.log('\n📋 FINAL TEST RESULTS:');
    console.log('========================');
    
    const results = [
      { test: 'Dependencies Loading', passed: dependenciesOK },
      { test: 'Button Event Handlers', passed: buttonsOK },
      { test: 'API Key Configuration', passed: apiKeysOK },
      { test: 'Background Communication', passed: backgroundOK },
      { test: 'Notification System', passed: notificationsOK },
      { test: 'Onboarding Hint', passed: onboardingHintOK }
    ];
    
    const passedTests = results.filter(r => r.passed).length;
    const totalTests = results.length;
    
    console.log(`\n📊 Results: ${passedTests}/${totalTests} tests passed`);
    
    results.forEach(({ test, passed }) => {
      console.log(`${passed ? '✅' : '❌'} ${test}`);
    });
    
    if (passedTests === totalTests) {
      console.log('\n🎉 ALL TESTS PASSED! Popup functionality should be working correctly.');
    } else if (passedTests >= totalTests * 0.8) {
      console.log('\n✅ Most tests passed. Extension should work with minor issues.');
    } else {
      console.log('\n⚠️ Some critical tests failed. Check the issues above.');
    }
    
    console.log('\n💡 Next Steps:');
    console.log('1. Test the translate button by clicking it');
    console.log('2. Test theme toggle and settings button');
    console.log('3. Check if onboarding appears when no API keys configured');
    console.log('4. Verify notifications appear when buttons are clicked');
    
  }, 2000);
})();
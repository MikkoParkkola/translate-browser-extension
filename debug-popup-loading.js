/**
 * Debug script to diagnose popup loading and functionality issues
 * Run this in the extension popup's developer tools console
 */

console.log('🔍 POPUP LOADING DIAGNOSTIC SCRIPT');
console.log('=====================================');

// 1. Check if all expected scripts are loaded
const expectedGlobals = [
    'qwenLogger',
    'qwenLanguages', 
    'IntelligentLanguageSelection',
    'TranslationProgress',
    'window.onboardingWizard'
];

console.log('\n📦 SCRIPT LOADING STATUS:');
expectedGlobals.forEach(global => {
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
    
    console.log(`${exists ? '✅' : '❌'} ${global}:`, exists ? 'Loaded' : 'Missing');
});

// 2. Check DOM elements
const expectedElements = [
    'source-language',
    'target-language', 
    'translate-button',
    'auto-translate-toggle',
    'theme-toggle',
    'settings-button',
    'test-settings-button'
];

console.log('\n🏗️ DOM ELEMENTS STATUS:');
expectedElements.forEach(id => {
    const element = document.getElementById(id);
    console.log(`${element ? '✅' : '❌'} #${id}:`, element ? 'Found' : 'Missing');
    
    if (element) {
        // Check if element has event listeners
        const events = getEventListeners ? getEventListeners(element) : 'Event listeners check not available';
        if (events && Object.keys(events).length > 0) {
            console.log(`   📡 Events:`, Object.keys(events));
        } else {
            console.log(`   ⚠️  No event listeners detected`);
        }
    }
});

// 3. Check Chrome API availability  
console.log('\n🌐 CHROME API STATUS:');
console.log(`${chrome ? '✅' : '❌'} chrome:`, chrome ? 'Available' : 'Missing');
if (chrome) {
    console.log(`${chrome.runtime ? '✅' : '❌'} chrome.runtime:`, chrome.runtime ? 'Available' : 'Missing');
    console.log(`${chrome.storage ? '✅' : '❌'} chrome.storage:`, chrome.storage ? 'Available' : 'Missing');
    console.log(`${chrome.tabs ? '✅' : '❌'} chrome.tabs:`, chrome.tabs ? 'Available' : 'Missing');
}

// 4. Check for JavaScript errors in console
console.log('\n🚨 CONSOLE ERRORS:');
const originalError = console.error;
const errors = [];
console.error = function(...args) {
    errors.push(args);
    originalError.apply(console, args);
};

// 5. Test Chrome storage access
if (chrome && chrome.storage) {
    console.log('\n💾 TESTING STORAGE ACCESS:');
    
    chrome.storage.sync.get(null, (result) => {
        if (chrome.runtime.lastError) {
            console.log('❌ Storage error:', chrome.runtime.lastError);
        } else {
            console.log('✅ Storage accessible');
            console.log('📄 Current config keys:', Object.keys(result));
            
            // Check for API keys
            if (result.providers) {
                console.log('🔑 API Keys status:');
                Object.entries(result.providers).forEach(([provider, config]) => {
                    console.log(`  ${provider}: ${config.apiKey ? '✅ Has key' : '❌ No key'}`);
                });
            } else {
                console.log('⚠️ No providers configuration found');
            }
        }
    });
}

// 6. Test background script communication
if (chrome && chrome.runtime) {
    console.log('\n📡 TESTING BACKGROUND COMMUNICATION:');
    
    chrome.runtime.sendMessage({ action: 'ping' }, response => {
        if (chrome.runtime.lastError) {
            console.log('❌ Background communication error:', chrome.runtime.lastError);
        } else {
            console.log('✅ Background script responding:', response);
        }
    });
}

// 7. Check CSS loading
console.log('\n🎨 CSS LOADING STATUS:');
const stylesheets = Array.from(document.styleSheets);
console.log(`Found ${stylesheets.length} stylesheets:`);
stylesheets.forEach((sheet, index) => {
    try {
        const href = sheet.href || 'inline';
        const rulesCount = sheet.cssRules ? sheet.cssRules.length : 'unknown';
        console.log(`  ${index + 1}. ${href} (${rulesCount} rules)`);
    } catch (e) {
        console.log(`  ${index + 1}. Error accessing stylesheet:`, e.message);
    }
});

// 8. Test button functionality
console.log('\n🔘 TESTING BUTTON FUNCTIONALITY:');
const testButton = (id, description) => {
    const button = document.getElementById(id);
    if (button) {
        console.log(`Testing ${description}...`);
        
        // Check if button is properly styled
        const computed = getComputedStyle(button);
        const isVisible = computed.display !== 'none' && computed.visibility !== 'hidden';
        console.log(`  Visibility: ${isVisible ? '✅ Visible' : '❌ Hidden'}`);
        
        // Check if button is clickable
        const isClickable = !button.disabled && computed.pointerEvents !== 'none';
        console.log(`  Clickable: ${isClickable ? '✅ Yes' : '❌ No'}`);
        
        // Simulate click
        try {
            button.click();
            console.log(`  Click test: ✅ No errors`);
        } catch (e) {
            console.log(`  Click test: ❌ Error:`, e.message);
        }
    } else {
        console.log(`❌ Button #${id} not found`);
    }
};

testButton('translate-button', 'Translate button');
testButton('theme-toggle', 'Theme toggle');
testButton('settings-button', 'Settings button');

// 9. Summary
setTimeout(() => {
    console.log('\n📋 DIAGNOSTIC SUMMARY:');
    console.log('=====================================');
    
    if (errors.length > 0) {
        console.log(`❌ Found ${errors.length} JavaScript errors`);
        errors.forEach(error => console.log('   -', error));
    } else {
        console.log('✅ No JavaScript errors detected in this session');
    }
    
    console.log('\n💡 RECOMMENDATIONS:');
    if (!window.qwenLogger) {
        console.log('- Logger not loaded: Check lib/logger.js');
    }
    if (!window.qwenLanguages) {
        console.log('- Languages not loaded: Check languages.js');
    }
    if (!chrome || !chrome.runtime) {
        console.log('- Chrome APIs not available: Extension may not be properly installed');
    }
    
    console.log('\n🎯 To fix the issues, run:');
    console.log('1. Check browser console for script loading errors');
    console.log('2. Verify all referenced JS files exist');
    console.log('3. Test Chrome extension permissions');
    console.log('4. Reload extension from chrome://extensions');
}, 1000);
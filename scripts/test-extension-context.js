// Test script to check extension context conflicts
// Run this in the browser extension environment

console.log('🔍 EXTENSION CONTEXT ANALYSIS');
console.log('=============================\n');

// Check if we're in a service worker context
console.log('📋 Context Information:');
console.log('typeof self:', typeof self);
console.log('typeof window:', typeof window);
console.log('typeof global:', typeof global);
console.log('typeof chrome:', typeof chrome);
console.log('typeof importScripts:', typeof importScripts);

// Check for conflicting globals
console.log('\n🔍 Global Identifier Check:');
const potentialConflicts = [
  'OnboardingWizard',
  'IntelligentLanguageSelection', 
  'TranslationProgress',
  'Command',
  'qwenLogger',
  'qwenErrorHandler',
  'qwenCommandDispatcher'
];

potentialConflicts.forEach(name => {
  try {
    const windowValue = typeof window !== 'undefined' ? window[name] : undefined;
    const selfValue = typeof self !== 'undefined' ? self[name] : undefined;
    const globalValue = typeof global !== 'undefined' ? global[name] : undefined;
    
    console.log(`${name}:`);
    console.log(`  window.${name}: ${typeof windowValue}`);
    console.log(`  self.${name}: ${typeof selfValue}`);
    if (typeof global !== 'undefined') {
      console.log(`  global.${name}: ${typeof globalValue}`);
    }
  } catch (error) {
    console.log(`${name}: Error accessing - ${error.message}`);
  }
});

// Check script loading status
console.log('\n📜 Script Loading Status:');
if (typeof document !== 'undefined') {
  const scripts = document.querySelectorAll('script[src]');
  console.log(`Found ${scripts.length} script tags:`);
  scripts.forEach((script, index) => {
    console.log(`${index + 1}. ${script.src}`);
  });
} else {
  console.log('No document object available (service worker context)');
}

// Check for duplicate declarations
console.log('\n⚠️ Checking for Duplicate Declarations:');
try {
  // This will throw if there are duplicate const declarations
  eval('const testDuplicate = "test1";');
  eval('const testDuplicate = "test2";');
} catch (error) {
  if (error.message.includes('already been declared')) {
    console.log('✅ Duplicate const declarations throw errors as expected');
  } else {
    console.log('❌ Unexpected error:', error.message);
  }
}

console.log('\n💡 Analysis Complete');
console.log('If you see duplicate identifiers, check for:');
console.log('1. Scripts loaded multiple times in HTML');
console.log('2. Same scripts imported in service worker and popup');
console.log('3. Extension context confusion between popup/background');
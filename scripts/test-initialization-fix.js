#!/usr/bin/env node

/**
 * Test script to verify the initialization hang fix
 * Tests that all required modules are available in the correct order
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Testing Initialization Fix');
console.log('===============================\n');

// Read popup.html to verify all scripts are loaded
const popupHtmlPath = path.join(__dirname, '../src/popup.html');
const popupHtml = fs.readFileSync(popupHtmlPath, 'utf8');

// Check that all required scripts are present
const requiredScripts = [
  'lib/logger.js',
  'lib/providers.js',
  'providers/index.js', 
  'providerConfig.js',
  'languages.js',
  'onboarding.js',
  'intelligent-language-selection.js',
  'translation-progress.js',
  'popup.js'
];

console.log('📋 Script Loading Order Check:');
requiredScripts.forEach((script, index) => {
  if (popupHtml.includes(`src="${script}"`)) {
    console.log(`${index + 1}. ✅ ${script}`);
  } else {
    console.log(`${index + 1}. ❌ ${script} - NOT FOUND`);
  }
});

// Verify files exist
console.log('\n📁 File Existence Check:');
requiredScripts.forEach(script => {
  const filePath = path.join(__dirname, '../src', script);
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    console.log(`✅ ${script} (${stats.size} bytes)`);
  } else {
    console.log(`❌ ${script} - FILE NOT FOUND`);
  }
});

// Check popup.js for waitForDependencies function
console.log('\n🔍 waitForDependencies() Analysis:');
const popupJsPath = path.join(__dirname, '../src/popup.js');
const popupJs = fs.readFileSync(popupJsPath, 'utf8');

const dependencyChecks = [
  'OnboardingWizard',
  'IntelligentLanguageSelection', 
  'TranslationProgress'
];

dependencyChecks.forEach(dep => {
  if (popupJs.includes(`typeof window.${dep} === 'undefined'`)) {
    console.log(`✅ ${dep} - dependency check present`);
  } else {
    console.log(`❌ ${dep} - dependency check missing`);
  }
});

// Check for initialization loading indicator hide
console.log('\n🎨 Loading Indicator Check:');
if (popupJs.includes("getElementById('init-loading')") && 
    popupJs.includes("style.display = 'none'")) {
  console.log('✅ Loading indicator hide code present');
} else {
  console.log('❌ Loading indicator hide code missing');
}

console.log('\n📊 Summary:');
console.log('The fix addresses the initialization hang by:');
console.log('1. Loading missing script dependencies (onboarding.js, intelligent-language-selection.js, translation-progress.js)');
console.log('2. waitForDependencies() will now find these modules and not timeout');
console.log('3. Initialization will complete and hide the loading indicator');
console.log('\n✅ Test Complete - Load the extension to verify the fix!');
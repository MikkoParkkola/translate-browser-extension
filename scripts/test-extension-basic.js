#!/usr/bin/env node

/**
 * Basic Extension Testing Script
 * Tests core functionality without requiring browser extension APIs
 */

console.log('🧪 Basic Extension Test Suite');
console.log('==============================');

const fs = require('fs');
const path = require('path');

// Test 1: Check if all referenced files exist
console.log('\n📁 File Existence Test:');

const srcDir = path.join(__dirname, '..', 'src');
const requiredFiles = [
    'popup.html',
    'popup.js',
    'manifest.json',
    'lib/logger.js',
    'lib/providers.js', 
    'providers/index.js',
    'providerConfig.js',
    'languages.js',
    'onboarding.js',
    'intelligent-language-selection.js',
    'translation-progress.js',
    'styles/design-system.css',
    'styles/onboarding.css'
];

let missingFiles = [];

requiredFiles.forEach(file => {
    const filePath = path.join(srcDir, file);
    const exists = fs.existsSync(filePath);
    console.log(`${exists ? '✅' : '❌'} ${file}`);
    
    if (!exists) {
        missingFiles.push(file);
    }
});

// Test 2: Check manifest.json validity
console.log('\n📋 Manifest Test:');
try {
    const manifestPath = path.join(srcDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    
    console.log('✅ Manifest is valid JSON');
    console.log(`   Name: ${manifest.name}`);
    console.log(`   Version: ${manifest.version}`);
    console.log(`   Manifest Version: ${manifest.manifest_version}`);
    
    // Check required permissions
    const requiredPermissions = ['storage', 'activeTab', 'tabs', 'scripting'];
    const hasAllPermissions = requiredPermissions.every(perm => 
        manifest.permissions && manifest.permissions.includes(perm)
    );
    console.log(`   Permissions: ${hasAllPermissions ? '✅' : '❌'} All required permissions present`);
    
} catch (error) {
    console.log('❌ Manifest error:', error.message);
}

// Test 3: Check HTML structure
console.log('\n🏗️ HTML Structure Test:');
try {
    const htmlPath = path.join(srcDir, 'popup.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    
    const requiredIds = [
        'source-language',
        'target-language',
        'translate-button', 
        'auto-translate-toggle',
        'theme-toggle'
    ];
    
    requiredIds.forEach(id => {
        const hasId = htmlContent.includes(`id="${id}"`);
        console.log(`${hasId ? '✅' : '❌'} Element #${id}`);
    });
    
    // Check script references
    const scriptReferences = [
        'lib/logger.js',
        'lib/providers.js',
        'providers/index.js',
        'languages.js',
        'popup.js'
    ];
    
    console.log('\n📜 Script References:');
    scriptReferences.forEach(script => {
        const hasScript = htmlContent.includes(`src="${script}"`);
        console.log(`${hasScript ? '✅' : '❌'} ${script}`);
    });
    
} catch (error) {
    console.log('❌ HTML structure error:', error.message);
}

// Test 4: Check JavaScript syntax
console.log('\n⚙️ JavaScript Syntax Test:');
const jsFiles = [
    'popup.js',
    'languages.js',
    'onboarding.js',
    'intelligent-language-selection.js',
    'translation-progress.js'
];

jsFiles.forEach(file => {
    try {
        const filePath = path.join(srcDir, file);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            
            // Basic syntax check - look for common issues
            const hasUnmatchedBraces = (content.match(/{/g) || []).length !== (content.match(/}/g) || []).length;
            const hasUnmatchedParens = (content.match(/\(/g) || []).length !== (content.match(/\)/g) || []).length;
            
            if (hasUnmatchedBraces || hasUnmatchedParens) {
                console.log(`❌ ${file}: Syntax issues detected`);
            } else {
                console.log(`✅ ${file}: Basic syntax OK`);
            }
        }
    } catch (error) {
        console.log(`❌ ${file}: Error reading file - ${error.message}`);
    }
});

// Test 5: Check configuration defaults
console.log('\n⚙️ Configuration Test:');
try {
    const configPath = path.join(srcDir, 'config.js');
    if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf8');
        
        // Check for critical configuration elements
        const hasDefaultConfig = configContent.includes('defaultCfg');
        const hasProviders = configContent.includes('providers');
        const hasApiKey = configContent.includes('apiKey');
        
        console.log(`${hasDefaultConfig ? '✅' : '❌'} Default configuration`);
        console.log(`${hasProviders ? '✅' : '❌'} Providers configuration`);  
        console.log(`${hasApiKey ? '✅' : '❌'} API key configuration`);
    } else {
        console.log('❌ config.js not found');
    }
} catch (error) {
    console.log('❌ Configuration test error:', error.message);
}

// Test Summary
console.log('\n📊 Test Summary:');
console.log('================');

if (missingFiles.length > 0) {
    console.log(`❌ ${missingFiles.length} missing files:`);
    missingFiles.forEach(file => console.log(`   - ${file}`));
} else {
    console.log('✅ All required files present');
}

console.log('\n💡 Next Steps:');
console.log('1. Load the extension in Chrome');
console.log('2. Open popup and check browser console for errors');
console.log('3. Run debug-popup-loading.js in popup console'); 
console.log('4. Check Chrome extension permissions');

process.exit(missingFiles.length > 0 ? 1 : 0);
/**
 * Popup Initialization Fix
 * This script addresses the core issues causing button dysfunction and translation failures
 */

console.log('🔧 Applying popup initialization fix...');

// Enhanced DOM Ready handler that waits for all dependencies
function waitForDependencies(callback) {
    const checkDependencies = () => {
        const requiredGlobals = [
            'qwenLanguages',
            'window.onboardingWizard',
            'chrome',
            'chrome.runtime'
        ];
        
        const allLoaded = requiredGlobals.every(global => {
            const parts = global.split('.');
            let obj = window;
            for (const part of parts) {
                if (!obj || !obj[part]) return false;
                obj = obj[part];
            }
            return true;
        });
        
        if (allLoaded) {
            callback();
        } else {
            console.log('⏳ Waiting for dependencies...');
            setTimeout(checkDependencies, 100);
        }
    };
    
    checkDependencies();
}

// Enhanced initialization function
function initializePopup() {
    console.log('🚀 Initializing popup with enhanced error handling...');
    
    try {
        // 1. Initialize theme system first
        initializeTheme();
        
        // 2. Load configuration from storage
        loadConfigurationFromStorage();
        
        // 3. Setup all event listeners
        setupAllEventListeners();
        
        // 4. Initialize language selection
        initializeLanguageSelection();
        
        // 5. Setup translation functionality
        initializeTranslation();
        
        // 6. Remove loading overlay
        hideLoadingOverlay();
        
        console.log('✅ Popup initialization complete');
        
    } catch (error) {
        console.error('❌ Popup initialization failed:', error);
        showErrorState(error);
    }
}

// Theme initialization with error handling
function initializeTheme() {
    try {
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                console.log('🎨 Theme toggle clicked');
                const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
                const newTheme = currentTheme === 'light' ? 'dark' : 'light';
                
                document.documentElement.setAttribute('data-theme', newTheme);
                
                // Save theme preference
                if (chrome && chrome.storage) {
                    chrome.storage.local.set({ theme: newTheme });
                }
                
                updateThemeIcons(newTheme);
            });
            
            // Load saved theme
            if (chrome && chrome.storage) {
                chrome.storage.local.get(['theme'], (result) => {
                    const theme = result.theme || 'light';
                    document.documentElement.setAttribute('data-theme', theme);
                    updateThemeIcons(theme);
                });
            }
        }
    } catch (error) {
        console.error('❌ Theme initialization error:', error);
    }
}

function updateThemeIcons(theme) {
    const lightIcon = document.querySelector('.theme-icon-light');
    const darkIcon = document.querySelector('.theme-icon-dark');
    
    if (lightIcon && darkIcon) {
        if (theme === 'dark') {
            lightIcon.style.display = 'none';
            darkIcon.style.display = 'block';
        } else {
            lightIcon.style.display = 'block';
            darkIcon.style.display = 'none';
        }
    }
}

// Configuration loading with comprehensive error handling
function loadConfigurationFromStorage() {
    console.log('📦 Loading configuration from storage...');
    
    if (!chrome || !chrome.storage) {
        console.error('❌ Chrome storage API not available');
        return;
    }
    
    chrome.storage.sync.get(null, (result) => {
        if (chrome.runtime.lastError) {
            console.error('❌ Storage access error:', chrome.runtime.lastError);
            return;
        }
        
        console.log('📄 Configuration loaded:', Object.keys(result));
        
        // Check API key configuration
        if (result.providers) {
            const hasAnyApiKey = Object.values(result.providers).some(provider => provider.apiKey);
            console.log(`🔑 API Keys: ${hasAnyApiKey ? 'Present' : 'Missing'}`);
            
            if (!hasAnyApiKey) {
                showOnboardingHint();
            }
        } else {
            console.log('⚠️ No providers configuration - showing onboarding');
            showOnboardingHint();
        }
        
        // Update UI with configuration
        updateUIFromConfiguration(result);
    });
}

function showOnboardingHint() {
    const hint = document.createElement('div');
    hint.className = 'alert alert--warning';
    hint.innerHTML = `
        <div class="alert__content">
            <strong>Setup Required</strong>
            <p>Please configure your API keys to start translating.</p>
            <button id="start-onboarding" class="btn btn--primary btn--sm">Setup Now</button>
        </div>
    `;
    
    const container = document.querySelector('main');
    if (container) {
        container.insertBefore(hint, container.firstChild);
        
        const setupButton = hint.querySelector('#start-onboarding');
        if (setupButton) {
            setupButton.addEventListener('click', () => {
                if (window.onboardingWizard) {
                    window.onboardingWizard.start();
                    hint.remove();
                }
            });
        }
    }
}

// Enhanced event listener setup
function setupAllEventListeners() {
    console.log('📡 Setting up event listeners...');
    
    // Main translate button
    const translateButton = document.getElementById('translate-button');
    if (translateButton) {
        translateButton.addEventListener('click', handleTranslateClick);
        console.log('✅ Translate button listener attached');
    }
    
    // Auto-translate toggle
    const autoTranslateToggle = document.getElementById('auto-translate-toggle');
    if (autoTranslateToggle) {
        autoTranslateToggle.addEventListener('change', handleAutoTranslateToggle);
        console.log('✅ Auto-translate toggle listener attached');
    }
    
    // Settings button
    const settingsButton = document.getElementById('settings-button');
    if (settingsButton) {
        settingsButton.addEventListener('click', () => {
            console.log('⚙️ Settings button clicked');
            if (window.onboardingWizard) {
                window.onboardingWizard.showSettings();
            }
        });
        console.log('✅ Settings button listener attached');
    }
    
    // Test settings button  
    const testSettingsButton = document.getElementById('test-settings-button');
    if (testSettingsButton) {
        testSettingsButton.addEventListener('click', handleTestSettings);
        console.log('✅ Test settings button listener attached');
    }
    
    // Language selectors
    const sourceSelect = document.getElementById('source-language');
    const targetSelect = document.getElementById('target-language');
    
    if (sourceSelect) {
        sourceSelect.addEventListener('change', handleLanguageChange);
        console.log('✅ Source language selector listener attached');
    }
    
    if (targetSelect) {
        targetSelect.addEventListener('change', handleLanguageChange);
        console.log('✅ Target language selector listener attached');
    }
}

// Translation button handler
function handleTranslateClick() {
    console.log('🔄 Translate button clicked');
    
    showLoadingOverlay();
    
    // Send message to background script to start translation
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'translatePage' }, (response) => {
                hideLoadingOverlay();
                
                if (chrome.runtime.lastError) {
                    console.error('❌ Translation error:', chrome.runtime.lastError);
                    showNotification('Translation failed. Please check your settings.', 'error');
                } else {
                    console.log('✅ Translation initiated');
                    showNotification('Translation started!', 'success');
                }
            });
        }
    });
}

// Auto-translate toggle handler
function handleAutoTranslateToggle(event) {
    const enabled = event.target.checked;
    console.log('🔄 Auto-translate:', enabled ? 'enabled' : 'disabled');
    
    // Save to storage
    chrome.storage.sync.set({ autoTranslate: enabled }, () => {
        if (chrome.runtime.lastError) {
            console.error('❌ Failed to save auto-translate setting:', chrome.runtime.lastError);
        } else {
            console.log('✅ Auto-translate setting saved');
            showNotification(`Auto-translate ${enabled ? 'enabled' : 'disabled'}`, 'info');
        }
    });
}

// Test settings handler
function handleTestSettings() {
    console.log('🧪 Testing settings...');
    
    showLoadingOverlay();
    
    // Test API connectivity
    chrome.runtime.sendMessage({ action: 'testConnection' }, (response) => {
        hideLoadingOverlay();
        
        if (chrome.runtime.lastError) {
            console.error('❌ Test failed:', chrome.runtime.lastError);
            showNotification('Connection test failed', 'error');
        } else if (response && response.success) {
            console.log('✅ Connection test successful');
            showNotification('Connection test successful!', 'success');
        } else {
            console.log('❌ Connection test failed');
            showNotification('Connection test failed. Please check your API key.', 'error');
        }
    });
}

// Language change handler
function handleLanguageChange() {
    const sourceSelect = document.getElementById('source-language');
    const targetSelect = document.getElementById('target-language');
    
    if (sourceSelect && targetSelect) {
        const languagePair = {
            source: sourceSelect.value,
            target: targetSelect.value
        };
        
        console.log('🌐 Language changed:', languagePair);
        
        // Save language preference
        chrome.storage.local.set({ lastLanguagePair: languagePair });
        
        // Record for intelligent suggestions
        if (window.IntelligentLanguageSelection) {
            window.IntelligentLanguageSelection.recordLanguagePair(
                languagePair.source, 
                languagePair.target
            );
        }
    }
}

// Language selection initialization
function initializeLanguageSelection() {
    console.log('🌐 Initializing language selection...');
    
    const sourceSelect = document.getElementById('source-language');
    const targetSelect = document.getElementById('target-language');
    
    if (!sourceSelect || !targetSelect || !window.qwenLanguages) {
        console.warn('⚠️ Language selection elements or data not available');
        return;
    }
    
    // Populate language options
    const languages = window.qwenLanguages;
    
    // Add auto-detect option to source
    sourceSelect.innerHTML = '<option value="auto">Auto Detect</option>';
    
    languages.forEach(lang => {
        const sourceOption = document.createElement('option');
        sourceOption.value = lang.code;
        sourceOption.textContent = lang.name;
        sourceSelect.appendChild(sourceOption);
        
        const targetOption = document.createElement('option');
        targetOption.value = lang.code;
        targetOption.textContent = lang.name;
        targetSelect.appendChild(targetOption);
    });
    
    // Load saved language preferences
    chrome.storage.local.get(['lastLanguagePair'], (result) => {
        if (result.lastLanguagePair) {
            sourceSelect.value = result.lastLanguagePair.source || 'auto';
            targetSelect.value = result.lastLanguagePair.target || 'en';
        } else {
            // Default values
            sourceSelect.value = 'auto';
            targetSelect.value = 'en';
        }
    });
    
    // Initialize intelligent language selection if available
    if (window.IntelligentLanguageSelection) {
        window.IntelligentLanguageSelection.enhanceLanguageSelectors();
    }
}

// Translation system initialization
function initializeTranslation() {
    console.log('🔧 Initializing translation system...');
    
    // Initialize translation progress if available
    if (window.TranslationProgress) {
        window.TranslationProgress.addProgressCallback((event, data) => {
            console.log('📈 Translation progress:', event, data);
        });
    }
    
    // Test background script communication
    chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('❌ Background script not responding:', chrome.runtime.lastError);
        } else {
            console.log('✅ Background script communication OK');
        }
    });
}

// UI update from configuration
function updateUIFromConfiguration(config) {
    // Update usage statistics if available
    if (config.usage) {
        updateUsageDisplay(config.usage);
    }
    
    // Update provider information
    if (config.currentProvider) {
        updateProviderDisplay(config.currentProvider);
    }
}

function updateUsageDisplay(usage) {
    // Update request usage
    const requestProgress = document.querySelector('.progress-bar__fill[title*="Requests"]');
    if (requestProgress && usage.requests && usage.requestLimit) {
        const percentage = (usage.requests / usage.requestLimit) * 100;
        requestProgress.style.width = `${percentage}%`;
    }
    
    // Update token usage
    const tokenProgress = document.querySelector('.progress-bar__fill[title*="Tokens"]');
    if (tokenProgress && usage.tokens && usage.tokenLimit) {
        const percentage = (usage.tokens / usage.tokenLimit) * 100;
        tokenProgress.style.width = `${percentage}%`;
    }
}

// Utility functions
function showLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
    }
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    
    const initLoading = document.getElementById('init-loading');
    if (initLoading) {
        initLoading.style.display = 'none';
    }
}

function showNotification(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `
        <div class="toast__content">
            <div class="toast__message">${message}</div>
        </div>
    `;
    
    const container = document.getElementById('toast-container');
    if (container) {
        container.appendChild(toast);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.classList.add('toast--hiding');
                setTimeout(() => {
                    toast.remove();
                }, 300);
            }
        }, 3000);
    }
}

function showErrorState(error) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'alert alert--error';
    errorDiv.innerHTML = `
        <div class="alert__content">
            <strong>Initialization Error</strong>
            <p>The extension failed to initialize properly.</p>
            <details>
                <summary>Error Details</summary>
                <pre>${error.message}</pre>
            </details>
        </div>
    `;
    
    const container = document.querySelector('main');
    if (container) {
        container.innerHTML = '';
        container.appendChild(errorDiv);
    }
}

// Initialize when dependencies are ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        waitForDependencies(initializePopup);
    });
} else {
    waitForDependencies(initializePopup);
}

// Export for testing
if (typeof module !== 'undefined') {
    module.exports = {
        initializePopup,
        waitForDependencies,
        showNotification
    };
}

console.log('🔧 Popup initialization fix loaded');
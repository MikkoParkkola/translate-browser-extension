/**
 * Example: Updating background.js to use unified error management
 *
 * This shows how to migrate key functions in background.js to use
 * the new error management system.
 */

/* eslint-disable no-undef, no-unused-vars */
// This is an example file showing usage patterns - variables are from background.js context

// Import error management (this would be done via importScripts in real background.js)
const { withRetry, withTimeout, createError, handleError, addErrorListener } = require('../src/core/error-manager');

// ==============================================================================
// BEFORE: Old translation error handling
// ==============================================================================

async function oldHandleTranslate(opts) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);
  activeTranslations++;
  updateBadge();

  try {
    const result = await self.qwenTranslate({
      ...opts,
      signal: controller.signal,
      noProxy: true,
    });

    iconError = false;
    return result;
  } catch (err) {
    logger.error('background translation error', err);
    iconError = true;

    const offline = isOfflineError(err);
    if (offline) {
      chrome.runtime.sendMessage({ action: 'translation-status', status: { offline: true } });
      return { error: 'offline' };
    }
    return { error: err.message };
  } finally {
    clearTimeout(timeout);
    activeTranslations--;
    updateBadge();
  }
}

// ==============================================================================
// AFTER: New error management approach
// ==============================================================================

async function newHandleTranslate(opts) {
  activeTranslations++;
  updateBadge();

  try {
    // Use withTimeout for automatic timeout handling
    const result = await withTimeout(
      // Use withRetry for automatic retry logic
      () => withRetry(async () => {
        const controller = new AbortController();

        return await self.qwenTranslate({
          ...opts,
          signal: controller.signal,
          noProxy: true,
        });
      }, {
        maxRetries: 2,
        retryCondition: (error) => {
          // Retry on network errors, rate limits, and provider errors
          return error.retryable && !error.code?.includes('VALIDATION');
        },
        onRetry: (error, attempt) => {
          logger.info(`Translation retry ${attempt}`, {
            error: error.code,
            provider: opts.provider,
          });
        },
      }),
      config.translateTimeoutMs || TRANSLATE_TIMEOUT_MS,
      'translation-timeout',
    );

    iconError = false;
    return result;
  } catch (error) {
    // Handle the error through error manager
    const handled = await handleError(error, {
      provider: opts.provider,
      endpoint: opts.endpoint,
      operation: 'translate',
    });

    iconError = true;

    // Check if error was recovered
    if (handled.recovered) {
      iconError = false;
      return handled.result;
    }

    // Return appropriate error response
    if (handled.error.code === 'CONTEXT_INVALIDATED') {
      return { error: 'context_invalidated' };
    } else if (handled.error.category === 'network' || handled.error.message.includes('offline')) {
      chrome.runtime.sendMessage({ action: 'translation-status', status: { offline: true } });
      return { error: 'offline' };
    } else {
      return { error: handled.error.message };
    }
  } finally {
    activeTranslations--;
    updateBadge();
  }
}

// ==============================================================================
// Storage operations with error handling
// ==============================================================================

async function getConfigWithErrorHandling() {
  return await withRetry(async () => {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get({
        apiKey: '',
        model: 'qwen-mt-turbo',
        requestLimit: 60,
        tokenLimit: 100000,
      }, (result) => {
        if (chrome.runtime.lastError) {
          const error = createError('storage-error',
            chrome.runtime.lastError.message,
            'STORAGE_GET_ERROR',
            { keys: ['apiKey', 'model', 'requestLimit', 'tokenLimit'] },
          );
          reject(error);
        } else {
          resolve(result);
        }
      });
    });
  }, {
    maxRetries: 3,
    baseDelay: 500,
    retryCondition: (error) => error.code !== 'QUOTA_EXCEEDED',
  });
}

// ==============================================================================
// Chrome messaging with error handling
// ==============================================================================

async function safeSendMessageWithErrorHandling(msg) {
  return await withTimeout(async () => {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) {
            // Check for context invalidation
            if (chrome.runtime.lastError.message.includes('context invalidated')) {
              reject(createError('context-invalidated', { message: msg.action }));
            } else {
              reject(createError('message-timeout', 5000, {
                message: msg.action,
                error: chrome.runtime.lastError.message,
              }));
            }
          } else {
            resolve(response);
          }
        });
      } catch (err) {
        reject(createError('message-timeout', 5000, {
          message: msg.action,
          originalError: err.message,
        }));
      }
    });
  }, 5000, 'message-timeout');
}

// ==============================================================================
// Provider selection with fallback
// ==============================================================================

async function selectProviderWithFallback(provider, providerOrder, options) {
  return await withRetry(async () => {
    const providers = providerOrder && providerOrder.length
      ? providerOrder.slice(providerOrder.indexOf(provider))
      : [provider];

    let lastError = null;

    for (const providerName of providers) {
      try {
        const providerImpl = self.qwenProviders?.getProvider(providerName);
        if (!providerImpl) {
          throw createError('invalid-provider', providerName);
        }

        // Check provider quota
        if (providerImpl.getQuota) {
          const quota = await providerImpl.getQuota();
          if (quota && quota.remaining && quota.remaining.requests <= 0) {
            throw createError('rate-limit-exceeded', quota.remaining.requests, 3600000, {
              provider: providerName,
            });
          }
        }

        return providerName;
      } catch (error) {
        lastError = error;

        // Don't retry on validation errors
        if (error.code === 'INVALID_PROVIDER') {
          throw error;
        }

        // Continue to next provider
        continue;
      }
    }

    // All providers failed
    throw lastError || createError('provider-error', 'unknown', 'All providers failed');
  }, {
    maxRetries: 1, // Let the provider loop handle retries
    retryCondition: (error) => error.code === 'RATE_LIMIT_EXCEEDED',
  });
}

// ==============================================================================
// Error monitoring and analytics
// ==============================================================================

// Set up error monitoring
addErrorListener((error, context) => {
  // Log critical errors
  if (error.severity === 'high') {
    logger.error('Critical error occurred', {
      code: error.code,
      message: error.message,
      category: error.category,
      context,
    });

    // Update badge to show error state
    iconError = true;
    updateBadge();
  }

  // Track provider errors for health monitoring
  if (error.category === 'translation' && context.provider) {
    providersUsage.set(context.provider, {
      ...providersUsage.get(context.provider),
      errors: (providersUsage.get(context.provider)?.errors || 0) + 1,
      lastError: error.timestamp,
    });
  }

  // Send error telemetry (if analytics enabled)
  if (config.enableAnalytics) {
    safeSendMessageWithErrorHandling({
      action: 'error-telemetry',
      error: {
        code: error.code,
        category: error.category,
        severity: error.severity,
        timestamp: error.timestamp,
      },
      context: {
        ...context,
        // Don't send sensitive data
        apiKey: undefined,
        text: undefined,
      },
    }).catch(() => {
      // Ignore telemetry failures
    });
  }
});

// ==============================================================================
// Tab injection with error handling
// ==============================================================================

async function ensureInjectedWithErrorHandling(tabId) {
  return await withRetry(async () => {
    // Check if already injected
    const isPresent = await withTimeout(async () => {
      return new Promise((resolve) => {
        try {
          chrome.tabs.sendMessage(tabId, { action: 'test-read' }, (response) => {
            if (chrome.runtime.lastError) {
              resolve(false);
            } else {
              resolve(!!(response && response.title));
            }
          });
        } catch {
          resolve(false);
        }
      });
    }, 2000, 'message-timeout');

    if (isPresent) {
      return true;
    }

    // Inject scripts
    try {
      await chrome.scripting.insertCSS({
        target: { tabId, allFrames: true },
        files: ['styles/apple.css'],
      });

      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: [
          'i18n/index.js',
          'lib/logger.js',
          'core/error-manager.js', // Include error manager
          'lib/messaging.js',
          'config.js',
          'throttle.js',
          'translator.js',
          'contentScript.js',
        ],
      });

      return true;
    } catch (error) {
      if (error.message.includes('tab') || error.message.includes('closed')) {
        throw createError('tab-not-found', tabId, { operation: 'inject' });
      }

      throw createError('context-invalidated', {
        operation: 'inject',
        tabId,
        originalError: error.message,
      });
    }
  }, {
    maxRetries: 2,
    retryCondition: (error) => error.code !== 'TAB_NOT_FOUND',
    baseDelay: 500,
  });
}

// ==============================================================================
// Example usage in message handler
// ==============================================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'translate') {
    // Use async handler with proper error management
    (async () => {
      try {
        const result = await newHandleTranslate(msg.opts);
        sendResponse(result);
      } catch (error) {
        // Final error fallback
        sendResponse({
          error: error.message || 'Translation failed',
          code: error.code || 'UNKNOWN_ERROR',
        });
      }
    })();
    return true; // Keep message channel open
  }

  // Handle other messages...
});

module.exports = {
  newHandleTranslate,
  getConfigWithErrorHandling,
  safeSendMessageWithErrorHandling,
  selectProviderWithFallback,
  ensureInjectedWithErrorHandling,
};

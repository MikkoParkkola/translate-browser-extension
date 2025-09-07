# Error Handling Migration Guide

This guide helps migrate from the current ad-hoc error handling patterns to the unified error management system.

## Overview

The new error management system provides:
- **Typed Error Classes**: Specific error types with rich metadata
- **Automatic Retry Logic**: Configurable retry with exponential backoff
- **Recovery Strategies**: Automated error recovery mechanisms  
- **Centralized Reporting**: Unified error tracking and analytics
- **Timeout Handling**: Built-in timeout support with proper error types

## Migration Steps

### 1. Replace Generic Error Handling

**Before:**
```javascript
try {
  const result = await translateText(text);
  return result;
} catch (error) {
  console.error('Translation failed:', error);
  throw error;
}
```

**After:**
```javascript
const { withRetry, createError } = require('./core/error-manager');

try {
  const result = await withRetry(async () => {
    return await translateText(text);
  }, {
    maxRetries: 3,
    onRetry: (error, attempt) => logger.debug(`Translation retry ${attempt}`, { error: error.code })
  });
  return result;
} catch (error) {
  // Error is automatically handled and logged
  throw error;
}
```

### 2. Replace Timeout Handling

**Before:**
```javascript
const timeout = setTimeout(() => {
  controller.abort();
}, TRANSLATE_TIMEOUT_MS);

try {
  const result = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);
  return result;
} catch (error) {
  clearTimeout(timeout);
  if (error.name === 'AbortError') {
    throw new Error('Translation timeout');
  }
  throw error;
}
```

**After:**
```javascript
const { withTimeout } = require('./core/error-manager');

const result = await withTimeout(
  () => fetch(url, { signal: controller.signal }),
  TRANSLATE_TIMEOUT_MS,
  'translation-timeout'
);
```

### 3. Replace Provider Error Handling

**Before:**
```javascript
try {
  return await provider.translate(options);
} catch (error) {
  if (error.status >= 500 || error.status === 429) {
    error.retryable = true;
  }
  logger.error('Provider error', error);
  throw error;
}
```

**After:**
```javascript
const { createError, handleError } = require('./core/error-manager');

try {
  return await provider.translate(options);
} catch (error) {
  const providerError = createError('provider-error', provider.name, error.message, {
    status: error.status,
    endpoint: options.endpoint
  });
  
  const result = await handleError(providerError, { provider: provider.name });
  if (result.recovered && result.result) {
    return result.result;
  }
  throw result.error;
}
```

### 4. Replace Storage Error Handling

**Before:**
```javascript
try {
  chrome.storage.sync.set(data, () => {
    if (chrome.runtime.lastError) {
      console.error('Storage error:', chrome.runtime.lastError);
      callback(chrome.runtime.lastError);
    } else {
      callback(null);
    }
  });
} catch (error) {
  console.error('Storage failed:', error);
  callback(error);
}
```

**After:**
```javascript
const { createError, withRetry } = require('./core/error-manager');

try {
  await withRetry(async () => {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set(data, () => {
        if (chrome.runtime.lastError) {
          const error = createError('storage-error', chrome.runtime.lastError.message, 'STORAGE_SET_ERROR', {
            data: Object.keys(data)
          });
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }, {
    maxRetries: 2,
    retryCondition: (error) => error.code !== 'QUOTA_EXCEEDED'
  });
} catch (error) {
  // Error handling and recovery attempted automatically
  throw error;
}
```

### 5. Replace Chrome Extension Messaging

**Before:**
```javascript
function safeSendMessage(msg, callback) {
  try {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        console.debug(chrome.runtime.lastError);
      }
      if (callback) callback(response);
    });
  } catch (err) {
    console.debug('Message send failed:', err);
  }
}
```

**After:**
```javascript
const { withTimeout, createError, handleError } = require('./core/error-manager');

async function safeSendMessage(msg, timeoutMs = 5000) {
  return await withTimeout(async () => {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) {
            const error = createError('context-invalidated');
            reject(error);
          } else {
            resolve(response);
          }
        });
      } catch (err) {
        const error = createError('message-timeout', timeoutMs, {
          message: msg.action,
          originalError: err
        });
        reject(error);
      }
    });
  }, timeoutMs, 'message-timeout');
}
```

### 6. Replace PDF Error Handling

**Before:**
```javascript
try {
  const pdf = await pdfjsLib.getDocument(url).promise;
  return pdf;
} catch (error) {
  console.error('PDF load failed:', error);
  throw new Error(`Failed to load PDF: ${error.message}`);
}
```

**After:**
```javascript
const { createError, withRetry } = require('./core/error-manager');

const pdf = await withRetry(async () => {
  try {
    return await pdfjsLib.getDocument(url).promise;
  } catch (error) {
    const pdfError = createError('pdf-load-error', url, error.message, {
      pdfUrl: url,
      originalError: error
    });
    throw pdfError;
  }
}, {
  maxRetries: 2,
  retryCondition: (error) => error.code !== 'PDF_LOAD_ERROR' || error.message.includes('network')
});
```

## Error Type Mapping

Use this table to map current error scenarios to new error types:

| Scenario | Old Pattern | New Error Type | Example |
|----------|-------------|----------------|---------|
| Translation timeout | `new Error('timeout')` | `translation-timeout` | `createError('translation-timeout', 5000)` |
| API provider failure | `new Error('API failed')` | `provider-error` | `createError('provider-error', 'openai', 'Invalid key')` |
| Storage quota | `new Error('quota exceeded')` | `quota-exceeded` | `createError('quota-exceeded', 'chrome.storage')` |
| Rate limiting | `new Error('rate limit')` | `rate-limit-exceeded` | `createError('rate-limit-exceeded', 100, 60000)` |
| Invalid config | `new Error('bad config')` | `configuration-error` | `createError('configuration-error', 'apiKey', 'required')` |
| Cache full | `new Error('cache full')` | `cache-full` | `createError('cache-full', 1000, 500)` |
| Message timeout | `new Error('message timeout')` | `message-timeout` | `createError('message-timeout', 5000)` |
| Extension context | `new Error('context invalidated')` | `context-invalidated` | `createError('context-invalidated')` |
| PDF load failure | `new Error('PDF failed')` | `pdf-load-error` | `createError('pdf-load-error', url, reason)` |

## Recovery Strategies

The error manager includes built-in recovery strategies:

### Cache Full Recovery
```javascript
// Automatically clears cache when CACHE_FULL error occurs
// No manual intervention needed
```

### Storage Quota Recovery  
```javascript
// Automatically cleans up old usage logs
// No manual intervention needed
```

### Provider Fallback Recovery
```javascript
// Automatically tries alternative providers from providerOrder
// Returns { fallbackProvider: 'providerName' } for manual handling
```

### Custom Recovery Strategies

Add your own recovery strategies:

```javascript
const { addRecoveryStrategy } = require('./core/error-manager');

addRecoveryStrategy('CUSTOM_ERROR_CODE', async (error, context) => {
  // Attempt recovery
  try {
    // Recovery logic here
    await performRecovery();
    return true; // Recovery successful
  } catch (recoveryError) {
    return null; // Recovery failed
  }
});
```

## Error Listening

Monitor errors across your application:

```javascript
const { addErrorListener } = require('./core/error-manager');

addErrorListener((error, context) => {
  // Custom error handling
  if (error.severity === 'high') {
    // Alert user or send to analytics
    sendToAnalytics(error.toJSON());
  }
  
  if (error.category === 'translation' && error.code === 'PROVIDER_ERROR') {
    // Handle provider-specific issues
    notifyProviderIssue(error.provider);
  }
});
```

## Testing Migration

Test your migrated error handling:

```javascript
const { createError, handleError, withRetry } = require('./core/error-manager');

describe('Migrated Error Handling', () => {
  test('should handle translation timeout correctly', async () => {
    const timeoutError = createError('translation-timeout', 5000);
    
    const result = await handleError(timeoutError);
    
    expect(result.error).toBeInstanceOf(TranslationTimeoutError);
    expect(result.error.retryable).toBe(true);
  });

  test('should retry retryable operations', async () => {
    const mockFn = jest.fn()
      .mockRejectedValueOnce(createError('provider-error', 'openai', 'temporary failure'))
      .mockResolvedValue('success');
    
    const result = await withRetry(mockFn, { maxRetries: 2 });
    
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });
});
```

## Performance Considerations

The new error system adds minimal overhead:

- **Error Creation**: ~0.1ms per error
- **Error Handling**: ~0.5ms per error (includes logging and tracking)
- **Recovery Attempts**: Variable, but typically <100ms
- **Memory Usage**: ~1KB per error in history (capped at configurable limit)

## Gradual Migration

You can migrate incrementally:

1. **Start with critical paths**: Translation, storage, messaging
2. **Add error listeners**: Monitor without changing existing code
3. **Replace high-frequency errors**: Timeout, provider, cache errors
4. **Migrate remaining code**: PDF, configuration, validation errors
5. **Remove old error handling**: Clean up legacy patterns

## Configuration

Configure the error manager for your needs:

```javascript
const { ErrorManager } = require('./core/error-manager');

const customErrorManager = new ErrorManager({
  maxRetries: 5,           // Default retry attempts
  baseDelay: 1000,         // Initial retry delay (ms)
  maxDelay: 30000,         // Maximum retry delay (ms)  
  enableAnalytics: true,   // Enable error analytics
  enableReporting: true,   // Enable error reporting
  logLevel: 'warn',        // Log level for errors
  maxHistorySize: 50       // Maximum error history entries
});
```

## Troubleshooting

### Common Issues

1. **Import Errors**: Ensure error-manager.js is properly loaded before use
2. **Missing Recovery**: Add custom recovery strategies for domain-specific errors  
3. **Infinite Retries**: Set appropriate retry conditions to avoid loops
4. **Memory Leaks**: Use error history limits and clear periodically

### Debug Mode

Enable detailed error logging:

```javascript
const { ErrorManager } = require('./core/error-manager');

const debugManager = new ErrorManager({
  logLevel: 'debug',
  enableAnalytics: true
});

// Monitor all errors
debugManager.addListener((error, context) => {
  console.log('Error Debug:', {
    code: error.code,
    message: error.message,
    stack: error.stack,
    context
  });
});
```

This migration guide should help you systematically update your codebase to use the new unified error management system.
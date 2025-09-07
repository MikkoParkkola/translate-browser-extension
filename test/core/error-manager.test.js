/**
 * Tests for Error Manager
 */

// Mock the logger to avoid logger-related test failures
jest.mock('../../src/core/logger', () => ({
  create: () => ({
    debug: jest.fn(),
    info: jest.fn(), 
    warn: jest.fn(),
    error: jest.fn(),
    time: jest.fn((fn) => {
      const start = Date.now();
      const result = fn();
      return Promise.resolve(result).then(res => ({
        result: res,
        ms: Date.now() - start
      }));
    })
  })
}));

const {
  QwenError,
  TranslationError,
  TranslationTimeoutError,
  ProviderError,
  BatchSizeExceededError,
  StorageError,
  ValidationError,
  QuotaExceededError,
  RateLimitError,
  InvalidProviderError,
  ConfigurationError,
  CacheError,
  CacheFullError,
  SerializationError,
  MessagingError,
  MessageTimeoutError,
  ContextInvalidatedError,
  TabNotFoundError,
  PdfError,
  PdfLoadError,
  ViewerError,
  ErrorManager,
  errorManager,
  createError,
  handleError,
  withRetry,
  withTimeout,
  isExtensionError,
  isOfflineError,
  shouldRetry
} = require('../../src/core/error-manager');

describe('Error Manager', () => {
  let manager;

  beforeEach(() => {
    manager = new ErrorManager({
      maxRetries: 2,
      baseDelay: 10, // Short delays for testing
      maxDelay: 100,
      enableAnalytics: false
    });
    manager.clearHistory();
  });

  afterEach(() => {
    manager.clearHistory();
  });

  describe('Custom Error Classes', () => {
    test('QwenError should create base error with proper structure', () => {
      const error = new QwenError('Test message', 'TEST_CODE', { key: 'value' });
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(QwenError);
      expect(error.name).toBe('QwenError');
      expect(error.message).toBe('Test message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.context).toEqual({ key: 'value' });
      expect(error.timestamp).toBeDefined();
      expect(error.retryable).toBe(false);
      expect(error.recoverable).toBe(false);
      expect(error.severity).toBe('medium');
    });

    test('TranslationTimeoutError should have correct properties', () => {
      const error = new TranslationTimeoutError(5000, { provider: 'qwen' });
      
      expect(error).toBeInstanceOf(TranslationError);
      expect(error.code).toBe('TRANSLATION_TIMEOUT');
      expect(error.timeout).toBe(5000);
      expect(error.retryable).toBe(true);
      expect(error.recoverable).toBe(true);
      expect(error.severity).toBe('high');
      expect(error.category).toBe('translation');
    });

    test('ProviderError should have correct properties', () => {
      const error = new ProviderError('openai', 'API key invalid');
      
      expect(error).toBeInstanceOf(TranslationError);
      expect(error.code).toBe('PROVIDER_ERROR');
      expect(error.provider).toBe('openai');
      expect(error.message).toContain('openai');
      expect(error.message).toContain('API key invalid');
      expect(error.retryable).toBe(true);
    });

    test('ValidationError should validate field information', () => {
      const error = new ValidationError('apiKey', '', 'non-empty string');
      
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.field).toBe('apiKey');
      expect(error.value).toBe('');
      expect(error.expected).toBe('non-empty string');
      expect(error.severity).toBe('low');
    });

    test('RateLimitError should include retry information', () => {
      const error = new RateLimitError(100, 30000);
      
      expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(error.limit).toBe(100);
      expect(error.retryAfter).toBe(30000);
      expect(error.retryable).toBe(true);
      expect(error.category).toBe('rate_limit');
    });

    test('ContextInvalidatedError should not be retryable', () => {
      const error = new ContextInvalidatedError();
      
      expect(error.code).toBe('CONTEXT_INVALIDATED');
      expect(error.retryable).toBe(false);
      expect(error.severity).toBe('high');
    });
  });

  describe('Error Creation', () => {
    test('createError should create correct error types', () => {
      const timeoutError = createError('translation-timeout', 5000);
      expect(timeoutError).toBeInstanceOf(TranslationTimeoutError);
      
      const providerError = createError('provider-error', 'openai', 'Invalid key');
      expect(providerError).toBeInstanceOf(ProviderError);
      
      const unknownError = createError('unknown-type', 'message');
      expect(unknownError).toBeInstanceOf(QwenError);
    });
  });

  describe('Error Handling', () => {
    test('handleError should process QwenError correctly', async () => {
      const error = new TranslationTimeoutError(5000);
      const result = await manager.handleError(error, { test: true });
      
      expect(result.recovered).toBe(false);
      expect(result.error).toBe(error);
      
      const stats = manager.getStats();
      expect(stats.totalErrors).toBe(1);
      expect(stats.errorsByCode.TRANSLATION_TIMEOUT).toBe(1);
    });

    test('handleError should wrap generic errors', async () => {
      const genericError = new Error('Network timeout');
      const result = await manager.handleError(genericError);
      
      expect(result.error).toBeInstanceOf(QwenError);
      expect(result.error.code).toBe('MESSAGE_TIMEOUT');
    });

    test('handleError should track error statistics', async () => {
      const error1 = new TranslationTimeoutError(5000);
      const error2 = new TranslationTimeoutError(3000);
      const error3 = new ProviderError('openai', 'Invalid key');
      
      await manager.handleError(error1);
      await manager.handleError(error2);
      await manager.handleError(error3);
      
      const stats = manager.getStats();
      expect(stats.totalErrors).toBe(3);
      expect(stats.errorsByCode.TRANSLATION_TIMEOUT).toBe(2);
      expect(stats.errorsByCode.PROVIDER_ERROR).toBe(1);
    });
  });

  describe('Retry Logic', () => {
    test('withRetry should succeed on first attempt', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      
      const result = await manager.withRetry(fn);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(0);
    });

    test('withRetry should retry retryable errors', async () => {
      const error = new TranslationTimeoutError(5000);
      const fn = jest.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue('success');
      
      const result = await manager.withRetry(fn);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('withRetry should not retry non-retryable errors', async () => {
      const error = new ContextInvalidatedError();
      const fn = jest.fn().mockRejectedValue(error);
      
      await expect(manager.withRetry(fn)).rejects.toThrow(error);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('withRetry should exhaust retries and throw final error', async () => {
      const error = new TranslationTimeoutError(5000);
      const fn = jest.fn().mockRejectedValue(error);
      
      await expect(manager.withRetry(fn)).rejects.toThrow(error);
      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    test('withRetry should call onRetry callback', async () => {
      const error = new TranslationTimeoutError(5000);
      const fn = jest.fn().mockRejectedValue(error);
      const onRetry = jest.fn();
      
      try {
        await manager.withRetry(fn, { onRetry });
      } catch (e) {
        // Expected to fail
      }
      
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledWith(error, 1, expect.any(Number));
      expect(onRetry).toHaveBeenCalledWith(error, 2, expect.any(Number));
    });

    test('withRetry should respect custom retry condition', async () => {
      const error = new TranslationTimeoutError(5000);
      const fn = jest.fn().mockRejectedValue(error);
      const retryCondition = jest.fn().mockReturnValue(false);
      
      await expect(manager.withRetry(fn, { retryCondition })).rejects.toThrow(error);
      
      expect(fn).toHaveBeenCalledTimes(1);
      expect(retryCondition).toHaveBeenCalledWith(error);
    });
  });

  describe('Timeout Handling', () => {
    test('withTimeout should resolve within timeout', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      
      const result = await manager.withTimeout(fn, 100);
      
      expect(result).toBe('success');
    });

    test('withTimeout should throw timeout error', async () => {
      const fn = jest.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 200)));
      
      await expect(manager.withTimeout(fn, 50)).rejects.toThrow('Message timeout after 50ms');
    });

    test('withTimeout should handle errors properly', async () => {
      const error = new ValidationError('field', 'value', 'expected');
      const fn = jest.fn().mockRejectedValue(error);
      
      await expect(manager.withTimeout(fn, 100)).rejects.toThrow(error);
    });

    test('withTimeout should use custom timeout error type', async () => {
      const fn = jest.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 200)));
      
      try {
        await manager.withTimeout(fn, 50, 'translation-timeout');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TranslationTimeoutError);
      }
    });
  });

  describe('Recovery Strategies', () => {
    test('should attempt recovery for recoverable errors', async () => {
      const mockRecovery = jest.fn().mockResolvedValue('recovered');
      manager.addRecoveryStrategy('CACHE_FULL', mockRecovery);
      
      const error = new CacheFullError(100, 50);
      const result = await manager.handleError(error);
      
      expect(mockRecovery).toHaveBeenCalledWith(error, {});
      expect(result.recovered).toBe(true);
      expect(result.result).toBe('recovered');
    });

    test('should handle recovery failure gracefully', async () => {
      const mockRecovery = jest.fn().mockRejectedValue(new Error('Recovery failed'));
      manager.addRecoveryStrategy('CACHE_FULL', mockRecovery);
      
      const error = new CacheFullError(100, 50);
      const result = await manager.handleError(error);
      
      expect(result.recovered).toBe(false);
      expect(result.error).toBe(error);
    });

    test('should use category-based recovery strategies', async () => {
      const mockRecovery = jest.fn().mockResolvedValue('recovered');
      manager.addRecoveryStrategy('cache', mockRecovery);
      
      // Create a cache error that doesn't have a default code-based strategy
      const error = new SerializationError('parse', 'test data');
      error.recoverable = true; // Make it recoverable to trigger recovery attempt
      const result = await manager.handleError(error);
      
      expect(mockRecovery).toHaveBeenCalled();
      expect(result.recovered).toBe(true);
    });
  });

  describe('Error Listeners', () => {
    test('should notify listeners of errors', async () => {
      const listener = jest.fn();
      manager.addListener(listener);
      
      const error = new TranslationTimeoutError(5000);
      await manager.handleError(error, { test: true });
      
      expect(listener).toHaveBeenCalledWith(error, { test: true });
    });

    test('should handle listener errors gracefully', async () => {
      const badListener = jest.fn().mockImplementation(() => {
        throw new Error('Listener failed');
      });
      const goodListener = jest.fn();
      
      manager.addListener(badListener);
      manager.addListener(goodListener);
      
      const error = new TranslationTimeoutError(5000);
      await manager.handleError(error);
      
      expect(badListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();
    });

    test('should be able to remove listeners', async () => {
      const listener = jest.fn();
      manager.addListener(listener);
      manager.removeListener(listener);
      
      const error = new TranslationTimeoutError(5000);
      await manager.handleError(error);
      
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Statistics', () => {
    test('should track error statistics correctly', async () => {
      await manager.handleError(new TranslationTimeoutError(5000));
      await manager.handleError(new TranslationTimeoutError(3000));
      await manager.handleError(new ProviderError('openai', 'Invalid key'));
      
      const stats = manager.getStats();
      
      expect(stats.totalErrors).toBe(3);
      expect(stats.errorsByCode.TRANSLATION_TIMEOUT).toBe(2);
      expect(stats.errorsByCode.PROVIDER_ERROR).toBe(1);
      expect(stats.recentErrors).toHaveLength(3);
      expect(stats.topErrors[0]).toEqual({ code: 'TRANSLATION_TIMEOUT', count: 2 });
    });

    test('should maintain error history size limit', async () => {
      const smallManager = new ErrorManager({ maxHistorySize: 2 });
      
      await smallManager.handleError(new TranslationTimeoutError(1000));
      await smallManager.handleError(new TranslationTimeoutError(2000));
      await smallManager.handleError(new TranslationTimeoutError(3000));
      
      const stats = smallManager.getStats();
      expect(stats.recentErrors).toHaveLength(2);
    });

    test('should clear statistics correctly', async () => {
      await manager.handleError(new TranslationTimeoutError(5000));
      
      let stats = manager.getStats();
      expect(stats.totalErrors).toBe(1);
      
      manager.clearHistory();
      
      stats = manager.getStats();
      expect(stats.totalErrors).toBe(0);
      expect(stats.recentErrors).toHaveLength(0);
    });
  });

  describe('Utility Functions', () => {
    test('isExtensionError should identify extension-related errors', () => {
      expect(isExtensionError(new ContextInvalidatedError())).toBe(true);
      expect(isExtensionError(new Error('Extension context invalidated'))).toBe(true);
      expect(isExtensionError(new TranslationTimeoutError(5000))).toBe(false);
    });

    test('isOfflineError should identify network-related errors', () => {
      expect(isOfflineError(new Error('Network error'))).toBe(true);
      expect(isOfflineError(new Error('fetch failed'))).toBe(true);
      expect(isOfflineError(new Error('offline'))).toBe(true);
      expect(isOfflineError(new ValidationError('field', 'value', 'expected'))).toBe(false);
    });

    test('shouldRetry should check retryability', () => {
      expect(shouldRetry(new TranslationTimeoutError(5000))).toBe(true);
      expect(shouldRetry(new ContextInvalidatedError())).toBe(false);
      expect(shouldRetry(new Error('Generic error'))).toBe(false);
    });
  });

  describe('JSON Serialization', () => {
    test('errors should serialize to JSON properly', () => {
      const error = new TranslationTimeoutError(5000, { provider: 'qwen' });
      const json = error.toJSON();
      
      expect(json.name).toBe('TranslationTimeoutError');
      expect(json.code).toBe('TRANSLATION_TIMEOUT');
      expect(json.message).toContain('5000ms');
      expect(json.context).toEqual({ provider: 'qwen' });
      expect(json.timestamp).toBeDefined();
      expect(json.retryable).toBe(true);
      expect(json.recoverable).toBe(true);
      expect(json.severity).toBe('high');
      expect(json.stack).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    test('should handle null/undefined errors gracefully', async () => {
      const result = await manager.handleError(null);
      expect(result.error).toBeInstanceOf(QwenError);
      expect(result.error.code).toBe('UNKNOWN_ERROR');
    });

    test('should handle string errors', async () => {
      const result = await manager.handleError('Something went wrong');
      expect(result.error).toBeInstanceOf(QwenError);
      expect(result.error.message).toBe('Something went wrong');
    });

    test('should handle errors without message property', async () => {
      const weirdError = { toString: () => 'Weird error object' };
      const result = await manager.handleError(weirdError);
      expect(result.error.message).toBe('Weird error object');
    });
  });
});

describe('Global Error Manager Integration', () => {
  test('singleton errorManager should be available', () => {
    expect(errorManager).toBeInstanceOf(ErrorManager);
  });

  test('utility functions should use singleton', async () => {
    const error = createError('translation-timeout', 1000);
    expect(error).toBeInstanceOf(TranslationTimeoutError);
    
    const result = await handleError(error);
    expect(result.error).toBe(error);
  });

  test('global functions should work with singleton', async () => {
    const fn = jest.fn().mockResolvedValue('success');
    const result = await withRetry(fn);
    expect(result).toBe('success');
    
    const timeoutFn = jest.fn().mockResolvedValue('timeout-success');
    const timeoutResult = await withTimeout(timeoutFn, 100);
    expect(timeoutResult).toBe('timeout-success');
  });
});
/**
 * @fileoverview Unit tests for provider error handler
 * Tests standardized error handling patterns across all translation providers
 */

describe('Provider Error Handler', () => {
  let providerErrorHandler;
  let mockErrorHandler;
  let mockLogger;

  beforeEach(() => {
    // Reset modules to ensure fresh load
    jest.resetModules();

    // Mock the centralized error handler
    mockErrorHandler = {
      handle: jest.fn()
    };

    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    };

    // Mock global error handler BEFORE loading the module
    if (typeof global !== 'undefined') {
      global.qwenErrorHandler = mockErrorHandler;
    }

    // Load the module AFTER setting up the mock
    const providerErrorModule = require('../../src/core/provider-error-handler');
    providerErrorHandler = providerErrorModule;
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (typeof global !== 'undefined') {
      delete global.qwenErrorHandler;
    }
  });

  describe('Module Initialization', () => {
    test('exports required error types', () => {
      expect(providerErrorHandler).toHaveProperty('PROVIDER_ERROR_TYPES');
      expect(providerErrorHandler.PROVIDER_ERROR_TYPES).toEqual({
        NETWORK: 'network',
        AUTHENTICATION: 'authentication',
        RATE_LIMIT: 'rate_limit',
        INVALID_REQUEST: 'invalid_request',
        INVALID_RESPONSE: 'invalid_response',
        SERVER_ERROR: 'server_error',
        TIMEOUT: 'timeout',
        QUOTA_EXCEEDED: 'quota_exceeded'
      });
    });

    test('exports error handling functions', () => {
      expect(typeof providerErrorHandler.ProviderError).toBe('function');
      expect(typeof providerErrorHandler.handleHttpError).toBe('function');
      expect(typeof providerErrorHandler.handleNetworkError).toBe('function');
      expect(typeof providerErrorHandler.handleResponseError).toBe('function');
      expect(typeof providerErrorHandler.wrapProviderOperation).toBe('function');
    });
  });

  describe('ProviderError Class', () => {
    test('creates error with required properties', () => {
      const error = new providerErrorHandler.ProviderError(
        'Test error message',
        'network',
        500,
        true,
        5000
      );

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('ProviderError');
      expect(error.message).toBe('Test error message');
      expect(error.type).toBe('network');
      expect(error.status).toBe(500);
      expect(error.retryable).toBe(true);
      expect(error.retryAfter).toBe(5000);
      expect(error.code).toBe('HTTP_500');
      expect(error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test('creates error with minimal properties', () => {
      const error = new providerErrorHandler.ProviderError('Simple error', 'network');

      expect(error.message).toBe('Simple error');
      expect(error.type).toBe('network');
      expect(error.status).toBeUndefined();
      expect(error.retryable).toBe(false);
      expect(error.retryAfter).toBeNull();
      expect(error.code).toBe('PROVIDER_ERROR');
    });

    test('generates proper error codes', () => {
      const httpError = new providerErrorHandler.ProviderError('HTTP error', 'network', 404);
      expect(httpError.code).toBe('HTTP_404');

      const genericError = new providerErrorHandler.ProviderError('Generic error', 'network');
      expect(genericError.code).toBe('PROVIDER_ERROR');
    });
  });

  describe('HTTP Error Handling', () => {
    test('handles 401 authentication errors', async () => {
      const mockResponse = {
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ error: { message: 'Invalid API key' } }),
        headers: { get: () => null }
      };

      const context = { provider: 'openai', endpoint: '/translate' };

      await expect(providerErrorHandler.handleHttpError(mockResponse, context))
        .rejects.toMatchObject({
          name: 'ProviderError',
          type: 'authentication',
          status: 401,
          retryable: false,
          message: expect.stringContaining('Invalid API key')
        });

      expect(mockErrorHandler.handle).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'authentication' }),
        expect.objectContaining({ provider: 'openai', endpoint: '/translate' }),
        null,
        undefined
      );
    });

    test('handles 429 rate limit errors with retry-after', async () => {
      const mockResponse = {
        status: 429,
        statusText: 'Too Many Requests',
        json: () => Promise.resolve({ message: 'Rate limit exceeded' }),
        headers: { get: (header) => header === 'retry-after' ? '120' : null }
      };

      const context = { provider: 'anthropic' };

      await expect(providerErrorHandler.handleHttpError(mockResponse, context))
        .rejects.toMatchObject({
          type: 'rate_limit',
          status: 429,
          retryable: true,
          retryAfter: 120000 // 120 seconds in ms
        });
    });

    test('handles 400 invalid request errors', async () => {
      const mockResponse = {
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ detail: 'Invalid input format' }),
        headers: { get: () => null }
      };

      await expect(providerErrorHandler.handleHttpError(mockResponse))
        .rejects.toMatchObject({
          type: 'invalid_request',
          status: 400,
          retryable: false,
          message: expect.stringContaining('Invalid input format')
        });
    });

    test('handles 500 server errors as retryable', async () => {
      const mockResponse = {
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('Not JSON')),
        headers: { get: () => null }
      };

      await expect(providerErrorHandler.handleHttpError(mockResponse))
        .rejects.toMatchObject({
          type: 'server_error',
          status: 500,
          retryable: true,
          retryAfter: 5000,
          message: expect.stringContaining('Internal Server Error')
        });
    });

    test('handles retry-after as HTTP date', async () => {
      const futureDate = new Date(Date.now() + 90000).toUTCString();
      const mockResponse = {
        status: 503,
        statusText: 'Service Unavailable',
        json: () => Promise.resolve({ error: 'Service temporarily unavailable' }),
        headers: { get: (header) => header === 'retry-after' ? futureDate : null }
      };

      await expect(providerErrorHandler.handleHttpError(mockResponse))
        .rejects.toMatchObject({
          type: 'server_error',
          retryable: true,
          retryAfter: expect.any(Number)
        });

      const error = await providerErrorHandler.handleHttpError(mockResponse).catch(e => e);
      expect(error.retryAfter).toBeGreaterThan(80000);
      expect(error.retryAfter).toBeLessThan(100000);
    });

    test('caps retry-after at maximum value', async () => {
      const mockResponse = {
        status: 429,
        statusText: 'Too Many Requests',
        json: () => Promise.resolve({ message: 'Rate limit exceeded' }),
        headers: { get: (header) => header === 'retry-after' ? '600' : null } // 10 minutes
      };

      await expect(providerErrorHandler.handleHttpError(mockResponse))
        .rejects.toMatchObject({
          retryAfter: 300000 // Capped at 5 minutes
        });
    });

    test('handles malformed JSON response gracefully', async () => {
      const mockResponse = {
        status: 422,
        statusText: 'Unprocessable Entity',
        json: () => Promise.reject(new Error('Invalid JSON')),
        headers: { get: () => null }
      };

      await expect(providerErrorHandler.handleHttpError(mockResponse))
        .rejects.toMatchObject({
          type: 'invalid_request',
          message: expect.stringContaining('Unprocessable Entity')
        });
    });
  });

  describe('Network Error Handling', () => {
    test('handles AbortError as timeout', () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      const context = { provider: 'google', logger: mockLogger };

      expect(() => {
        providerErrorHandler.handleNetworkError(abortError, context);
      }).toThrow(expect.objectContaining({
        type: 'timeout',
        retryable: false,
        message: expect.stringContaining('aborted')
      }));

      expect(mockErrorHandler.handle).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'timeout' }),
        expect.objectContaining({ provider: 'google', originalError: 'AbortError' }),
        null,
        mockLogger
      );
    });

    test('handles timeout errors as retryable', () => {
      const timeoutError = new Error('Request timeout after 30 seconds');
      timeoutError.name = 'TypeError';

      expect(() => {
        providerErrorHandler.handleNetworkError(timeoutError);
      }).toThrow(expect.objectContaining({
        type: 'timeout',
        retryable: true,
        retryAfter: 5000
      }));
    });

    test('handles generic network errors', () => {
      const networkError = new Error('Network connection failed');
      networkError.name = 'TypeError';

      expect(() => {
        providerErrorHandler.handleNetworkError(networkError);
      }).toThrow(expect.objectContaining({
        type: 'network',
        retryable: true,
        retryAfter: 5000
      }));
    });
  });

  describe('Response Error Handling', () => {
    test('creates invalid response error', () => {
      const context = { provider: 'deepl', endpoint: '/v2/translate' };

      expect(() => {
        providerErrorHandler.handleResponseError('Missing required field: text', context);
      }).toThrow(expect.objectContaining({
        type: 'invalid_response',
        retryable: false,
        message: 'Missing required field: text'
      }));

      expect(mockErrorHandler.handle).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'invalid_response' }),
        expect.objectContaining({ provider: 'deepl', endpoint: '/v2/translate' }),
        null,
        undefined
      );
    });

    test('uses default message when none provided', () => {
      expect(() => {
        providerErrorHandler.handleResponseError();
      }).toThrow(expect.objectContaining({
        message: 'Invalid API response'
      }));
    });
  });

  describe('Provider Operation Wrapper', () => {
    test('wraps successful operation', async () => {
      const successfulOperation = jest.fn(async (text) => ({ translated: text + ' [ES]' }));
      const wrappedOperation = providerErrorHandler.wrapProviderOperation(
        successfulOperation,
        { provider: 'test' }
      );

      const result = await wrappedOperation('Hello world');
      expect(result).toEqual({ translated: 'Hello world [ES]' });
      expect(successfulOperation).toHaveBeenCalledWith('Hello world');
    });

    test('wraps and re-throws ProviderError', async () => {
      const providerError = new providerErrorHandler.ProviderError(
        'API quota exceeded',
        'quota_exceeded',
        429,
        true,
        3600000
      );

      const failingOperation = jest.fn(async () => {
        throw providerError;
      });

      const wrappedOperation = providerErrorHandler.wrapProviderOperation(
        failingOperation,
        { provider: 'test', logger: mockLogger }
      );

      await expect(wrappedOperation('test')).rejects.toBe(providerError);

      expect(mockErrorHandler.handle).toHaveBeenCalledWith(
        providerError,
        expect.objectContaining({ provider: 'test' }),
        null,
        mockLogger
      );
    });

    test('wraps and converts AbortError', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      const failingOperation = jest.fn(async () => {
        throw abortError;
      });

      const wrappedOperation = providerErrorHandler.wrapProviderOperation(
        failingOperation,
        { provider: 'test' }
      );

      await expect(wrappedOperation('test')).rejects.toThrow(
        expect.objectContaining({
          name: 'ProviderError',
          type: 'timeout',
          retryable: false
        })
      );
    });

    test('wraps and converts TypeError', async () => {
      const typeError = new Error('Failed to fetch');
      typeError.name = 'TypeError';

      const failingOperation = jest.fn(async () => {
        throw typeError;
      });

      const wrappedOperation = providerErrorHandler.wrapProviderOperation(
        failingOperation,
        { provider: 'test' }
      );

      await expect(wrappedOperation('test')).rejects.toThrow(
        expect.objectContaining({
          name: 'ProviderError',
          type: 'network',
          retryable: true
        })
      );
    });

    test('wraps generic errors', async () => {
      const genericError = new Error('Something went wrong');

      const failingOperation = jest.fn(async () => {
        throw genericError;
      });

      const wrappedOperation = providerErrorHandler.wrapProviderOperation(
        failingOperation,
        { provider: 'test' }
      );

      await expect(wrappedOperation('test')).rejects.toThrow(
        expect.objectContaining({
          name: 'ProviderError',
          type: 'server_error',
          retryable: true,
          retryAfter: 5000
        })
      );
    });
  });

  describe('Golden Test Scenarios', () => {
    // Golden Test 1: Complete provider error handling workflow
    test('GOLDEN: handles complete provider failure workflow', async () => {
      const mockTranslateOperation = async (text, options) => {
        // Simulate different failure scenarios based on input
        if (text === 'trigger_auth_error') {
          const response = {
            status: 401,
            statusText: 'Unauthorized',
            json: () => Promise.resolve({ error: 'Invalid API key' }),
            headers: { get: () => null }
          };
          await providerErrorHandler.handleHttpError(response, {
            provider: 'openai',
            endpoint: '/translate'
          });
        } else if (text === 'trigger_rate_limit') {
          const response = {
            status: 429,
            statusText: 'Too Many Requests',
            json: () => Promise.resolve({ message: 'Rate limit exceeded' }),
            headers: { get: (h) => h === 'retry-after' ? '60' : null }
          };
          await providerErrorHandler.handleHttpError(response, {
            provider: 'openai'
          });
        } else if (text === 'trigger_network_error') {
          const networkError = new Error('Network connection failed');
          networkError.name = 'TypeError';
          providerErrorHandler.handleNetworkError(networkError, {
            provider: 'openai'
          });
        }
        return { text: text + ' [translated]' };
      };

      const wrappedOperation = providerErrorHandler.wrapProviderOperation(
        mockTranslateOperation,
        { provider: 'openai', logger: mockLogger }
      );

      // Test successful operation
      const success = await wrappedOperation('Hello world');
      expect(success).toEqual({ text: 'Hello world [translated]' });

      // Test authentication error
      await expect(wrappedOperation('trigger_auth_error')).rejects.toMatchObject({
        type: 'authentication',
        retryable: false
      });

      // Test rate limit error
      await expect(wrappedOperation('trigger_rate_limit')).rejects.toMatchObject({
        type: 'rate_limit',
        retryable: true,
        retryAfter: 60000
      });

      // Test network error
      await expect(wrappedOperation('trigger_network_error')).rejects.toMatchObject({
        type: 'network',
        retryable: true
      });

      // Verify all errors were logged through centralized handler
      // Each error is logged twice: once by specific handler, once by wrapper
      expect(mockErrorHandler.handle).toHaveBeenCalledTimes(6);
    });

    // Golden Test 2: Provider resilience patterns  
    test('GOLDEN: demonstrates resilient provider patterns', async () => {
      const resilientProvider = {
        maxRetries: 3,
        retryDelay: 10, // Reduced delay for test speed

        async translate(text, attempt = 1) {
          const mockOperation = async () => {
            if (attempt === 1) {
              // First attempt: rate limited
              const response = {
                status: 429,
                statusText: 'Too Many Requests',
                json: () => Promise.resolve({ message: 'Rate limit' }),
                headers: { get: () => null }
              };
              await providerErrorHandler.handleHttpError(response, {
                provider: 'resilient-test'
              });
            } else if (attempt === 2) {
              // Second attempt: server error
              const response = {
                status: 503,
                statusText: 'Service Unavailable',
                json: () => Promise.resolve({ error: 'Service down' }),
                headers: { get: () => null }
              };
              await providerErrorHandler.handleHttpError(response, {
                provider: 'resilient-test'
              });
            } else {
              // Third attempt: success
              return { text: text + ' [successfully translated]' };
            }
          };

          const wrappedOperation = providerErrorHandler.wrapProviderOperation(
            mockOperation,
            { provider: 'resilient-test' }
          );

          try {
            return await wrappedOperation();
          } catch (error) {
            if (error.retryable && attempt < this.maxRetries) {
              // Skip delay for test speed
              return this.translate(text, attempt + 1);
            }
            throw error;
          }
        }
      };

      // Should succeed after retries
      const result = await resilientProvider.translate('Test message');
      expect(result).toEqual({ text: 'Test message [successfully translated]' });

      // Should have logged 2 retryable errors (each logged twice: handler + wrapper)
      expect(mockErrorHandler.handle).toHaveBeenCalledTimes(4);
    });

    // Edge Case 1: Malformed response handling
    test('EDGE CASE: handles completely malformed API responses', async () => {
      const mockOperation = async () => {
        // Simulate response that's not valid JSON and has no useful headers
        const mockResponse = {
          status: 200,
          statusText: 'OK',
          json: () => Promise.reject(new Error('Unexpected token')),
          headers: { get: () => null }
        };

        // Even though status is 200, we should handle JSON parsing failure
        try {
          await mockResponse.json();
          return { text: 'This should not be reached' };
        } catch (e) {
          providerErrorHandler.handleResponseError(
            'API returned malformed JSON',
            { provider: 'malformed-test' }
          );
        }
      };

      const wrappedOperation = providerErrorHandler.wrapProviderOperation(
        mockOperation,
        { provider: 'malformed-test' }
      );

      await expect(wrappedOperation()).rejects.toMatchObject({
        type: 'invalid_response',
        retryable: false,
        message: 'API returned malformed JSON'
      });
    });

    // Edge Case 2: Retry-after parsing edge cases
    test('EDGE CASE: handles edge cases in retry-after parsing', async () => {
      const testCases = [
        { value: 'invalid-number', expected: 60000 }, // Falls back to default
        { value: '0', expected: 100 }, // Minimum value enforced
        { value: '999999', expected: 300000 }, // Capped at max
        { value: 'Mon, 01 Jan 2024 00:00:00 GMT', expected: 100 }, // Past date = 0, min = 100
        { value: '', expected: 60000 } // Empty value falls back
      ];

      for (const testCase of testCases) {
        const mockResponse = {
          status: 429,
          statusText: 'Too Many Requests',
          json: () => Promise.resolve({ message: 'Rate limited' }),
          headers: { get: (h) => h === 'retry-after' ? testCase.value : null }
        };

        const error = await providerErrorHandler.handleHttpError(mockResponse)
          .catch(e => e);

        expect(error.retryAfter).toBe(testCase.expected);
      }
    });
  });

  describe('Integration with Centralized Error Handler', () => {
    test('uses centralized error handler when available', async () => {
      const mockResponse = {
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: 'Database connection failed' }),
        headers: { get: () => null }
      };

      const context = {
        provider: 'custom-provider',
        endpoint: '/api/translate',
        userId: 'test-user',
        logger: mockLogger
      };

      await expect(providerErrorHandler.handleHttpError(mockResponse, context))
        .rejects.toBeInstanceOf(providerErrorHandler.ProviderError);

      expect(mockErrorHandler.handle).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'ProviderError',
          type: 'server_error'
        }),
        expect.objectContaining({
          operation: 'translation',
          provider: 'custom-provider',
          endpoint: '/api/translate',
          userId: 'test-user'
        }),
        null,
        mockLogger
      );
    });

    test('works without centralized error handler', () => {
      // Remove the mock error handler and reload module
      if (typeof global !== 'undefined') {
        delete global.qwenErrorHandler;
      }
      
      // Reset modules to reload without global error handler
      jest.resetModules();
      const providerErrorModule = require('../../src/core/provider-error-handler');
      
      // Reset the mock call count since we deleted the global handler
      mockErrorHandler.handle.mockClear();

      const networkError = new Error('Connection refused');
      networkError.name = 'TypeError';

      // Should still throw proper ProviderError even without centralized handler
      expect(() => {
        providerErrorModule.handleNetworkError(networkError, { provider: 'test' });
      }).toThrow(expect.objectContaining({
        name: 'ProviderError',
        type: 'network'
      }));

      // No calls to centralized handler since it's not available
      expect(mockErrorHandler.handle).not.toHaveBeenCalled();
    });
  });
});
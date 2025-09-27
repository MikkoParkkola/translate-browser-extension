/**
 * HTTP Client Module - Implements HttpClientInterface
 * Handles HTTP requests with automatic retries, error handling, and streaming support
 */

/**
 * HTTP Client implementation following the defined interface
 */
class HttpClient {
  constructor(options = {}) {
    this.defaultRetries = options.retries || 3;
    this.timeout = options.timeout || 30000;
    this.userAgent = options.userAgent || 'Qwen-Translator/1.0';
    
    // Use fetch if available, fallback to XHR
    this.fetchFn = typeof fetch !== 'undefined' ? fetch : null;
  }

  /**
   * Make HTTP request with automatic retries and error handling
   * @param {string} url - Request URL
   * @param {Object} options - Request options
   * @returns {Promise<Response>} HTTP response
   */
  async request(url, options = {}) {
    const {
      method = 'GET',
      headers = {},
      body,
      signal,
      retries = this.defaultRetries
    } = options;

    const requestOptions = {
      method,
      headers: {
        'User-Agent': this.userAgent,
        ...headers
      },
      body,
      signal
    };

    let lastError;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (this.fetchFn) {
          const response = await this.fetchFn(url, requestOptions);
          return response;
        } else {
          // Fallback to XHR for environments without fetch
          return await this._xhrRequest(url, requestOptions);
        }
      } catch (error) {
        lastError = error;
        
        // Don't retry on certain errors
        if (error.name === 'AbortError' || 
            (error.status && error.status >= 400 && error.status < 500)) {
          throw error;
        }
        
        // Wait before retry with exponential backoff
        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await this._delay(delay);
        }
      }
    }
    
    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Make streaming request with data callback
   * @param {string} url - Request URL  
   * @param {Object} options - Request options
   * @param {Function} onData - Callback for streaming data
   * @returns {Promise<Response>} HTTP response
   */
  async requestStream(url, options, onData) {
    if (!this.fetchFn) {
      throw new Error('Streaming not supported without fetch API');
    }

    const response = await this.request(url, options);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (!response.body || !response.body.getReader) {
      // No streaming support, return full response
      const text = await response.text();
      if (onData) onData(text);
      return response;
    }

    // Stream the response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        if (onData && chunk) {
          onData(chunk);
        }
      }
    } finally {
      reader.releaseLock();
    }

    return response;
  }

  /**
   * XHR fallback implementation
   * @private
   */
  _xhrRequest(url, options) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(options.method || 'GET', url, true);
      
      // Set headers
      Object.entries(options.headers || {}).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value);
      });
      
      xhr.responseType = 'text';
      
      // Handle abort signal
      if (options.signal) {
        if (options.signal.aborted) {
          return reject(new DOMException('Aborted', 'AbortError'));
        }
        
        const onAbort = () => {
          xhr.abort();
          reject(new DOMException('Aborted', 'AbortError'));
        };
        
        options.signal.addEventListener('abort', onAbort, { once: true });
        xhr.addEventListener('loadend', () => {
          options.signal.removeEventListener('abort', onAbort);
        });
      }
      
      xhr.onload = () => {
        const response = {
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          statusText: xhr.statusText,
          headers: new Map(), // Simplified for XHR
          json: async () => JSON.parse(xhr.responseText || 'null'),
          text: async () => xhr.responseText,
          arrayBuffer: async () => {
            throw new Error('ArrayBuffer not supported in XHR fallback');
          }
        };
        resolve(response);
      };
      
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.ontimeout = () => reject(new Error('Request timeout'));
      
      if (this.timeout) {
        xhr.timeout = this.timeout;
      }
      
      xhr.send(options.body);
    });
  }

  /**
   * Utility delay function
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create HTTP client with bearer token authentication
   * @param {string} token - Bearer token
   * @returns {HttpClient} Configured HTTP client
   */
  static withBearerAuth(token) {
    return new HttpClient({
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
  }

  /**
   * Create HTTP client with custom configuration
   * @param {Object} config - Configuration options
   * @returns {HttpClient} Configured HTTP client
   */
  static create(config = {}) {
    return new HttpClient(config);
  }
}

// Create default instance
const defaultHttpClient = new HttpClient();

// Export for different environments
if (typeof module !== 'undefined') {
  module.exports = {
    HttpClient,
    defaultHttpClient
  };
}

if (typeof window !== 'undefined') {
  window.qwenHttpClient = {
    HttpClient,
    defaultHttpClient
  };
}

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.qwenHttpClient = {
    HttpClient,  
    defaultHttpClient
  };
}
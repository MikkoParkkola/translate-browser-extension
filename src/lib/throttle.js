/**
 * Rate limiting and throttling for API requests
 * Prevents API overuse and handles rate limit errors
 */

import { logger } from './logger.js';

class Throttle {
  constructor(options = {}) {
    this.requestLimit = options.requestLimit || 60;
    this.tokenLimit = options.tokenLimit || 100000;
    this.windowMs = options.windowMs || 60000; // 1 minute
    
    this.requests = [];
    this.tokens = 0;
    this.tokenResetTime = Date.now() + this.windowMs;
  }

  // Check if we can make a request
  canMakeRequest(tokensNeeded = 0) {
    const now = Date.now();
    
    // Clean old requests
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    // Reset token counter if window expired
    if (now > this.tokenResetTime) {
      this.tokens = 0;
      this.tokenResetTime = now + this.windowMs;
    }
    
    const hasRequestCapacity = this.requests.length < this.requestLimit;
    const hasTokenCapacity = this.tokens + tokensNeeded <= this.tokenLimit;
    
    return hasRequestCapacity && hasTokenCapacity;
  }

  // Record usage after successful request
  recordUsage(tokensUsed = 0) {
    this.requests.push(Date.now());
    this.tokens += tokensUsed;
  }

  // Get current usage stats
  getUsage() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    if (now > this.tokenResetTime) {
      this.tokens = 0;
      this.tokenResetTime = now + this.windowMs;
    }
    
    return {
      requests: this.requests.length,
      requestLimit: this.requestLimit,
      tokens: this.tokens,
      tokenLimit: this.tokenLimit,
      resetIn: Math.max(0, this.tokenResetTime - now)
    };
  }

  // Wait for capacity to be available
  async waitForCapacity(tokensNeeded = 0, maxWaitMs = 30000) {
    const startTime = Date.now();
    
    while (!this.canMakeRequest(tokensNeeded)) {
      if (Date.now() - startTime > maxWaitMs) {
        throw new Error('Rate limit wait timeout');
      }
      
      // Wait 1 second before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Run function with rate limiting
  async runWithRateLimit(fn, tokensNeeded = 0, retries = 5) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        // Wait for capacity
        await this.waitForCapacity(tokensNeeded);

        // Execute function
        const result = await fn();

        // Record successful usage
        this.recordUsage(tokensNeeded);

        return result;
      } catch (error) {
        // Check if it's a rate limit error or parameter limit error
        if (error.message?.includes('rate limit') ||
            error.message?.includes('429') ||
            error.message?.includes('Parameter limit exceeded')) {

          // Use more conservative backoff for parameter limits
          const isParameterLimit = error.message?.includes('Parameter limit exceeded');
          const baseWait = isParameterLimit ? 2000 : 3000;
          const waitTime = Math.min(baseWait * Math.pow(1.5, attempt), 45000); // More conservative backoff

          logger.warn('Throttle', `${isParameterLimit ? 'Parameter limit' : 'Rate limit'} hit, waiting ${waitTime}ms before retry ${attempt + 1}/${retries}`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        // If it's not a retryable error, throw immediately
        throw error;
      }
    }

    throw new Error('Max retries exceeded for rate limited request');
  }
}

// Global throttle instance
let globalThrottle = new Throttle();

// Factory function to create throttles
function createThrottle(options) {
  return new Throttle(options);
}

// Configure global throttle
function configure(options) {
  globalThrottle = new Throttle(options);
}

// Get global throttle usage
function getUsage() {
  return globalThrottle.getUsage();
}

// Record usage on global throttle
function recordUsage(tokens) {
  return globalThrottle.recordUsage(tokens);
}

// Approximate token count (rough estimation: 1 token ≈ 4 characters)
function approxTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// Export for browser extension
if (typeof window !== 'undefined') {
  window.Throttle = {
    createThrottle,
    configure,
    getUsage,
    recordUsage,
    approxTokens,
    globalThrottle: () => globalThrottle
  };
} else if (typeof self !== 'undefined') {
  // Service worker context
  self.Throttle = {
    createThrottle,
    configure,
    getUsage,
    recordUsage,
    approxTokens,
    globalThrottle: () => globalThrottle
  };
}

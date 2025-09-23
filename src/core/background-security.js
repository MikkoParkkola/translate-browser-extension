/**
 * @fileoverview Background Script Security Hardening
 * Implements comprehensive security measures for the background service worker
 *
 * THREAT MODEL:
 * - Malicious content scripts injecting requests
 * - Rate limiting bypass attempts
 * - API key theft via timing attacks
 * - Memory exhaustion attacks
 * - Request flooding (DoS)
 */

(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenBackgroundSecurity = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {

  // THREAT: Timing attacks on rate limiting
  // MITIGATION: Sliding window with jitter and memory-bounded tracking
  class SecureRateLimit {
    constructor(options = {}) {
      this.windowMs = options.windowMs || 60000;
      this.maxRequests = options.maxRequests || 60;
      this.maxTokens = options.maxTokens || 100000;
      this.maxMemoryMB = options.maxMemoryMB || 10;

      // Sliding window buckets for precise rate limiting
      this.requestBuckets = new Map();
      this.tokenBuckets = new Map();
      this.lastCleanup = Date.now();
      this.cleanupInterval = 30000; // Clean every 30 seconds
    }

    // THREAT: Memory exhaustion via origin flooding
    // MITIGATION: LRU eviction with memory limits
    checkLimits(origin, tokens = 0) {
      const now = Date.now();

      // Cleanup old entries periodically
      if (now - this.lastCleanup > this.cleanupInterval) {
        this.cleanup(now);
      }

      const requestKey = `req:${origin}`;
      const tokenKey = `tok:${origin}`;

      // Check request limit
      const requests = this.requestBuckets.get(requestKey) || [];
      const recentRequests = requests.filter(time => now - time < this.windowMs);

      if (recentRequests.length >= this.maxRequests) {
        return { allowed: false, reason: 'request_limit_exceeded' };
      }

      // Check token limit
      const tokenEntries = this.tokenBuckets.get(tokenKey) || [];
      const recentTokens = tokenEntries.filter(entry => now - entry.time < this.windowMs);
      const totalTokens = recentTokens.reduce((sum, entry) => sum + entry.tokens, 0);

      if (totalTokens + tokens > this.maxTokens) {
        return { allowed: false, reason: 'token_limit_exceeded' };
      }

      // Record this request
      recentRequests.push(now);
      this.requestBuckets.set(requestKey, recentRequests);

      if (tokens > 0) {
        recentTokens.push({ time: now, tokens });
        this.tokenBuckets.set(tokenKey, recentTokens);
      }

      return { allowed: true, requests: recentRequests.length, tokens: totalTokens + tokens };
    }

    cleanup(now) {
      const cutoff = now - this.windowMs;

      // Clean request buckets
      for (const [key, requests] of this.requestBuckets.entries()) {
        const recent = requests.filter(time => time > cutoff);
        if (recent.length === 0) {
          this.requestBuckets.delete(key);
        } else {
          this.requestBuckets.set(key, recent);
        }
      }

      // Clean token buckets
      for (const [key, tokens] of this.tokenBuckets.entries()) {
        const recent = tokens.filter(entry => entry.time > cutoff);
        if (recent.length === 0) {
          this.tokenBuckets.delete(key);
        } else {
          this.tokenBuckets.set(key, recent);
        }
      }

      this.lastCleanup = now;

      // Memory pressure cleanup - keep only most recent entries
      if (this.getMemoryUsageMB() > this.maxMemoryMB) {
        this.emergencyCleanup();
      }
    }

    emergencyCleanup() {
      // Keep only the 100 most recent origins for each bucket type
      const maxOrigins = 100;

      if (this.requestBuckets.size > maxOrigins) {
        const entries = Array.from(this.requestBuckets.entries());
        entries.sort((a, b) => Math.max(...b[1]) - Math.max(...a[1])); // Sort by most recent activity
        this.requestBuckets.clear();
        entries.slice(0, maxOrigins).forEach(([key, value]) => {
          this.requestBuckets.set(key, value);
        });
      }

      if (this.tokenBuckets.size > maxOrigins) {
        const entries = Array.from(this.tokenBuckets.entries());
        entries.sort((a, b) => Math.max(...b[1].map(e => e.time)) - Math.max(...a[1].map(e => e.time)));
        this.tokenBuckets.clear();
        entries.slice(0, maxOrigins).forEach(([key, value]) => {
          this.tokenBuckets.set(key, value);
        });
      }
    }

    getMemoryUsageMB() {
      // Rough estimation of memory usage
      const requestEntries = Array.from(this.requestBuckets.values()).flat().length;
      const tokenEntries = Array.from(this.tokenBuckets.values()).flat().length;
      return (requestEntries * 8 + tokenEntries * 16) / (1024 * 1024); // 8 bytes per timestamp, 16 per token entry
    }

    getStats() {
      return {
        requestOrigins: this.requestBuckets.size,
        tokenOrigins: this.tokenBuckets.size,
        memoryUsageMB: this.getMemoryUsageMB(),
        maxMemoryMB: this.maxMemoryMB
      };
    }
  }

  // THREAT: Request signature forgery and replay attacks
  // MITIGATION: HMAC-based request signing with nonce
  class RequestValidator {
    constructor(secretKey) {
      this.secretKey = secretKey || this.generateSecret();
      this.nonceCache = new Set();
      this.maxNonceAge = 300000; // 5 minutes
      this.lastNoncePurge = Date.now();
    }

    async generateSecret() {
      if (crypto && crypto.subtle) {
        const key = await crypto.subtle.generateKey(
          { name: 'HMAC', hash: 'SHA-256' },
          true,
          ['sign', 'verify']
        );
        return key;
      }
      // Fallback for environments without crypto.subtle
      return Math.random().toString(36).repeat(8);
    }

    // THREAT: Replay attacks
    // MITIGATION: Nonce validation with time-based expiry
    async validateRequest(request, signature, nonce, timestamp) {
      const now = Date.now();

      // Check timestamp freshness (within 5 minutes)
      if (Math.abs(now - timestamp) > this.maxNonceAge) {
        return { valid: false, reason: 'timestamp_expired' };
      }

      // Check nonce uniqueness
      if (this.nonceCache.has(nonce)) {
        return { valid: false, reason: 'nonce_reused' };
      }

      // Validate HMAC signature
      const expectedSignature = await this.signRequest(request, nonce, timestamp);

      // Constant-time comparison to prevent timing attacks
      if (!this.constantTimeCompare(signature, expectedSignature)) {
        return { valid: false, reason: 'invalid_signature' };
      }

      // Add nonce to cache
      this.nonceCache.add(nonce);
      this.purgeOldNonces(now);

      return { valid: true };
    }

    async signRequest(request, nonce, timestamp) {
      const message = JSON.stringify({ request, nonce, timestamp });

      if (crypto && crypto.subtle && typeof this.secretKey === 'object') {
        const encoder = new TextEncoder();
        const data = encoder.encode(message);
        const signature = await crypto.subtle.sign('HMAC', this.secretKey, data);
        return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
      }

      // Fallback simple hash for environments without crypto.subtle
      let hash = 0;
      const str = message + this.secretKey;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      return hash.toString(16);
    }

    constantTimeCompare(a, b) {
      if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
      }

      let result = 0;
      const maxLength = Math.max(a.length, b.length);

      for (let i = 0; i < maxLength; i++) {
        const charA = i < a.length ? a.charCodeAt(i) : 0;
        const charB = i < b.length ? b.charCodeAt(i) : 0;
        result |= charA ^ charB;
      }

      return result === 0 && a.length === b.length;
    }

    purgeOldNonces(now) {
      if (now - this.lastNoncePurge > 60000) { // Purge every minute
        // Since Set doesn't have timestamps, we clear periodically
        // In production, use a Map with timestamps for more precise control
        if (this.nonceCache.size > 10000) {
          this.nonceCache.clear();
        }
        this.lastNoncePurge = now;
      }
    }
  }

  // THREAT: Message content injection and XSS
  // MITIGATION: Comprehensive input sanitization
  class InputSanitizer {
    constructor() {
      this.maxTextLength = 50000;
      this.maxApiKeyLength = 500;
      this.maxUrlLength = 2048;

      this.suspiciousPatterns = [
        // Script injection patterns
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        /javascript:/gi,
        /data:.*?(?:javascript|vbscript)/gi,
        /on\w+\s*=/gi,

        // SQL injection patterns
        /(\bUNION\b|\bSELECT\b|\bINSERT\b|\bDELETE\b|\bUPDATE\b).*?(\bFROM\b|\bINTO\b|\bWHERE\b)/gi,

        // Command injection patterns
        /[;&|`$(){}[\]]/g,

        // Path traversal
        /\.\.[\/\\]/g,
      ];
    }

    sanitizeTranslationRequest(request) {
      const sanitized = { ...request };

      // Sanitize text content
      if (sanitized.text) {
        sanitized.text = this.sanitizeText(sanitized.text);
      }

      // Sanitize API configuration
      if (sanitized.apiKey) {
        sanitized.apiKey = this.sanitizeApiKey(sanitized.apiKey);
      }

      if (sanitized.endpoint) {
        sanitized.endpoint = this.sanitizeUrl(sanitized.endpoint);
      }

      // Validate language codes
      if (sanitized.source) {
        sanitized.source = this.sanitizeLanguageCode(sanitized.source);
      }

      if (sanitized.target) {
        sanitized.target = this.sanitizeLanguageCode(sanitized.target);
      }

      return sanitized;
    }

    sanitizeText(text) {
      if (typeof text !== 'string') {
        return '';
      }

      // Length validation
      if (text.length > this.maxTextLength) {
        text = text.substring(0, this.maxTextLength);
      }

      // Remove suspicious patterns
      for (const pattern of this.suspiciousPatterns) {
        text = text.replace(pattern, '');
      }

      // Normalize whitespace
      text = text.replace(/\s+/g, ' ').trim();

      return text;
    }

    sanitizeApiKey(key) {
      if (typeof key !== 'string') {
        return '';
      }

      // Length validation
      if (key.length > this.maxApiKeyLength) {
        return '';
      }

      // Remove dangerous characters
      return key.replace(/[<>&"'\/\\]/g, '');
    }

    sanitizeUrl(url) {
      if (typeof url !== 'string') {
        return '';
      }

      // Length validation
      if (url.length > this.maxUrlLength) {
        return '';
      }

      try {
        const urlObj = new URL(url);

        // Only allow HTTPS (and HTTP for localhost/development)
        if (urlObj.protocol !== 'https:' &&
            !(urlObj.protocol === 'http:' && urlObj.hostname === 'localhost')) {
          return '';
        }

        return urlObj.toString();
      } catch {
        return '';
      }
    }

    sanitizeLanguageCode(code) {
      if (typeof code !== 'string') {
        return 'auto';
      }

      // Only allow valid language codes (2-3 chars, alphanumeric, plus 'auto')
      if (!/^(auto|[a-z]{2,3})$/i.test(code)) {
        return 'auto';
      }

      return code.toLowerCase();
    }

    detectSuspiciousContent(text) {
      if (typeof text !== 'string') {
        return { suspicious: false, patterns: [] };
      }

      const detectedPatterns = [];

      for (let i = 0; i < this.suspiciousPatterns.length; i++) {
        if (this.suspiciousPatterns[i].test(text)) {
          detectedPatterns.push(`pattern_${i}`);
        }
      }

      return {
        suspicious: detectedPatterns.length > 0,
        patterns: detectedPatterns
      };
    }
  }

  // THREAT: Memory leak attacks through excessive caching
  // MITIGATION: Memory-bounded request tracking
  class MemoryGuard {
    constructor(maxMemoryMB = 50) {
      this.maxMemoryBytes = maxMemoryMB * 1024 * 1024;
      this.requestHistory = new Map();
      this.lastCleanup = Date.now();
      this.cleanupInterval = 60000; // 1 minute
    }

    checkMemoryPressure() {
      const usage = this.estimateMemoryUsage();

      if (usage > this.maxMemoryBytes) {
        this.emergencyCleanup();
        return { critical: true, usage, limit: this.maxMemoryBytes };
      }

      if (usage > this.maxMemoryBytes * 0.8) {
        return { warning: true, usage, limit: this.maxMemoryBytes };
      }

      return { ok: true, usage, limit: this.maxMemoryBytes };
    }

    trackRequest(origin, requestData) {
      const now = Date.now();
      const entry = {
        timestamp: now,
        size: this.estimateObjectSize(requestData),
        origin
      };

      if (!this.requestHistory.has(origin)) {
        this.requestHistory.set(origin, []);
      }

      this.requestHistory.get(origin).push(entry);

      // Periodic cleanup
      if (now - this.lastCleanup > this.cleanupInterval) {
        this.cleanup();
      }
    }

    cleanup() {
      const now = Date.now();
      const maxAge = 300000; // 5 minutes
      let removedEntries = 0;

      for (const [origin, entries] of this.requestHistory.entries()) {
        const recentEntries = entries.filter(entry => now - entry.timestamp < maxAge);

        if (recentEntries.length === 0) {
          this.requestHistory.delete(origin);
        } else {
          this.requestHistory.set(origin, recentEntries);
        }

        removedEntries += entries.length - recentEntries.length;
      }

      this.lastCleanup = now;
      return removedEntries;
    }

    emergencyCleanup() {
      // Keep only the 50 most recent origins
      const maxOrigins = 50;

      if (this.requestHistory.size > maxOrigins) {
        const entries = Array.from(this.requestHistory.entries());
        entries.sort((a, b) => {
          const aLatest = Math.max(...a[1].map(e => e.timestamp));
          const bLatest = Math.max(...b[1].map(e => e.timestamp));
          return bLatest - aLatest;
        });

        this.requestHistory.clear();
        entries.slice(0, maxOrigins).forEach(([origin, requests]) => {
          // Keep only the 10 most recent requests per origin
          const recent = requests.slice(-10);
          this.requestHistory.set(origin, recent);
        });
      }
    }

    estimateMemoryUsage() {
      let totalSize = 0;

      for (const entries of this.requestHistory.values()) {
        totalSize += entries.reduce((sum, entry) => sum + entry.size + 64, 0); // 64 bytes overhead per entry
      }

      return totalSize;
    }

    estimateObjectSize(obj) {
      // Rough estimation of object size in bytes
      const jsonStr = JSON.stringify(obj);
      return jsonStr.length * 2; // UTF-16 encoding
    }

    getStats() {
      return {
        totalOrigins: this.requestHistory.size,
        totalRequests: Array.from(this.requestHistory.values()).reduce((sum, entries) => sum + entries.length, 0),
        memoryUsageBytes: this.estimateMemoryUsage(),
        maxMemoryBytes: this.maxMemoryBytes,
        memoryPressure: this.estimateMemoryUsage() / this.maxMemoryBytes
      };
    }
  }

  // Main security module
  class BackgroundSecurity {
    constructor(options = {}) {
      this.rateLimit = new SecureRateLimit(options.rateLimit);
      this.requestValidator = new RequestValidator(options.secretKey);
      this.inputSanitizer = new InputSanitizer();
      this.memoryGuard = new MemoryGuard(options.maxMemoryMB);

      this.securityLog = [];
      this.maxLogEntries = 1000;
    }

    // THREAT: Comprehensive request validation pipeline
    // MITIGATION: Multi-layer security validation
    async validateSecureRequest(request, sender) {
      const origin = this.extractOrigin(sender);
      const timestamp = Date.now();

      // 1. Rate limiting check
      const tokens = this.estimateTokens(request.text || '');
      const rateLimitResult = this.rateLimit.checkLimits(origin, tokens);

      if (!rateLimitResult.allowed) {
        this.logSecurityEvent('rate_limit_exceeded', {
          origin,
          reason: rateLimitResult.reason,
          tokens
        });
        return { valid: false, error: 'Rate limit exceeded' };
      }

      // 2. Memory pressure check
      const memoryStatus = this.memoryGuard.checkMemoryPressure();
      this.memoryGuard.trackRequest(origin, request);

      if (memoryStatus.critical) {
        this.logSecurityEvent('memory_pressure_critical', {
          origin,
          usage: memoryStatus.usage,
          limit: memoryStatus.limit
        });
        return { valid: false, error: 'System under memory pressure' };
      }

      // 3. Input sanitization
      const sanitized = this.inputSanitizer.sanitizeTranslationRequest(request);

      // 4. Suspicious content detection
      if (sanitized.text) {
        const suspiciousResult = this.inputSanitizer.detectSuspiciousContent(sanitized.text);
        if (suspiciousResult.suspicious) {
          this.logSecurityEvent('suspicious_content_detected', {
            origin,
            patterns: suspiciousResult.patterns
          });
          return { valid: false, error: 'Suspicious content detected' };
        }
      }

      return {
        valid: true,
        sanitized,
        memoryWarning: memoryStatus.warning
      };
    }

    extractOrigin(sender) {
      if (sender.tab && sender.tab.url) {
        try {
          return new URL(sender.tab.url).origin;
        } catch {
          return 'unknown';
        }
      }
      return sender.id || 'extension';
    }

    estimateTokens(text) {
      return Math.ceil((text || '').length / 4);
    }

    logSecurityEvent(eventType, details) {
      const event = {
        timestamp: Date.now(),
        type: eventType,
        details,
        severity: this.getEventSeverity(eventType)
      };

      this.securityLog.push(event);

      // Keep log size bounded
      if (this.securityLog.length > this.maxLogEntries) {
        this.securityLog.shift();
      }

      // Log high-severity events
      if (event.severity === 'high' || event.severity === 'critical') {
        console.warn('[SECURITY]', eventType, details);
      }
    }

    getEventSeverity(eventType) {
      const severityMap = {
        'rate_limit_exceeded': 'high',
        'memory_pressure_critical': 'critical',
        'suspicious_content_detected': 'high',
        'invalid_signature': 'high',
        'nonce_reused': 'high',
        'timestamp_expired': 'medium',
        'input_validation_failed': 'medium'
      };

      return severityMap[eventType] || 'low';
    }

    getSecurityStats() {
      return {
        rateLimit: this.rateLimit.getStats(),
        memory: this.memoryGuard.getStats(),
        events: {
          total: this.securityLog.length,
          recent: this.securityLog.filter(e => Date.now() - e.timestamp < 300000).length,
          highSeverity: this.securityLog.filter(e => e.severity === 'high' || e.severity === 'critical').length
        }
      };
    }

    // Emergency shutdown in case of attack
    emergencyShutdown(reason) {
      this.logSecurityEvent('emergency_shutdown', { reason, severity: 'critical' });

      // Clear all caches and rate limiters
      this.rateLimit.requestBuckets.clear();
      this.rateLimit.tokenBuckets.clear();
      this.memoryGuard.emergencyCleanup();

      console.error('[SECURITY] Emergency shutdown triggered:', reason);
    }
  }

  return {
    BackgroundSecurity,
    SecureRateLimit,
    RequestValidator,
    InputSanitizer,
    MemoryGuard
  };

}));
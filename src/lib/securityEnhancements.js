/**
 * Security Enhancement System
 * Provides input sanitization, XSS protection, CSP enforcement, and security monitoring
 * for the browser extension translation system.
 */

(function(global) {
  'use strict';

  /**
   * Security Enhancement System for robust input validation and attack prevention
   */
  class SecurityEnhancements {
    constructor(options = {}) {
      this.options = {
        enableInputSanitization: options.enableInputSanitization ?? true,
        enableXSSProtection: options.enableXSSProtection ?? true,
        enableCSPEnforcement: options.enableCSPEnforcement ?? true,
        enableContentValidation: options.enableContentValidation ?? true,
        enableOutputSanitization: options.enableOutputSanitization ?? true,
        enableRateLimiting: options.enableRateLimiting ?? true,
        enableSecurityLogging: options.enableSecurityLogging ?? true,
        enableThreatDetection: options.enableThreatDetection ?? true,
        maxInputLength: options.maxInputLength ?? 100000, // 100KB max input
        maxNestingDepth: options.maxNestingDepth ?? 10,
        allowedProtocols: options.allowedProtocols ?? ['http:', 'https:'],
        blockedPatterns: options.blockedPatterns ?? [],
        sanitizationLevel: options.sanitizationLevel ?? 'strict', // strict, moderate, permissive
        cspDirectives: options.cspDirectives ?? this.getDefaultCSP(),
        threatThreshold: options.threatThreshold ?? 0.7,
        enableHoneypot: options.enableHoneypot ?? false,
        debug: options.debug ?? false,
        ...options
      };

      this.threats = new Map();
      this.violations = new Map();
      this.sanitizationCache = new Map();
      this.securityEvents = [];
      this.rateLimiters = new Map();

      // Security patterns for threat detection
      this.threatPatterns = {
        xss: [
          /<script[^>]*>[\s\S]*?<\/script>/gi,
          /javascript:/gi,
          /on\w+\s*=/gi,
          /<iframe[^>]*>[\s\S]*?<\/iframe>/gi,
          /<object[^>]*>[\s\S]*?<\/object>/gi,
          /<embed[^>]*>/gi,
          /expression\s*\(/gi,
          /@import/gi,
          /vbscript:/gi,
          /data:text\/html/gi
        ],
        injection: [
          /\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b/gi,
          /['"]\s*(or|and)\s*['"]/gi,
          /--\s*$/gm,
          /\/\*[\s\S]*?\*\//g
        ],
        traversal: [
          /\.\.[\/\\]/g,
          /\.\.\\/g,
          /%2e%2e[\/\\]/gi,
          /%252e%252e/gi
        ],
        protocol: [
          /^(data|javascript|vbscript|file|ftp):/i
        ]
      };

      // HTML entities for sanitization
      this.htmlEntities = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '/': '&#x2F;',
        '`': '&#x60;',
        '=': '&#x3D;'
      };

      // Initialize security monitoring
      this.initialize();
    }

    /**
     * Initialize security system
     */
    initialize() {
      if (this.options.debug) {
        console.log('[SecurityEnhancements] Initializing security system...');
      }

      // Set up CSP enforcement if in browser context
      if (typeof document !== 'undefined' && this.options.enableCSPEnforcement) {
        this.enforceCSP();
      }

      // Set up security event listeners
      this.setupSecurityListeners();

      if (this.options.debug) {
        console.log('[SecurityEnhancements] Security system initialized');
      }
    }

    /**
     * Get default Content Security Policy
     */
    getDefaultCSP() {
      return {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", "data:", "https:"],
        'connect-src': ["'self'", "https:"],
        'font-src': ["'self'", "data:"],
        'object-src': ["'none'"],
        'media-src': ["'self'"],
        'frame-src': ["'none'"],
        'worker-src': ["'self'"],
        'child-src': ["'self'"],
        'form-action': ["'self'"],
        'base-uri': ["'self'"],
        'manifest-src': ["'self'"]
      };
    }

    /**
     * Sanitize input text for safe processing
     */
    sanitizeInput(input, context = {}) {
      try {
        if (!this.options.enableInputSanitization) {
          return { sanitized: input, threats: [], safe: true };
        }

        if (typeof input !== 'string') {
          input = String(input);
        }

        // Check input length
        if (input.length > this.options.maxInputLength) {
          this.logSecurityEvent('input_length_exceeded', {
            length: input.length,
            maxLength: this.options.maxInputLength,
            context
          });

          return {
            sanitized: input.substring(0, this.options.maxInputLength),
            threats: ['excessive_length'],
            safe: false,
            truncated: true
          };
        }

        // Check for threats
        const threats = this.detectThreats(input);

        // Apply sanitization based on level
        let sanitized = input;
        let safe = threats.length === 0;

        if (this.options.sanitizationLevel === 'strict') {
          sanitized = this.strictSanitize(input, threats);
        } else if (this.options.sanitizationLevel === 'moderate') {
          sanitized = this.moderateSanitize(input, threats);
        } else if (this.options.sanitizationLevel === 'permissive') {
          sanitized = this.permissiveSanitize(input, threats);
        }

        // Log security events
        if (threats.length > 0) {
          this.logSecurityEvent('threats_detected', {
            threats,
            originalLength: input.length,
            sanitizedLength: sanitized.length,
            context
          });
        }

        return {
          sanitized,
          threats,
          safe,
          confidence: this.calculateThreatConfidence(threats)
        };

      } catch (error) {
        this.logSecurityEvent('sanitization_error', {
          error: error.message,
          context
        });

        return {
          sanitized: '',
          threats: ['sanitization_error'],
          safe: false,
          error: error.message
        };
      }
    }

    /**
     * Detect security threats in input
     */
    detectThreats(input) {
      const threats = [];

      // Check each threat pattern
      for (const [threatType, patterns] of Object.entries(this.threatPatterns)) {
        for (const pattern of patterns) {
          if (pattern.test(input)) {
            threats.push(threatType);
            break; // Only add threat type once
          }
        }
      }

      // Check custom blocked patterns
      for (const pattern of this.options.blockedPatterns) {
        if (typeof pattern === 'string' && input.includes(pattern)) {
          threats.push('blocked_pattern');
        } else if (pattern instanceof RegExp && pattern.test(input)) {
          threats.push('blocked_pattern');
        }
      }

      // Check for suspicious character sequences
      if (this.containsSuspiciousSequences(input)) {
        threats.push('suspicious_sequence');
      }

      return [...new Set(threats)]; // Remove duplicates
    }

    /**
     * Check for suspicious character sequences
     */
    containsSuspiciousSequences(input) {
      const suspiciousPatterns = [
        /%[0-9a-f]{2}/gi, // URL encoding
        /&#[0-9]+;/gi,    // HTML entities
        /\\u[0-9a-f]{4}/gi, // Unicode escapes
        /\\x[0-9a-f]{2}/gi, // Hex escapes
        /\u0000-\u001f/g,   // Control characters
        /\ufeff/g           // Byte order mark
      ];

      return suspiciousPatterns.some(pattern => pattern.test(input));
    }

    /**
     * Strict sanitization - removes all potentially dangerous content
     */
    strictSanitize(input, threats) {
      let sanitized = input;

      // Remove all HTML/XML tags
      sanitized = sanitized.replace(/<[^>]*>/g, '');

      // Encode HTML entities
      sanitized = this.encodeHTMLEntities(sanitized);

      // Remove JavaScript protocols
      sanitized = sanitized.replace(/javascript:/gi, '');

      // Remove data URLs
      sanitized = sanitized.replace(/data:[^;]*;base64,[a-zA-Z0-9+/=]*/gi, '[REMOVED_DATA_URL]');

      // Remove SQL injection patterns
      sanitized = sanitized.replace(/(\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b)/gi, '[REMOVED_SQL]');

      // Remove path traversal attempts
      sanitized = sanitized.replace(/\.\.[\/\\]/g, '');

      // Remove null bytes and control characters
      sanitized = sanitized.replace(/[\x00-\x1f\x7f-\x9f]/g, '');

      return sanitized;
    }

    /**
     * Moderate sanitization - escapes dangerous content
     */
    moderateSanitize(input, threats) {
      let sanitized = input;

      // Encode HTML entities in script tags
      sanitized = sanitized.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, (match) => {
        return this.encodeHTMLEntities(match);
      });

      // Escape event handlers
      sanitized = sanitized.replace(/(on\w+\s*=\s*["'][^"']*["'])/gi, (match) => {
        return this.encodeHTMLEntities(match);
      });

      // Escape JavaScript protocols
      sanitized = sanitized.replace(/javascript:/gi, 'javascript&#58;');

      return sanitized;
    }

    /**
     * Permissive sanitization - minimal escaping
     */
    permissiveSanitize(input, threats) {
      let sanitized = input;

      // Only escape the most critical XSS vectors
      sanitized = sanitized.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
      sanitized = sanitized.replace(/javascript:/gi, '');

      return sanitized;
    }

    /**
     * Encode HTML entities
     */
    encodeHTMLEntities(str) {
      return str.replace(/[&<>"'`=\/]/g, (s) => this.htmlEntities[s] || s);
    }

    /**
     * Sanitize output for safe display
     */
    sanitizeOutput(output, context = {}) {
      if (!this.options.enableOutputSanitization) {
        return { sanitized: output, safe: true };
      }

      try {
        let sanitized = output;

        // Ensure output is a string
        if (typeof sanitized !== 'string') {
          sanitized = String(sanitized);
        }

        // Check for injection attempts in translated content
        const threats = this.detectThreats(sanitized);

        if (threats.length > 0) {
          this.logSecurityEvent('output_threats_detected', {
            threats,
            context
          });

          // Apply output sanitization
          sanitized = this.strictSanitize(sanitized, threats);
        }

        return {
          sanitized,
          threats,
          safe: threats.length === 0
        };

      } catch (error) {
        this.logSecurityEvent('output_sanitization_error', {
          error: error.message,
          context
        });

        return {
          sanitized: '',
          safe: false,
          error: error.message
        };
      }
    }

    /**
     * Validate content against security policies
     */
    validateContent(content, type = 'text', context = {}) {
      if (!this.options.enableContentValidation) {
        return { valid: true, violations: [] };
      }

      const violations = [];

      try {
        // Type-specific validation
        switch (type) {
          case 'url':
            if (!this.validateURL(content)) {
              violations.push('invalid_url');
            }
            break;

          case 'html':
            if (!this.validateHTML(content)) {
              violations.push('invalid_html');
            }
            break;

          case 'json':
            if (!this.validateJSON(content)) {
              violations.push('invalid_json');
            }
            break;

          case 'text':
          default:
            // Basic text validation
            if (this.containsNullBytes(content)) {
              violations.push('null_bytes');
            }
            break;
        }

        // Check content length
        if (content.length > this.options.maxInputLength) {
          violations.push('excessive_length');
        }

        // Check nesting depth for structured data
        if (type === 'json' || type === 'html') {
          if (this.getMaxNestingDepth(content) > this.options.maxNestingDepth) {
            violations.push('excessive_nesting');
          }
        }

        if (violations.length > 0) {
          this.logSecurityEvent('content_validation_failed', {
            type,
            violations,
            context
          });
        }

        return {
          valid: violations.length === 0,
          violations
        };

      } catch (error) {
        this.logSecurityEvent('content_validation_error', {
          error: error.message,
          context
        });

        return {
          valid: false,
          violations: ['validation_error'],
          error: error.message
        };
      }
    }

    /**
     * Validate URL security
     */
    validateURL(url) {
      try {
        const urlObj = new URL(url);

        // Check protocol
        if (!this.options.allowedProtocols.includes(urlObj.protocol)) {
          return false;
        }

        // Check for suspicious patterns
        if (this.detectThreats(url).length > 0) {
          return false;
        }

        return true;
      } catch {
        return false;
      }
    }

    /**
     * Validate HTML content
     */
    validateHTML(html) {
      try {
        // Check for dangerous tags and attributes
        const dangerousTags = /<(script|object|embed|iframe|form|input|link|meta)[^>]*>/gi;
        if (dangerousTags.test(html)) {
          return false;
        }

        // Check for event handlers
        if (/\bon\w+\s*=/gi.test(html)) {
          return false;
        }

        return true;
      } catch {
        return false;
      }
    }

    /**
     * Validate JSON content
     */
    validateJSON(json) {
      try {
        JSON.parse(json);
        return true;
      } catch {
        return false;
      }
    }

    /**
     * Check for null bytes
     */
    containsNullBytes(content) {
      return content.includes('\0') || content.includes('%00');
    }

    /**
     * Calculate nesting depth
     */
    getMaxNestingDepth(content) {
      let maxDepth = 0;
      let currentDepth = 0;

      for (const char of content) {
        if (char === '{' || char === '[' || char === '<') {
          currentDepth++;
          maxDepth = Math.max(maxDepth, currentDepth);
        } else if (char === '}' || char === ']' || char === '>') {
          currentDepth--;
        }
      }

      return maxDepth;
    }

    /**
     * Calculate threat confidence score
     */
    calculateThreatConfidence(threats) {
      if (threats.length === 0) return 0;

      const threatWeights = {
        xss: 0.9,
        injection: 0.8,
        traversal: 0.7,
        protocol: 0.6,
        blocked_pattern: 0.5,
        suspicious_sequence: 0.3,
        excessive_length: 0.2
      };

      const totalWeight = threats.reduce((sum, threat) => {
        return sum + (threatWeights[threat] || 0.1);
      }, 0);

      return Math.min(totalWeight / threats.length, 1.0);
    }

    /**
     * Enforce Content Security Policy
     */
    enforceCSP() {
      if (!this.options.enableCSPEnforcement || typeof document === 'undefined') {
        return;
      }

      try {
        // Create CSP meta tag
        const cspString = Object.entries(this.options.cspDirectives)
          .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
          .join('; ');

        const meta = document.createElement('meta');
        meta.httpEquiv = 'Content-Security-Policy';
        meta.content = cspString;

        const head = document.head || document.getElementsByTagName('head')[0];
        if (head) {
          head.appendChild(meta);
        }

        if (this.options.debug) {
          console.log('[SecurityEnhancements] CSP enforced:', cspString);
        }

      } catch (error) {
        this.logSecurityEvent('csp_enforcement_error', {
          error: error.message
        });
      }
    }

    /**
     * Set up security event listeners
     */
    setupSecurityListeners() {
      if (typeof window === 'undefined') return;

      // Listen for CSP violations
      document.addEventListener('securitypolicyviolation', (event) => {
        this.logSecurityEvent('csp_violation', {
          violatedDirective: event.violatedDirective,
          blockedURI: event.blockedURI,
          documentURI: event.documentURI,
          effectiveDirective: event.effectiveDirective
        });
      });

      // Listen for security errors
      window.addEventListener('error', (event) => {
        if (event.error && event.error.name === 'SecurityError') {
          this.logSecurityEvent('security_error', {
            message: event.error.message,
            filename: event.filename,
            lineno: event.lineno
          });
        }
      });
    }

    /**
     * Rate limiting for security-sensitive operations
     */
    checkRateLimit(identifier, maxRequests = 100, windowMs = 60000) {
      if (!this.options.enableRateLimiting) {
        return { allowed: true, remaining: maxRequests };
      }

      const now = Date.now();
      const windowStart = now - windowMs;

      if (!this.rateLimiters.has(identifier)) {
        this.rateLimiters.set(identifier, []);
      }

      const requests = this.rateLimiters.get(identifier);

      // Remove old requests
      const validRequests = requests.filter(timestamp => timestamp > windowStart);

      if (validRequests.length >= maxRequests) {
        this.logSecurityEvent('rate_limit_exceeded', {
          identifier,
          requests: validRequests.length,
          maxRequests,
          windowMs
        });

        return {
          allowed: false,
          remaining: 0,
          resetTime: validRequests[0] + windowMs
        };
      }

      // Add current request
      validRequests.push(now);
      this.rateLimiters.set(identifier, validRequests);

      return {
        allowed: true,
        remaining: maxRequests - validRequests.length
      };
    }

    /**
     * Log security events
     */
    logSecurityEvent(type, data = {}) {
      if (!this.options.enableSecurityLogging) {
        return;
      }

      const event = {
        type,
        timestamp: Date.now(),
        data,
        severity: this.getEventSeverity(type)
      };

      this.securityEvents.push(event);

      // Keep only recent events
      if (this.securityEvents.length > 1000) {
        this.securityEvents = this.securityEvents.slice(-500);
      }

      if (this.options.debug || event.severity === 'high') {
        console.warn('[SecurityEnhancements] Security event:', event);
      }
    }

    /**
     * Get event severity level
     */
    getEventSeverity(type) {
      const highSeverity = [
        'csp_violation',
        'security_error',
        'threats_detected',
        'rate_limit_exceeded'
      ];

      const mediumSeverity = [
        'content_validation_failed',
        'output_threats_detected',
        'input_length_exceeded'
      ];

      if (highSeverity.includes(type)) return 'high';
      if (mediumSeverity.includes(type)) return 'medium';
      return 'low';
    }

    /**
     * Get security status and statistics
     */
    getSecurityStatus() {
      const recentEvents = this.securityEvents.filter(
        event => Date.now() - event.timestamp < 86400000 // 24 hours
      );

      const eventsByType = recentEvents.reduce((acc, event) => {
        acc[event.type] = (acc[event.type] || 0) + 1;
        return acc;
      }, {});

      const eventsBySeverity = recentEvents.reduce((acc, event) => {
        acc[event.severity] = (acc[event.severity] || 0) + 1;
        return acc;
      }, {});

      return {
        totalEvents: this.securityEvents.length,
        recentEvents: recentEvents.length,
        eventsByType,
        eventsBySeverity,
        rateLimiters: this.rateLimiters.size,
        cacheSize: this.sanitizationCache.size,
        configuration: {
          sanitizationLevel: this.options.sanitizationLevel,
          enabledFeatures: Object.keys(this.options).filter(
            key => key.startsWith('enable') && this.options[key]
          )
        }
      };
    }

    /**
     * Clean up security system
     */
    cleanup() {
      this.threats.clear();
      this.violations.clear();
      this.sanitizationCache.clear();
      this.securityEvents.length = 0;
      this.rateLimiters.clear();

      if (this.options.debug) {
        console.log('[SecurityEnhancements] Security system cleaned up');
      }
    }

    /**
     * Update security configuration
     */
    updateConfig(newOptions) {
      this.options = { ...this.options, ...newOptions };

      this.logSecurityEvent('config_updated', {
        updatedOptions: Object.keys(newOptions)
      });

      if (this.options.debug) {
        console.log('[SecurityEnhancements] Configuration updated');
      }
    }
  }

  // Export for different environments
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SecurityEnhancements;
  } else if (typeof define === 'function' && define.amd) {
    define([], () => SecurityEnhancements);
  } else {
    global.SecurityEnhancements = SecurityEnhancements;
  }

})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
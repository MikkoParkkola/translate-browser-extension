/**
 * Security utility functions for browser extension
 * Provides XSS prevention, input sanitization, and secure DOM manipulation
 */

/**
 * HTML escape mapping for XSS prevention
 */
const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;'
};

/**
 * Escapes HTML special characters to prevent XSS attacks
 * @param {string} str - String to escape
 * @returns {string} HTML-escaped string
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') {
    return '';
  }
  return str.replace(/[&<>"'/]/g, (char) => HTML_ESCAPE_MAP[char]);
}

/**
 * Safely sets text content without HTML interpretation
 * @param {HTMLElement} element - DOM element
 * @param {string} text - Text content to set
 */
export function setTextContent(element, text) {
  if (!element || typeof text !== 'string') {
    return;
  }
  element.textContent = text;
}

/**
 * Safely creates DOM elements with escaped content
 * @param {string} tagName - HTML tag name
 * @param {Object} options - Element options
 * @param {string} options.text - Text content (will be escaped)
 * @param {string} options.className - CSS class name
 * @param {Object} options.attributes - HTML attributes (will be escaped)
 * @returns {HTMLElement} Created DOM element
 */
export function createElement(tagName, options = {}) {
  const element = document.createElement(tagName);

  if (options.text) {
    element.textContent = options.text;
  }

  if (options.className) {
    element.className = options.className;
  }

  if (options.attributes) {
    Object.entries(options.attributes).forEach(([key, value]) => {
      element.setAttribute(key, escapeHtml(String(value)));
    });
  }

  return element;
}

/**
 * Validates API endpoint URLs to prevent SSRF attacks
 * @param {string} url - URL to validate
 * @returns {boolean} True if URL is safe
 */
export function validateApiUrl(url) {
  if (typeof url !== 'string' || !url) {
    return false;
  }

  try {
    const parsed = new URL(url);

    // Only allow HTTPS (except localhost for development)
    if (parsed.protocol !== 'https:' &&
        !(parsed.protocol === 'http:' && parsed.hostname === 'localhost')) {
      return false;
    }

    // Block private IP ranges and localhost in production
    const hostname = parsed.hostname;

    // Block obvious private ranges
    if (hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./)) {
      return false;
    }

    // Block localhost variants in production
    if (hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1') {
      // Allow only in development
      const isDevelopment =
        (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest &&
         chrome.runtime.getManifest().version_name &&
         chrome.runtime.getManifest().version_name.includes('dev'));

      if (!isDevelopment) {
        return false;
      }
    }

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Sanitizes configuration values to prevent injection attacks
 * @param {Object} config - Configuration object
 * @returns {Object} Sanitized configuration
 */
export function sanitizeConfig(config) {
  if (!config || typeof config !== 'object') {
    return {};
  }

  const sanitized = {};

  Object.entries(config).forEach(([key, value]) => {
    // Sanitize string values
    if (typeof value === 'string') {
      // Remove null bytes and control characters
      sanitized[key] = value.replace(/[\x00-\x1F\x7F]/g, '');
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      // Numbers and booleans are safe
      sanitized[key] = value;
    } else if (Array.isArray(value)) {
      // Recursively sanitize arrays
      sanitized[key] = value.map(item =>
        typeof item === 'string' ? item.replace(/[\x00-\x1F\x7F]/g, '') : item
      );
    } else if (value && typeof value === 'object') {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeConfig(value);
    }
    // Skip functions and other types
  });

  return sanitized;
}

/**
 * Validates and sanitizes translation text to prevent XSS
 * @param {string} text - Text to validate
 * @returns {string} Sanitized text
 */
export function sanitizeTranslationText(text) {
  if (typeof text !== 'string') {
    return '';
  }

  // Remove script tags and event handlers
  const sanitized = text
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/data:text\/html/gi, '');

  return sanitized;
}

/**
 * Content Security Policy validation for dynamic content
 * @param {string} content - Content to validate
 * @returns {boolean} True if content is CSP-safe
 */
export function validateCSPSafe(content) {
  if (typeof content !== 'string') {
    return false;
  }

  // Check for CSP violations
  const violations = [
    /javascript:/i,
    /data:.*script/i,
    /on\w+\s*=/i, // Event handlers
    /<script/i,
    /eval\s*\(/i,
    /Function\s*\(/i
  ];

  return !violations.some(pattern => pattern.test(content));
}

/**
 * Secure random ID generation
 * @param {number} length - Length of ID to generate
 * @returns {string} Cryptographically secure random ID
 */
export function generateSecureId(length = 16) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  // Fallback for environments without crypto
  return Math.random().toString(36).substring(2, length + 2).padEnd(length, '0');
}

/**
 * Validates Chrome extension permissions
 * @param {Array} requestedPermissions - Permissions being requested
 * @param {Array} allowedPermissions - Permissions that are allowed
 * @returns {boolean} True if permissions are valid
 */
export function validatePermissions(requestedPermissions, allowedPermissions) {
  if (!Array.isArray(requestedPermissions) || !Array.isArray(allowedPermissions)) {
    return false;
  }

  return requestedPermissions.every(permission =>
    allowedPermissions.includes(permission)
  );
}

/**
 * Rate limiting for API calls to prevent abuse
 */
export class SecurityRateLimiter {
  constructor(maxRequests = 100, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map();
  }

  /**
   * Check if request is allowed under rate limit
   * @param {string} identifier - Unique identifier for rate limiting
   * @returns {boolean} True if request is allowed
   */
  isAllowed(identifier) {
    const now = Date.now();
    const key = String(identifier);

    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }

    const userRequests = this.requests.get(key);

    // Remove old requests outside window
    const validRequests = userRequests.filter(
      timestamp => now - timestamp < this.windowMs
    );

    if (validRequests.length >= this.maxRequests) {
      return false;
    }

    // Add current request
    validRequests.push(now);
    this.requests.set(key, validRequests);

    return true;
  }

  /**
   * Clear rate limiting data for cleanup
   */
  clear() {
    this.requests.clear();
  }
}
/**
 * Content Security Policy utilities for browser extension security
 * Provides CSP validation and secure content handling
 */

import { validateCSPSafe, escapeHtml } from './securityUtils.js';
import { secureLogger } from './secureLogging.js';

/**
 * Content Security Policy configuration for the extension
 */
export const CSP_CONFIG = {
  // Default CSP directives for secure operation
  directives: {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'wasm-unsafe-eval'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'chrome-extension:', 'moz-extension:'],
    'connect-src': ["'self'", 'https://dashscope.aliyuncs.com', 'https://api.openai.com'],
    'font-src': ["'self'"],
    'object-src': ["'none'"],
    'media-src': ["'none'"],
    'frame-src': ["'none'"],
    'worker-src': ["'self'"],
    'child-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'none'"]
  },

  // Reporting configuration
  reportUri: null, // Can be set to collect CSP violations
  reportOnly: false // Set to true for testing without enforcement
};

/**
 * Generate CSP header string from configuration
 */
export function generateCSPHeader(config = CSP_CONFIG) {
  const directives = [];

  Object.entries(config.directives).forEach(([directive, sources]) => {
    if (Array.isArray(sources) && sources.length > 0) {
      directives.push(`${directive} ${sources.join(' ')}`);
    }
  });

  if (config.reportUri) {
    directives.push(`report-uri ${config.reportUri}`);
  }

  return directives.join('; ');
}

/**
 * Validate content against CSP directives
 */
export function validateContent(content, context = 'default') {
  if (typeof content !== 'string') {
    return { valid: true, violations: [] };
  }

  const violations = [];

  // Check for inline scripts
  if (/<script[^>]*>[\s\S]*?<\/script>/gi.test(content)) {
    violations.push({
      directive: 'script-src',
      violation: 'inline-script',
      context: context,
      severity: 'high'
    });
  }

  // Check for event handlers
  if (/on\w+\s*=/gi.test(content)) {
    violations.push({
      directive: 'script-src',
      violation: 'inline-handler',
      context: context,
      severity: 'high'
    });
  }

  // Check for javascript: URIs
  if (/javascript:/gi.test(content)) {
    violations.push({
      directive: 'script-src',
      violation: 'javascript-uri',
      context: context,
      severity: 'high'
    });
  }

  // Check for inline styles (if not allowed)
  if (/<style[^>]*>[\s\S]*?<\/style>/gi.test(content)) {
    violations.push({
      directive: 'style-src',
      violation: 'inline-style',
      context: context,
      severity: 'medium'
    });
  }

  // Check for data: URIs in images (allowed by default but worth noting)
  const dataUriMatches = content.match(/src\s*=\s*["']data:/gi);
  if (dataUriMatches && dataUriMatches.length > 0) {
    violations.push({
      directive: 'img-src',
      violation: 'data-uri',
      context: context,
      severity: 'low',
      count: dataUriMatches.length
    });
  }

  return {
    valid: violations.length === 0,
    violations: violations
  };
}

/**
 * Sanitize content to comply with CSP
 */
export function sanitizeForCSP(content, options = {}) {
  if (typeof content !== 'string') {
    return content;
  }

  let sanitized = content;

  // Remove inline scripts
  sanitized = sanitized.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Remove event handlers
  sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');

  // Remove javascript: URIs
  sanitized = sanitized.replace(/javascript:[^"'\s>]*/gi, '');

  // Remove inline styles if not allowed
  if (options.removeInlineStyles) {
    sanitized = sanitized.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    sanitized = sanitized.replace(/style\s*=\s*["'][^"']*["']/gi, '');
  }

  // Escape HTML if requested
  if (options.escapeHtml) {
    sanitized = escapeHtml(sanitized);
  }

  return sanitized;
}

/**
 * CSP violation reporter
 */
export class CSPViolationReporter {
  constructor() {
    this.violations = [];
    this.maxViolations = 100;
  }

  /**
   * Report a CSP violation
   */
  reportViolation(violation) {
    const timestamp = Date.now();
    const violationRecord = {
      ...violation,
      timestamp: timestamp,
      userAgent: navigator.userAgent,
      url: window.location?.href || 'unknown'
    };

    this.violations.push(violationRecord);

    // Maintain maximum violations
    if (this.violations.length > this.maxViolations) {
      this.violations.shift();
    }

    // Log violation securely
    secureLogger.warn('CSP', 'Content Security Policy violation detected', {
      directive: violation.directive,
      violation: violation.violation,
      severity: violation.severity,
      context: violation.context
    });

    // Trigger violation callback if set
    if (this.onViolation) {
      this.onViolation(violationRecord);
    }
  }

  /**
   * Get violation statistics
   */
  getViolationStats() {
    const stats = {
      total: this.violations.length,
      byDirective: {},
      bySeverity: { high: 0, medium: 0, low: 0 },
      recent: this.violations.slice(-10)
    };

    this.violations.forEach(v => {
      stats.byDirective[v.directive] = (stats.byDirective[v.directive] || 0) + 1;
      stats.bySeverity[v.severity] = (stats.bySeverity[v.severity] || 0) + 1;
    });

    return stats;
  }

  /**
   * Clear violation history
   */
  clearViolations() {
    this.violations = [];
  }
}

/**
 * Global CSP violation reporter
 */
export const cspViolationReporter = new CSPViolationReporter();

/**
 * Set up CSP violation reporting
 */
export function setupCSPReporting() {
  // Listen for CSP violations if supported
  if (typeof document !== 'undefined') {
    document.addEventListener('securitypolicyviolation', (event) => {
      cspViolationReporter.reportViolation({
        directive: event.violatedDirective,
        violation: 'browser-csp-violation',
        severity: 'high',
        context: 'browser-event',
        blockedURI: event.blockedURI,
        lineNumber: event.lineNumber,
        columnNumber: event.columnNumber,
        sourceFile: event.sourceFile
      });
    });
  }
}

/**
 * Utility to check if a URL is allowed by CSP connect-src
 */
export function isUrlAllowedByCSP(url) {
  try {
    const urlObj = new URL(url);
    const allowedHosts = [
      'dashscope.aliyuncs.com',
      'api.openai.com',
      'api.deepl.com',
      'translate.googleapis.com'
    ];

    // Check if it's HTTPS (required for external APIs)
    if (urlObj.protocol !== 'https:' && !urlObj.hostname.includes('localhost')) {
      return false;
    }

    // Check against allowed hosts
    return allowedHosts.some(host => urlObj.hostname === host || urlObj.hostname.endsWith('.' + host));
  } catch (error) {
    secureLogger.warn('CSP', 'Invalid URL for CSP validation', { url: url.substring(0, 100) });
    return false;
  }
}

/**
 * Secure script loader that respects CSP
 */
export function loadSecureScript(src, options = {}) {
  return new Promise((resolve, reject) => {
    // Validate the script source
    if (!isUrlAllowedByCSP(src) && !src.startsWith('chrome-extension:') && !src.startsWith('moz-extension:')) {
      reject(new Error(`Script source not allowed by CSP: ${src.substring(0, 50)}...`));
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = options.async !== false;
    script.defer = options.defer || false;

    script.onload = () => {
      secureLogger.debug('CSP', 'Secure script loaded successfully');
      resolve();
    };

    script.onerror = (error) => {
      secureLogger.error('CSP', 'Failed to load secure script', error);
      reject(new Error(`Failed to load script: ${src}`));
    };

    document.head.appendChild(script);
  });
}

/**
 * Initialize CSP utilities
 */
export function initializeCSP() {
  setupCSPReporting();
  secureLogger.info('CSP', 'Content Security Policy utilities initialized');
}
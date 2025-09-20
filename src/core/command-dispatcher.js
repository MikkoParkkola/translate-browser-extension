/**
 * Command Dispatcher - Central message routing system using Command Pattern
 * 
 * This module replaces the monolithic messageHandlers object in background.js
 * with a pluggable command system for better maintainability.
 */

class CommandDispatcher {
  constructor(logger, errorHandler) {
    this.commands = new Map();
    this.logger = logger;
    this.errorHandler = errorHandler;
    this.messageRateLimit = null;
    this.securityAudit = null;
    this.securityValidators = [];
  }

  /**
   * Register a command handler
   * @param {string} action - The message action to handle
   * @param {Command} command - Command instance implementing execute method
   */
  registerCommand(action, command) {
    this.commands.set(action, command);
    this.logger?.debug(`Registered command: ${action}`);
  }

  /**
   * Register multiple commands at once
   * @param {Object} commands - Map of action -> command pairs
   */
  registerCommands(commands) {
    Object.entries(commands).forEach(([action, command]) => {
      this.registerCommand(action, command);
    });
  }

  /**
   * Set security dependencies
   * @param {Function} messageRateLimit - Rate limiting function
   * @param {Object} securityAudit - Security audit logger
   * @param {Array} validators - Array of security validator functions
   */
  setSecurityDependencies(messageRateLimit, securityAudit, validators = []) {
    this.messageRateLimit = messageRateLimit;
    this.securityAudit = securityAudit;
    this.securityValidators = validators;
  }

  /**
   * Main message handler - replaces the chrome.runtime.onMessage listener logic
   * @param {Object} raw - Raw message from chrome runtime
   * @param {Object} sender - Message sender info
   * @param {Function} sendResponse - Response callback
   * @returns {boolean} - Whether the response is async
   */
  async handleMessage(raw, sender, sendResponse) {
    try {
      // Rate limiting check
      if (this.messageRateLimit) {
        const senderId = sender?.tab?.url || sender?.id || 'unknown';
        if (!this.messageRateLimit(senderId)) {
          this.securityAudit?.logEvent('rate_limit_exceeded', {
            sender: senderId,
            action: raw?.action,
          });
          sendResponse({ error: 'Rate limit exceeded' });
          return true;
        }
      }

      // Security validation
      const securityResult = this.validateSecurity(sender, raw);
      if (!securityResult.ok) {
        sendResponse({ error: securityResult.error });
        return true;
      }

      const msg = securityResult.msg;

      // Find and execute command
      const command = this.commands.get(msg.action);
      if (!command) {
        this.logger?.warn(`Unknown message action: ${msg.action}`);
        sendResponse({ error: `Unknown action: ${msg.action}` });
        return true;
      }

      const sanitize = (obj) => {
        try {
          return JSON.parse(JSON.stringify(obj, (k, v) => {
            if (typeof v === 'function') return undefined;
            if (v && typeof v === 'object') {
              if (v instanceof Map) return Object.fromEntries(v);
              if (v instanceof Set) return Array.from(v);
            }
            if (typeof v === 'bigint') return Number(v);
            return v;
          }));
        } catch (_) { return { error: 'Internal error' }; }
      };

      // Execute command with error handling
      const result = await this.executeCommand(command, msg, sender);
      
      // Handle async responses
      if (result instanceof Promise) {
        result
          .then(response => sendResponse(sanitize(response)))
          .catch(error => {
            this.logger?.error(`Command error for action ${msg.action}:`, error);
            sendResponse({ error: error.message || 'Command execution failed' });
          });
      } else {
        sendResponse(sanitize(result));
      }

      return true;
    } catch (error) {
      this.logger?.error('Command dispatcher error:', error);
      sendResponse({ error: 'Internal error' });
      return true;
    }
  }

  /**
   * Execute a command with proper error handling
   * @param {Command} command - Command to execute
   * @param {Object} msg - Validated message
   * @param {Object} sender - Message sender
   * @returns {Promise|Object} - Command result
   */
  async executeCommand(command, msg, sender) {
    return this.errorHandler?.handleAsync(
      () => command.execute(msg, sender),
      { operation: 'executeCommand', module: 'commandDispatcher', action: msg.action },
      { error: 'Command execution failed' }
    ) || await command.execute(msg, sender);
  }

  /**
   * Validate message security using registered validators
   * @param {Object} sender - Message sender
   * @param {Object} raw - Raw message
   * @returns {Object} - Validation result
   */
  validateSecurity(sender, raw) {
    return this.errorHandler?.safe(() => {
      // Apply all registered security validators
      for (const validator of this.securityValidators) {
        const result = validator(sender, raw);
        if (!result.ok) {
          return result;
        }
      }
      return { ok: true, msg: raw };
    }, { operation: 'securityValidation', module: 'commandDispatcher' }, { ok: false, error: 'Security validation failed' })() 
    || { ok: true, msg: raw };
  }

  /**
   * Get list of registered commands for debugging
   * @returns {Array} - Array of registered command names
   */
  getRegisteredCommands() {
    return Array.from(this.commands.keys());
  }

  /**
   * Clear all registered commands
   */
  clear() {
    this.commands.clear();
  }
}

/**
 * Base Command class - all commands should extend this
 */
class Command {
  constructor(name, dependencies = {}) {
    this.name = name;
    this.dependencies = dependencies;
  }

  /**
   * Execute the command
   * @param {Object} msg - Message payload
   * @param {Object} sender - Message sender
   * @returns {Promise|Object} - Command result
   */
  async execute(msg, sender) {
    throw new Error('Command execute method must be implemented');
  }

  /**
   * Validate command dependencies are available
   * @returns {boolean} - Whether all dependencies are available
   */
  validateDependencies() {
    return Object.values(this.dependencies).every(dep => dep != null);
  }
}

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CommandDispatcher, Command };
} else {
  self.qwenCommandDispatcher = { CommandDispatcher, Command };
}

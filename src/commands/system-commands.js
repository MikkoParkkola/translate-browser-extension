/**
 * System Commands - Basic system operations and health checks
 * 
 * Handles ping, debugging, usage logs, and other system utilities.
 */

if (typeof self.qwenCommandDispatcher === 'undefined') {
  throw new Error('Command dispatcher not loaded');
}

const { Command } = self.qwenCommandDispatcher;

class PingCommand extends Command {
  constructor(logger) {
    super('ping', { logger });
    this.logger = logger;
  }

  execute(msg) {
    if (msg.debug) {
      this.logger?.debug('ping received');
    }
    return { ok: true };
  }
}

class DebugCommand extends Command {
  constructor() {
    super('debug');
  }

  execute() {
    const cache = {
      size: self.qwenGetCacheSize ? self.qwenGetCacheSize() : 0,
      max: (self.qwenConfig && self.qwenConfig.memCacheMax) || 0,
    };
    const tm = (self.qwenTM && self.qwenTM.stats) ? self.qwenTM.stats() : {};
    return { cache, tm };
  }
}

class GetUsageLogCommand extends Command {
  constructor(usageLog) {
    super('get-usage-log', { usageLog });
    this.usageLog = usageLog;
  }

  execute() {
    return { log: this.usageLog || [] };
  }
}

class GetSecurityAuditCommand extends Command {
  constructor(securityAudit) {
    super('get-security-audit', { securityAudit });
    this.securityAudit = securityAudit;
  }

  execute() {
    if (!this.securityAudit) {
      return { auditLog: [], cspCompliant: false, timestamp: Date.now() };
    }

    return {
      auditLog: this.securityAudit.getAuditLog(),
      cspCompliant: this.securityAudit.validateCSPCompliance(),
      timestamp: Date.now(),
    };
  }
}

// Export all system commands
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PingCommand,
    DebugCommand,
    GetUsageLogCommand,
    GetSecurityAuditCommand,
  };
} else {
  self.qwenSystemCommands = {
    PingCommand,
    DebugCommand,
    GetUsageLogCommand,
    GetSecurityAuditCommand,
  };
}
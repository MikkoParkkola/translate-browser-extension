/**
 * Simple logging utility with module prefixing
 */

export function createLogger(module: string) {
  return {
    debug: (msg: string, ...args: unknown[]) => console.log(`[${module}]`, msg, ...args),
    info: (msg: string, ...args: unknown[]) => console.log(`[${module}]`, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(`[${module}]`, msg, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[${module}]`, msg, ...args),
  };
}

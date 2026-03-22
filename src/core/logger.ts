/**
 * Logging utility with module prefixing and level filtering.
 *
 * Log level is controlled by the VITE_LOG_LEVEL environment variable:
 *   debug | info | warn | error
 *
 * Defaults: 'debug' in development, 'info' in production.
 * Set VITE_LOG_LEVEL=debug to see all logs in production builds.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const minLevel: number = (() => {
  // import.meta.env is replaced by Vite at build time
  const envLevel = import.meta.env?.VITE_LOG_LEVEL as LogLevel | undefined;
  if (envLevel && envLevel in LEVELS) return LEVELS[envLevel];
  return LEVELS[import.meta.env?.MODE === 'production' ? 'info' : 'debug'];
})();

export function createLogger(module: string) {
  const prefix = `[${module}]`;
  return {
    debug: (msg: string, ...args: unknown[]) => {
      if (minLevel <= LEVELS.debug) console.log(prefix, msg, ...args);
    },
    info: (msg: string, ...args: unknown[]) => {
      if (minLevel <= LEVELS.info) console.log(prefix, msg, ...args);
    },
    warn: (msg: string, ...args: unknown[]) => {
      if (minLevel <= LEVELS.warn) console.warn(prefix, msg, ...args);
    },
    error: (msg: string, ...args: unknown[]) => {
      if (minLevel <= LEVELS.error) console.error(prefix, msg, ...args);
    },
  };
}

/** Named export of the logger singleton for legacy `lib/logger.ts` consumers. */
export const logger = createLogger('App');

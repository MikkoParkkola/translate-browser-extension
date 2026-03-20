// Logger stub for LocalModelManager

export interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export const logger: Logger = {
  info(..._args: unknown[]): void {},
  warn(..._args: unknown[]): void {},
  error(..._args: unknown[]): void {},
  debug(..._args: unknown[]): void {},
};

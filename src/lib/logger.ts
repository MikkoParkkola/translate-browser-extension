import { createLogger } from '../core/logger';

export interface Logger {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
  debug: (msg: string, ...args: unknown[]) => void;
}

export const logger: Logger = createLogger('LocalModel');

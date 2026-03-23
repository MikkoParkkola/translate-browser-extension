import type { Setter } from 'solid-js';

export interface ErrorLogger {
  error: (message: string, ...args: unknown[]) => void;
}

export function reportUiError(
  setError: Setter<string | null>,
  logger: ErrorLogger,
  userMessage: string,
  logMessage: string,
  error: unknown
): void {
  setError(userMessage);
  logger.error(logMessage, error);
}

export function showTemporaryMessage(
  setMessage: Setter<string | null>,
  message: string,
  durationMs = 3000,
  onClear?: () => void
): void {
  setMessage(message);
  setTimeout(() => {
    setMessage(null);
    onClear?.();
  }, durationMs);
}

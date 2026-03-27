import { extractErrorMessage } from '../../core/errors';
import type { MessageResponse, MessageResponseWithFallback } from '../../types';

export function createErrorLogger(
  logError: (message: string, error: unknown) => void,
  message: string
): (error: unknown) => void {
  return (error: unknown) => {
    logError(message, error);
  };
}

export async function withMessageResponse<T extends Record<string, unknown>>(
  operation: () => Promise<T>,
  onError?: (error: unknown) => void
): Promise<MessageResponse<T>> {
  try {
    return {
      success: true,
      ...(await operation()),
    };
  } catch (error) {
    onError?.(error);
    return {
      success: false,
      error: extractErrorMessage(error),
    };
  }
}

export async function withMessageResponseFixedError<T extends Record<string, unknown>>(
  operation: () => Promise<T>,
  errorMessage: string,
  onError?: (error: unknown) => void
): Promise<MessageResponse<T>> {
  try {
    return {
      success: true,
      ...(await operation()),
    };
  } catch (error) {
    onError?.(error);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function withMessageResponseFallback<T extends Record<string, unknown>>(
  operation: () => Promise<T>,
  fallback: T,
  onError?: (error: unknown) => void
): Promise<MessageResponseWithFallback<T>> {
  try {
    return {
      success: true,
      ...(await operation()),
    };
  } catch (error) {
    onError?.(error);
    return {
      success: false,
      error: extractErrorMessage(error),
      ...fallback,
    };
  }
}

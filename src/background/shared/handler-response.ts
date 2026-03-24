import { extractErrorMessage } from '../../core/errors';
import type { MessageResponse } from '../../types';

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

export async function withMessageResponseFallback<T extends Record<string, unknown>>(
  operation: () => Promise<T>,
  fallback: T,
  onError?: (error: unknown) => void
): Promise<({ success: true } & T) | ({ success: false; error: string } & T)> {
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

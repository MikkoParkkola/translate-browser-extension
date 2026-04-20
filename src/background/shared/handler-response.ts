import { extractErrorMessage } from '../../core/errors';
import type { MessageResponse, MessageResponseWithFallback } from '../../types';

type ReservedMessageResponseField = 'error' | 'success';
type WithoutReservedMessageResponseFields<T extends Record<string, unknown>> = Omit<
  T,
  ReservedMessageResponseField
>;

function stripReservedMessageResponseFields<T extends Record<string, unknown>>(
  payload: T
): WithoutReservedMessageResponseFields<T> {
  const { error: _error, success: _success, ...rest } = payload;
  return rest;
}

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
): Promise<MessageResponse<WithoutReservedMessageResponseFields<T>>> {
  try {
    return {
      success: true,
      ...stripReservedMessageResponseFields(await operation()),
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
): Promise<MessageResponse<WithoutReservedMessageResponseFields<T>>> {
  try {
    return {
      success: true,
      ...stripReservedMessageResponseFields(await operation()),
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
): Promise<MessageResponseWithFallback<WithoutReservedMessageResponseFields<T>>> {
  try {
    return {
      success: true,
      ...stripReservedMessageResponseFields(await operation()),
    };
  } catch (error) {
    onError?.(error);
    return {
      success: false,
      error: extractErrorMessage(error),
      ...stripReservedMessageResponseFields(fallback),
    };
  }
}

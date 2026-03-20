// StandardErrorHandler stub for LocalModelManager

export interface ErrorContext {
  source?: string;
  operation?: string;
  [key: string]: unknown;
}

export class HandledError extends Error {
  context: ErrorContext;

  constructor(message: string, context: ErrorContext) {
    super(message);
    this.name = 'HandledError';
    this.context = context;
  }
}

export interface StandardErrorHandler {
  handleError: (error: Error, context?: ErrorContext) => HandledError;
}

export const standardErrorHandler: StandardErrorHandler = {
  handleError(error: Error, context: ErrorContext = {}): HandledError {
    return new HandledError(error.message || 'handled error', context);
  },
};

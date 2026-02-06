/**
 * Message Router for Background Service Worker
 * Handles routing of messages between different components
 */

import { logger } from '../lib/logger.js';
import { trackError } from '../lib/performanceTracker.js';
import { createErrorHandler, throwStandardError } from '../lib/standardErrorHandler.js';

class MessageRouter {
  constructor() {
    this.handlers = new Map();
    this.middleware = [];
    this.isInitialized = false;
    this.errorHandler = createErrorHandler('MessageRouter');
  }

  // Register message handlers
  registerHandler(messageType, handler) {
    if (typeof handler !== 'function') {
      throwStandardError('CONFIG_INVALID', 'Handler must be a function', null, { messageType, handlerType: typeof handler });
    }

    this.handlers.set(messageType, handler);
    logger.debug('MessageRouter', `Registered handler for: ${messageType}`);
  }

  // Register middleware (runs before handlers)
  use(middleware) {
    if (typeof middleware !== 'function') {
      throwStandardError('CONFIG_INVALID', 'Middleware must be a function', null, { middlewareType: typeof middleware });
    }

    this.middleware.push(middleware);
    logger.debug('MessageRouter', 'Added middleware');
  }

  // Route message to appropriate handler
  async route(request, sender, sendResponse) {
    try {
      const messageType = request?.type;
      if (!messageType) {
        logger.warn('MessageRouter', 'Message without type received');
        sendResponse({ error: 'Invalid message format' });
        return;
      }

      // Run middleware
      for (const middleware of this.middleware) {
        try {
          const result = await middleware(request, sender);
          if (result === false) {
            // Middleware blocked the request
            logger.debug('MessageRouter', `Request blocked by middleware: ${messageType}`);
            return;
          }
        } catch (error) {
          const handledException = await this.errorHandler.handleError(error, {
            operation: 'middleware',
            messageType,
            middleware: middleware.name
          });

          trackError('MessageRouter', handledException, { messageType, middleware: middleware.name });
          // Continue processing despite middleware error
        }
      }

      // Find and execute handler
      const handler = this.handlers.get(messageType);
      if (!handler) {
        logger.warn('MessageRouter', `No handler found for: ${messageType}`);
        sendResponse({ error: `Unknown message type: ${messageType}` });
        return;
      }

      logger.debug('MessageRouter', `Routing message: ${messageType}`);

      // Execute handler with error handling
      try {
        const result = await handler(request, sender);
        sendResponse({ success: true, data: result });
      } catch (error) {
        const handledException = await this.errorHandler.handleError(error, {
          operation: 'routeHandler',
          messageType,
          sender: sender?.tab?.id
        });

        trackError('MessageRouter', handledException, { messageType, sender: sender?.tab?.id });
        sendResponse({
          error: handledException.getUserMessage(),
          errorCode: handledException.errorCode,
          details: handledException.name
        });
      }

    } catch (error) {
      const handledException = await this.errorHandler.handleError(error, {
        operation: 'routeMessage',
        messageType: request?.type
      });

      trackError('MessageRouter', handledException, { request: request?.type });
      sendResponse({
        error: handledException.getUserMessage(),
        errorCode: handledException.errorCode
      });
    }
  }

  // Get handler info for debugging
  getHandlerInfo() {
    return {
      registeredHandlers: Array.from(this.handlers.keys()),
      middlewareCount: this.middleware.length
    };
  }

  // Remove handler
  unregisterHandler(messageType) {
    const removed = this.handlers.delete(messageType);
    if (removed) {
      logger.debug('MessageRouter', `Unregistered handler for: ${messageType}`);
    }
    return removed;
  }

  // Clear all handlers
  clearHandlers() {
    this.handlers.clear();
    this.middleware = [];
    logger.info('MessageRouter', 'All handlers and middleware cleared');
  }
}

// Middleware factories
const createLoggingMiddleware = () => {
  return async (request, sender) => {
    logger.debug('MessageRouter',
      `Incoming: ${request.type} from ${sender?.tab?.id || 'popup'}`);
    return true;
  };
};

const createRateLimitMiddleware = (requestsPerMinute = 100) => {
  const requestCounts = new Map();

  return async (request, sender) => {
    const senderId = sender?.tab?.id || 'popup';
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window

    if (!requestCounts.has(senderId)) {
      requestCounts.set(senderId, []);
    }

    const senderRequests = requestCounts.get(senderId);

    // Clean old requests
    const recent = senderRequests.filter(time => time > windowStart);
    requestCounts.set(senderId, recent);

    // Check rate limit
    if (recent.length >= requestsPerMinute) {
      logger.warn('MessageRouter',
        `Rate limit exceeded for sender ${senderId}: ${recent.length} requests`);
      return false;
    }

    // Record this request
    recent.push(now);
    return true;
  };
};

const createAuthMiddleware = () => {
  return async (request, sender) => {
    // Verify sender is from a valid extension context
    if (!sender?.id || sender.id !== chrome.runtime.id) {
      logger.warn('MessageRouter', 'Unauthorized message sender');
      return false;
    }
    return true;
  };
};

export {
  MessageRouter,
  createLoggingMiddleware,
  createRateLimitMiddleware,
  createAuthMiddleware
};
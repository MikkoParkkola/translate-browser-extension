/**
 * TypeScript definitions for MessageRouter module
 */

export type MessageHandler = (request: any, sender?: chrome.runtime.MessageSender) => Promise<any>;
export type Middleware = (request: any, sender?: chrome.runtime.MessageSender) => Promise<boolean>;

export interface HandlerInfo {
  registeredHandlers: string[];
  middlewareCount: number;
}

export declare class MessageRouter {
  constructor();

  registerHandler(messageType: string, handler: MessageHandler): void;
  unregisterHandler(messageType: string): boolean;
  clearHandlers(): void;

  use(middleware: Middleware): void;

  route(
    request: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ): Promise<void>;

  getHandlerInfo(): HandlerInfo;
}

export declare function createLoggingMiddleware(): Middleware;
export declare function createRateLimitMiddleware(requestsPerMinute?: number): Middleware;
export declare function createAuthMiddleware(): Middleware;
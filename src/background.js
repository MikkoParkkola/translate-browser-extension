/**
 * Background Script Entry Point
 * Modular architecture using separated concerns
 */

import { BackgroundService } from './background/backgroundService.js';
import { Logger } from './lib/logger.js';

// Initialize global background service instance
let backgroundService = null;
const logger = new Logger({ component: 'Background' });

// Chrome extension event handlers
chrome.runtime.onInstalled.addListener(async (details) => {
  logger.info('Extension installed/updated:', details.reason);

  try {
    // Initialize background service
    backgroundService = new BackgroundService();
    await backgroundService.initialize();

    logger.info('Background service initialized successfully');

  } catch (error) {
    logger.error('Failed to initialize background service:', error);
    // Fallback to basic functionality if initialization fails
    setupFallbackHandlers();
  }
});

// Chrome extension startup handler
chrome.runtime.onStartup.addListener(async () => {
  logger.info('Extension starting up');

  if (!backgroundService) {
    try {
      backgroundService = new BackgroundService();
      await backgroundService.initialize();
    } catch (error) {
      logger.error('Failed to initialize background service on startup:', error);
      setupFallbackHandlers();
    }
  }
});

// Service worker suspension handler
chrome.runtime.onSuspend?.addListener(() => {
  logger.info('Service worker suspending');

  if (backgroundService) {
    backgroundService.handleSuspend();
  }
});

// Fallback handlers for when modular system fails
function setupFallbackHandlers() {
  logger.warn('Setting up fallback message handlers');

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Basic ping handler
    if (request.type === 'ping') {
      sendResponse({ pong: Date.now(), version: 'fallback', status: 'degraded' });
      return true;
    }

    // Basic status handler
    if (request.type === 'getServiceStatus') {
      sendResponse({
        version: 'fallback',
        initialized: false,
        services: { overall: 'error' },
        fallbackMode: true
      });
      return true;
    }

    // Error response for other requests
    sendResponse({
      error: 'Service unavailable - background service failed to initialize',
      fallbackMode: true
    });
    return true;
  });
}

// Health check endpoint for monitoring
async function getHealthStatus() {
  if (!backgroundService) {
    return {
      healthy: false,
      status: 'Service not initialized',
      fallbackMode: true,
      lastCheck: Date.now()
    };
  }

  return backgroundService.getHealthCheck();
}

// Export for potential external access
if (typeof globalThis !== 'undefined') {
  globalThis.backgroundService = backgroundService;
  globalThis.getHealthStatus = getHealthStatus;
}
/**
 * Background Service Worker
 * Handles translation requests and provider management
 */

import { translationRouter } from '../core/translation-router';
import { throttle } from '../core/throttle';
import type { ExtensionMessage, TranslateResponse, Strategy } from '../types';

// Initialize router on startup
translationRouter.initialize().catch(console.error);

// Message handler
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: TranslateResponse | unknown) => void
  ) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          success: false,
          error: error.message,
        });
      });

    // Return true to indicate async response
    return true;
  }
);

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'translate':
      return handleTranslate(message);
    case 'getUsage':
      return handleGetUsage();
    case 'getProviders':
      return handleGetProviders();
    default:
      throw new Error(`Unknown message type: ${(message as { type: string }).type}`);
  }
}

async function handleTranslate(message: {
  text: string | string[];
  sourceLang: string;
  targetLang: string;
  options?: { strategy?: Strategy };
}): Promise<TranslateResponse> {
  const startTime = Date.now();

  try {
    // Set strategy if provided
    if (message.options?.strategy) {
      translationRouter.setStrategy(message.options.strategy);
    }

    // Use throttle for rate limiting
    const result = await throttle.runWithRetry(
      async () => {
        return await translationRouter.translate(
          message.text,
          message.sourceLang,
          message.targetLang,
          message.options
        );
      },
      typeof message.text === 'string' ? message.text : message.text.join(' '),
      3 // max retries
    );

    return {
      success: true,
      result,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    console.error('[Background] Translation error:', error);
    return {
      success: false,
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}

function handleGetUsage(): unknown {
  return {
    throttle: throttle.getUsage(),
    providers: translationRouter.getStats(),
  };
}

function handleGetProviders(): unknown {
  return {
    providers: translationRouter.listProviders(),
    strategy: translationRouter.getStrategy(),
  };
}

// Extension icon click handler
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    // Open popup is default behavior, but we can add custom logic here
    console.log('[Background] Extension icon clicked for tab:', tab.id);
  }
});

// Installation handler
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Background] Extension installed');
    // Set default preferences
    chrome.storage.local.set({
      sourceLang: 'auto',
      targetLang: 'fi',
      strategy: 'smart',
    });
  } else if (details.reason === 'update') {
    console.log('[Background] Extension updated from', details.previousVersion);
  }
});

console.log('[Background] Service worker initialized');

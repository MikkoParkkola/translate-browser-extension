/**
 * Background Service Worker
 * Uses offscreen document for ML inference (service workers can't access DOM)
 */

import type { ExtensionMessage, TranslateResponse, Strategy } from '../types';

// Offscreen document management
let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL('src/offscreen/offscreen.html');

  // Check if already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) {
    return;
  }

  // Avoid race condition
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Run Transformers.js ML inference in document context',
  });

  await creatingOffscreen;
  creatingOffscreen = null;
  console.log('[Background] Offscreen document created');
}

// Send message to offscreen document
async function sendToOffscreen<T>(message: Record<string, unknown>): Promise<T> {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ ...message, target: 'offscreen' });
}

// Strategy state (simple, no need for complex router in service worker)
let currentStrategy: Strategy = 'smart';

// Rate limiting state
interface RateLimitState {
  requests: number;
  tokens: number;
  windowStart: number;
}

const rateLimit: RateLimitState = {
  requests: 0,
  tokens: 0,
  windowStart: Date.now(),
};

const RATE_LIMIT = {
  requestsPerMinute: 60,
  tokensPerMinute: 100000,
  windowMs: 60000,
};

function checkRateLimit(tokenEstimate: number): boolean {
  const now = Date.now();
  if (now - rateLimit.windowStart > RATE_LIMIT.windowMs) {
    rateLimit.requests = 0;
    rateLimit.tokens = 0;
    rateLimit.windowStart = now;
  }

  if (rateLimit.requests >= RATE_LIMIT.requestsPerMinute) return false;
  if (rateLimit.tokens + tokenEstimate > RATE_LIMIT.tokensPerMinute) return false;

  return true;
}

function recordUsage(tokens: number): void {
  rateLimit.requests++;
  rateLimit.tokens += tokens;
}

function estimateTokens(text: string | string[]): number {
  const str = Array.isArray(text) ? text.join(' ') : text;
  return Math.max(1, Math.ceil(str.length / 4));
}

// Message handler
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: TranslateResponse | unknown) => void
  ) => {
    // Ignore messages from offscreen document
    if (message.target === 'offscreen') return false;

    handleMessage(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          success: false,
          error: error.message,
        });
      });

    return true; // Async response
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
    if (message.options?.strategy) {
      currentStrategy = message.options.strategy;
    }

    const tokenEstimate = estimateTokens(message.text);

    if (!checkRateLimit(tokenEstimate)) {
      return {
        success: false,
        error: 'Rate limit exceeded. Please wait a moment.',
        duration: Date.now() - startTime,
      };
    }

    const response = await sendToOffscreen<{ success: boolean; result?: string | string[]; error?: string }>({
      type: 'translate',
      text: message.text,
      sourceLang: message.sourceLang,
      targetLang: message.targetLang,
    });

    if (!response.success) {
      throw new Error(response.error || 'Translation failed');
    }

    recordUsage(tokenEstimate);

    return {
      success: true,
      result: response.result,
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
    throttle: {
      requests: rateLimit.requests,
      tokens: rateLimit.tokens,
      requestLimit: RATE_LIMIT.requestsPerMinute,
      tokenLimit: RATE_LIMIT.tokensPerMinute,
      queue: 0,
    },
    providers: {},
  };
}

async function handleGetProviders(): Promise<unknown> {
  try {
    const response = await sendToOffscreen<{ success: boolean; languages?: Array<{ src: string; tgt: string }> }>({
      type: 'getSupportedLanguages',
    });

    return {
      providers: [
        {
          id: 'opus-mt-local',
          name: 'Helsinki-NLP OPUS-MT',
          type: 'local',
          qualityTier: 'standard',
          icon: '',
        },
      ],
      strategy: currentStrategy,
      supportedLanguages: response.success ? response.languages : [],
    };
  } catch {
    return {
      providers: [
        {
          id: 'opus-mt-local',
          name: 'Helsinki-NLP OPUS-MT',
          type: 'local',
          qualityTier: 'standard',
          icon: '',
        },
      ],
      strategy: currentStrategy,
      supportedLanguages: [],
    };
  }
}

// Extension icon click handler
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    console.log('[Background] Extension icon clicked for tab:', tab.id);
  }
});

// Installation handler
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Background] Extension installed');
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

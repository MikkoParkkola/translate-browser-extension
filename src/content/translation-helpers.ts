/**
 * Content Script — Pure Translation Helpers
 *
 * Stateless utilities extracted from content/index.ts. These functions have
 * no dependency on module-level mutable state and can be tested in isolation.
 */

import type { GlossaryStore } from '../core/glossary';
import { glossary } from '../core/glossary';
import { CONFIG } from '../config';
import { createLogger } from '../core/logger';
import { browserAPI } from '../core/browser-api';
import { detectLanguage, samplePageText } from '../core/language-detector';
import { sanitizeText } from './dom-utils';

const log = createLogger('Content');

/**
 * Resolve 'auto' source language using fast trigram-based detection.
 * Falls back to 'auto' if detection fails or confidence is too low.
 */
export function resolveSourceLang(sourceLang: string, text?: string): string {
  if (sourceLang !== 'auto') return sourceLang;
  const sample = text || samplePageText(300);
  if (!sample) return 'auto';
  const result = detectLanguage(sample);
  if (result && result.confidence >= 0.20) {
    log.info(`Detected language: ${result.lang} (confidence: ${result.confidence.toFixed(2)})`);
    return result.lang;
  }
  return 'auto';
}

/**
 * Translate text via a long-lived Port connection so partial results arrive
 * progressively. Calls `onChunk(partial)` as each sentence is translated, then
 * resolves with the final full translation. Falls back to `sendMessage` on any
 * port error.
 */
export async function translateWithStreaming(
  text: string,
  sourceLang: string,
  targetLang: string,
  provider: string | undefined,
  onChunk: (partial: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let port: chrome.runtime.Port;
    try {
      port = browserAPI.runtime.connect({ name: 'translate-stream' });
    } catch {
      reject(new Error('Port connection failed'));
      return;
    }

    port.onMessage.addListener((msg: { type: string; partial?: string; result?: string; error?: string }) => {
      if (msg.type === 'chunk' && msg.partial) {
        onChunk(msg.partial);
      } else if (msg.type === 'done') {
        port.disconnect();
        resolve(msg.result ?? '');
      } else if (msg.type === 'error') {
        port.disconnect();
        reject(new Error(msg.error ?? 'Streaming translation failed'));
      }
    });

    port.onDisconnect.addListener(() => {
      reject(new Error('Port disconnected'));
    });

    port.postMessage({ type: 'startStream', text, sourceLang, targetLang, provider });
  });
}

/**
 * Check if an error is likely transient and worth retrying.
 * Pre-compiled regex for performance (called on every retry).
 *
 * Includes Chrome Built-in Translator failure modes that surface on SPAs
 * (trainline, gmail etc): the target frame can be torn down between the
 * executeScript call and the injection firing. Classifying these as
 * transient lets the retry loop recover instead of failing the batch wholesale.
 */
const TRANSIENT_ERROR_RE = /timeout|network|connection|econnreset|fetch failed|service worker|disconnected|offscreen|loading model|frame with id|frame .* was removed|frame .* detached|returned no result|chrome translator/i;

export function isTransientError(errorMsg: string): boolean {
  return TRANSIENT_ERROR_RE.test(errorMsg);
}

/**
 * Chrome Built-in Translator transient failure patterns.
 * When these match, the background falls back to opus-mt transparently
 * so the user still sees translations on SPAs with aggressive DOM churn.
 */
export const CHROME_BUILTIN_TRANSIENT_RE = /frame with id|frame .* was removed|frame .* detached|returned no result|no active tab/i;

export function isChromeBuiltinTransientError(errorMsg: string): boolean {
  return CHROME_BUILTIN_TRANSIENT_RE.test(errorMsg);
}

/**
 * Create translation batches from text nodes with glossary pre-processing.
 */
export async function createBatches(
  nodes: Text[],
  glossaryStore: GlossaryStore,
): Promise<Array<{ nodes: Text[]; texts: string[]; restoreFns: Array<(text: string) => string> }>> {
  const batches: Array<{ nodes: Text[]; texts: string[]; restoreFns: Array<(text: string) => string> }> = [];
  for (let i = 0; i < nodes.length; i += CONFIG.batching.maxSize) {
    const batchNodes = nodes.slice(i, i + CONFIG.batching.maxSize);
    const rawTexts = batchNodes.map((n) => {
      /* v8 ignore start */
      const text = sanitizeText(n.textContent || '');
      return text.length > CONFIG.batching.maxTextLength
      /* v8 ignore stop */
        ? text.substring(0, CONFIG.batching.maxTextLength)
        : text;
    });

    const { processedTexts, restoreFns } = await glossary.applyGlossaryBatch(rawTexts, glossaryStore);
    batches.push({ nodes: batchNodes, texts: processedTexts, restoreFns });
  }
  return batches;
}

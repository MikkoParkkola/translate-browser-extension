/**
 * Content script types and constants
 */

import type { Strategy } from '../types';

// ============================================================================
// Constants
// ============================================================================

/** Elements to skip during translation */
export const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'CODE',
  'PRE',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'BUTTON',
  'SVG',
  'MATH',
  'CANVAS',
  'VIDEO',
  'AUDIO',
  'IFRAME',
  'OBJECT',
  'EMBED',
]);

/** Mark translated nodes to avoid re-translation */
export const TRANSLATED_ATTR = 'data-translated';

/** Attribute to store original text for undo */
export const ORIGINAL_TEXT_ATTR = 'data-original-text';

/** Attributes for correction learning */
export const MACHINE_TRANSLATION_ATTR = 'data-machine-translation';
export const SOURCE_LANG_ATTR = 'data-source-lang';
export const TARGET_LANG_ATTR = 'data-target-lang';

// ============================================================================
// Message Types
// ============================================================================

export interface TranslateSelectionMessage {
  type: 'translateSelection';
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
  provider?: string;
}

export interface TranslatePageMessage {
  type: 'translatePage';
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
  provider?: string;
}

export interface TranslateImageMessage {
  type: 'translateImage';
  imageUrl: string;
  sourceLang: string;
  targetLang: string;
  provider?: string;
}

export interface TranslatePdfContentMessage {
  type: 'translatePdf';
  targetLang: string;
}

export type ContentMessage =
  | TranslateSelectionMessage
  | TranslatePageMessage
  | TranslateImageMessage
  | TranslatePdfContentMessage
  | { type: 'ping' }
  | { type: 'stopAutoTranslate' }
  | { type: 'undoTranslation' }
  | { type: 'toggleBilingualMode' }
  | { type: 'setBilingualMode'; enabled: boolean }
  | { type: 'getBilingualMode' }
  | { type: 'toggleWidget' }
  | { type: 'showWidget' }
  | { type: 'enterScreenshotMode' };

// ============================================================================
// Shared State Types
// ============================================================================

export interface CurrentSettings {
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
  provider?: string;
}

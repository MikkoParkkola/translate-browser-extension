/**
 * Content script types and constants
 */

import type { Strategy, TranslationProviderId } from '../types';

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
export const ORIGINAL_TEXT_NODES_ATTR = 'data-original-text-nodes';

/** Attributes for correction learning */
export const MACHINE_TRANSLATION_ATTR = 'data-machine-translation';
export const SOURCE_LANG_ATTR = 'data-source-lang';
export const TARGET_LANG_ATTR = 'data-target-lang';
export const CONTENT_SCRIPT_READY_ATTR = 'data-translate-content-loaded';
export const AUTO_TRANSLATE_DIAGNOSTICS_ATTR = 'data-auto-translate-diagnostics';
export const AUTO_TRANSLATE_E2E_REQUEST_EVENT = 'translate:auto-translate-e2e-request';
export const AUTO_TRANSLATE_E2E_RESPONSE_EVENT = 'translate:auto-translate-e2e-response';

// ============================================================================
// Message Types
// ============================================================================

export interface TranslateSelectionMessage {
  type: 'translateSelection';
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
  provider?: TranslationProviderId;
}

export interface TranslatePageMessage {
  type: 'translatePage';
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
  provider?: TranslationProviderId;
}

export interface TranslateImageMessage {
  type: 'translateImage';
  imageUrl: string;
  sourceLang: string;
  targetLang: string;
  provider?: TranslationProviderId;
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

export type ContentMessageType = ContentMessage['type'];

export type ContentMessageByType<TType extends ContentMessageType> = Extract<
  ContentMessage,
  { type: TType }
>;

export interface StartedContentResponse {
  success: true;
  status: 'started';
}

export interface ContentMessageResponseMap {
  ping: { loaded: boolean };
  stopAutoTranslate: boolean;
  undoTranslation: { success: boolean; restoredCount: number };
  toggleBilingualMode: { enabled: boolean };
  setBilingualMode: { enabled: boolean };
  getBilingualMode: { enabled: boolean };
  toggleWidget: { visible: boolean };
  showWidget: { visible: boolean };
  translateSelection: StartedContentResponse;
  translatePage: StartedContentResponse;
  translatePdf: StartedContentResponse;
  translateImage: StartedContentResponse;
  enterScreenshotMode: boolean;
}

export type ContentMessageResponse = ContentMessageResponseMap[ContentMessageType];

export interface AutoTranslateDiagnostics {
  contentLoaded: boolean;
  checkStarted: boolean;
  settingsLoaded: boolean;
  hasSiteSpecificRules: boolean;
  shouldAutoTranslate: boolean;
  currentSettingsApplied: boolean;
  startScheduled: boolean;
  scheduleMethod: 'requestIdleCallback' | 'setTimeoutFallback' | null;
  startTriggeredBy:
    | 'requestIdleCallback'
    | 'requestIdleCallbackTimeout'
    | 'setTimeoutFallback'
    | null;
  startRan: boolean;
  translationRequested: boolean;
  translationCompleted: boolean;
  handledBy: 'extension' | 'site-tool' | 'pdf' | null;
  translatedCount: number | null;
  errorCount: number | null;
  sourceLang: string | null;
  targetLang: string | null;
  provider: TranslationProviderId | null;
  lastError: string | null;
  readyState: DocumentReadyState;
  visibilityState: DocumentVisibilityState;
}

// ============================================================================
// Shared State Types
// ============================================================================

export interface CurrentSettings {
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
  provider?: TranslationProviderId;
}

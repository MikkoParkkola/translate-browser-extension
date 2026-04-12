import type { CurrentSettings } from './content-types';

type WebMcpScope = 'page' | 'selection';

interface WebMcpToolDefinition<TInput extends object, TResult> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: TInput) => Promise<TResult> | TResult;
}

interface WebMcpRegistry {
  registerTool<TInput extends object, TResult>(
    tool: WebMcpToolDefinition<TInput, TResult>,
    options?: { signal?: AbortSignal }
  ): void;
}

interface NavigatorWithModelContext extends Navigator {
  modelContext?: WebMcpRegistry;
}

interface TranslateToolInput {
  sourceLanguage?: unknown;
  targetLanguage?: unknown;
}

interface DetectLanguageToolInput {
  scope?: unknown;
}

export interface WebMcpDetectionResult {
  language: string;
  confidence: number;
  sampleLength: number;
}

export interface WebMcpHandlers {
  getCurrentSettings: () => Promise<CurrentSettings>;
  translatePage: (settings: CurrentSettings) => Promise<void>;
  translateSelection: (settings: CurrentSettings) => Promise<void>;
  hasSelectionText: () => boolean;
  detectLanguage: (scope: WebMcpScope) => WebMcpDetectionResult | null;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeScope(value: unknown): WebMcpScope {
  return value === 'selection' ? 'selection' : 'page';
}

async function resolveRequestedSettings(
  input: TranslateToolInput,
  getCurrentSettings: () => Promise<CurrentSettings>
): Promise<CurrentSettings> {
  const defaults = await getCurrentSettings();
  return {
    ...defaults,
    sourceLang: normalizeOptionalString(input.sourceLanguage) ?? defaults.sourceLang,
    targetLang: normalizeOptionalString(input.targetLanguage) ?? defaults.targetLang,
  };
}

export function registerWebMcpTools(handlers: WebMcpHandlers): (() => void) | null {
  const registry = (navigator as NavigatorWithModelContext).modelContext;
  if (!registry?.registerTool) {
    return null;
  }

  const controller = new AbortController();

  registry.registerTool<TranslateToolInput, Record<string, unknown>>(
    {
      name: 'translate_page',
      description:
        'Translate the current page into the requested target language. When language fields are omitted, the extension uses its saved defaults for this site.',
      inputSchema: {
        type: 'object',
        properties: {
          sourceLanguage: {
            type: 'string',
            description:
              'Optional source language. Use "auto" to detect from the page, or omit to reuse the extension default.',
          },
          targetLanguage: {
            type: 'string',
            description:
              'Optional target language. Omit to reuse the extension target language for this site.',
          },
        },
        additionalProperties: false,
      },
      execute: async (input) => {
        const settings = await resolveRequestedSettings(input, handlers.getCurrentSettings);
        await handlers.translatePage(settings);
        return {
          translated: true,
          scope: 'page',
          sourceLanguage: settings.sourceLang,
          targetLanguage: settings.targetLang,
          strategy: settings.strategy,
          provider: settings.provider ?? null,
        };
      },
    },
    { signal: controller.signal }
  );

  registry.registerTool<TranslateToolInput, Record<string, unknown>>(
    {
      name: 'translate_selection',
      description:
        'Translate the current text selection into the requested target language. When language fields are omitted, the extension uses its saved defaults for this site.',
      inputSchema: {
        type: 'object',
        properties: {
          sourceLanguage: {
            type: 'string',
            description:
              'Optional source language. Use "auto" to detect from the selection, or omit to reuse the extension default.',
          },
          targetLanguage: {
            type: 'string',
            description:
              'Optional target language. Omit to reuse the extension target language for this site.',
          },
        },
        additionalProperties: false,
      },
      execute: async (input) => {
        if (!handlers.hasSelectionText()) {
          return {
            translated: false,
            scope: 'selection',
            reason: 'no_selection',
          };
        }

        const settings = await resolveRequestedSettings(input, handlers.getCurrentSettings);
        await handlers.translateSelection(settings);
        return {
          translated: true,
          scope: 'selection',
          sourceLanguage: settings.sourceLang,
          targetLanguage: settings.targetLang,
          strategy: settings.strategy,
          provider: settings.provider ?? null,
        };
      },
    },
    { signal: controller.signal }
  );

  registry.registerTool<DetectLanguageToolInput, Record<string, unknown>>(
    {
      name: 'detect_language',
      description:
        'Detect the current page language or the currently selected text language without modifying the page.',
      inputSchema: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['page', 'selection'],
            description: 'Detect from the whole page or only from the current selection.',
            default: 'page',
          },
        },
        additionalProperties: false,
      },
      execute: async (input) => {
        const scope = normalizeScope(input.scope);
        const detected = handlers.detectLanguage(scope);
        if (!detected) {
          return {
            detected: false,
            scope,
          };
        }

        return {
          detected: true,
          scope,
          language: detected.language,
          confidence: detected.confidence,
          sampleLength: detected.sampleLength,
        };
      },
    },
    { signal: controller.signal }
  );

  return () => controller.abort();
}

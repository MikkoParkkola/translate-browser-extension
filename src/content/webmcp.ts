import type { Strategy } from '../types';
import { createLogger } from '../core/logger';
import type { CurrentSettings } from './content-types';

const log = createLogger('ContentWebMCP');
const EXTENSION_TOOL_MARKER = '[translate-browser-extension]';
const TRANSLATE_PAGE_TOOL_NAME = 'translate_page';
const TRANSLATE_SELECTION_TOOL_NAME = 'translate_selection';
const DETECT_LANGUAGE_TOOL_NAME = 'detect_language';
const RESERVED_EXTENSION_TOOL_NAMES = new Set([
  TRANSLATE_PAGE_TOOL_NAME,
  TRANSLATE_SELECTION_TOOL_NAME,
  DETECT_LANGUAGE_TOOL_NAME,
]);
const PAGE_TOOL_ALIASES = new Set([TRANSLATE_PAGE_TOOL_NAME, 'translatePage']);
const SELECTION_TOOL_ALIASES = new Set([
  TRANSLATE_SELECTION_TOOL_NAME,
  'translateSelection',
]);

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

interface WebMcpToolDescriptor {
  name: string;
  description?: string;
}

interface WebMcpTestingRegistry {
  listTools: () => Promise<unknown> | unknown;
  executeTool: (name: string, inputArgsJson: string) => Promise<unknown>;
}

interface NavigatorWithModelContext extends Navigator {
  modelContext?: WebMcpRegistry;
  modelContextTesting?: WebMcpTestingRegistry;
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

export interface SiteSelectionToolRequest {
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
  provider?: string;
  text: string;
}

export interface SitePageToolRequest {
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
  provider?: string;
}

export interface SiteSelectionToolResult {
  toolName: string;
  translatedText: string;
}

export interface SitePageToolResult {
  toolName: string;
  summaryText: string | null;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getStringField(record: Record<string, unknown>, key: string): string | undefined {
  return normalizeOptionalString(record[key]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function compactArgs(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== null)
  );
}

function markExtensionDescription(description: string): string {
  return `${description} ${EXTENSION_TOOL_MARKER}`;
}

function normalizeToolDescriptors(rawTools: unknown): WebMcpToolDescriptor[] {
  if (!Array.isArray(rawTools)) return [];
  return rawTools.flatMap((tool) => {
    if (typeof tool === 'string') {
      const name = normalizeOptionalString(tool);
      return name ? [{ name }] : [];
    }
    if (!isRecord(tool)) return [];

    const name = getStringField(tool, 'name');
    if (!name) return [];
    return [{ name, description: getStringField(tool, 'description') }];
  });
}

function isExtensionTool(descriptor: WebMcpToolDescriptor): boolean {
  if (RESERVED_EXTENSION_TOOL_NAMES.has(descriptor.name)) {
    return true;
  }

  const description = descriptor.description?.toLowerCase() ?? '';
  return description.includes(EXTENSION_TOOL_MARKER.toLowerCase());
}

function matchesPageTool(descriptor: WebMcpToolDescriptor): boolean {
  const description = descriptor.description?.toLowerCase() ?? '';
  return (
    PAGE_TOOL_ALIASES.has(descriptor.name) ||
    (description.includes('translate') &&
      (description.includes('page') ||
        description.includes('document') ||
        description.includes('content')))
  );
}

function matchesSelectionTool(descriptor: WebMcpToolDescriptor): boolean {
  const description = descriptor.description?.toLowerCase() ?? '';
  return (
    SELECTION_TOOL_ALIASES.has(descriptor.name) ||
    (description.includes('translate') && description.includes('selection'))
  );
}

function parseToolResult(raw: unknown): { text: string | null; isError: boolean } {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return { text: null, isError: false };
    try {
      return parseToolResult(JSON.parse(trimmed));
    } catch {
      return { text: trimmed, isError: false };
    }
  }

  if (Array.isArray(raw)) {
    const texts = raw
      .map((value) => parseToolResult(value).text)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    return { text: texts.length > 0 ? texts.join('\n') : null, isError: false };
  }

  if (!isRecord(raw)) {
    return { text: null, isError: false };
  }

  const isError = raw.isError === true;
  const directText = getStringField(raw, 'text');
  if (directText) return { text: directText, isError };

  const structuredContent = raw.structuredContent;
  if (isRecord(structuredContent)) {
    const translatedText = getStringField(structuredContent, 'translatedText');
    if (translatedText) return { text: translatedText, isError };

    const text = getStringField(structuredContent, 'text');
    if (text) return { text, isError };
  }

  const content = raw.content;
  if (Array.isArray(content)) {
    const texts = content
      .map((block) => {
        if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') {
          return null;
        }
        return normalizeOptionalString(block.text) ?? null;
      })
      .filter((text): text is string => typeof text === 'string');

    if (texts.length > 0) return { text: texts.join('\n'), isError };
  }

  if ('result' in raw) return { ...parseToolResult(raw.result), isError };
  if ('output' in raw) return { ...parseToolResult(raw.output), isError };

  return { text: null, isError };
}

async function findTestingToolName(kind: 'page' | 'selection'): Promise<string | null> {
  const testing = (navigator as NavigatorWithModelContext).modelContextTesting;
  if (!testing?.listTools || !testing.executeTool) {
    return null;
  }

  try {
    const tools = normalizeToolDescriptors(await testing.listTools());
    const match = tools.find((descriptor) => {
      if (isExtensionTool(descriptor)) return false;
      return kind === 'page' ? matchesPageTool(descriptor) : matchesSelectionTool(descriptor);
    });
    return match?.name ?? null;
  } catch (error) {
    log.info('Failed to list WebMCP tools:', error);
    return null;
  }
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
        markExtensionDescription(
          'Translate the current page into the requested target language. When language fields are omitted, the extension uses its saved defaults for this site.'
        ),
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
        markExtensionDescription(
          'Translate the current text selection into the requested target language. When language fields are omitted, the extension uses its saved defaults for this site.'
        ),
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
        markExtensionDescription(
          'Detect the current page language or the currently selected text language without modifying the page.'
        ),
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

export async function maybeTranslateSelectionWithSiteTool(
  request: SiteSelectionToolRequest
): Promise<SiteSelectionToolResult | null> {
  const toolName = await findTestingToolName('selection');
  const testing = (navigator as NavigatorWithModelContext).modelContextTesting;
  if (!toolName || !testing?.executeTool) return null;

  try {
    const rawResult = await testing.executeTool(
      toolName,
      JSON.stringify(
        compactArgs({
          sourceLang: request.sourceLang,
          targetLang: request.targetLang,
          strategy: request.strategy,
          provider: request.provider,
          text: request.text,
        })
      )
    );
    const result = parseToolResult(rawResult);
    if (result.isError || !result.text) return null;
    return { toolName, translatedText: result.text };
  } catch (error) {
    log.info(`Site selection tool '${toolName}' failed:`, error);
    return null;
  }
}

export async function maybeTranslatePageWithSiteTool(
  request: SitePageToolRequest
): Promise<SitePageToolResult | null> {
  const toolName = await findTestingToolName('page');
  const testing = (navigator as NavigatorWithModelContext).modelContextTesting;
  if (!toolName || !testing?.executeTool) return null;

  try {
    const rawResult = await testing.executeTool(
      toolName,
      JSON.stringify(
        compactArgs({
          sourceLang: request.sourceLang,
          targetLang: request.targetLang,
          strategy: request.strategy,
          provider: request.provider,
        })
      )
    );
    const result = parseToolResult(rawResult);
    if (result.isError) return null;
    return { toolName, summaryText: result.text };
  } catch (error) {
    log.info(`Site page tool '${toolName}' failed:`, error);
    return null;
  }
}

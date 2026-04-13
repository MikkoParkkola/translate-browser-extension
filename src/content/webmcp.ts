import type { Strategy, TranslationProviderId } from '../types';
import { createLogger } from '../core/logger';

const log = createLogger('ContentWebMCP');

const EXTENSION_TOOL_MARKER = '[translate-browser-extension]';
const TRANSLATE_PAGE_TOOL_NAME = 'translate_page';
const TRANSLATE_SELECTION_TOOL_NAME = 'translate_selection';
const DETECT_LANGUAGE_TOOL_NAME = 'detect_language';
const RESERVED_EXTENSION_TOOL_NAMES = [
  TRANSLATE_PAGE_TOOL_NAME,
  TRANSLATE_SELECTION_TOOL_NAME,
  DETECT_LANGUAGE_TOOL_NAME,
] as const;
const PAGE_TOOL_ALIASES = [TRANSLATE_PAGE_TOOL_NAME, 'translatePage'] as const;
const SELECTION_TOOL_ALIASES = [TRANSLATE_SELECTION_TOOL_NAME, 'translateSelection'] as const;
const STRATEGY_VALUES: readonly Strategy[] = ['smart', 'fast', 'quality', 'cost', 'balanced'];
const PROVIDER_VALUES: readonly TranslationProviderId[] = [
  'opus-mt',
  'translategemma',
  'chrome-builtin',
  'deepl',
  'openai',
  'google-cloud',
  'anthropic',
];

interface WebMcpToolContentBlock {
  type: string;
  text?: string;
}

interface WebMcpToolResponse {
  content: WebMcpToolContentBlock[];
  isError?: boolean;
}

interface WebMcpToolDescriptor {
  name: string;
  description?: string;
}

interface WebMcpToolRegistration extends WebMcpToolDescriptor {
  inputSchema: unknown;
  execute: (input: unknown) => Promise<WebMcpToolResponse>;
  annotations?: {
    destructiveHint?: boolean;
    readOnlyHint?: boolean;
    title?: string;
  };
}

export interface NavigatorModelContext {
  registerTool: (tool: WebMcpToolRegistration) => Promise<void> | void;
  unregisterTool?: (name: string) => Promise<void> | void;
}

export interface NavigatorModelContextTesting {
  listTools: () => Promise<unknown> | unknown;
  executeTool: (name: string, inputArgsJson: string) => Promise<unknown>;
}

declare global {
  interface Navigator {
    modelContext?: NavigatorModelContext;
    modelContextTesting?: NavigatorModelContextTesting;
  }
}

export interface TranslateSelectionToolRequest {
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
  provider?: TranslationProviderId;
}

export interface TranslatePageToolRequest {
  sourceLang: string;
  targetLang: string;
  strategy: Strategy;
  provider?: TranslationProviderId;
}

export interface PageToolSummary {
  translatedCount: number;
  errorCount: number;
}

export interface SiteSelectionToolResult {
  toolName: string;
  translatedText: string;
}

export interface SitePageToolResult {
  toolName: string;
  summaryText: string | null;
}

export interface TranslationWebMcpHandlers {
  translatePage: (
    request: TranslatePageToolRequest & { agentInvoked: true }
  ) => Promise<PageToolSummary>;
  translateSelection: (
    request: TranslateSelectionToolRequest & { agentInvoked: true }
  ) => Promise<string | null>;
  detectLanguage: (text?: string) => Promise<{ lang: string; confidence: number } | null>;
}

let toolsRegistered = false;
let registrationPromise: Promise<boolean> | null = null;

function isStrategy(value: string): value is Strategy {
  return STRATEGY_VALUES.includes(value as Strategy);
}

function isProvider(value: string): value is TranslationProviderId {
  return PROVIDER_VALUES.includes(value as TranslationProviderId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function compactArgs(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== null)
  );
}

function createTextResponse(text: string, isError = false): WebMcpToolResponse {
  return { content: [{ type: 'text', text }], isError };
}

function parseSelectionToolInput(input: unknown): TranslateSelectionToolRequest | null {
  const record = isRecord(input) ? input : {};
  const targetLang = getStringField(record, 'targetLang');
  if (!targetLang) return null;

  const rawSourceLang = getStringField(record, 'sourceLang');
  const rawStrategy = getStringField(record, 'strategy');
  const rawProvider = getStringField(record, 'provider');

  return {
    sourceLang: rawSourceLang || 'auto',
    targetLang,
    strategy: rawStrategy && isStrategy(rawStrategy) ? rawStrategy : 'smart',
    provider: rawProvider && isProvider(rawProvider) ? rawProvider : undefined,
  };
}

function parsePageToolInput(input: unknown): TranslatePageToolRequest | null {
  const record = isRecord(input) ? input : {};
  const targetLang = getStringField(record, 'targetLang');
  if (!targetLang) return null;

  const rawSourceLang = getStringField(record, 'sourceLang');
  const rawStrategy = getStringField(record, 'strategy');
  const rawProvider = getStringField(record, 'provider');

  return {
    sourceLang: rawSourceLang || 'auto',
    targetLang,
    strategy: rawStrategy && isStrategy(rawStrategy) ? rawStrategy : 'smart',
    provider: rawProvider && isProvider(rawProvider) ? rawProvider : undefined,
  };
}

function selectionToolDescription(): string {
  return `Translate the current page selection and return the translated text. ${EXTENSION_TOOL_MARKER}`;
}

function pageToolDescription(): string {
  return `Translate the current page in place and keep following dynamic content updates. ${EXTENSION_TOOL_MARKER}`;
}

function detectLanguageToolDescription(): string {
  return `Detect the language of the provided text or current page context. ${EXTENSION_TOOL_MARKER}`;
}

function formatPageToolSummary(summary: PageToolSummary): string {
  if (summary.translatedCount === 0 && summary.errorCount === 0) {
    return 'No translatable text was found on the page.';
  }
  if (summary.errorCount > 0 && summary.translatedCount > 0) {
    return `Translated ${summary.translatedCount} page items (${summary.errorCount} failed).`;
  }
  if (summary.errorCount > 0) {
    return `Page translation failed for ${summary.errorCount} items.`;
  }
  return `Translated ${summary.translatedCount} page items.`;
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
        return block.text;
      })
      .filter((text): text is string => typeof text === 'string')
      .filter((text) => text.length > 0);
    if (texts.length > 0) return { text: texts.join('\n'), isError };
  }

  if ('result' in raw) return { ...parseToolResult(raw.result), isError };
  if ('output' in raw) return { ...parseToolResult(raw.output), isError };

  return { text: null, isError };
}

function normalizeToolDescriptors(rawTools: unknown): WebMcpToolDescriptor[] {
  if (!Array.isArray(rawTools)) return [];
  return rawTools.flatMap((tool) => {
    if (typeof tool === 'string') {
      return [{ name: tool }];
    }
    if (!isRecord(tool)) {
      return [];
    }
    const name = getStringField(tool, 'name');
    if (!name) return [];
    return [{ name, description: getStringField(tool, 'description') }];
  });
}

function isExtensionTool(descriptor: WebMcpToolDescriptor): boolean {
  if (
    RESERVED_EXTENSION_TOOL_NAMES.includes(
      descriptor.name as (typeof RESERVED_EXTENSION_TOOL_NAMES)[number]
    )
  ) {
    return true;
  }

  const description = descriptor.description?.toLowerCase() ?? '';
  return description.includes(EXTENSION_TOOL_MARKER.toLowerCase());
}

function matchesPageTool(descriptor: WebMcpToolDescriptor): boolean {
  const description = descriptor.description?.toLowerCase() ?? '';
  return (
    PAGE_TOOL_ALIASES.includes(descriptor.name as (typeof PAGE_TOOL_ALIASES)[number]) ||
    (description.includes('translate') &&
      (description.includes('page') ||
        description.includes('document') ||
        description.includes('content')))
  );
}

function matchesSelectionTool(descriptor: WebMcpToolDescriptor): boolean {
  const description = descriptor.description?.toLowerCase() ?? '';
  return (
    SELECTION_TOOL_ALIASES.includes(descriptor.name as (typeof SELECTION_TOOL_ALIASES)[number]) ||
    (description.includes('translate') && description.includes('selection'))
  );
}

async function findTestingToolName(
  kind: 'page' | 'selection'
): Promise<string | null> {
  const testing = navigator.modelContextTesting;
  if (!testing?.listTools || !testing.executeTool) return null;

  try {
    const tools = normalizeToolDescriptors(await testing.listTools());
    const match = tools.find((descriptor) => {
      if (isExtensionTool(descriptor)) return false;
      return kind === 'page' ? matchesPageTool(descriptor) : matchesSelectionTool(descriptor);
    });
    return match?.name ?? null;
  } catch (error) {
    log.info(' Failed to list WebMCP tools:', error);
    return null;
  }
}

export async function registerTranslationWebMcpTools(
  handlers: TranslationWebMcpHandlers
): Promise<boolean> {
  if (toolsRegistered) return true;
  if (registrationPromise) return registrationPromise;

  const context = navigator.modelContext;
  if (!context?.registerTool) return false;

  const tools: WebMcpToolRegistration[] = [
    {
      name: TRANSLATE_SELECTION_TOOL_NAME,
      description: selectionToolDescription(),
      inputSchema: {
        type: 'object',
        properties: {
          sourceLang: {
            type: 'string',
            description: 'Source language code or "auto" to detect it.',
            default: 'auto',
          },
          targetLang: {
            type: 'string',
            description: 'Target language code to translate into.',
          },
          strategy: {
            type: 'string',
            enum: [...STRATEGY_VALUES],
            default: 'smart',
          },
          provider: {
            type: 'string',
            enum: [...PROVIDER_VALUES],
          },
        },
        required: ['targetLang'],
      },
      annotations: {
        readOnlyHint: true,
        title: 'Translate selection',
      },
      execute: async (input) => {
        try {
          const request = parseSelectionToolInput(input);
          if (!request) {
            return createTextResponse('targetLang is required.', true);
          }

          const translatedText = await handlers.translateSelection({
            ...request,
            agentInvoked: true,
          });
          if (!translatedText) {
            return createTextResponse('No translatable selection is available.', true);
          }
          return createTextResponse(translatedText);
        } catch (error) {
          log.info(' translate_selection failed:', error);
          return createTextResponse('Selection translation failed.', true);
        }
      },
    },
    {
      name: TRANSLATE_PAGE_TOOL_NAME,
      description: pageToolDescription(),
      inputSchema: {
        type: 'object',
        properties: {
          sourceLang: {
            type: 'string',
            description: 'Source language code or "auto" to detect it.',
            default: 'auto',
          },
          targetLang: {
            type: 'string',
            description: 'Target language code to translate into.',
          },
          strategy: {
            type: 'string',
            enum: [...STRATEGY_VALUES],
            default: 'smart',
          },
          provider: {
            type: 'string',
            enum: [...PROVIDER_VALUES],
          },
        },
        required: ['targetLang'],
      },
      annotations: {
        readOnlyHint: false,
        title: 'Translate page',
      },
      execute: async (input) => {
        try {
          const request = parsePageToolInput(input);
          if (!request) {
            return createTextResponse('targetLang is required.', true);
          }
          const summary = await handlers.translatePage({
            ...request,
            agentInvoked: true,
          });
          return createTextResponse(formatPageToolSummary(summary));
        } catch (error) {
          log.info(' translate_page failed:', error);
          return createTextResponse('Page translation failed.', true);
        }
      },
    },
    {
      name: DETECT_LANGUAGE_TOOL_NAME,
      description: detectLanguageToolDescription(),
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Optional text to detect. Falls back to the current page context.',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        title: 'Detect language',
      },
      execute: async (input) => {
        try {
          const record = isRecord(input) ? input : {};
          const result = await handlers.detectLanguage(getStringField(record, 'text'));
          if (!result) {
            return createTextResponse('No text is available for language detection.', true);
          }
          return createTextResponse(
            JSON.stringify({
              lang: result.lang,
              confidence: Number(result.confidence.toFixed(3)),
            })
          );
        } catch (error) {
          log.info(' detect_language failed:', error);
          return createTextResponse('Language detection failed.', true);
        }
      },
    },
  ];

  registrationPromise = (async () => {
    try {
      await Promise.all(tools.map((tool) => Promise.resolve(context.registerTool(tool))));
      toolsRegistered = true;
      return true;
    } catch (error) {
      log.info(' Failed to register WebMCP tools:', error);
      toolsRegistered = false;
      return false;
    } finally {
      registrationPromise = null;
    }
  })();

  return registrationPromise;
}

export async function unregisterTranslationWebMcpTools(): Promise<void> {
  if (!toolsRegistered) return;
  toolsRegistered = false;

  const context = navigator.modelContext;
  if (typeof context?.unregisterTool !== 'function') return;

  try {
    await Promise.all([
      Promise.resolve(context.unregisterTool(TRANSLATE_PAGE_TOOL_NAME)),
      Promise.resolve(context.unregisterTool(TRANSLATE_SELECTION_TOOL_NAME)),
      Promise.resolve(context.unregisterTool(DETECT_LANGUAGE_TOOL_NAME)),
    ]);
  } catch (error) {
    log.info(' Failed to unregister WebMCP tools:', error);
  }
}

export async function maybeTranslateSelectionWithSiteTool(
  request: TranslateSelectionToolRequest & { text: string }
): Promise<SiteSelectionToolResult | null> {
  const toolName = await findTestingToolName('selection');
  if (!toolName) return null;

  try {
    const rawResult = await navigator.modelContextTesting!.executeTool(
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
    log.info(` Site selection tool '${toolName}' failed:`, error);
    return null;
  }
}

export async function maybeTranslatePageWithSiteTool(
  request: TranslatePageToolRequest
): Promise<SitePageToolResult | null> {
  const toolName = await findTestingToolName('page');
  if (!toolName) return null;

  try {
    const rawResult = await navigator.modelContextTesting!.executeTool(
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
    log.info(` Site page tool '${toolName}' failed:`, error);
    return null;
  }
}

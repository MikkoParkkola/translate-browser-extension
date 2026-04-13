import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { CurrentSettings } from './content-types';
import {
  maybeTranslatePageWithSiteTool,
  maybeTranslateSelectionWithSiteTool,
  registerWebMcpTools,
} from './webmcp';

describe('registerWebMcpTools', () => {
  const defaultSettings: CurrentSettings = {
    sourceLang: 'auto',
    targetLang: 'fi',
    strategy: 'smart',
    provider: 'opus-mt',
  };

  const handlers = {
    getCurrentSettings: vi.fn<() => Promise<CurrentSettings>>(),
    translatePage: vi.fn<(settings: CurrentSettings) => Promise<void>>(),
    translateSelection: vi.fn<(settings: CurrentSettings) => Promise<void>>(),
    hasSelectionText: vi.fn<() => boolean>(),
    detectLanguage: vi.fn<(scope: 'page' | 'selection') => { language: string; confidence: number; sampleLength: number } | null>(),
  };

  const registerTool = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.getCurrentSettings.mockResolvedValue(defaultSettings);
    handlers.translatePage.mockResolvedValue();
    handlers.translateSelection.mockResolvedValue();
    handlers.hasSelectionText.mockReturnValue(true);
    handlers.detectLanguage.mockReturnValue({
      language: 'en',
      confidence: 0.98,
      sampleLength: 128,
    });

    Object.defineProperty(window.navigator, 'modelContext', {
      value: { registerTool },
      configurable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window.navigator, 'modelContext');
    Reflect.deleteProperty(window.navigator, 'modelContextTesting');
  });

  it('returns null when navigator.modelContext is unavailable', () => {
    Reflect.deleteProperty(window.navigator, 'modelContext');

    const cleanup = registerWebMcpTools(handlers);

    expect(cleanup).toBeNull();
    expect(registerTool).not.toHaveBeenCalled();
  });

  it('registers translate and language detection tools', () => {
    const cleanup = registerWebMcpTools(handlers);

    expect(cleanup).toBeTypeOf('function');
    expect(registerTool).toHaveBeenCalledTimes(3);
    const toolNames = registerTool.mock.calls.map(([tool]) => tool.name);
    expect(toolNames).toEqual([
      'translate_page',
      'translate_selection',
      'detect_language',
    ]);
  });

  it('uses saved defaults when translate_page input omits languages', async () => {
    registerWebMcpTools(handlers);
    const translatePageTool = registerTool.mock.calls[0][0];

    const result = await translatePageTool.execute({});

    expect(handlers.getCurrentSettings).toHaveBeenCalledOnce();
    expect(handlers.translatePage).toHaveBeenCalledWith(defaultSettings);
    expect(result).toMatchObject({
      translated: true,
      scope: 'page',
      sourceLanguage: 'auto',
      targetLanguage: 'fi',
      strategy: 'smart',
      provider: 'opus-mt',
    });
  });

  it('returns no_selection when translate_selection is invoked without a selection', async () => {
    handlers.hasSelectionText.mockReturnValue(false);
    registerWebMcpTools(handlers);
    const translateSelectionTool = registerTool.mock.calls[1][0];

    const result = await translateSelectionTool.execute({});

    expect(handlers.translateSelection).not.toHaveBeenCalled();
    expect(result).toEqual({
      translated: false,
      scope: 'selection',
      reason: 'no_selection',
    });
  });

  it('applies language overrides for translate_selection', async () => {
    registerWebMcpTools(handlers);
    const translateSelectionTool = registerTool.mock.calls[1][0];

    await translateSelectionTool.execute({
      sourceLanguage: 'en',
      targetLanguage: 'sv',
    });

    expect(handlers.translateSelection).toHaveBeenCalledWith({
      sourceLang: 'en',
      targetLang: 'sv',
      strategy: 'smart',
      provider: 'opus-mt',
    });
  });

  it('returns page language detection details', async () => {
    registerWebMcpTools(handlers);
    const detectLanguageTool = registerTool.mock.calls[2][0];

    const result = await detectLanguageTool.execute({ scope: 'page' });

    expect(handlers.detectLanguage).toHaveBeenCalledWith('page');
    expect(result).toEqual({
      detected: true,
      scope: 'page',
      language: 'en',
      confidence: 0.98,
      sampleLength: 128,
    });
  });

  it('aborts all registrations on cleanup', () => {
    const cleanup = registerWebMcpTools(handlers);

    cleanup?.();

    for (const [, options] of registerTool.mock.calls) {
      expect(options.signal.aborted).toBe(true);
    }
  });

  it('prefers site selection tools over extension-owned tools', async () => {
    const executeTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Hei maailma' }],
    });
    Object.defineProperty(window.navigator, 'modelContextTesting', {
      value: {
        listTools: vi.fn().mockResolvedValue([
          {
            name: 'translate_selection',
            description: 'Translate the current selection. [translate-browser-extension]',
          },
          {
            name: 'translateSelection',
            description: 'Translate the current selection inside the page.',
          },
        ]),
        executeTool,
      },
      configurable: true,
    });

    const result = await maybeTranslateSelectionWithSiteTool({
      sourceLang: 'auto',
      targetLang: 'fi',
      strategy: 'smart',
      text: 'Hello world',
    });

    expect(result).toEqual({
      toolName: 'translateSelection',
      translatedText: 'Hei maailma',
    });
    expect(executeTool).toHaveBeenCalledWith(
      'translateSelection',
      JSON.stringify({
        sourceLang: 'auto',
        targetLang: 'fi',
        strategy: 'smart',
        text: 'Hello world',
      })
    );
  });

  it('reserves canonical extension tool names for page and selection discovery', async () => {
    const executeTool = vi.fn();
    const listTools = vi
      .fn()
      .mockResolvedValueOnce([
        {
          name: 'translate_page',
          description: 'Translate the current page using the site tool.',
        },
      ])
      .mockResolvedValueOnce([
        {
          name: 'translate_selection',
          description: 'Translate the current selection using the site tool.',
        },
      ]);
    Object.defineProperty(window.navigator, 'modelContextTesting', {
      value: { listTools, executeTool },
      configurable: true,
    });

    await expect(
      maybeTranslatePageWithSiteTool({
        sourceLang: 'auto',
        targetLang: 'fi',
        strategy: 'smart',
      })
    ).resolves.toBeNull();
    await expect(
      maybeTranslateSelectionWithSiteTool({
        sourceLang: 'auto',
        targetLang: 'fi',
        strategy: 'smart',
        text: 'Hello world',
      })
    ).resolves.toBeNull();

    expect(executeTool).not.toHaveBeenCalled();
  });

  it('discovers a page tool by description and parses structured results', async () => {
    const executeTool = vi.fn().mockResolvedValue({
      structuredContent: {
        text: 'Translated 12 page items.',
      },
    });
    Object.defineProperty(window.navigator, 'modelContextTesting', {
      value: {
        listTools: vi.fn().mockResolvedValue([
          {
            name: 'site-page-tool',
            description: 'Translate the current document content in place.',
          },
          {
            name: 'detect_language',
            description: 'Detect page language.',
          },
        ]),
        executeTool,
      },
      configurable: true,
    });

    const result = await maybeTranslatePageWithSiteTool({
      sourceLang: 'auto',
      targetLang: 'fi',
      strategy: 'balanced',
      provider: 'openai',
    });

    expect(result).toEqual({
      toolName: 'site-page-tool',
      summaryText: 'Translated 12 page items.',
    });
    expect(executeTool).toHaveBeenCalledWith(
      'site-page-tool',
      JSON.stringify({
        sourceLang: 'auto',
        targetLang: 'fi',
        strategy: 'balanced',
        provider: 'openai',
      })
    );
  });

  it('returns null when helper discovery or execution fails', async () => {
    const executeTool = vi.fn().mockRejectedValue(new Error('boom'));
    Object.defineProperty(window.navigator, 'modelContextTesting', {
      value: {
        listTools: vi.fn().mockResolvedValue([
          {
            name: 'translateSelection',
            description: 'Translate the current selection inside the page.',
          },
        ]),
        executeTool,
      },
      configurable: true,
    });

    await expect(
      maybeTranslateSelectionWithSiteTool({
        sourceLang: 'auto',
        targetLang: 'fi',
        strategy: 'smart',
        text: 'Hello world',
      })
    ).resolves.toBeNull();

    Object.defineProperty(window.navigator, 'modelContextTesting', {
      value: {
        listTools: vi.fn().mockRejectedValue(new Error('list failed')),
        executeTool,
      },
      configurable: true,
    });

    await expect(
      maybeTranslatePageWithSiteTool({
        sourceLang: 'auto',
        targetLang: 'fi',
        strategy: 'smart',
      })
    ).resolves.toBeNull();
  });
});

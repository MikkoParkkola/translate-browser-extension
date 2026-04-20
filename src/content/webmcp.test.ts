import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoggerModuleMock } from '../test-helpers/module-mocks';

vi.mock('../core/logger', () => createLoggerModuleMock());

describe('content WebMCP helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (navigator as Navigator & { modelContext?: unknown }).modelContext;
    delete (navigator as Navigator & { modelContextTesting?: unknown }).modelContextTesting;
  });

  function getRegisteredTool(registerTool: ReturnType<typeof vi.fn>, name: string) {
    return registerTool.mock.calls.find(([tool]) => tool.name === name)?.[0];
  }

  it('registers the three translation tools once and marks agent-invoked execution', async () => {
    const registerTool = vi.fn();
    (navigator as Navigator & { modelContext?: unknown }).modelContext = { registerTool };

    const {
      registerTranslationWebMcpTools,
    } = await import('./webmcp');

    const translatePage = vi.fn().mockResolvedValue({ translatedCount: 4, errorCount: 1 });
    const translateSelection = vi.fn().mockResolvedValue('Hei maailma');
    const detectLanguage = vi.fn().mockResolvedValue({ lang: 'fi', confidence: 0.92 });

    expect(
      await registerTranslationWebMcpTools({
        translatePage,
        translateSelection,
        detectLanguage,
      })
    ).toBe(true);

    expect(registerTool).toHaveBeenCalledTimes(3);

    const selectionTool = getRegisteredTool(registerTool, 'translate_selection');
    expect(selectionTool).toBeDefined();
    expect(selectionTool.description).toContain('[translate-browser-extension]');

    await selectionTool.execute({
      targetLang: 'fi',
      sourceLang: 'en',
      strategy: 'quality',
      provider: 'openai',
    });
    expect(translateSelection).toHaveBeenCalledWith({
      targetLang: 'fi',
      sourceLang: 'en',
      strategy: 'quality',
      provider: 'openai',
      agentInvoked: true,
    });

    const pageTool = getRegisteredTool(registerTool, 'translate_page');
    await pageTool.execute({ targetLang: 'fi' });
    expect(translatePage).toHaveBeenCalledWith({
      targetLang: 'fi',
      sourceLang: 'auto',
      strategy: 'smart',
      provider: undefined,
      agentInvoked: true,
    });

    const languageTool = getRegisteredTool(registerTool, 'detect_language');
    const languageResult = await languageTool.execute({ text: 'bonjour le monde' });
    expect(detectLanguage).toHaveBeenCalledWith('bonjour le monde');
    expect(languageResult.content[0]?.text).toContain('"lang":"fi"');

    expect(
      await registerTranslationWebMcpTools({
        translatePage,
        translateSelection,
        detectLanguage,
      })
    ).toBe(true);
    expect(registerTool).toHaveBeenCalledTimes(3);
  });

  it('returns false when WebMCP registration is unavailable', async () => {
    const { registerTranslationWebMcpTools } = await import('./webmcp');

    await expect(
      registerTranslationWebMcpTools({
        translatePage: vi.fn(),
        translateSelection: vi.fn(),
        detectLanguage: vi.fn(),
      })
    ).resolves.toBe(false);
  });

  it('surfaces tool validation, empty-result, and failure states', async () => {
    const registerTool = vi.fn();
    (navigator as Navigator & { modelContext?: unknown }).modelContext = { registerTool };

    const { registerTranslationWebMcpTools } = await import('./webmcp');

    const translatePage = vi
      .fn()
      .mockResolvedValueOnce({ translatedCount: 0, errorCount: 0 })
      .mockResolvedValueOnce({ translatedCount: 3, errorCount: 1 })
      .mockResolvedValueOnce({ translatedCount: 0, errorCount: 2 })
      .mockResolvedValueOnce({ translatedCount: 2, errorCount: 0 })
      .mockRejectedValueOnce(new Error('page failed'));
    const translateSelection = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('selection failed'));
    const detectLanguage = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('detect failed'));

    expect(
      await registerTranslationWebMcpTools({
        translatePage,
        translateSelection,
        detectLanguage,
      })
    ).toBe(true);

    const selectionTool = getRegisteredTool(registerTool, 'translate_selection');
    const pageTool = getRegisteredTool(registerTool, 'translate_page');
    const languageTool = getRegisteredTool(registerTool, 'detect_language');

    await expect(selectionTool.execute({})).resolves.toEqual({
      content: [{ type: 'text', text: 'targetLang is required.' }],
      isError: true,
    });
    await expect(selectionTool.execute({ targetLang: 'fi' })).resolves.toEqual({
      content: [{ type: 'text', text: 'No translatable selection is available.' }],
      isError: true,
    });
    await expect(selectionTool.execute({ targetLang: 'fi' })).resolves.toEqual({
      content: [{ type: 'text', text: 'Selection translation failed.' }],
      isError: true,
    });

    await expect(pageTool.execute({})).resolves.toEqual({
      content: [{ type: 'text', text: 'targetLang is required.' }],
      isError: true,
    });
    await expect(pageTool.execute({ targetLang: 'fi' })).resolves.toEqual({
      content: [{ type: 'text', text: 'No translatable text was found on the page.' }],
      isError: false,
    });
    await expect(pageTool.execute({ targetLang: 'fi' })).resolves.toEqual({
      content: [{ type: 'text', text: 'Translated 3 page items (1 failed).' }],
      isError: false,
    });
    await expect(pageTool.execute({ targetLang: 'fi' })).resolves.toEqual({
      content: [{ type: 'text', text: 'Page translation failed for 2 items.' }],
      isError: false,
    });
    await expect(pageTool.execute({ targetLang: 'fi' })).resolves.toEqual({
      content: [{ type: 'text', text: 'Translated 2 page items.' }],
      isError: false,
    });
    await expect(pageTool.execute({ targetLang: 'fi' })).resolves.toEqual({
      content: [{ type: 'text', text: 'Page translation failed.' }],
      isError: true,
    });

    await expect(languageTool.execute({})).resolves.toEqual({
      content: [{ type: 'text', text: 'No text is available for language detection.' }],
      isError: true,
    });
    await expect(languageTool.execute({ text: 'bonjour' })).resolves.toEqual({
      content: [{ type: 'text', text: 'Language detection failed.' }],
      isError: true,
    });
  });

  it('retries registration after failure and tolerates unregister errors', async () => {
    const registerTool = vi
      .fn()
      .mockRejectedValueOnce(new Error('register failed'))
      .mockResolvedValue(undefined);
    const unregisterTool = vi.fn().mockRejectedValue(new Error('unregister failed'));
    (navigator as Navigator & { modelContext?: unknown }).modelContext = {
      registerTool,
      unregisterTool,
    };

    const {
      registerTranslationWebMcpTools,
      unregisterTranslationWebMcpTools,
    } = await import('./webmcp');

    await expect(
      registerTranslationWebMcpTools({
        translatePage: vi.fn(),
        translateSelection: vi.fn(),
        detectLanguage: vi.fn(),
      })
    ).resolves.toBe(false);

    await expect(
      registerTranslationWebMcpTools({
        translatePage: vi.fn(),
        translateSelection: vi.fn(),
        detectLanguage: vi.fn(),
      })
    ).resolves.toBe(true);

    await expect(unregisterTranslationWebMcpTools()).resolves.toBeUndefined();
    expect(unregisterTool).toHaveBeenCalledTimes(3);
    expect(unregisterTool).toHaveBeenNthCalledWith(1, 'translate_page');
    expect(unregisterTool).toHaveBeenNthCalledWith(2, 'translate_selection');
    expect(unregisterTool).toHaveBeenNthCalledWith(3, 'detect_language');
  });

  it('prefers site selection tools and ignores the extension marker', async () => {
    (navigator as Navigator & { modelContextTesting?: unknown }).modelContextTesting = {
      listTools: vi.fn().mockResolvedValue([
        {
          name: 'translate_selection',
          description:
            'Translate the current selection and return the translated text. [translate-browser-extension]',
        },
        {
          name: 'translateSelection',
          description: 'Translate the current selection inside the page.',
        },
      ]),
      executeTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Hola mundo' }],
      }),
    };

    const { maybeTranslateSelectionWithSiteTool } = await import('./webmcp');
    const result = await maybeTranslateSelectionWithSiteTool({
      sourceLang: 'auto',
      targetLang: 'es',
      strategy: 'smart',
      text: 'Hello world',
    });

    expect(result).toEqual({
      toolName: 'translateSelection',
      translatedText: 'Hola mundo',
    });
  });

  it('treats ambiguous canonical page tools without descriptions as self tools', async () => {
    const executeTool = vi.fn();
    (navigator as Navigator & { modelContextTesting?: unknown }).modelContextTesting = {
      listTools: vi.fn().mockResolvedValue([{ name: 'translate_page' }]),
      executeTool,
    };

    const { maybeTranslatePageWithSiteTool } = await import('./webmcp');
    const result = await maybeTranslatePageWithSiteTool({
      sourceLang: 'auto',
      targetLang: 'fi',
      strategy: 'smart',
    });

    expect(result).toBeNull();
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('treats canonical page and selection tool names as self tools even with site descriptions', async () => {
    const executeTool = vi.fn();
    (navigator as Navigator & { modelContextTesting?: unknown }).modelContextTesting = {
      listTools: vi
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
        ]),
      executeTool,
    };

    const {
      maybeTranslatePageWithSiteTool,
      maybeTranslateSelectionWithSiteTool,
    } = await import('./webmcp');

    await expect(
      maybeTranslatePageWithSiteTool({
        sourceLang: 'auto',
        targetLang: 'fi',
        strategy: 'smart',
      })
    ).resolves.toBeNull();

    await expect(
      maybeTranslateSelectionWithSiteTool({
        sourceLang: 'en',
        targetLang: 'fr',
        strategy: 'quality',
        text: 'Hello world',
      })
    ).resolves.toBeNull();

    expect(executeTool).not.toHaveBeenCalled();
  });

  it('parses JSON-string tool responses for site selection tools', async () => {
    (navigator as Navigator & { modelContextTesting?: unknown }).modelContextTesting = {
      listTools: vi.fn().mockResolvedValue([
        {
          name: 'translateSelection',
          description: 'Translate the current selection inside the page.',
        },
      ]),
      executeTool: vi
        .fn()
        .mockResolvedValue('{"content":[{"type":"text","text":"Bonjour le monde"}]}'),
    };

    const { maybeTranslateSelectionWithSiteTool } = await import('./webmcp');
    const result = await maybeTranslateSelectionWithSiteTool({
      sourceLang: 'en',
      targetLang: 'fr',
      strategy: 'quality',
      text: 'Hello world',
    });

    expect(result?.translatedText).toBe('Bonjour le monde');
  });

  it('supports description-based site tool discovery and structured result parsing', async () => {
    const executeTool = vi.fn(async (name: string, _inputArgsJson: string) => {
      if (name === 'siteSelectionTool') {
        return { structuredContent: { translatedText: 'Hola mundo' } };
      }

      return {
        result: {
          content: [{ type: 'text', text: 'Translated page in place.' }],
        },
      };
    });
    (navigator as Navigator & { modelContextTesting?: unknown }).modelContextTesting = {
      listTools: vi.fn().mockResolvedValue([
        'ignored-string-tool',
        { invalid: true },
        {
          name: 'siteSelectionTool',
          description: 'Translate the current selection inline.',
        },
        {
          name: 'sitePageTool',
          description: 'Translate the page content and document in place.',
        },
      ]),
      executeTool,
    };

    const {
      maybeTranslatePageWithSiteTool,
      maybeTranslateSelectionWithSiteTool,
    } = await import('./webmcp');

    await expect(
      maybeTranslateSelectionWithSiteTool({
        sourceLang: 'en',
        targetLang: 'es',
        strategy: 'quality',
        provider: 'deepl',
        text: 'Hello world',
      })
    ).resolves.toEqual({
      toolName: 'siteSelectionTool',
      translatedText: 'Hola mundo',
    });
    expect(JSON.parse(executeTool.mock.calls[0][1])).toEqual({
      sourceLang: 'en',
      targetLang: 'es',
      strategy: 'quality',
      provider: 'deepl',
      text: 'Hello world',
    });

    await expect(
      maybeTranslatePageWithSiteTool({
        sourceLang: 'auto',
        targetLang: 'fi',
        strategy: 'smart',
      })
    ).resolves.toEqual({
      toolName: 'sitePageTool',
      summaryText: 'Translated page in place.',
    });
  });

  it('parses array, direct text, structured text, and output-wrapped site tool responses', async () => {
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce([
        { text: 'Hola' },
        { structuredContent: { text: 'mundo' } },
        '!',
      ])
      .mockResolvedValueOnce({
        output: { structuredContent: { text: 'Translated whole page.' } },
      });
    (navigator as Navigator & { modelContextTesting?: unknown }).modelContextTesting = {
      listTools: vi.fn().mockResolvedValue([
        {
          name: 'siteSelectionTool',
          description: 'Translate the current selection inline.',
        },
        {
          name: 'sitePageTool',
          description: 'Translate the page content and document in place.',
        },
      ]),
      executeTool,
    };

    const {
      maybeTranslatePageWithSiteTool,
      maybeTranslateSelectionWithSiteTool,
    } = await import('./webmcp');

    await expect(
      maybeTranslateSelectionWithSiteTool({
        sourceLang: 'en',
        targetLang: 'es',
        strategy: 'quality',
        text: 'Hello world',
      })
    ).resolves.toEqual({
      toolName: 'siteSelectionTool',
      translatedText: 'Hola\nmundo\n!',
    });

    await expect(
      maybeTranslatePageWithSiteTool({
        sourceLang: 'auto',
        targetLang: 'fi',
        strategy: 'smart',
      })
    ).resolves.toEqual({
      toolName: 'sitePageTool',
      summaryText: 'Translated whole page.',
    });
  });

  it('returns null when site tool lookup or execution fails', async () => {
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({
        isError: true,
        content: [{ type: 'text', text: 'site tool failed' }],
      })
      .mockRejectedValueOnce(new Error('site page failed'));
    (navigator as Navigator & { modelContextTesting?: unknown }).modelContextTesting = {
      listTools: vi
        .fn()
        .mockResolvedValueOnce([
          {
            name: 'siteSelectionTool',
            description: 'Translate the current selection inside the page.',
          },
          {
            name: 'sitePageTool',
            description: 'Translate the page content in place.',
          },
        ])
        .mockResolvedValueOnce([
          {
            name: 'sitePageTool',
            description: 'Translate the page content in place.',
          },
        ])
        .mockRejectedValueOnce(new Error('list failed')),
      executeTool,
    };

    const {
      maybeTranslatePageWithSiteTool,
      maybeTranslateSelectionWithSiteTool,
    } = await import('./webmcp');

    await expect(
      maybeTranslateSelectionWithSiteTool({
        sourceLang: 'en',
        targetLang: 'fr',
        strategy: 'quality',
        text: 'Hello world',
      })
    ).resolves.toBeNull();

    await expect(
      maybeTranslatePageWithSiteTool({
        sourceLang: 'auto',
        targetLang: 'fi',
        strategy: 'smart',
      })
    ).resolves.toBeNull();

    await expect(
      maybeTranslatePageWithSiteTool({
        sourceLang: 'auto',
        targetLang: 'fi',
        strategy: 'smart',
      })
    ).resolves.toBeNull();
  });

  it('returns null when a site selection tool throws before producing a result', async () => {
    (navigator as Navigator & { modelContextTesting?: unknown }).modelContextTesting = {
      listTools: vi.fn().mockResolvedValue([
        {
          name: 'siteSelectionTool',
          description: 'Translate the current selection inline.',
        },
      ]),
      executeTool: vi.fn().mockRejectedValue(new Error('selection tool crashed')),
    };

    const { maybeTranslateSelectionWithSiteTool } = await import('./webmcp');

    await expect(
      maybeTranslateSelectionWithSiteTool({
        sourceLang: 'en',
        targetLang: 'fr',
        strategy: 'quality',
        text: 'Hello world',
      })
    ).resolves.toBeNull();
  });
});

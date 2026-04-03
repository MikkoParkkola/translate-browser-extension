import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoggerModuleMock } from '../test-helpers/module-mocks';

vi.mock('../core/logger', () => createLoggerModuleMock());

describe('content WebMCP helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (navigator as Navigator & { modelContext?: unknown }).modelContext;
    delete (navigator as Navigator & { modelContextTesting?: unknown }).modelContextTesting;
  });

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

    const selectionTool = registerTool.mock.calls.find(
      ([tool]) => tool.name === 'translate_selection'
    )?.[0];
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

    const pageTool = registerTool.mock.calls.find(([tool]) => tool.name === 'translate_page')?.[0];
    await pageTool.execute({ targetLang: 'fi' });
    expect(translatePage).toHaveBeenCalledWith({
      targetLang: 'fi',
      sourceLang: 'auto',
      strategy: 'smart',
      provider: undefined,
      agentInvoked: true,
    });

    const languageTool = registerTool.mock.calls.find(
      ([tool]) => tool.name === 'detect_language'
    )?.[0];
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
});

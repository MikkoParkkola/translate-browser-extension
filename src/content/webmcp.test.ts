import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { CurrentSettings } from './content-types';
import { registerWebMcpTools } from './webmcp';

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
});

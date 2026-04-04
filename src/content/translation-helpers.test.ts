import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  detectLanguage: vi.fn(),
  samplePageText: vi.fn(),
  sanitizeText: vi.fn((text: string) => text),
  applyGlossaryBatch: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock('../core/browser-api', () => ({
  browserAPI: {
    runtime: {
      connect: mocks.connect,
    },
  },
}));

vi.mock('../core/language-detector', () => ({
  detectLanguage: mocks.detectLanguage,
  samplePageText: mocks.samplePageText,
}));

vi.mock('./dom-utils', () => ({
  sanitizeText: mocks.sanitizeText,
}));

vi.mock('../core/glossary', () => ({
  glossary: {
    applyGlossaryBatch: mocks.applyGlossaryBatch,
  },
}));

vi.mock('../core/logger', () => ({
  createLogger: () => ({
    info: mocks.logInfo,
  }),
}));

import {
  createBatches,
  detectSampledLanguage,
  resolveSourceLang,
  translateWithStreaming,
} from './translation-helpers';

function createStreamingPort() {
  let messageListener:
    | ((message: { type: string; partial?: string; result?: string; error?: string }) => void)
    | undefined;
  let disconnectListener: (() => void) | undefined;

  return {
    port: {
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: {
        addListener: vi.fn((listener) => {
          messageListener = listener;
        }),
      },
      onDisconnect: {
        addListener: vi.fn((listener) => {
          disconnectListener = listener;
        }),
      },
    },
    emitMessage(message: { type: string; partial?: string; result?: string; error?: string }) {
      messageListener?.(message);
    },
    emitDisconnect() {
      disconnectListener?.();
    },
  };
}

describe('translation helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sanitizeText.mockImplementation((text: string) => text);
    mocks.samplePageText.mockReturnValue('');
    mocks.detectLanguage.mockReturnValue(null);
    mocks.applyGlossaryBatch.mockImplementation(async (texts: string[]) => ({
      processedTexts: texts,
      restoreFns: texts.map(() => (text: string) => text),
    }));
  });

  it('detects provided text and falls back to sampled page text', () => {
    mocks.sanitizeText.mockReturnValueOnce('bonjour').mockReturnValueOnce('');
    mocks.detectLanguage.mockReturnValueOnce({ lang: 'fr', confidence: 0.92 });

    expect(detectSampledLanguage('ignored input')).toEqual({
      lang: 'fr',
      confidence: 0.92,
    });
    expect(mocks.samplePageText).not.toHaveBeenCalled();

    expect(detectSampledLanguage()).toBeNull();
    expect(mocks.samplePageText).toHaveBeenCalledWith(300);
  });

  it('resolves detected auto languages only when confidence is high enough', () => {
    expect(resolveSourceLang('fi', 'Hei maailma')).toBe('fi');

    mocks.sanitizeText.mockReturnValue('bonjour le monde');
    mocks.detectLanguage.mockReturnValueOnce({ lang: 'fr', confidence: 0.82 });
    expect(resolveSourceLang('auto', 'bonjour le monde')).toBe('fr');
    expect(mocks.logInfo).toHaveBeenCalledWith('Detected language: fr (confidence: 0.82)');

    mocks.detectLanguage.mockReturnValueOnce({ lang: 'de', confidence: 0.19 });
    expect(resolveSourceLang('auto', 'guten tag')).toBe('auto');
  });

  it('rejects immediately when a streaming port cannot be opened', async () => {
    mocks.connect.mockImplementation(() => {
      throw new Error('connect failed');
    });

    await expect(
      translateWithStreaming('Hello', 'en', 'fi', undefined, vi.fn())
    ).rejects.toThrow('Port connection failed');
  });

  it('streams partial results and resolves with the final translation', async () => {
    const stream = createStreamingPort();
    const onChunk = vi.fn();
    mocks.connect.mockReturnValue(stream.port);

    const pending = translateWithStreaming('Hello world', 'en', 'fi', 'deepl', onChunk);

    expect(stream.port.postMessage).toHaveBeenCalledWith({
      type: 'startStream',
      text: 'Hello world',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'deepl',
    });

    stream.emitMessage({ type: 'chunk', partial: 'Hei' });
    stream.emitMessage({ type: 'done', result: 'Hei maailma' });

    await expect(pending).resolves.toBe('Hei maailma');
    expect(onChunk).toHaveBeenCalledWith('Hei');
    expect(stream.port.disconnect).toHaveBeenCalledTimes(1);
  });

  it('rejects when the streaming layer reports an error or disconnects', async () => {
    const errorStream = createStreamingPort();
    mocks.connect.mockReturnValueOnce(errorStream.port);

    const errorPending = translateWithStreaming('Hello', 'en', 'fi', undefined, vi.fn());
    errorStream.emitMessage({ type: 'error', error: 'Streaming translation failed upstream' });
    await expect(errorPending).rejects.toThrow('Streaming translation failed upstream');

    const disconnectedStream = createStreamingPort();
    mocks.connect.mockReturnValueOnce(disconnectedStream.port);

    const disconnectPending = translateWithStreaming('Hello', 'en', 'fi', undefined, vi.fn());
    disconnectedStream.emitDisconnect();
    await expect(disconnectPending).rejects.toThrow('Port disconnected');
  });

  it('ignores empty chunks, defaults missing done results, and uses the fallback error text', async () => {
    const doneStream = createStreamingPort();
    const onChunk = vi.fn();
    mocks.connect.mockReturnValueOnce(doneStream.port);

    const donePending = translateWithStreaming('Hello', 'en', 'fi', undefined, onChunk);
    doneStream.emitMessage({ type: 'chunk' });
    doneStream.emitMessage({ type: 'done' });

    await expect(donePending).resolves.toBe('');
    expect(onChunk).not.toHaveBeenCalled();

    const errorStream = createStreamingPort();
    mocks.connect.mockReturnValueOnce(errorStream.port);

    const errorPending = translateWithStreaming('Hello', 'en', 'fi', undefined, vi.fn());
    errorStream.emitMessage({ type: 'error' });
    await expect(errorPending).rejects.toThrow('Streaming translation failed');
  });

  it('creates batched glossary payloads with sanitization and truncation', async () => {
    const nodes = Array.from({ length: 51 }, (_, index) =>
      document.createTextNode(index === 0 ? `  ${'x'.repeat(6000)}  ` : `Node ${index}`)
    );
    mocks.sanitizeText.mockImplementation((text: string) => text.trim());
    mocks.applyGlossaryBatch.mockImplementation(async (texts: string[]) => ({
      processedTexts: texts.map((text) => `[processed] ${text}`),
      restoreFns: texts.map((text) => (translated: string) => `${translated} :: ${text.length}`),
    }));

    const batches = await createBatches(nodes, { hello: { replacement: 'bonjour', caseSensitive: false } });

    expect(batches).toHaveLength(2);
    expect(batches[0]?.nodes).toHaveLength(50);
    expect(batches[1]?.nodes).toHaveLength(1);
    expect(mocks.applyGlossaryBatch).toHaveBeenCalledTimes(2);
    expect(mocks.applyGlossaryBatch.mock.calls[0]?.[0][0]).toHaveLength(5000);
    expect(batches[0]?.texts[0]).toBe(`[processed] ${'x'.repeat(5000)}`);
    expect(batches[0]?.restoreFns[0]?.('translated')).toBe('translated :: 5000');
  });
});

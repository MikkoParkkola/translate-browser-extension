import { extractErrorMessage } from '../../core/errors';
import type { TranslateResponse, TranslationProviderId } from '../../types';

export interface StreamPortHandlerLogger {
  debug: (message: string, ...args: unknown[]) => void;
}

export interface StreamPortMessage {
  type: string;
  text?: string;
  sourceLang?: string;
  targetLang?: string;
  provider?: string;
}

export interface StreamTranslationRequest {
  text: string | string[];
  sourceLang: string;
  targetLang: string;
  provider?: TranslationProviderId;
}

export interface CreateStreamPortHandlerOptions {
  getProvider: () => TranslationProviderId;
  handleTranslate: (message: StreamTranslationRequest) => Promise<TranslateResponse>;
  acquireKeepAlive: () => void;
  releaseKeepAlive: () => void;
  splitIntoSentences: (text: string) => string[];
  log: StreamPortHandlerLogger;
}

type StreamPort = Pick<chrome.runtime.Port, 'name' | 'postMessage' | 'onMessage' | 'onDisconnect'>;

function normalizeStreamResult(result: string | string[]): string {
  if (typeof result === 'string') {
    return result;
  }

  if (result.length !== 1) {
    throw new Error(
      `Stream translation returned ${result.length} result(s) for 1 input text(s)`
    );
  }

  return result[0] ?? '';
}

export function createStreamPortSender(port: StreamPort, log: StreamPortHandlerLogger) {
  let closed = false;
  port.onDisconnect.addListener(() => {
    closed = true;
  });

  return (message: Record<string, unknown>): boolean => {
    if (closed) return false;

    try {
      port.postMessage(message);
      return true;
    } catch (error) {
      closed = true;
      log.debug('Stream port closed before message delivery:', error);
      return false;
    }
  };
}

export function createStreamPortHandler({
  getProvider,
  handleTranslate,
  acquireKeepAlive,
  releaseKeepAlive,
  splitIntoSentences,
  log,
}: CreateStreamPortHandlerOptions) {
  return (port: StreamPort): void => {
    if (port.name !== 'translate-stream') {
      return;
    }

    const postToStream = createStreamPortSender(port, log);

    port.onMessage.addListener(async (msg: StreamPortMessage) => {
      if (msg.type !== 'startStream') {
        return;
      }

      const { text, sourceLang, targetLang, provider: requestedProvider } = msg;

      if (!text || !sourceLang || !targetLang) {
        postToStream({ type: 'error', error: 'Missing required fields' });
        return;
      }

      const provider = (requestedProvider || getProvider()) as TranslationProviderId;
      acquireKeepAlive();

      try {
        if (provider === 'chrome-builtin') {
          const sentences = splitIntoSentences(text);
          const accumulated: string[] = [];

          for (const sentence of sentences) {
            if (!sentence.trim()) {
              accumulated.push(sentence);
              continue;
            }

            const response = await handleTranslate({
              text: sentence,
              sourceLang,
              targetLang,
              provider: 'chrome-builtin',
            });

            if (response.success && response.result !== undefined) {
              accumulated.push(normalizeStreamResult(response.result));
              if (!postToStream({ type: 'chunk', partial: accumulated.join(' ') })) {
                return;
              }
            } else {
              throw new Error(response.error || 'Translation failed');
            }
          }

          postToStream({ type: 'done', result: accumulated.join(' ') });
          return;
        }

        const response = await handleTranslate({ text, sourceLang, targetLang, provider });
        if (response.success && response.result !== undefined) {
          const translated = normalizeStreamResult(response.result);

          if (!postToStream({ type: 'chunk', partial: translated })) {
            return;
          }
          postToStream({ type: 'done', result: translated });
        } else {
          throw new Error(response.error || 'Translation failed');
        }
      } catch (error) {
        postToStream({ type: 'error', error: extractErrorMessage(error) });
      } finally {
        releaseKeepAlive();
      }
    });
  };
}

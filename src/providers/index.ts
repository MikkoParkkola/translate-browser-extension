/**
 * Provider exports
 */

export { BaseProvider } from './base-provider';
export { OpusMTProvider, opusMTProvider } from './opus-mt-local';

// Chrome Built-in Translator (Chrome 138+)
export {
  ChromeTranslatorProvider,
  getChromeTranslator,
  isChromeTranslatorAvailable,
} from './chrome-translator';

// Cloud providers
export { DeepLProvider, deeplProvider } from './deepl';
export { OpenAIProvider, openaiProvider } from './openai';
export { GoogleCloudProvider, googleCloudProvider } from './google-cloud';
export { AnthropicProvider, anthropicProvider } from './anthropic';

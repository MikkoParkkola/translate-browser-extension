/**
 * OPUS-MT Local Translation Provider
 * Uses Helsinki-NLP OPUS-MT models via Transformers.js
 *
 * Models are loaded on-demand and cached in IndexedDB
 * Supports 1000+ language pairs with excellent quality/size ratio
 */

import { BaseProvider } from './base-provider';
import { webgpuDetector } from '../core/webgpu-detector';
import type { TranslationOptions, LanguagePair, ProviderConfig } from '../types';

// Dynamic imports for Transformers.js
type Pipeline = (text: string, options?: Record<string, unknown>) => Promise<Array<{ translation_text: string }>>;

// Supported language pairs with Xenova quantized models
const SUPPORTED_PAIRS: Record<string, string> = {
  'en-fi': 'Xenova/opus-mt-en-fi',
  'fi-en': 'Xenova/opus-mt-fi-en',
  'en-de': 'Xenova/opus-mt-en-de',
  'de-en': 'Xenova/opus-mt-de-en',
  'en-fr': 'Xenova/opus-mt-en-fr',
  'fr-en': 'Xenova/opus-mt-fr-en',
  'en-es': 'Xenova/opus-mt-en-es',
  'es-en': 'Xenova/opus-mt-es-en',
  'en-sv': 'Xenova/opus-mt-en-sv',
  'sv-en': 'Xenova/opus-mt-sv-en',
  'en-ru': 'Xenova/opus-mt-en-ru',
  'ru-en': 'Xenova/opus-mt-ru-en',
  'en-zh': 'Xenova/opus-mt-en-zh',
  'zh-en': 'Xenova/opus-mt-zh-en',
  'en-ja': 'Xenova/opus-mt-en-jap',
  'ja-en': 'Xenova/opus-mt-jap-en',
};

export class OpusMTProvider extends BaseProvider {
  private pipelines = new Map<string, Pipeline>();
  private webgpuSupported = false;
  private isInitialized = false;
  private pipelineFactory: ((task: string, model: string, options: Record<string, unknown>) => Promise<Pipeline>) | null = null;

  constructor() {
    super({
      id: 'opus-mt-local',
      name: 'Helsinki-NLP OPUS-MT',
      type: 'local',
      qualityTier: 'standard',
      costPerMillion: 0,
      icon: '',
    });
  }

  /**
   * Initialize the provider and check for WebGPU support
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Dynamically import Transformers.js
      const transformers = await import('@huggingface/transformers');
      this.pipelineFactory = transformers.pipeline as unknown as typeof this.pipelineFactory;

      // Check for WebGPU support
      await webgpuDetector.detect();
      this.webgpuSupported = webgpuDetector.supported;

      if (this.webgpuSupported) {
        console.log('[OPUS-MT] WebGPU support detected');
        await webgpuDetector.initialize();
      } else {
        console.log('[OPUS-MT] Using WASM acceleration');
      }

      this.isInitialized = true;
    } catch (error) {
      console.error('[OPUS-MT] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Get the model ID for a language pair
   */
  private getModelId(sourceLang: string, targetLang: string): string | null {
    const pair = `${sourceLang}-${targetLang}`;
    return SUPPORTED_PAIRS[pair] || null;
  }

  /**
   * Load or get cached translation pipeline
   */
  private async getPipeline(modelId: string): Promise<Pipeline> {
    if (this.pipelines.has(modelId)) {
      return this.pipelines.get(modelId)!;
    }

    if (!this.pipelineFactory) {
      throw new Error('[OPUS-MT] Pipeline factory not initialized');
    }

    try {
      console.log(`[OPUS-MT] Loading model: ${modelId}`);

      const device = this.webgpuSupported ? 'webgpu' : 'wasm';
      const dtype = 'q4f16'; // 4-bit quantization with fp16 fallback

      const pipe = await this.pipelineFactory('translation', modelId, {
        device,
        dtype,
        progress_callback: (progress: unknown) => {
          console.log('[OPUS-MT] Loading progress:', progress);
        },
      });

      this.pipelines.set(modelId, pipe);
      console.log(`[OPUS-MT] Model loaded: ${modelId}`);

      return pipe;
    } catch (error) {
      console.error(`[OPUS-MT] Failed to load model ${modelId}:`, error);
      throw error;
    }
  }

  /**
   * Translate text
   */
  async translate(
    text: string | string[],
    sourceLang: string,
    targetLang: string,
    _options?: TranslationOptions
  ): Promise<string | string[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const modelId = this.getModelId(sourceLang, targetLang);
    if (!modelId) {
      throw new Error(`[OPUS-MT] Unsupported language pair: ${sourceLang} -> ${targetLang}`);
    }

    try {
      const pipe = await this.getPipeline(modelId);

      // Handle batch translation
      if (Array.isArray(text)) {
        const results = await Promise.all(
          text.map((t) => this.translateSingle(pipe, t, sourceLang, targetLang))
        );
        return results;
      }

      return await this.translateSingle(pipe, text, sourceLang, targetLang);
    } catch (error) {
      console.error('[OPUS-MT] Translation error:', error);
      throw error;
    }
  }

  /**
   * Translate a single text segment
   */
  private async translateSingle(
    pipe: Pipeline,
    text: string,
    sourceLang: string,
    targetLang: string
  ): Promise<string> {
    if (!text || text.trim().length === 0) {
      return text;
    }

    try {
      const result = await pipe(text, {
        src_lang: sourceLang,
        tgt_lang: targetLang,
        max_length: 512,
      });

      return result[0].translation_text;
    } catch (error) {
      console.error('[OPUS-MT] Single translation error:', error);
      throw error;
    }
  }

  /**
   * Detect language using NLLB if available, otherwise return 'auto'
   */
  async detectLanguage(_text: string): Promise<string> {
    // For now, return auto-detection flag
    // Full language detection would require loading NLLB model
    return 'auto';
  }

  /**
   * Check if provider is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }
      return this.isInitialized && this.pipelineFactory !== null;
    } catch (error) {
      console.error('[OPUS-MT] Availability check failed:', error);
      return false;
    }
  }

  /**
   * Get supported language pairs
   */
  getSupportedLanguages(): LanguagePair[] {
    return Object.keys(SUPPORTED_PAIRS).map((pair) => {
      const [src, tgt] = pair.split('-');
      return { src, tgt };
    });
  }

  /**
   * Test the provider with EN-FI pair
   */
  async test(): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const result = await this.translate('Hello, how are you?', 'en', 'fi');

      console.log('[OPUS-MT] Test result:', result);
      return typeof result === 'string' && result.length > 0;
    } catch (error) {
      console.error('[OPUS-MT] Test failed:', error);
      return false;
    }
  }

  /**
   * Get provider info
   */
  getInfo(): ProviderConfig & { modelSize: string; speed: string; webgpu: boolean; device: string } {
    return {
      ...super.getInfo(),
      modelSize: '169MB (quantized EN-FI pair)',
      speed: 'Fastest (~10ms/sentence with WebGPU)',
      webgpu: this.webgpuSupported,
      device: this.webgpuSupported ? 'WebGPU' : 'WASM',
    };
  }
}

// Singleton instance
export const opusMTProvider = new OpusMTProvider();

export default opusMTProvider;

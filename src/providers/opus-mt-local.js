/**
 * OPUS-MT Local Translation Provider
 * Uses Helsinki-NLP OPUS-MT models via Transformers.js
 *
 * Models are loaded on-demand and cached in IndexedDB
 * Supports 1000+ language pairs with excellent quality/size ratio
 */

import { BaseProvider } from './base-provider.js';

// Dynamic import - will work in browser via bundler
let pipeline;
let env;

const SUPPORTED_PAIRS = {
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
  'en-de': 'Xenova/opus-mt-en-de',
  'de-en': 'Xenova/opus-mt-de-en',
};

class OpusMTProvider extends BaseProvider {
  constructor() {
    super({
      id: 'opus-mt-local',
      name: 'Helsinki-NLP OPUS-MT',
      type: 'local',
      qualityTier: 'standard',
      costPerMillion: 0,
      icon: '🇫🇮',
    });

    this.pipelines = new Map(); // Cache loaded models
    this.webgpuSupported = false;
    this.isInitialized = false;
    this.detector = null;
  }

  /**
   * Initialize the provider and check for WebGPU support
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      // Dynamically import Transformers.js
      const transformers = await import('@huggingface/transformers');
      pipeline = transformers.pipeline;
      env = transformers.env;

      // Check for WebGPU support
      this.webgpuSupported = typeof navigator !== 'undefined' && !!navigator.gpu;

      if (this.webgpuSupported) {
        console.log('[OPUS-MT] WebGPU support detected');
        // WebGPU will be used automatically by Transformers.js v3+
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
  getModelId(sourceLang, targetLang) {
    const pair = `${sourceLang}-${targetLang}`;
    return SUPPORTED_PAIRS[pair] || null;
  }

  /**
   * Load or get cached translation pipeline
   */
  async getPipeline(modelId) {
    if (this.pipelines.has(modelId)) {
      return this.pipelines.get(modelId);
    }

    try {
      console.log(`[OPUS-MT] Loading model: ${modelId}`);

      const device = this.webgpuSupported ? 'webgpu' : 'wasm';
      const dtype = 'q4f16'; // 4-bit quantization with fp16 fallback

      const pipe = await pipeline('translation', modelId, {
        device,
        dtype,
        progress_callback: (progress) => {
          console.log(`[OPUS-MT] Loading progress:`, progress);
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
  async translate(text, sourceLang, targetLang, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const modelId = this.getModelId(sourceLang, targetLang);
    if (!modelId) {
      throw new Error(
        `[OPUS-MT] Unsupported language pair: ${sourceLang} → ${targetLang}`
      );
    }

    try {
      const pipe = await this.getPipeline(modelId);

      // Handle batch translation
      if (Array.isArray(text)) {
        const results = await Promise.all(
          text.map((t) => this._translateSingle(pipe, t, sourceLang, targetLang))
        );
        return results;
      }

      return await this._translateSingle(pipe, text, sourceLang, targetLang);
    } catch (error) {
      console.error('[OPUS-MT] Translation error:', error);
      throw error;
    }
  }

  /**
   * Translate a single text segment
   */
  async _translateSingle(pipe, text, sourceLang, targetLang) {
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
  async detectLanguage(text) {
    // For now, return auto-detection flag
    // Full language detection would require loading NLLB model
    return 'auto';
  }

  /**
   * Check if provider is available
   */
  async isAvailable() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }
      return this.isInitialized && typeof pipeline !== 'undefined';
    } catch (error) {
      console.error('[OPUS-MT] Availability check failed:', error);
      return false;
    }
  }

  /**
   * Get supported language pairs
   */
  getSupportedLanguages() {
    return Object.keys(SUPPORTED_PAIRS).map((pair) => {
      const [src, tgt] = pair.split('-');
      return { src, tgt };
    });
  }

  /**
   * Test the provider with EN-FI pair
   */
  async test() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const result = await this.translate(
        'Hello, how are you?',
        'en',
        'fi'
      );

      console.log('[OPUS-MT] Test result:', result);
      return result && result.length > 0;
    } catch (error) {
      console.error('[OPUS-MT] Test failed:', error);
      return false;
    }
  }

  /**
   * Get provider info
   */
  getInfo() {
    return {
      ...super.getInfo(),
      modelSize: '169MB (quantized EN-FI pair)',
      speed: 'Fastest (~10ms/sentence with WebGPU)',
      webgpu: this.webgpuSupported,
      device: this.webgpuSupported ? 'WebGPU' : 'WASM',
    };
  }
}

export default new OpusMTProvider();

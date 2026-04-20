/**
 * OPUS-MT Local Translation Provider
 * Uses Helsinki-NLP OPUS-MT models via Transformers.js
 *
 * Models are loaded on-demand and cached in IndexedDB
 * Supports 1000+ language pairs with excellent quality/size ratio
 */

import { BaseProvider } from './base-provider';
import { webgpuDetector } from '../core/webgpu-detector';
import { createLogger } from '../core/logger';
import { extractErrorMessage } from '../core/errors';
import type { TranslationOptions, LanguagePair, ProviderConfig } from '../types';
import {
  getModelId,
  getSupportedLanguagePairs,
  getSupportedTargetsForSource,
  resolveOpusMtTranslationRoute,
} from '../offscreen/model-maps';

const log = createLogger('OPUS-MT');

// Dynamic imports for Transformers.js
type Pipeline = (text: string, options?: Record<string, unknown>) => Promise<Array<{ translation_text: string }>>;

export class OpusMTProvider extends BaseProvider {
  private pipelines = new Map<string, Pipeline>();
  private webgpuSupported = false;
  private isInitialized = false;
  private pipelineFactory: ((task: string, model: string, options: Record<string, unknown>) => Promise<Pipeline>) | null = null;

  constructor() {
    super({
      id: 'opus-mt',
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
      const pipelineFactory = transformers.pipeline as (
        task: string, 
        model: string, 
        options: Record<string, unknown>
      ) => Promise<Pipeline>;
      this.pipelineFactory = pipelineFactory;

      // Check for WebGPU support
      await webgpuDetector.detect();
      this.webgpuSupported = webgpuDetector.supported;

      if (this.webgpuSupported) {
        log.info('WebGPU support detected');
        await webgpuDetector.initialize();
      } else {
        log.info('Using WASM acceleration');
      }

      this.isInitialized = true;
    } catch (error) {
      log.error('Initialization failed:', error);
      throw error;
    }
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

    log.info(`Loading model: ${modelId}`);

    // Build fallback chain: most optimal first, safest last
    // OPUS-MT Xenova models reliably ship q8 (quantized) variants.
    // fp16 variants may not exist or cause mixed-precision ONNX errors,
    // so we always prefer q8 even when shader-f16 is available.
    const attempts: Array<{ device: 'webgpu' | 'wasm'; dtype: string; label: string }> = [];

    if (this.webgpuSupported) {
      attempts.push({ device: 'webgpu', dtype: 'q8', label: 'WebGPU+q8' });
    }
    // WASM fallback always available
    attempts.push({ device: 'wasm', dtype: 'q8', label: 'WASM+q8' });

    let lastError: Error | null = null;

    for (const attempt of attempts) {
      try {
        log.info(`Trying ${attempt.label} for ${modelId}`);
        const pipe = await this.pipelineFactory('translation', modelId, {
          device: attempt.device,
          dtype: attempt.dtype,
          progress_callback: (progress: { status: string; progress?: number; file?: string }) => {
            log.info('Loading progress:', progress);
          },
        });

        this.pipelines.set(modelId, pipe);
        log.info(`Model loaded: ${modelId} (${attempt.label})`);
        return pipe;
      } catch (error) {
        const errMsg = extractErrorMessage(error);
        log.warn(`${attempt.label} failed: ${errMsg}`);
        lastError = error instanceof Error ? error : new Error(errMsg);
      }
    }

    log.error(`All attempts failed for ${modelId}`);
    /* v8 ignore start */
    throw lastError ?? new Error(`Failed to load model ${modelId}`);
    /* v8 ignore stop */
  }

  /**
   * Translate text with a single OPUS-MT model.
   */
  private async translateWithModel(
    text: string | string[],
    modelId: string
  ): Promise<string | string[]> {
    const pipe = await this.getPipeline(modelId);

    if (Array.isArray(text)) {
      return Promise.all(text.map((value) => this.translateSingle(pipe, value)));
    }

    return this.translateSingle(pipe, text);
  }

  /**
   * Translate text through a pivot route using two direct models.
   */
  private async translateWithPivotRoute(
    text: string | string[],
    firstHop: string,
    secondHop: string
  ): Promise<string | string[]> {
    const [firstSrc, firstTgt] = firstHop.split('-');
    const [secondSrc, secondTgt] = secondHop.split('-');
    const firstModelId = getModelId(firstSrc, firstTgt);
    const secondModelId = getModelId(secondSrc, secondTgt);

    if (!firstModelId || !secondModelId) {
      throw new Error(`Invalid OPUS-MT pivot route: ${firstHop} -> ${secondHop}`);
    }

    const intermediate = await this.translateWithModel(text, firstModelId);
    return this.translateWithModel(intermediate, secondModelId);
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

    const route = resolveOpusMtTranslationRoute(sourceLang, targetLang);
    if (!route) {
      const availableTargets = getSupportedTargetsForSource(sourceLang).join(', ');
      const hint = availableTargets
        ? `Available targets for ${sourceLang}: ${availableTargets}`
        : `${sourceLang} is not a supported source language`;

      throw new Error(`Unsupported language pair: ${sourceLang} -> ${targetLang}. ${hint}`);
    }

    try {
      if (route.kind === 'direct') {
        return await this.translateWithModel(text, route.modelId);
      }

      const [firstHop, secondHop] = route.route;
      const [, pivotTarget] = firstHop.split('-');
      log.info(`Pivot translation: ${sourceLang} -> ${pivotTarget} -> ${targetLang}`);
      return await this.translateWithPivotRoute(text, firstHop, secondHop);
    } catch (error) {
      log.error('Translation error:', error);
      throw error;
    }
  }

  /**
   * Translate a single text segment
   */
  private async translateSingle(
    pipe: Pipeline,
    text: string
  ): Promise<string> {
    if (!text || text.trim().length === 0) {
      return text;
    }

    try {
      const result = await pipe(text, { max_length: 512 });

      return result[0].translation_text;
    } catch (error) {
      log.error('Single translation error:', error);
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
      log.error('Availability check failed:', error);
      return false;
    }
  }

  /**
   * Get supported language pairs
   */
  getSupportedLanguages(): LanguagePair[] {
    return getSupportedLanguagePairs().map(({ src, tgt }) => ({ src, tgt }));
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

      log.info('Test result:', result);
      return typeof result === 'string' && result.length > 0;
    } catch (error) {
      log.error('Test failed:', error);
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

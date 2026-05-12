import type { PreloadModelResponsePayload } from '../types';
import { resolveOpusMtTranslationRoute } from './model-maps';

export interface OpusMtRuntimeCapabilities {
  supported: boolean;
  fp16: boolean;
}

export interface OpusMtPipelineConfig {
  device: 'wasm' | 'webgpu';
  dtype: 'q8';
  label: string;
}

export interface OpusMtPipelineOptions {
  webgpuProbe?: boolean;
}

/**
 * OPUS-MT Marian checkpoints only ship q8 ONNX assets. Running them through
 * WebGPU has caused degenerate repeated-token output with OPUS-MT Marian
 * checkpoints, so production stays pinned to wasm/q8. The optional probe path
 * is only for measuring whether the v4 runtime is stable enough to revisit.
 */
export function selectOpusMtDtype(_capabilities: OpusMtRuntimeCapabilities): 'q8' {
  return 'q8';
}

export function getOpusMtPipelineConfig(
  capabilities: OpusMtRuntimeCapabilities,
  options: OpusMtPipelineOptions = {}
): OpusMtPipelineConfig {
  return getOpusMtPipelineAttempts(capabilities, options)[0];
}

export function getOpusMtPipelineAttempts(
  capabilities: OpusMtRuntimeCapabilities,
  options: OpusMtPipelineOptions = {}
): OpusMtPipelineConfig[] {
  const attempts: OpusMtPipelineConfig[] = [];

  if (options.webgpuProbe === true && capabilities.supported) {
    attempts.push({
      device: 'webgpu',
      dtype: selectOpusMtDtype(capabilities),
      label: 'WebGPU+q8 probe',
    });
  }

  attempts.push({
    device: 'wasm',
    dtype: selectOpusMtDtype(capabilities),
    label: 'WASM+q8',
  });

  return attempts;
}

export function getDefaultOpusMtPipelineConfig(): OpusMtPipelineConfig {
  return {
    device: 'wasm',
    dtype: 'q8',
    label: 'WASM+q8',
  };
}

export async function preloadOpusMtModel(
  sourceLang: string,
  targetLang: string,
  loadPipeline: (sourceLang: string, targetLang: string) => Promise<unknown>
): Promise<PreloadModelResponsePayload> {
  const route = resolveOpusMtTranslationRoute(sourceLang, targetLang);

  if (route?.kind === 'direct') {
    await loadPipeline(sourceLang, targetLang);
    return { preloaded: true, available: true };
  }

  if (route?.kind === 'pivot') {
    const [firstHop] = route.route;
    const [firstSrc, firstTgt] = firstHop.split('-');
    await loadPipeline(firstSrc, firstTgt);
    return { preloaded: true, partial: true, available: true };
  }

  return { preloaded: false, available: false };
}

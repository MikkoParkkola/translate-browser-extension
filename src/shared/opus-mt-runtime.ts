export interface OpusMtWebGpuCapabilities {
  supported: boolean;
  fp16: boolean;
}

export interface OpusMtExecutionConfig {
  device: 'webgpu' | 'wasm';
  dtype: 'q8' | 'fp32';
  reason:
    | 'experimental-webgpu-probe'
    | 'safe-default-wasm'
    | 'webgpu-fallback-wasm-q8'
    | 'wasm-fp32-diagnostic-fallback';
}

/**
 * OPUS-MT Marian models in this extension use q8 ONNX artifacts.
 * They do not ship dedicated fp16 checkpoints, so we keep dtype fixed.
 */
export function selectOpusMtDtype(_webgpu: OpusMtWebGpuCapabilities): 'q8' {
  return 'q8';
}

export function resolveOpusMtExecutionConfig(
  webgpu: OpusMtWebGpuCapabilities,
  webgpuProbeEnabled: boolean
): OpusMtExecutionConfig {
  if (webgpuProbeEnabled && webgpu.supported) {
    return {
      device: 'webgpu',
      dtype: selectOpusMtDtype(webgpu),
      reason: 'experimental-webgpu-probe',
    };
  }

  return {
    device: 'wasm',
    dtype: selectOpusMtDtype(webgpu),
    reason: 'safe-default-wasm',
  };
}

export function buildOpusMtExecutionPlan(
  webgpu: OpusMtWebGpuCapabilities,
  webgpuProbeEnabled: boolean
): OpusMtExecutionConfig[] {
  const primary = resolveOpusMtExecutionConfig(webgpu, webgpuProbeEnabled);
  const attempts: OpusMtExecutionConfig[] = [primary];

  if (primary.device === 'webgpu') {
    attempts.push({
      device: 'wasm',
      dtype: 'q8',
      reason: 'webgpu-fallback-wasm-q8',
    });
  }

  attempts.push({
    device: 'wasm',
    dtype: 'fp32',
    reason: 'wasm-fp32-diagnostic-fallback',
  });

  return attempts;
}

export function describeOpusMtExecutionConfig(config: OpusMtExecutionConfig): string {
  switch (config.reason) {
    case 'experimental-webgpu-probe':
      return 'WebGPU+q8 (probe)';
    case 'safe-default-wasm':
      return 'WASM+q8';
    case 'webgpu-fallback-wasm-q8':
      return 'WASM+q8 fallback';
    case 'wasm-fp32-diagnostic-fallback':
      return 'WASM+fp32 diagnostic fallback';
  }
}

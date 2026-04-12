export interface OpusMtWebGpuCapabilities {
  supported: boolean;
  fp16: boolean;
}

export interface OpusMtExecutionConfig {
  device: 'webgpu' | 'wasm';
  dtype: 'q8';
  reason: 'experimental-webgpu-probe' | 'safe-default-wasm';
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

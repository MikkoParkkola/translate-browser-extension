export interface OpusMtRuntimeCapabilities {
  supported: boolean;
  fp16: boolean;
}

export interface OpusMtPipelineConfig {
  device: 'wasm';
  dtype: 'q8';
}

/**
 * OPUS-MT Marian checkpoints only ship q8 ONNX assets. Running them through
 * WebGPU currently causes degenerate repeated-token output, so keep the
 * runtime pinned to wasm/q8 until a browser-safe GPU path is proven.
 */
export function selectOpusMtDtype(_capabilities: OpusMtRuntimeCapabilities): 'q8' {
  return 'q8';
}

export function getOpusMtPipelineConfig(
  capabilities: OpusMtRuntimeCapabilities
): OpusMtPipelineConfig {
  return {
    device: 'wasm',
    dtype: selectOpusMtDtype(capabilities),
  };
}

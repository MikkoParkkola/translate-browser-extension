// Shared Vite configuration between Chrome and Firefox builds
export const sharedManualChunks = (id: string) => {
  // Transformers.js core - shared by all ML providers
  if (id.includes('@huggingface/transformers')) {
    return 'transformers';
  }
  // ONNX Runtime - separate chunk for WASM-based inference
  if (id.includes('onnxruntime')) {
    return 'onnx-runtime';
  }
  // Solid.js - UI framework (popup/options only)
  if (id.includes('solid-js') || id.includes('solid-refresh')) {
    return 'solid';
  }
};

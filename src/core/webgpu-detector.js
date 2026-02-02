/**
 * WebGPU Detection and Setup
 * Automatically detects WebGPU support and configures acceleration
 */

class WebGPUDetector {
  constructor() {
    this.supported = false;
    this.adapter = null;
    this.device = null;
    this.initialized = false;
  }

  /**
   * Detect WebGPU support
   */
  async detect() {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      console.log('[WebGPU] Not supported in this browser');
      return false;
    }

    try {
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
      });

      if (!adapter) {
        console.log('[WebGPU] No GPU adapter available');
        return false;
      }

      this.adapter = adapter;
      this.supported = true;
      console.log('[WebGPU] Detected and supported');

      // Log GPU info
      const info = adapter.requestAdapterInfo?.();
      if (info) {
        console.log('[WebGPU] GPU:', info.device || 'Unknown');
      }

      return true;
    } catch (error) {
      console.log('[WebGPU] Detection error:', error.message);
      return false;
    }
  }

  /**
   * Initialize WebGPU device
   */
  async initialize() {
    if (this.initialized) return this.device;

    if (!this.supported || !this.adapter) {
      return null;
    }

    try {
      this.device = await this.adapter.requestDevice({
        requiredLimits: {
          maxStorageBufferBindingSize: 1024 * 1024 * 1024, // 1GB
          maxBufferSize: 1024 * 1024 * 1024,
        },
      });

      this.initialized = true;
      console.log('[WebGPU] Device initialized');

      // Monitor device loss
      if (this.device.lost) {
        this.device.lost.then(() => {
          console.warn('[WebGPU] Device lost');
          this.initialized = false;
        });
      }

      return this.device;
    } catch (error) {
      console.error('[WebGPU] Initialization failed:', error);
      return null;
    }
  }

  /**
   * Get execution provider for Transformers.js
   * Returns 'webgpu' or 'wasm'
   */
  getExecutionProvider() {
    if (this.supported && this.initialized) {
      return 'webgpu';
    }
    return 'wasm';
  }

  /**
   * Get provider info for logging
   */
  getInfo() {
    return {
      supported: this.supported,
      initialized: this.initialized,
      provider: this.getExecutionProvider(),
      device: this.device ? 'Ready' : 'Not initialized',
    };
  }
}

// Singleton instance
const webgpuDetector = new WebGPUDetector();

// Export for use
if (typeof window !== 'undefined') {
  window.webgpuDetector = webgpuDetector;
}

export default webgpuDetector;
export { WebGPUDetector };

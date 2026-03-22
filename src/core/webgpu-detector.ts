/**
 * WebGPU Detection and Setup
 * Automatically detects WebGPU support and configures acceleration
 */

/// <reference types="@webgpu/types" />

import type { WebGPUInfo } from '../types';
import { createLogger } from './logger';

const log = createLogger('WebGPU');

class WebGPUDetector {
  private _supported = false;
  private _adapter: GPUAdapter | null = null;
  private _device: GPUDevice | null = null;
  private _initialized = false;

  get supported(): boolean {
    return this._supported;
  }

  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Detect WebGPU support
   */
  async detect(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) {
      log.info('Not supported in this browser');
      return false;
    }

    try {
      const gpu = navigator.gpu;
      const adapter = await gpu.requestAdapter({
        powerPreference: 'high-performance',
      });

      if (!adapter) {
        log.info('No GPU adapter available');
        return false;
      }

      this._adapter = adapter;
      this._supported = true;
      log.info('Detected and supported');

      // Log GPU info if available (requestAdapterInfo may not exist in older implementations)
      if ('requestAdapterInfo' in adapter) {
        const info = await (adapter as GPUAdapter & { requestAdapterInfo(): Promise<GPUAdapterInfo> }).requestAdapterInfo();
        /* v8 ignore next -- device name fallback to Unknown */
        log.info('GPU:', info.device || 'Unknown');
      }

      return true;
    } catch (error) {
      log.info('Detection error:', (error as Error).message);
      return false;
    }
  }

  /**
   * Initialize WebGPU device
   */
  async initialize(): Promise<GPUDevice | null> {
    if (this._initialized) return this._device;

    if (!this._supported || !this._adapter) {
      return null;
    }

    try {
      this._device = await this._adapter.requestDevice({
        requiredLimits: {
          maxStorageBufferBindingSize: 1024 * 1024 * 1024, // 1GB
          maxBufferSize: 1024 * 1024 * 1024,
        },
      });

      this._initialized = true;
      log.info('Device initialized');

      // Monitor device loss
      this._device.lost.then(() => {
        log.warn('Device lost');
        this._initialized = false;
      });

      return this._device;
    } catch (error) {
      console.error('[WebGPU] Initialization failed:', error);
      return null;
    }
  }

  /**
   * Get execution provider for Transformers.js
   * Returns 'webgpu' or 'wasm'
   */
  getExecutionProvider(): 'webgpu' | 'wasm' {
    if (this._supported && this._initialized) {
      return 'webgpu';
    }
    return 'wasm';
  }

  /**
   * Get provider info for logging
   */
  getInfo(): WebGPUInfo {
    return {
      supported: this._supported,
      initialized: this._initialized,
      provider: this.getExecutionProvider(),
      device: this._device ? 'Ready' : 'Not initialized',
    };
  }
}

// Singleton instance
export const webgpuDetector = new WebGPUDetector();

export default webgpuDetector;

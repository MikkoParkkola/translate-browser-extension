/**
 * WebGPU Detection and Setup
 * Automatically detects WebGPU support and configures acceleration
 */

import type { WebGPUInfo } from '../types';

// WebGPU types (not fully available in TypeScript yet)
declare global {
  interface Navigator {
    gpu?: GPU;
  }
  interface GPU {
    requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
  }
  interface GPURequestAdapterOptions {
    powerPreference?: 'low-power' | 'high-performance';
  }
  interface GPUAdapter {
    requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
    requestAdapterInfo?(): Promise<GPUAdapterInfo>;
  }
  interface GPUDeviceDescriptor {
    requiredLimits?: Record<string, number>;
  }
  interface GPUAdapterInfo {
    device?: string;
    vendor?: string;
  }
  interface GPUDevice {
    lost: Promise<GPUDeviceLostInfo>;
  }
  interface GPUDeviceLostInfo {
    message: string;
    reason: string;
  }
}

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
      console.log('[WebGPU] Not supported in this browser');
      return false;
    }

    try {
      const gpu = navigator.gpu;
      const adapter = await gpu.requestAdapter({
        powerPreference: 'high-performance',
      });

      if (!adapter) {
        console.log('[WebGPU] No GPU adapter available');
        return false;
      }

      this._adapter = adapter;
      this._supported = true;
      console.log('[WebGPU] Detected and supported');

      // Log GPU info if available
      const info = await adapter.requestAdapterInfo?.();
      if (info) {
        console.log('[WebGPU] GPU:', info.device || 'Unknown');
      }

      return true;
    } catch (error) {
      console.log('[WebGPU] Detection error:', (error as Error).message);
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
      console.log('[WebGPU] Device initialized');

      // Monitor device loss
      this._device.lost.then(() => {
        console.warn('[WebGPU] Device lost');
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

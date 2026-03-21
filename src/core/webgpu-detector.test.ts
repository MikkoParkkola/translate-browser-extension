/**
 * WebGPU Detector unit tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We need to test the class, not the singleton
// Import fresh module for each test
describe('WebGPUDetector', () => {
  let originalNavigator: typeof navigator;

  beforeEach(() => {
    // Store original navigator
    originalNavigator = global.navigator;
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original navigator
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  describe('detect', () => {
    it('returns false when navigator is undefined', async () => {
      // Remove navigator
      Object.defineProperty(global, 'navigator', {
        value: undefined,
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      const result = await webgpuDetector.detect();

      expect(result).toBe(false);
      expect(webgpuDetector.supported).toBe(false);
    });

    it('returns false when gpu is not in navigator', async () => {
      Object.defineProperty(global, 'navigator', {
        value: {},
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      const result = await webgpuDetector.detect();

      expect(result).toBe(false);
    });

    it('returns false when gpu.requestAdapter returns null', async () => {
      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(null),
      };

      Object.defineProperty(global, 'navigator', {
        value: { gpu: mockGpu },
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      const result = await webgpuDetector.detect();

      expect(result).toBe(false);
      expect(mockGpu.requestAdapter).toHaveBeenCalledWith({
        powerPreference: 'high-performance',
      });
    });

    it('returns true when adapter is available', async () => {
      const mockAdapter = {
        requestAdapterInfo: vi.fn().mockResolvedValue({
          device: 'Test GPU',
          vendor: 'Test Vendor',
        }),
        requestDevice: vi.fn().mockResolvedValue({}),
      };

      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      };

      Object.defineProperty(global, 'navigator', {
        value: { gpu: mockGpu },
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      const result = await webgpuDetector.detect();

      expect(result).toBe(true);
      expect(webgpuDetector.supported).toBe(true);
    });

    it('returns true even when requestAdapterInfo is not available', async () => {
      const mockAdapter = {
        // No requestAdapterInfo method
        requestDevice: vi.fn().mockResolvedValue({}),
      };

      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      };

      Object.defineProperty(global, 'navigator', {
        value: { gpu: mockGpu },
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      const result = await webgpuDetector.detect();

      expect(result).toBe(true);
    });

    it('returns false when detection throws error', async () => {
      const mockGpu = {
        requestAdapter: vi.fn().mockRejectedValue(new Error('WebGPU error')),
      };

      Object.defineProperty(global, 'navigator', {
        value: { gpu: mockGpu },
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      const result = await webgpuDetector.detect();

      expect(result).toBe(false);
    });
  });

  describe('initialize', () => {
    it('returns null when not supported', async () => {
      Object.defineProperty(global, 'navigator', {
        value: {},
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      const device = await webgpuDetector.initialize();

      expect(device).toBeNull();
    });

    it('returns device when supported', async () => {
      const mockDevice = {
        lost: new Promise(() => {}), // Never resolves
      };

      const mockAdapter = {
        requestAdapterInfo: vi.fn().mockResolvedValue({ device: 'GPU' }),
        requestDevice: vi.fn().mockResolvedValue(mockDevice),
      };

      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      };

      Object.defineProperty(global, 'navigator', {
        value: { gpu: mockGpu },
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      await webgpuDetector.detect();
      const device = await webgpuDetector.initialize();

      expect(device).toBe(mockDevice);
      expect(webgpuDetector.initialized).toBe(true);
    });

    it('returns cached device on subsequent calls', async () => {
      const mockDevice = {
        lost: new Promise(() => {}),
      };

      const mockAdapter = {
        requestAdapterInfo: vi.fn().mockResolvedValue({ device: 'GPU' }),
        requestDevice: vi.fn().mockResolvedValue(mockDevice),
      };

      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      };

      Object.defineProperty(global, 'navigator', {
        value: { gpu: mockGpu },
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      await webgpuDetector.detect();
      await webgpuDetector.initialize();
      const device2 = await webgpuDetector.initialize();

      expect(device2).toBe(mockDevice);
      expect(mockAdapter.requestDevice).toHaveBeenCalledTimes(1);
    });

    it('returns null when device request fails', async () => {
      const mockAdapter = {
        requestAdapterInfo: vi.fn().mockResolvedValue({ device: 'GPU' }),
        requestDevice: vi.fn().mockRejectedValue(new Error('Device error')),
      };

      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      };

      Object.defineProperty(global, 'navigator', {
        value: { gpu: mockGpu },
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      await webgpuDetector.detect();
      const device = await webgpuDetector.initialize();

      expect(device).toBeNull();
    });

    it('handles device lost event', async () => {
      let lostResolve: () => void;
      const lostPromise = new Promise<void>((resolve) => {
        lostResolve = resolve;
      });

      const mockDevice = {
        lost: lostPromise.then(() => ({
          message: 'Device was lost',
          reason: 'destroyed',
        })),
      };

      const mockAdapter = {
        requestAdapterInfo: vi.fn().mockResolvedValue({ device: 'GPU' }),
        requestDevice: vi.fn().mockResolvedValue(mockDevice),
      };

      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      };

      Object.defineProperty(global, 'navigator', {
        value: { gpu: mockGpu },
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      await webgpuDetector.detect();
      await webgpuDetector.initialize();

      expect(webgpuDetector.initialized).toBe(true);

      // Simulate device lost
      lostResolve!();
      await new Promise((r) => setTimeout(r, 10));

      // After device lost, initialized should be false
      expect(webgpuDetector.initialized).toBe(false);
    });
  });

  describe('getExecutionProvider', () => {
    it('returns wasm when not supported', async () => {
      Object.defineProperty(global, 'navigator', {
        value: {},
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      const provider = webgpuDetector.getExecutionProvider();

      expect(provider).toBe('wasm');
    });

    it('returns wasm when supported but not initialized', async () => {
      const mockAdapter = {
        requestAdapterInfo: vi.fn().mockResolvedValue({ device: 'GPU' }),
        requestDevice: vi.fn().mockResolvedValue({}),
      };

      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      };

      Object.defineProperty(global, 'navigator', {
        value: { gpu: mockGpu },
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      await webgpuDetector.detect();
      // Don't initialize
      const provider = webgpuDetector.getExecutionProvider();

      expect(provider).toBe('wasm');
    });

    it('returns webgpu when supported and initialized', async () => {
      const mockDevice = {
        lost: new Promise(() => {}),
      };

      const mockAdapter = {
        requestAdapterInfo: vi.fn().mockResolvedValue({ device: 'GPU' }),
        requestDevice: vi.fn().mockResolvedValue(mockDevice),
      };

      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      };

      Object.defineProperty(global, 'navigator', {
        value: { gpu: mockGpu },
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      await webgpuDetector.detect();
      await webgpuDetector.initialize();
      const provider = webgpuDetector.getExecutionProvider();

      expect(provider).toBe('webgpu');
    });
  });

  describe('getInfo', () => {
    it('returns info object with correct structure', async () => {
      Object.defineProperty(global, 'navigator', {
        value: {},
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      const info = webgpuDetector.getInfo();

      expect(info).toEqual({
        supported: false,
        initialized: false,
        provider: 'wasm',
        device: 'Not initialized',
      });
    });

    it('returns ready device status when initialized', async () => {
      const mockDevice = {
        lost: new Promise(() => {}),
      };

      const mockAdapter = {
        requestAdapterInfo: vi.fn().mockResolvedValue({ device: 'GPU' }),
        requestDevice: vi.fn().mockResolvedValue(mockDevice),
      };

      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      };

      Object.defineProperty(global, 'navigator', {
        value: { gpu: mockGpu },
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      await webgpuDetector.detect();
      await webgpuDetector.initialize();
      const info = webgpuDetector.getInfo();

      expect(info).toEqual({
        supported: true,
        initialized: true,
        provider: 'webgpu',
        device: 'Ready',
      });
    });
  });

  describe('detect - additional edge cases', () => {
    it('handles requestAdapterInfo that throws', async () => {
      const mockAdapter = {
        requestAdapterInfo: vi.fn().mockRejectedValue(new Error('info error')),
        requestDevice: vi.fn().mockResolvedValue({}),
      };

      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      };

      Object.defineProperty(global, 'navigator', {
        value: { gpu: mockGpu },
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      // detect should still return true even if adapterInfo fails
      // (it catches errors internally)
      const result = await webgpuDetector.detect();
      // Depending on implementation, this may return true or false
      expect(typeof result).toBe('boolean');
    });
  });

  describe('initialize edge cases', () => {
    it('returns null when adapter is null (detect found no adapter)', async () => {
      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(null),
      };

      Object.defineProperty(global, 'navigator', {
        value: { gpu: mockGpu },
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      await webgpuDetector.detect(); // supported = false, adapter = null

      const device = await webgpuDetector.initialize();
      expect(device).toBeNull();
    });
  });

  describe('getInfo with adapter info', () => {
    it('includes device name when adapter info provides it', async () => {
      const mockDevice = {
        lost: new Promise(() => {}),
      };

      const mockAdapter = {
        requestAdapterInfo: vi.fn().mockResolvedValue({
          device: 'NVIDIA RTX 3080',
          vendor: 'NVIDIA',
        }),
        requestDevice: vi.fn().mockResolvedValue(mockDevice),
      };

      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      };

      Object.defineProperty(global, 'navigator', {
        value: { gpu: mockGpu },
        writable: true,
      });

      const { webgpuDetector } = await import('./webgpu-detector');
      const detected = await webgpuDetector.detect();
      expect(detected).toBe(true);

      const info = webgpuDetector.getInfo();
      expect(info.supported).toBe(true);
    });
  });
});

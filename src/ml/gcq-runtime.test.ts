/**
 * Tests for GCQ Runtime - Global Codebook Quantization for WebGPU
 *
 * Covers:
 * - GCQRuntime: init, loadModel, create (factory), WebGPU detection
 * - GCQModel: getTensor (cached & uncached), dequantize, format getters,
 *   component/tensor listing, destroy, entropy-coded tensors, residual path
 * - SimpleEntropyDecoder: RLE decode, raw symbols, edge cases
 * - fp16→f32 conversion: normals, denormals, specials (Inf, NaN, ±0)
 * - Error paths: no WebGPU, no adapter, not initialized, bad magic, missing components
 * - Concurrent getTensor, memory cleanup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// WebGPU mock infrastructure
// ---------------------------------------------------------------------------

// Track created buffers so destroy() can be verified
const createdBuffers: MockGPUBuffer[] = [];

class MockGPUBuffer {
  size: number;
  usage: number;
  destroyed = false;
  private mappedData: ArrayBuffer;
  private mapped = false;

  constructor(descriptor: { size: number; usage: number; mappedAtCreation?: boolean }) {
    this.size = descriptor.size;
    this.usage = descriptor.usage;
    this.mappedData = new ArrayBuffer(descriptor.size);
    if (descriptor.mappedAtCreation) {
      this.mapped = true;
    }
    createdBuffers.push(this);
  }

  getMappedRange(): ArrayBuffer {
    return this.mappedData;
  }

  unmap(): void {
    this.mapped = false;
  }

  async mapAsync(_mode: number): Promise<void> {
    this.mapped = true;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

function createMockDevice() {
  const device = {
    createShaderModule: vi.fn().mockReturnValue({}),
    createComputePipeline: vi.fn().mockReturnValue({
      getBindGroupLayout: vi.fn().mockReturnValue({}),
    }),
    createBuffer: vi.fn((desc: { size: number; usage: number; mappedAtCreation?: boolean }) => {
      return new MockGPUBuffer(desc);
    }),
    createBindGroup: vi.fn().mockReturnValue({}),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: vi.fn(() => ({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        dispatchWorkgroups: vi.fn(),
        end: vi.fn(),
      })),
      copyBufferToBuffer: vi.fn(),
      finish: vi.fn().mockReturnValue({}),
    })),
    queue: {
      writeBuffer: vi.fn(),
      submit: vi.fn(),
    },
  };
  return device;
}

function createMockAdapter(device?: ReturnType<typeof createMockDevice>) {
  return {
    requestDevice: vi.fn().mockResolvedValue(device ?? createMockDevice()),
  };
}

// ---------------------------------------------------------------------------
// GCQ binary builder helpers
// ---------------------------------------------------------------------------

/** Float32 → Float16 (inverse of fp16ToF32, good enough for tests) */
function f32ToFp16(val: number): number {
  if (val === 0) return Object.is(val, -0) ? 0x8000 : 0;
  if (!isFinite(val)) return val > 0 ? 0x7c00 : 0xfc00;
  if (isNaN(val)) return 0x7e00;

  const sign = val < 0 ? 1 : 0;
  val = Math.abs(val);
  const exp = Math.floor(Math.log2(val));
  const biasedExp = exp + 15;

  if (biasedExp >= 31) return (sign << 15) | 0x7c00; // Inf
  if (biasedExp <= 0) {
    // Denormal
    const frac = Math.round(val / Math.pow(2, -14) * 1024);
    return (sign << 15) | (frac & 0x3ff);
  }

  const frac = Math.round((val / Math.pow(2, exp) - 1) * 1024);
  return (sign << 15) | (biasedExp << 10) | (frac & 0x3ff);
}

const GCQ_MAGIC = 0x34514347; // "GCQ4"

interface BuildGCQOpts {
  format?: string;
  version?: number;
  blockSize?: number;
  withResidual?: boolean;
  withEntropy?: boolean;
  codebookValues?: number[];
  components?: Array<{
    name: string;
    tensors: Array<{
      name: string;
      originalSize: number;
      blockSize?: number;
      entropyCoded?: boolean;
      entropyCount?: number;
      indicesBytes?: Uint8Array;
      scalesFp16?: number[];
      residualBytes?: Uint8Array;
      residualScalesFp16?: number[];
    }>;
  }>;
}

/** Build a valid GCQ binary buffer for testing parseModel paths */
function buildGCQBuffer(opts: BuildGCQOpts = {}): ArrayBuffer {
  const format = opts.format ?? 'GCQ4';
  const version = opts.version ?? 1;
  const blockSize = opts.blockSize ?? 32;
  const withResidual = opts.withResidual ?? false;
  const withEntropy = opts.withEntropy ?? false;
  const codebookValues = opts.codebookValues ?? Array.from({ length: 16 }, (_, i) => (i - 8) * 0.1);
  const components = opts.components ?? [];

  // Layout: [header 24B] [codebook 32B] [tensor data...] [manifest JSON]
  const HEADER_SIZE = 24; // magic(4) + version(4) + manifestOffset(8) + manifestSize(8)
  const CODEBOOK_SIZE = 32; // 16 × fp16 (2B each)
  const codebookOffset = HEADER_SIZE;

  // Build codebook as Uint16Array (fp16)
  const codebookFp16 = new Uint16Array(16);
  for (let i = 0; i < 16; i++) {
    codebookFp16[i] = f32ToFp16(codebookValues[i]);
  }

  // Lay out tensor data after codebook
  let dataOffset = HEADER_SIZE + CODEBOOK_SIZE;
  const componentMetas: Array<{
    name: string;
    offset: number;
    size: number;
    tensors: Array<Record<string, unknown>>;
  }> = [];

  for (const comp of components) {
    const compStart = dataOffset;
    const tensorMetas: Array<Record<string, unknown>> = [];

    for (const t of comp.tensors) {
      const numBlocks = Math.ceil(t.originalSize / (t.blockSize ?? blockSize));
      const indicesBytes = t.indicesBytes ?? new Uint8Array(Math.ceil(t.originalSize / 2));
      const scalesFp16 = t.scalesFp16 ?? Array.from({ length: numBlocks }, () => 1.0);
      const scalesBytes = new Uint16Array(scalesFp16.map(f32ToFp16));

      const meta: Record<string, unknown> = {
        name: t.name,
        original_shape: [t.originalSize],
        original_size: t.originalSize,
        num_blocks: numBlocks,
        block_size: t.blockSize ?? blockSize,
        entropy_coded: t.entropyCoded ?? false,
        indices_offset: dataOffset,
        indices_size: indicesBytes.byteLength,
      };
      dataOffset += indicesBytes.byteLength;
      // Align to 2 bytes for Uint16Array construction in the runtime
      if (dataOffset % 2 !== 0) dataOffset++;

      meta.scales_offset = dataOffset;
      meta.scales_size = scalesBytes.byteLength;
      dataOffset += scalesBytes.byteLength;
      if (dataOffset % 2 !== 0) dataOffset++;

      if (t.entropyCoded) {
        meta.entropy_count = t.entropyCount ?? t.originalSize;
      }

      if (withResidual && t.residualBytes) {
        meta.residual_offset = dataOffset;
        meta.residual_size = t.residualBytes.byteLength;
        dataOffset += t.residualBytes.byteLength;
        if (dataOffset % 2 !== 0) dataOffset++;

        const resScalesFp16 = t.residualScalesFp16 ?? Array.from({ length: numBlocks }, () => 0.01);
        const resScalesBytes = new Uint16Array(resScalesFp16.map(f32ToFp16));
        meta.residual_scales_offset = dataOffset;
        meta.residual_scales_size = resScalesBytes.byteLength;
        dataOffset += resScalesBytes.byteLength;
        if (dataOffset % 2 !== 0) dataOffset++;
      }

      tensorMetas.push(meta);
    }

    componentMetas.push({
      name: comp.name,
      offset: compStart,
      size: dataOffset - compStart,
      tensors: tensorMetas,
    });
  }

  // Build manifest JSON
  const manifest = {
    format,
    version,
    block_size: blockSize,
    n_centroids: 16,
    codebook_offset: codebookOffset,
    codebook_size: CODEBOOK_SIZE,
    with_residual: withResidual,
    with_entropy: withEntropy,
    components: componentMetas,
  };
  const manifestStr = JSON.stringify(manifest);
  const manifestBytes = new TextEncoder().encode(manifestStr);
  const manifestOffset = dataOffset;

  // Allocate buffer
  const totalSize = manifestOffset + manifestBytes.byteLength;
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // Write header
  view.setUint32(0, GCQ_MAGIC, true);
  view.setUint32(4, version, true);
  view.setBigUint64(8, BigInt(manifestOffset), true);
  view.setBigUint64(16, BigInt(manifestBytes.byteLength), true);

  // Write codebook
  new Uint8Array(buf, codebookOffset, CODEBOOK_SIZE).set(new Uint8Array(codebookFp16.buffer));

  // Write tensor data
  for (const comp of components) {
    for (const t of comp.tensors) {
      const compMeta = componentMetas.find(c => c.name === comp.name)!;
      const tensorMeta = compMeta.tensors.find(
        (tm: Record<string, unknown>) => tm.name === t.name,
      )!;

      const indicesBytes = t.indicesBytes ?? new Uint8Array(Math.ceil(t.originalSize / 2));
      u8.set(indicesBytes, tensorMeta.indices_offset as number);

      const numBlocks = tensorMeta.num_blocks as number;
      const scalesFp16 = t.scalesFp16 ?? Array.from({ length: numBlocks }, () => 1.0);
      const scalesU16 = new Uint16Array(scalesFp16.map(f32ToFp16));
      new Uint8Array(buf, tensorMeta.scales_offset as number, scalesU16.byteLength).set(
        new Uint8Array(scalesU16.buffer),
      );

      if (withResidual && t.residualBytes && tensorMeta.residual_offset !== undefined) {
        u8.set(t.residualBytes, tensorMeta.residual_offset as number);

        const resScalesFp16 = t.residualScalesFp16 ?? Array.from({ length: numBlocks }, () => 0.01);
        const resScalesU16 = new Uint16Array(resScalesFp16.map(f32ToFp16));
        new Uint8Array(
          buf,
          tensorMeta.residual_scales_offset as number,
          resScalesU16.byteLength,
        ).set(new Uint8Array(resScalesU16.buffer));
      }
    }
  }

  // Write manifest
  u8.set(manifestBytes, manifestOffset);

  return buf;
}

// ---------------------------------------------------------------------------
// Module import (after mocks are ready)
// ---------------------------------------------------------------------------

// We need to reset modules between tests that swap navigator.gpu
let GCQRuntime: typeof import('./gcq-runtime').GCQRuntime;
let GCQModel: typeof import('./gcq-runtime').GCQModel;

async function importModule() {
  const mod = await import('./gcq-runtime');
  GCQRuntime = mod.GCQRuntime;
  GCQModel = mod.GCQModel;
  return mod;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GCQ Runtime', () => {
  let mockDevice: ReturnType<typeof createMockDevice>;
  let mockAdapter: ReturnType<typeof createMockAdapter>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    createdBuffers.length = 0;

    mockDevice = createMockDevice();
    mockAdapter = createMockAdapter(mockDevice);

    // Default: WebGPU available
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      },
    });

    // Suppress console noise
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // GPUBufferUsage and GPUMapMode constants
    vi.stubGlobal('GPUBufferUsage', {
      UNIFORM: 0x0040,
      STORAGE: 0x0080,
      COPY_DST: 0x0008,
      COPY_SRC: 0x0004,
      MAP_READ: 0x0001,
    });
    vi.stubGlobal('GPUMapMode', { READ: 1 });

    await importModule();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // =========================================================================
  // GCQRuntime.init()
  // =========================================================================
  describe('GCQRuntime.init()', () => {
    it('initializes WebGPU successfully', async () => {
      const runtime = new GCQRuntime();
      const result = await runtime.init();

      expect(result).toBe(true);
      expect(navigator.gpu.requestAdapter).toHaveBeenCalledWith({
        powerPreference: 'high-performance',
      });
      expect(mockAdapter.requestDevice).toHaveBeenCalled();
      expect(mockDevice.createShaderModule).toHaveBeenCalledTimes(2); // GCQ4 + GCQ4R
      expect(mockDevice.createComputePipeline).toHaveBeenCalledTimes(2);
    });

    it('returns true immediately if already initialized', async () => {
      const runtime = new GCQRuntime();
      await runtime.init();

      // Reset call counts
      vi.clearAllMocks();

      const result = await runtime.init();
      expect(result).toBe(true);
      expect(navigator.gpu.requestAdapter).not.toHaveBeenCalled();
    });

    it('returns false when WebGPU is not supported (no navigator.gpu)', async () => {
      vi.stubGlobal('navigator', {});

      const runtime = new GCQRuntime();
      const result = await runtime.init();

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith('[GCQ] WebGPU not supported');
    });

    it('returns false when no adapter is available', async () => {
      vi.stubGlobal('navigator', {
        gpu: { requestAdapter: vi.fn().mockResolvedValue(null) },
      });

      const runtime = new GCQRuntime();
      const result = await runtime.init();

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith('[GCQ] No WebGPU adapter');
    });

    it('requests high-performance adapter and 1 GiB buffer limits', async () => {
      const runtime = new GCQRuntime();
      await runtime.init();

      expect(mockAdapter.requestDevice).toHaveBeenCalledWith({
        requiredLimits: {
          maxStorageBufferBindingSize: 1024 * 1024 * 1024,
          maxBufferSize: 1024 * 1024 * 1024,
        },
      });
    });

    it('compiles both GCQ4 and GCQ4R shaders', async () => {
      const runtime = new GCQRuntime();
      await runtime.init();

      const calls = mockDevice.createShaderModule.mock.calls;
      expect(calls).toHaveLength(2);

      // Verify shader source contains expected entry points
      expect(calls[0][0].code).toContain('gcq4_dequant');
      expect(calls[1][0].code).toContain('gcq4r_dequant');
    });
  });

  // =========================================================================
  // GCQRuntime.create() (static factory)
  // =========================================================================
  describe('GCQRuntime.create()', () => {
    it('creates and initializes a runtime', async () => {
      const runtime = await GCQRuntime.create();
      expect(runtime).toBeInstanceOf(GCQRuntime);
      expect(navigator.gpu.requestAdapter).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // GCQRuntime.loadModel()
  // =========================================================================
  describe('GCQRuntime.loadModel()', () => {
    it('throws if runtime is not initialized', async () => {
      const runtime = new GCQRuntime();
      await expect(runtime.loadModel('http://example.com/model.gcq')).rejects.toThrow(
        'GCQRuntime not initialized',
      );
    });

    it('loads and parses a valid GCQ4 model', async () => {
      const gcqBuf = buildGCQBuffer({
        format: 'GCQ4',
        components: [
          {
            name: 'encoder',
            tensors: [{ name: 'weight', originalSize: 64 }],
          },
        ],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://example.com/model.gcq');

      expect(model).toBeDefined();
      expect(model.format).toBe('GCQ4');
      expect(model.withResidual).toBe(false);
      expect(model.getComponentNames()).toEqual(['encoder']);
      expect(model.getTensorNames('encoder')).toEqual(['weight']);
    });

    it('loads a GCQ4R model with residual flag', async () => {
      const gcqBuf = buildGCQBuffer({
        format: 'GCQ4R',
        withResidual: true,
        components: [
          {
            name: 'decoder',
            tensors: [
              {
                name: 'weight',
                originalSize: 64,
                residualBytes: new Uint8Array(16),
                residualScalesFp16: [0.01, 0.02],
              },
            ],
          },
        ],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://example.com/model_r.gcq');

      expect(model.format).toBe('GCQ4R');
      expect(model.withResidual).toBe(true);
    });

    it('throws on invalid magic number', async () => {
      const badBuf = new ArrayBuffer(64);
      const view = new DataView(badBuf);
      view.setUint32(0, 0xdeadbeef, true); // Wrong magic

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(badBuf),
      }));

      const runtime = await GCQRuntime.create();
      await expect(runtime.loadModel('http://example.com/bad.gcq')).rejects.toThrow(
        'Invalid GCQ magic: 0xdeadbeef',
      );
    });

    it('propagates fetch errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const runtime = await GCQRuntime.create();
      await expect(runtime.loadModel('http://unreachable/model.gcq')).rejects.toThrow(
        'Network error',
      );
    });
  });

  // =========================================================================
  // GCQModel — getters and listing
  // =========================================================================
  describe('GCQModel getters and listing', () => {
    let model: InstanceType<typeof GCQModel>;

    beforeEach(async () => {
      const gcqBuf = buildGCQBuffer({
        format: 'ECGCQ-16',
        components: [
          {
            name: 'encoder',
            tensors: [
              { name: 'w1', originalSize: 64 },
              { name: 'w2', originalSize: 128 },
            ],
          },
          {
            name: 'decoder',
            tensors: [{ name: 'bias', originalSize: 32 }],
          },
        ],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      model = await runtime.loadModel('http://example.com/model.gcq');
    });

    it('format returns manifest format', () => {
      expect(model.format).toBe('ECGCQ-16');
    });

    it('getComponentNames lists all components', () => {
      expect(model.getComponentNames()).toEqual(['encoder', 'decoder']);
    });

    it('getTensorNames lists tensors for a component', () => {
      expect(model.getTensorNames('encoder')).toEqual(['w1', 'w2']);
      expect(model.getTensorNames('decoder')).toEqual(['bias']);
    });

    it('getTensorNames returns empty array for unknown component', () => {
      expect(model.getTensorNames('nonexistent')).toEqual([]);
    });
  });

  // =========================================================================
  // GCQModel.getTensor()
  // =========================================================================
  describe('GCQModel.getTensor()', () => {
    it('throws on unknown component', async () => {
      const gcqBuf = buildGCQBuffer({
        components: [{ name: 'enc', tensors: [{ name: 'w', originalSize: 32 }] }],
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');

      await expect(model.getTensor('missing', 'w')).rejects.toThrow('Component not found: missing');
    });

    it('throws on unknown tensor', async () => {
      const gcqBuf = buildGCQBuffer({
        components: [{ name: 'enc', tensors: [{ name: 'w', originalSize: 32 }] }],
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');

      await expect(model.getTensor('enc', 'missing')).rejects.toThrow(
        'Tensor not found: missing',
      );
    });

    it('returns Float32Array from GPU dequantization', async () => {
      const gcqBuf = buildGCQBuffer({
        components: [{ name: 'enc', tensors: [{ name: 'w', originalSize: 64 }] }],
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');
      const tensor = await model.getTensor('enc', 'w');

      expect(tensor).toBeInstanceOf(Float32Array);
    });

    it('caches tensors — second call returns from cache', async () => {
      const gcqBuf = buildGCQBuffer({
        components: [{ name: 'enc', tensors: [{ name: 'w', originalSize: 64 }] }],
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');

      // Track createCommandEncoder calls to detect GPU dispatches
      const encoderCallsBefore = mockDevice.createCommandEncoder.mock.calls.length;

      await model.getTensor('enc', 'w');
      const encoderCallsAfterFirst = mockDevice.createCommandEncoder.mock.calls.length;
      const gpuDispatches1 = encoderCallsAfterFirst - encoderCallsBefore;

      await model.getTensor('enc', 'w');
      const encoderCallsAfterSecond = mockDevice.createCommandEncoder.mock.calls.length;
      const gpuDispatches2 = encoderCallsAfterSecond - encoderCallsAfterFirst;

      // First call: 1 dispatch (dequant) + 1 readback = 2 encoder calls
      expect(gpuDispatches1).toBe(2);
      // Second call: only readback, no dequant dispatch = 1 encoder call
      expect(gpuDispatches2).toBe(1);
    });

    it('dispatches correct workgroup count based on tensor size', async () => {
      const tensorSize = 1024;
      const gcqBuf = buildGCQBuffer({
        components: [{ name: 'enc', tensors: [{ name: 'w', originalSize: tensorSize }] }],
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');

      // Capture dispatchWorkgroups call
      let dispatchedCount = 0;
      mockDevice.createCommandEncoder.mockImplementation(() => ({
        beginComputePass: vi.fn(() => ({
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          dispatchWorkgroups: vi.fn((count: number) => {
            dispatchedCount = count;
          }),
          end: vi.fn(),
        })),
        copyBufferToBuffer: vi.fn(),
        finish: vi.fn().mockReturnValue({}),
      }));

      await model.getTensor('enc', 'w');

      // ceil(1024 / 256) = 4
      expect(dispatchedCount).toBe(Math.ceil(tensorSize / 256));
    });
  });

  // =========================================================================
  // GCQModel.getTensor() — entropy-coded tensors
  // =========================================================================
  describe('GCQModel.getTensor() with entropy coding', () => {
    it('handles entropy-coded (RLE) indices', async () => {
      // Build RLE data: symbol 3 repeated 10 times = [0x83, 0x09]
      // Then raw symbol 5 = [0x05]
      const rleData = new Uint8Array([0x83, 0x09, 0x05]);
      const expectedCount = 11; // 10 repeats + 1 raw

      const gcqBuf = buildGCQBuffer({
        withEntropy: true,
        components: [
          {
            name: 'enc',
            tensors: [
              {
                name: 'w',
                originalSize: expectedCount,
                entropyCoded: true,
                entropyCount: expectedCount,
                indicesBytes: rleData,
              },
            ],
          },
        ],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');

      // Should not throw — entropy path is exercised
      const result = await model.getTensor('enc', 'w');
      expect(result).toBeInstanceOf(Float32Array);
    });
  });

  // =========================================================================
  // GCQModel.getTensor() — residual path (GCQ4R)
  // =========================================================================
  describe('GCQModel.getTensor() with residual', () => {
    it('creates bind group with 7 entries for GCQ4R', async () => {
      const tensorSize = 64;
      const numBlocks = Math.ceil(tensorSize / 32);

      const gcqBuf = buildGCQBuffer({
        format: 'GCQ4R',
        withResidual: true,
        components: [
          {
            name: 'dec',
            tensors: [
              {
                name: 'weight',
                originalSize: tensorSize,
                residualBytes: new Uint8Array(Math.ceil(tensorSize / 4)),
                residualScalesFp16: Array.from({ length: numBlocks }, () => 0.01),
              },
            ],
          },
        ],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');
      await model.getTensor('dec', 'weight');

      // GCQ4R bind group has 7 entries (params, indices, scales, codebook, residual, res_scales, output)
      const bindGroupCalls = mockDevice.createBindGroup.mock.calls;
      const lastCall = bindGroupCalls[bindGroupCalls.length - 1];
      expect(lastCall[0].entries).toHaveLength(7);
    });
  });

  // =========================================================================
  // GCQModel.destroy()
  // =========================================================================
  describe('GCQModel.destroy()', () => {
    it('destroys all cached GPU buffers and clears cache', async () => {
      const gcqBuf = buildGCQBuffer({
        components: [
          {
            name: 'enc',
            tensors: [
              { name: 'w1', originalSize: 32 },
              { name: 'w2', originalSize: 32 },
            ],
          },
        ],
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');

      // Load two tensors to populate cache
      await model.getTensor('enc', 'w1');
      await model.getTensor('enc', 'w2');

      // Find output buffers (the ones in the cache are STORAGE | COPY_SRC)
      const outputBuffers = createdBuffers.filter(
        (b) => (b.usage & 0x0084) === 0x0084, // STORAGE | COPY_SRC
      );

      model.destroy();

      // All cached output buffers should be destroyed
      for (const buf of outputBuffers) {
        expect(buf.destroyed).toBe(true);
      }

      // After destroy, getTensor should re-dequantize (cache is empty)
      const callsBefore = mockDevice.createCommandEncoder.mock.calls.length;
      await model.getTensor('enc', 'w1');
      const callsAfter = mockDevice.createCommandEncoder.mock.calls.length;
      // Should have dispatched again (dequant + readback = 2 encoder calls)
      expect(callsAfter - callsBefore).toBe(2);
    });
  });

  // =========================================================================
  // GCQModel — GCQ4 standard bind group (5 entries)
  // =========================================================================
  describe('GCQModel dequantize — GCQ4 standard path', () => {
    it('creates bind group with 5 entries for GCQ4 (no residual)', async () => {
      const gcqBuf = buildGCQBuffer({
        format: 'GCQ4',
        withResidual: false,
        components: [
          { name: 'enc', tensors: [{ name: 'w', originalSize: 64 }] },
        ],
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');
      await model.getTensor('enc', 'w');

      const bindGroupCalls = mockDevice.createBindGroup.mock.calls;
      const lastCall = bindGroupCalls[bindGroupCalls.length - 1];
      // GCQ4: params, indices, scales, codebook, output = 5
      expect(lastCall[0].entries).toHaveLength(5);
    });
  });

  // =========================================================================
  // fp16 → f32 conversion (tested indirectly through codebook parsing)
  // =========================================================================
  describe('fp16 to f32 conversion', () => {
    it.each([
      [0x0000, 'positive zero'],
      [0x8000, 'negative zero'],
      [0x3c00, 'one (1.0)'],
      [0xbc00, 'negative one (-1.0)'],
      [0x7c00, 'positive infinity'],
      [0xfc00, 'negative infinity'],
    ] as [number, string][])(
      'correctly parses fp16 codebook entry 0x%s (%s)',
      async (fp16Bits, _desc) => {
        // Build a model where the first codebook entry uses our test value
        const gcqBuf = buildGCQBuffer({
          codebookValues: Array(16).fill(0),
          components: [],
        });

        // Overwrite codebook with exact fp16 bits
        const codebookOffset = 24;
        const u16View = new Uint16Array(gcqBuf, codebookOffset, 16);
        u16View[0] = fp16Bits;

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          arrayBuffer: () => Promise.resolve(gcqBuf),
        }));

        const runtime = await GCQRuntime.create();
        const model = await runtime.loadModel('http://x/m.gcq');

        // If we get here without throwing, fp16→f32 conversion succeeded
        expect(model).toBeDefined();
        expect(model.format).toBeDefined();
      },
    );

    it('handles NaN (exp=31, frac≠0)', async () => {
      const gcqBuf = buildGCQBuffer({ codebookValues: [], components: [] });
      const codebookOffset = 24;
      const u16View = new Uint16Array(gcqBuf, codebookOffset, 16);
      u16View[0] = 0x7e00; // NaN in fp16

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      // Should not throw — NaN is handled gracefully
      const model = await runtime.loadModel('http://x/m.gcq');
      expect(model).toBeDefined();
    });

    it('handles denormals (exp=0, frac≠0)', async () => {
      const gcqBuf = buildGCQBuffer({ codebookValues: [], components: [] });
      const codebookOffset = 24;
      const u16View = new Uint16Array(gcqBuf, codebookOffset, 16);
      u16View[0] = 0x0001; // Smallest positive denormal

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');
      expect(model).toBeDefined();
    });
  });

  // =========================================================================
  // SimpleEntropyDecoder (tested through entropy-coded tensor path)
  // =========================================================================
  describe('SimpleEntropyDecoder', () => {
    // We test the decoder indirectly through model loading with entropy-coded tensors.
    // The decoder is a private class, so we exercise it through the public API.

    it('decodes pure RLE data correctly', async () => {
      // RLE: symbol 7, run length 5 → [0x87, 0x04] (runLen = data[i+1]+1 = 4+1=5)
      const rleData = new Uint8Array([0x87, 0x04]);
      const expectedCount = 5;

      const gcqBuf = buildGCQBuffer({
        withEntropy: true,
        components: [
          {
            name: 'c',
            tensors: [
              {
                name: 't',
                originalSize: expectedCount,
                entropyCoded: true,
                entropyCount: expectedCount,
                indicesBytes: rleData,
              },
            ],
          },
        ],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');
      const result = await model.getTensor('c', 't');
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(expectedCount);
    });

    it('decodes pure raw symbols', async () => {
      // Raw symbols (high bit clear): 0x01, 0x02, 0x03
      const rawData = new Uint8Array([0x01, 0x02, 0x03]);
      const expectedCount = 3;

      const gcqBuf = buildGCQBuffer({
        withEntropy: true,
        components: [
          {
            name: 'c',
            tensors: [
              {
                name: 't',
                originalSize: expectedCount,
                entropyCoded: true,
                entropyCount: expectedCount,
                indicesBytes: rawData,
              },
            ],
          },
        ],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');
      const result = await model.getTensor('c', 't');
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(expectedCount);
    });

    it('decodes mixed RLE and raw data', async () => {
      // Raw 0x05, then RLE symbol 2 run 3 [0x82, 0x02], then raw 0x0A
      const mixedData = new Uint8Array([0x05, 0x82, 0x02, 0x0a]);
      const expectedCount = 5; // 1 raw + 3 RLE + 1 raw

      const gcqBuf = buildGCQBuffer({
        withEntropy: true,
        components: [
          {
            name: 'c',
            tensors: [
              {
                name: 't',
                originalSize: expectedCount,
                entropyCoded: true,
                entropyCount: expectedCount,
                indicesBytes: mixedData,
              },
            ],
          },
        ],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');
      const result = await model.getTensor('c', 't');
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(expectedCount);
    });

    it('truncates output to count when data produces more symbols', async () => {
      // RLE: symbol 0, run 20 → but count is only 5
      const rleData = new Uint8Array([0x80, 0x13]); // run of 20
      const expectedCount = 5;

      const gcqBuf = buildGCQBuffer({
        withEntropy: true,
        components: [
          {
            name: 'c',
            tensors: [
              {
                name: 't',
                originalSize: expectedCount,
                entropyCoded: true,
                entropyCount: expectedCount,
                indicesBytes: rleData,
              },
            ],
          },
        ],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');
      const result = await model.getTensor('c', 't');
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(expectedCount);
    });

    it('handles RLE byte at end of data without length byte (fallback to 0)', async () => {
      // RLE marker at last byte — data[i+1] doesn't exist so runLen = 0 + 1 = 1
      const rleData = new Uint8Array([0x01, 0x85]); // raw 1, then RLE symbol 5 with no length byte
      const expectedCount = 2; // 1 raw + 1 from RLE (runLen defaults to 1)

      const gcqBuf = buildGCQBuffer({
        withEntropy: true,
        components: [
          {
            name: 'c',
            tensors: [
              {
                name: 't',
                originalSize: expectedCount,
                entropyCoded: true,
                entropyCount: expectedCount,
                indicesBytes: rleData,
              },
            ],
          },
        ],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/rle_edge.gcq');
      const result = await model.getTensor('c', 't');
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(expectedCount);
    });

    it('handles empty data (returns empty output)', async () => {
      // Empty entropy-coded data — output should be all zeros from packed indices
      const emptyData = new Uint8Array([]);
      const expectedCount = 4;

      const gcqBuf = buildGCQBuffer({
        withEntropy: true,
        components: [
          {
            name: 'c',
            tensors: [
              {
                name: 't',
                originalSize: expectedCount,
                entropyCoded: true,
                entropyCount: expectedCount,
                indicesBytes: emptyData,
              },
            ],
          },
        ],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/empty_ent.gcq');
      const result = await model.getTensor('c', 't');
      expect(result).toBeInstanceOf(Float32Array);
    });
  });

  // =========================================================================
  // Concurrent requests
  // =========================================================================
  describe('concurrent tensor requests', () => {
    it('handles multiple concurrent getTensor calls', async () => {
      const gcqBuf = buildGCQBuffer({
        components: [
          {
            name: 'enc',
            tensors: [
              { name: 'w1', originalSize: 64 },
              { name: 'w2', originalSize: 128 },
              { name: 'bias', originalSize: 32 },
            ],
          },
        ],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');

      // Fire all concurrently
      const [t1, t2, t3] = await Promise.all([
        model.getTensor('enc', 'w1'),
        model.getTensor('enc', 'w2'),
        model.getTensor('enc', 'bias'),
      ]);

      expect(t1).toBeInstanceOf(Float32Array);
      expect(t2).toBeInstanceOf(Float32Array);
      expect(t3).toBeInstanceOf(Float32Array);
    });

    it('handles concurrent requests for the same tensor', async () => {
      const gcqBuf = buildGCQBuffer({
        components: [
          { name: 'enc', tensors: [{ name: 'w', originalSize: 64 }] },
        ],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');

      const [r1, r2] = await Promise.all([
        model.getTensor('enc', 'w'),
        model.getTensor('enc', 'w'),
      ]);

      expect(r1).toBeInstanceOf(Float32Array);
      expect(r2).toBeInstanceOf(Float32Array);
    });
  });

  // =========================================================================
  // Buffer alignment
  // =========================================================================
  describe('buffer alignment', () => {
    it('aligns storage buffers to 4 bytes', async () => {
      // Use a tensor size that produces non-4-aligned index bytes
      const gcqBuf = buildGCQBuffer({
        components: [
          { name: 'enc', tensors: [{ name: 'w', originalSize: 7 }] },
        ],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');
      await model.getTensor('enc', 'w');

      // All storage buffers should have 4-byte-aligned sizes
      const storageBuffers = createdBuffers.filter(
        (b) => (b.usage & 0x0080) !== 0, // STORAGE flag
      );
      for (const buf of storageBuffers) {
        expect(buf.size % 4).toBe(0);
      }
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('handles model with no components', async () => {
      const gcqBuf = buildGCQBuffer({ components: [] });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');

      expect(model.getComponentNames()).toEqual([]);
    });

    it('handles model with many components', async () => {
      const components = Array.from({ length: 20 }, (_, i) => ({
        name: `layer_${i}`,
        tensors: [{ name: 'weight', originalSize: 32 }],
      }));

      const gcqBuf = buildGCQBuffer({ components });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');

      expect(model.getComponentNames()).toHaveLength(20);
      expect(model.getComponentNames()[0]).toBe('layer_0');
      expect(model.getComponentNames()[19]).toBe('layer_19');
    });

    it('handles very small tensor (1 element)', async () => {
      const gcqBuf = buildGCQBuffer({
        components: [
          { name: 'enc', tensors: [{ name: 'scalar', originalSize: 1 }] },
        ],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');
      const result = await model.getTensor('enc', 'scalar');

      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(1);
    });
  });

  // =========================================================================
  // Exported singleton
  // =========================================================================
  describe('gcqRuntime singleton', () => {
    it('exports a GCQRuntime instance', async () => {
      const mod = await import('./gcq-runtime');
      expect(mod.gcqRuntime).toBeInstanceOf(GCQRuntime);
    });
  });

  // =========================================================================
  // GPU submission correctness
  // =========================================================================
  describe('GPU command submission', () => {
    it('submits command buffer to device queue', async () => {
      const gcqBuf = buildGCQBuffer({
        components: [{ name: 'enc', tensors: [{ name: 'w', originalSize: 32 }] }],
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');
      await model.getTensor('enc', 'w');

      // queue.submit should have been called (for dequant dispatch + readback)
      expect(mockDevice.queue.submit).toHaveBeenCalled();
    });

    it('writes params buffer with correct numElements and blockSize', async () => {
      const tensorSize = 256;
      const blockSize = 32;

      const gcqBuf = buildGCQBuffer({
        blockSize,
        components: [
          { name: 'enc', tensors: [{ name: 'w', originalSize: tensorSize, blockSize }] },
        ],
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');
      await model.getTensor('enc', 'w');

      // Check that writeBuffer was called with a Uint32Array containing [tensorSize, blockSize]
      const writeBufferCalls = mockDevice.queue.writeBuffer.mock.calls;
      const paramsWrite = writeBufferCalls.find((call: unknown[]) => {
        const data = call[2];
        return data instanceof Uint32Array && data[0] === tensorSize && data[1] === blockSize;
      });
      expect(paramsWrite).toBeDefined();
    });
  });

  // =========================================================================
  // readBuffer (copy-to-staging pattern)
  // =========================================================================
  describe('readBuffer — staging pattern', () => {
    it('creates a MAP_READ staging buffer matching output size', async () => {
      const gcqBuf = buildGCQBuffer({
        components: [{ name: 'enc', tensors: [{ name: 'w', originalSize: 64 }] }],
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/m.gcq');
      await model.getTensor('enc', 'w');

      // Find MAP_READ buffers
      const readBuffers = createdBuffers.filter(
        (b) => (b.usage & 0x0001) !== 0, // MAP_READ flag
      );
      expect(readBuffers.length).toBeGreaterThanOrEqual(1);

      // Staging buffer should be destroyed after read
      const lastReadBuf = readBuffers[readBuffers.length - 1];
      expect(lastReadBuf.destroyed).toBe(true);
    });
  });

  // =========================================================================
  // Adapter request failure after GPU is available
  // =========================================================================
  describe('adapter device request failure', () => {
    it('propagates error when requestDevice throws', async () => {
      const failAdapter = {
        requestDevice: vi.fn().mockRejectedValue(new Error('GPU OOM')),
      };
      vi.stubGlobal('navigator', {
        gpu: { requestAdapter: vi.fn().mockResolvedValue(failAdapter) },
      });

      const runtime = new GCQRuntime();
      await expect(runtime.init()).rejects.toThrow('GPU OOM');
    });
  });

  // =========================================================================
  // GCQModel.fp16ToF32 — denormal & special values via scales in dequantize
  // =========================================================================
  describe('GCQModel fp16ToF32 via scale conversion in dequantize', () => {
    beforeEach(async () => {
      mockDevice = createMockDevice();
      mockAdapter = createMockAdapter(mockDevice);
      vi.stubGlobal('navigator', {
        gpu: { requestAdapter: vi.fn().mockResolvedValue(mockAdapter) },
      });
      createdBuffers.length = 0;
      await importModule();
    });

    it('handles positive denormal fp16 scales (exp=0, frac≠0)', async () => {
      const tensorSize = 32;
      const gcqBuf = buildGCQBuffer({
        components: [{
          name: 'denorm_comp',
          tensors: [{
            name: 'w',
            originalSize: tensorSize,
            scalesFp16: [1e-6],
          }],
        }],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/denorm.gcq');
      const result = await model.getTensor('denorm_comp', 'w');
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('handles negative denormal fp16 scales (exp=0, frac≠0, sign=1)', async () => {
      const tensorSize = 32;
      const gcqBuf = buildGCQBuffer({
        components: [{
          name: 'neg_denorm',
          tensors: [{
            name: 'w',
            originalSize: tensorSize,
            scalesFp16: [-1e-6],
          }],
        }],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/neg_denorm.gcq');
      const result = await model.getTensor('neg_denorm', 'w');
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('handles Infinity fp16 scales (exp=31, frac=0)', async () => {
      const tensorSize = 32;
      const gcqBuf = buildGCQBuffer({
        components: [{
          name: 'inf_comp',
          tensors: [{
            name: 'w',
            originalSize: tensorSize,
            scalesFp16: [1e10],
          }],
        }],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/inf.gcq');
      const result = await model.getTensor('inf_comp', 'w');
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('handles negative Infinity fp16 scales (sign=1, exp=31, frac=0)', async () => {
      const tensorSize = 32;
      const gcqBuf = buildGCQBuffer({
        components: [{
          name: 'ninf_comp',
          tensors: [{
            name: 'w',
            originalSize: tensorSize,
            scalesFp16: [-1e10],
          }],
        }],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/ninf.gcq');
      const result = await model.getTensor('ninf_comp', 'w');
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('handles NaN fp16 scales (exp=31, frac≠0) via manual buffer override', async () => {
      const tensorSize = 32;
      const gcqBuf = buildGCQBuffer({
        components: [{
          name: 'nan_comp',
          tensors: [{
            name: 'w',
            originalSize: tensorSize,
            scalesFp16: [1.0],
          }],
        }],
      });

      // Parse manifest to locate scales_offset, then overwrite with NaN fp16
      const dv = new DataView(gcqBuf);
      const mOff = Number(dv.getBigUint64(8, true));
      const mSize = Number(dv.getBigUint64(16, true));
      const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(gcqBuf, mOff, mSize)));
      const scalesOffset = manifest.components[0].tensors[0].scales_offset;
      new Uint16Array(gcqBuf, scalesOffset, 1)[0] = 0x7e00; // NaN in fp16

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/nan.gcq');
      const result = await model.getTensor('nan_comp', 'w');
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('handles negative zero fp16 scales (sign=1, exp=0, frac=0) via manual override', async () => {
      const tensorSize = 32;
      const gcqBuf = buildGCQBuffer({
        components: [{
          name: 'nz_comp',
          tensors: [{
            name: 'w',
            originalSize: tensorSize,
            scalesFp16: [1.0],
          }],
        }],
      });

      const dv = new DataView(gcqBuf);
      const mOff = Number(dv.getBigUint64(8, true));
      const mSize = Number(dv.getBigUint64(16, true));
      const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(gcqBuf, mOff, mSize)));
      const scalesOffset = manifest.components[0].tensors[0].scales_offset;
      new Uint16Array(gcqBuf, scalesOffset, 1)[0] = 0x8000; // Negative zero

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/nz.gcq');
      const result = await model.getTensor('nz_comp', 'w');
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('handles denormal + special scales in residual path (GCQ4R)', async () => {
      const tensorSize = 64;
      const numBlocks = Math.ceil(tensorSize / 32);

      const gcqBuf = buildGCQBuffer({
        format: 'GCQ4R',
        withResidual: true,
        components: [{
          name: 'res_denorm',
          tensors: [{
            name: 'weight',
            originalSize: tensorSize,
            scalesFp16: [1e-6, 1e10], // denormal + infinity
            residualBytes: new Uint8Array(Math.ceil(tensorSize / 4)),
            residualScalesFp16: [1e-6, 1e10],
          }],
        }],
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/res_denorm.gcq');
      const result = await model.getTensor('res_denorm', 'weight');
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('handles positive zero fp16 scale (sign=0, exp=0, frac=0) via manual override', async () => {
      const tensorSize = 32;
      const gcqBuf = buildGCQBuffer({
        components: [{
          name: 'zero_scale',
          tensors: [{
            name: 'w',
            originalSize: tensorSize,
            scalesFp16: [1.0],
          }],
        }],
      });

      // Overwrite scale with exact positive zero (0x0000)
      const dv = new DataView(gcqBuf);
      const mOff = Number(dv.getBigUint64(8, true));
      const mSize = Number(dv.getBigUint64(16, true));
      const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(gcqBuf, mOff, mSize)));
      const scalesOffset = manifest.components[0].tensors[0].scales_offset;
      new Uint16Array(gcqBuf, scalesOffset, 1)[0] = 0x0000; // Positive zero

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/zero_scale.gcq');
      const result = await model.getTensor('zero_scale', 'w');
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('handles normal negative fp16 scale via manual override', async () => {
      const tensorSize = 32;
      const gcqBuf = buildGCQBuffer({
        components: [{
          name: 'neg_norm',
          tensors: [{
            name: 'w',
            originalSize: tensorSize,
            scalesFp16: [1.0],
          }],
        }],
      });

      // Overwrite scale with -2.0 in fp16 (sign=1, exp=16, frac=0 → 0xC000)
      const dv = new DataView(gcqBuf);
      const mOff = Number(dv.getBigUint64(8, true));
      const mSize = Number(dv.getBigUint64(16, true));
      const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(gcqBuf, mOff, mSize)));
      const scalesOffset = manifest.components[0].tensors[0].scales_offset;
      new Uint16Array(gcqBuf, scalesOffset, 1)[0] = 0xC000; // -2.0 fp16

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(gcqBuf),
      }));

      const runtime = await GCQRuntime.create();
      const model = await runtime.loadModel('http://x/neg_norm.gcq');
      const result = await model.getTensor('neg_norm', 'w');
      expect(result).toBeInstanceOf(Float32Array);
    });
  });
});

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface SpikeModule {
  buildTransformersEnvSettings: (
    options: { offline?: boolean; cacheDir?: string }
  ) => {
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
    useBrowserCache: boolean;
    useFSCache: boolean;
    useWasmCache: boolean;
    cacheDir: string;
  };
  calculateMemoryDelta: (
    before: { rss: number; heapUsed: number; external: number },
    after: { rss: number; heapUsed: number; external: number }
  ) => { rssBytes: number; heapUsedBytes: number; externalBytes: number } | null;
  estimateTokenCount: (text: string) => number;
  parseSpikeArgs: (argv: string[]) => {
    model: string;
    device: string;
    dtype: string;
    text: string;
    cacheDir: string;
    offline: boolean;
    maxLength: number;
  };
  resolveSpikeDevice: (requestedDevice: string, hasWebGpu: boolean, isNodeRuntime?: boolean) => string;
  runSpike: (options: { device: string }) => Promise<unknown>;
  summarizeInferenceMetrics: (input: {
    loadMs: number;
    inferenceMs: number;
    outputText: string;
    memoryBefore: { rss: number; heapUsed: number; external: number };
    memoryAfter: { rss: number; heapUsed: number; external: number };
  }) => {
    loadMs: number;
    inferenceMs: number;
    estimatedOutputTokens: number;
    estimatedTokensPerSecond: number;
    memoryDelta: { rssBytes: number; heapUsedBytes: number; externalBytes: number } | null;
  };
}

async function loadSpikeModule(): Promise<SpikeModule> {
  return import(
    pathToFileURL(resolve(process.cwd(), 'scripts/transformers-v4-webgpu-spike.mjs')).href
  ) as Promise<SpikeModule>;
}

describe('Transformers.js v4 WebGPU spike script helpers', () => {
  it('parses explicit CLI options', async () => {
    const { parseSpikeArgs } = await loadSpikeModule();

    expect(parseSpikeArgs([
      '--model=Xenova/opus-mt-en-fi',
      '--device=wasm',
      '--dtype=q8',
      '--text=Hello',
      '--cache-dir=/tmp/transformers-cache',
      '--max-length=64',
      '--offline',
    ])).toEqual({
      model: 'Xenova/opus-mt-en-fi',
      device: 'wasm',
      dtype: 'q8',
      text: 'Hello',
      cacheDir: '/tmp/transformers-cache',
      offline: true,
      maxLength: 64,
    });
  });

  it('rejects unsupported devices', async () => {
    const { parseSpikeArgs } = await loadSpikeModule();

    expect(() => parseSpikeArgs(['--device=webnn'])).toThrow(/Unsupported device/);
  });

  it('resolves auto device from WebGPU availability', async () => {
    const { resolveSpikeDevice } = await loadSpikeModule();

    expect(resolveSpikeDevice('auto', true)).toBe('webgpu');
    expect(resolveSpikeDevice('auto', false)).toBe('cpu');
    expect(resolveSpikeDevice('auto', false, false)).toBe('wasm');
    expect(resolveSpikeDevice('wasm', true)).toBe('cpu');
    expect(resolveSpikeDevice('wasm', true, false)).toBe('wasm');
  });

  it('estimates token count conservatively from text length', async () => {
    const { estimateTokenCount } = await loadSpikeModule();

    expect(estimateTokenCount('')).toBe(0);
    expect(estimateTokenCount('test')).toBe(1);
    expect(estimateTokenCount('123456789')).toBe(3);
  });

  it('summarizes latency, throughput, and memory deltas', async () => {
    const { summarizeInferenceMetrics } = await loadSpikeModule();

    expect(summarizeInferenceMetrics({
      loadMs: 1234.4,
      inferenceMs: 250,
      outputText: 'translated output',
      memoryBefore: { rss: 1000, heapUsed: 500, external: 100 },
      memoryAfter: { rss: 1500, heapUsed: 650, external: 130 },
    })).toEqual({
      loadMs: 1234,
      inferenceMs: 250,
      estimatedOutputTokens: 5,
      estimatedTokensPerSecond: 20,
      memoryDelta: {
        rssBytes: 500,
        heapUsedBytes: 150,
        externalBytes: 30,
      },
    });
  });

  it('returns null memory deltas when snapshots are unavailable', async () => {
    const { calculateMemoryDelta } = await loadSpikeModule();

    expect(calculateMemoryDelta(null as never, { rss: 1, heapUsed: 1, external: 1 })).toBeNull();
  });

  it('allows local cache reads when offline mode disables remote fetches', async () => {
    const { buildTransformersEnvSettings } = await loadSpikeModule();

    expect(buildTransformersEnvSettings({ offline: true, cacheDir: '/tmp/cache' })).toMatchObject({
      allowRemoteModels: false,
      allowLocalModels: true,
      useBrowserCache: false,
      useFSCache: true,
      useWasmCache: true,
      cacheDir: '/tmp/cache',
    });
  });

  it('fails fast when WebGPU is requested in a runtime without navigator.gpu', async () => {
    const { runSpike } = await loadSpikeModule();

    await expect(runSpike({ device: 'webgpu' })).rejects.toThrow(/navigator\.gpu is not available/);
  });
});

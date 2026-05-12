#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const DEFAULT_OPTIONS = Object.freeze({
  model: 'Xenova/opus-mt-en-de',
  device: 'auto',
  dtype: 'q8',
  text: 'Hello world. I like apples. This is a local translation smoke test.',
  cacheDir: '.cache/transformers-v4-spike',
  offline: false,
  maxLength: 512,
});

const SUPPORTED_DEVICES = new Set(['auto', 'webgpu', 'wasm', 'cpu']);

export function parseSpikeArgs(argv) {
  const options = { ...DEFAULT_OPTIONS };

  for (const arg of argv) {
    if (arg === '--offline') {
      options.offline = true;
      continue;
    }

    const [key, ...valueParts] = arg.replace(/^--/, '').split('=');
    const value = valueParts.join('=');

    switch (key) {
      case 'model':
      case 'device':
      case 'dtype':
      case 'text':
      case 'cache-dir':
        if (!value) {
          throw new Error(`Missing value for --${key}`);
        }
        options[key === 'cache-dir' ? 'cacheDir' : key] = value;
        break;
      case 'max-length': {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error('--max-length must be a positive integer');
        }
        options.maxLength = parsed;
        break;
      }
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (!SUPPORTED_DEVICES.has(options.device)) {
    throw new Error(`Unsupported device "${options.device}". Use auto, webgpu, wasm, or cpu.`);
  }

  return options;
}

export function resolveSpikeDevice(requestedDevice, hasWebGpu, isNodeRuntime = true) {
  if (requestedDevice === 'auto') {
    return hasWebGpu ? 'webgpu' : (isNodeRuntime ? 'cpu' : 'wasm');
  }

  if (requestedDevice === 'wasm' && isNodeRuntime) {
    return 'cpu';
  }

  return requestedDevice;
}

export function estimateTokenCount(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).trim().length / 4));
}

export function calculateMemoryDelta(before, after) {
  if (!before || !after) return null;
  return {
    rssBytes: after.rss - before.rss,
    heapUsedBytes: after.heapUsed - before.heapUsed,
    externalBytes: after.external - before.external,
  };
}

export function summarizeInferenceMetrics({ loadMs, inferenceMs, outputText, memoryBefore, memoryAfter }) {
  const estimatedOutputTokens = estimateTokenCount(outputText);
  const inferenceSeconds = Math.max(inferenceMs / 1000, 0.001);

  return {
    loadMs: Math.round(loadMs),
    inferenceMs: Math.round(inferenceMs),
    estimatedOutputTokens,
    estimatedTokensPerSecond: Number((estimatedOutputTokens / inferenceSeconds).toFixed(2)),
    memoryDelta: calculateMemoryDelta(memoryBefore, memoryAfter),
  };
}

export function buildTransformersEnvSettings(options) {
  const offline = options.offline === true;

  return {
    allowRemoteModels: !offline,
    allowLocalModels: offline,
    useBrowserCache: false,
    useFSCache: true,
    useWasmCache: true,
    cacheDir: resolve(options.cacheDir || DEFAULT_OPTIONS.cacheDir),
  };
}

function hasNavigatorWebGpu() {
  return typeof globalThis.navigator !== 'undefined' && Boolean(globalThis.navigator.gpu);
}

function isNodeRuntime() {
  return typeof process !== 'undefined' && Boolean(process.versions?.node);
}

function memorySnapshot() {
  return typeof process.memoryUsage === 'function' ? process.memoryUsage() : null;
}

function normalizePipelineOutput(result) {
  if (!Array.isArray(result) || result.length === 0) return '';
  const first = result[0];
  return typeof first?.translation_text === 'string' ? first.translation_text : '';
}

export async function runSpike(rawOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...rawOptions };
  const hasWebGpu = hasNavigatorWebGpu();
  const device = resolveSpikeDevice(options.device, hasWebGpu, isNodeRuntime());

  if (device === 'webgpu' && !hasWebGpu) {
    throw new Error(
      'WebGPU was requested, but navigator.gpu is not available in this runtime. ' +
      'Run this in a WebGPU-capable browser context, or use --device=cpu for a cache/quality smoke test.'
    );
  }

  const cacheDir = resolve(options.cacheDir);
  await mkdir(cacheDir, { recursive: true });

  const { env, pipeline } = await import('@huggingface/transformers');
  const envSettings = buildTransformersEnvSettings(options);
  env.allowRemoteModels = envSettings.allowRemoteModels;
  env.allowLocalModels = envSettings.allowLocalModels;
  env.useBrowserCache = envSettings.useBrowserCache;
  env.useFSCache = envSettings.useFSCache;
  env.cacheDir = envSettings.cacheDir;
  env.useWasmCache = envSettings.useWasmCache;

  const progressEvents = [];
  const memoryBefore = memorySnapshot();
  const loadStart = performance.now();
  const translator = await pipeline('translation', options.model, {
    device,
    dtype: options.dtype,
    local_files_only: options.offline,
    progress_callback: (progress) => {
      progressEvents.push({
        status: progress?.status,
        file: progress?.file,
        progress: progress?.progress,
      });
    },
  });
  const loadMs = performance.now() - loadStart;

  const inferenceStart = performance.now();
  const result = await translator(options.text, { max_length: options.maxLength });
  const inferenceMs = performance.now() - inferenceStart;
  const outputText = normalizePipelineOutput(result);
  const memoryAfter = memorySnapshot();

  return {
    transformersVersion: env.version,
    model: options.model,
    device,
    dtype: options.dtype,
    offline: options.offline,
    inputText: options.text,
    outputText,
    progressEventCount: progressEvents.length,
    ...summarizeInferenceMetrics({
      loadMs,
      inferenceMs,
      outputText,
      memoryBefore,
      memoryAfter,
    }),
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  runSpike(parseSpikeArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2));
      process.exitCode = 1;
    });
}

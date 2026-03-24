import { gpuTest as test, expect, offscreenUrl } from './fixtures';

test.describe('WebGPU Detection (GPU Enabled)', () => {
  test('detects WebGPU and shader-f16 capability', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(offscreenUrl(extensionId));
    await page.waitForLoadState('domcontentloaded');

    const gpuInfo = await page.evaluate(async () => {
      const gpu = (navigator as { gpu?: GPU }).gpu;
      if (!gpu) {
        return { supported: false, reason: 'navigator.gpu undefined' };
      }
      try {
        const adapter = await gpu.requestAdapter();
        if (!adapter) {
          return { supported: false, reason: 'requestAdapter returned null' };
        }
        const features = [...adapter.features];
        const fp16 = features.includes('shader-f16');
        const limits = {
          maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX,
          maxBufferSize: adapter.limits.maxBufferSize,
          maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        };
        const info = await adapter.requestAdapterInfo?.() || {};
        return {
          supported: true,
          fp16,
          features: features.slice(0, 10), // Limit for readability
          limits,
          vendor: (info as { vendor?: string }).vendor || 'unknown',
          architecture: (info as { architecture?: string }).architecture || 'unknown',
          description: (info as { description?: string }).description || 'unknown',
        };
      } catch (error) {
        return { supported: false, reason: String(error) };
      }
    });

    console.log('WebGPU detection result:');
    console.log(JSON.stringify(gpuInfo, null, 2));

    // In this test, GPU is enabled, so WebGPU SHOULD be available on macOS with Apple Silicon
    // But we don't fail if it's not — we just report the fallback path
    if (gpuInfo.supported) {
      console.log('\n--- EXPECTED FALLBACK CHAIN ---');
      if (gpuInfo.fp16) {
        console.log('Path: webgpu+q4f16 -> webgpu+q4 -> wasm+q4');
        console.log('Expected: q4f16 will fail with fp16 type mismatch, q4 should succeed');
      } else {
        console.log('Path: webgpu+q4 -> wasm+q4');
        console.log('Expected: q4 (fp32 compute) should succeed directly');
      }
    } else {
      console.log('\n--- EXPECTED FALLBACK CHAIN ---');
      console.log('Path: wasm+q4 (direct)');
      console.log(`Reason: ${gpuInfo.reason}`);
    }

    await page.close();
  });
});

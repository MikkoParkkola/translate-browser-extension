import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const CHROMIUM_EXECUTABLE_PATH_ENV = 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH';
const ORIGINAL_EXECUTABLE_PATH = process.env[CHROMIUM_EXECUTABLE_PATH_ENV];

afterEach(() => {
  if (typeof ORIGINAL_EXECUTABLE_PATH === 'string') {
    process.env[CHROMIUM_EXECUTABLE_PATH_ENV] = ORIGINAL_EXECUTABLE_PATH;
    return;
  }

  delete process.env[CHROMIUM_EXECUTABLE_PATH_ENV];
});

describe('getExtensionLaunchSettings', () => {
  it('returns no executable override by default', async () => {
    delete process.env[CHROMIUM_EXECUTABLE_PATH_ENV];
    const { getExtensionLaunchSettings } = await import('./extension-launch');

    expect(getExtensionLaunchSettings()).toEqual(
      expect.objectContaining({
        executablePath: undefined,
      }),
    );
  });

  it('passes through the explicit executable override', async () => {
    process.env[CHROMIUM_EXECUTABLE_PATH_ENV] =
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const { getExtensionLaunchSettings } = await import('./extension-launch');

    expect(getExtensionLaunchSettings()).toEqual(
      expect.objectContaining({
        executablePath:
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      }),
    );
  });
});

describe('assertBuiltExtensionExists', () => {
  it('accepts an unpacked extension build with a manifest', async () => {
    const { assertBuiltExtensionExists, getExtensionManifestPath } =
      await import('./extension-launch');
    const extensionPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'translate-extension-build-'),
    );

    try {
      fs.writeFileSync(getExtensionManifestPath(extensionPath), '{}');
      expect(() => assertBuiltExtensionExists(extensionPath)).not.toThrow();
    } finally {
      fs.rmSync(extensionPath, { recursive: true, force: true });
    }
  });

  it('throws a clear error when the unpacked extension build is missing', async () => {
    const { assertBuiltExtensionExists, getExtensionManifestPath } =
      await import('./extension-launch');
    const extensionPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'translate-extension-missing-'),
    );

    try {
      const manifestPath = getExtensionManifestPath(extensionPath);

      let thrown: unknown;
      try {
        assertBuiltExtensionExists(extensionPath);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain(manifestPath);
      expect((thrown as Error).message).toContain(
        'downloads the dist artifact into dist/',
      );
    } finally {
      fs.rmSync(extensionPath, { recursive: true, force: true });
    }
  });
});

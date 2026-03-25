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
      })
    );
  });

  it('passes through the explicit executable override', async () => {
    process.env[CHROMIUM_EXECUTABLE_PATH_ENV] =
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const { getExtensionLaunchSettings } = await import('./extension-launch');

    expect(getExtensionLaunchSettings()).toEqual(
      expect.objectContaining({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      })
    );
  });
});

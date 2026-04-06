import path from 'path';

export const EXTENSION_PATH = path.resolve(__dirname, '..', 'dist');
const BACKGROUND_MODE = process.env.BACKGROUND !== 'false';
const CHROMIUM_EXECUTABLE_PATH_ENV = 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH';
const FORCE_HEADED_EXTENSION_ENV = 'PLAYWRIGHT_EXTENSION_HEADED';
const FORCE_HEADLESS_EXTENSION_ENV = 'PLAYWRIGHT_EXTENSION_HEADLESS';

export interface ExtensionLaunchOptions {
  enableGpu?: boolean;
}

export interface ExtensionLaunchSettings {
  headless: boolean;
  channel?: 'chromium';
  args: string[];
  executablePath?: string;
}

function shouldUseHeadlessExtensionMode(): boolean {
  if (process.env[FORCE_HEADED_EXTENSION_ENV] === 'true') {
    return false;
  }

  if (process.env[FORCE_HEADLESS_EXTENSION_ENV] === 'true') {
    return true;
  }

  return process.env.CI === 'true';
}

export function buildExtensionArgs(
  { enableGpu = false }: ExtensionLaunchOptions = {},
  headless = false
): string[] {
  return [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run',
    '--disable-component-update',
    // Keep GPU-dependent coverage behind gpuTest; the default fixture should stay
    // on the most stable launch path for CI-hosted extension smoke runs.
    ...(enableGpu ? [] : ['--disable-gpu']),
    ...(BACKGROUND_MODE && !headless
      ? [
          '--window-position=-32000,-32000',
          '--window-size=1280,720',
          '--mute-audio',
        ]
      : []),
  ];
}

function readChromiumExecutablePathOverride(): string | undefined {
  const executablePath = process.env[CHROMIUM_EXECUTABLE_PATH_ENV];
  return typeof executablePath === 'string' && executablePath.length > 0
    ? executablePath
    : undefined;
}

export function getExtensionLaunchSettings(
  options: ExtensionLaunchOptions = {}
): ExtensionLaunchSettings {
  const executablePath = readChromiumExecutablePathOverride();
  const headless = shouldUseHeadlessExtensionMode();

  return {
    // Playwright's bundled chromium channel supports MV3 extensions in headless
    // mode, which avoids the flaky Linux/Xvfb headed launch path in CI.
    headless,
    channel: headless && !executablePath ? 'chromium' : undefined,
    args: buildExtensionArgs(options, headless),
    executablePath,
  };
}

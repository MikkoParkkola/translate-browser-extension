import path from 'path';

export const EXTENSION_PATH = path.resolve(__dirname, '..', 'dist');
const BACKGROUND_MODE = process.env.BACKGROUND !== 'false';
const CHROMIUM_EXECUTABLE_PATH_ENV = 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH';

export interface ExtensionLaunchOptions {
  enableGpu?: boolean;
}

export interface ExtensionLaunchSettings {
  headless: boolean;
  args: string[];
  executablePath?: string;
}

export function buildExtensionArgs({ enableGpu = false }: ExtensionLaunchOptions = {}): string[] {
  return [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run',
    '--disable-component-update',
    // Keep GPU-dependent coverage behind gpuTest; the default fixture should stay
    // on the most stable launch path for CI-hosted extension smoke runs.
    ...(enableGpu ? [] : ['--disable-gpu']),
    ...(BACKGROUND_MODE
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
  return {
    headless: false,
    args: buildExtensionArgs(options),
    executablePath: readChromiumExecutablePathOverride(),
  };
}

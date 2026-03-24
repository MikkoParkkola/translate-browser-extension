import path from 'path';

export const EXTENSION_PATH = path.resolve(__dirname, '..', 'dist');
const BACKGROUND_MODE = process.env.BACKGROUND !== 'false';

export interface ExtensionLaunchOptions {
  enableGpu?: boolean;
}

export interface ExtensionLaunchSettings {
  headless: boolean;
  args: string[];
}

export function buildExtensionArgs({ enableGpu = false }: ExtensionLaunchOptions = {}): string[] {
  return [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run',
    '--disable-component-update',
    ...(BACKGROUND_MODE
      ? [
          '--window-position=-32000,-32000',
          '--window-size=1280,720',
          ...(enableGpu ? [] : ['--disable-gpu']),
          '--mute-audio',
        ]
      : []),
  ];
}

export function getExtensionLaunchSettings(
  options: ExtensionLaunchOptions = {}
): ExtensionLaunchSettings {
  return {
    headless: false,
    args: buildExtensionArgs(options),
  };
}

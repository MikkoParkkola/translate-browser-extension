declare module 'popup/providerEditor.js' {
  export {};
}

export interface QwenProviderEditor {
  open(id: string, config: any, onDone?: () => void): Promise<void>;
}

declare global {
  interface Window {
    qwenProviderEditor?: QwenProviderEditor;
  }
}

export {};

export interface BackgroundRequestOptions {
  endpoint?: string;
  apiKey?: string;
  model?: string;
  text: string;
  source?: string;
  target: string;
  debug?: boolean;
  stream?: boolean;
  signal?: AbortSignal;
  onData?: (chunk: string) => void;
  provider?: string;
  providerOrder?: string[];
  endpoints?: Record<string, string>;
  failover?: boolean;
  parallel?: boolean | 'auto';
}

export interface DetectOptions {
  text: string;
  detector?: string;
  debug?: boolean;
  sensitivity?: number;
  minLength?: number;
}

export declare function requestViaBackground(opts: BackgroundRequestOptions): Promise<{ text: string }>;
export declare function detectLanguage(opts: DetectOptions): Promise<{ lang: string; confidence?: number }>;

export declare const qwenMessaging: {
  requestViaBackground: typeof requestViaBackground;
  detectLanguage: typeof detectLanguage;
};
